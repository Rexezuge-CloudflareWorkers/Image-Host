import { BadGatewayError } from '@rexezuge/errors';
import { log } from '@image-host/shared/utils/Logger';
import type { TelegramApiResponse, TelegramDocument, TelegramFile, TelegramMessage } from './types';

const API_BASE = 'https://api.telegram.org';
const FILE_BASE = 'https://api.telegram.org/file';

/**
 * The global `fetch`, wrapped so it survives being called as a method.
 *
 * ### Why the wrapper exists
 *
 * On workerd `fetch` is not a free function. It is `JSG_METHOD(fetch)` on
 * `ServiceWorkerGlobalScope`, so it must be invoked with `this === globalThis`.
 * Store the bare global on an object and call it as a method — which is the
 * obvious way to inject a `fetch` for testing — and the receiver becomes the
 * holder, V8 rejects it, and every call throws `TypeError: Illegal invocation`
 * before the native callback ever runs.
 *
 * `undefined` is the one receiver that is *also* valid: V8 converts it to the
 * global proxy. So the same function value behaves correctly when called freely
 * and fails when called as a method, which is what makes this read as arbitrary.
 *
 * The wrapper fixes the stored _value_ rather than the call site, so every
 * `this.fetchImpl(...)` is receiver-safe without knowing whether the value is the
 * default or an injected stub. `typeof fetch` is a plain function signature, so
 * `tsc` and ESLint cannot see any of this, and Node's `fetch` is not
 * receiver-checked, so the unit suite cannot either. The guard lives in
 * `test/integration/telegram.int.test.ts`, which runs in workerd.
 */
export const globalFetch: typeof fetch = (input, init) => fetch(input, init);

/**
Telegram's own ceiling; exceeding it means `getFile` never returns a path.
*/
const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export interface TelegramUpload {
  fileId: string;
  fileName: string;
  /**
   * The message id in the group.
   *
   * Captured because `deleteMessage` needs it and `file_id` does not contain it.
   * The predecessor this replaces stored the file id and nothing else, which is
   * why its delete was permanently metadata-only: without a message id there is
   * nothing to delete, and the bytes stayed in the group forever.
   */
  messageId: number;
}

export interface TelegramClientEnv {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

/**
 * The only external storage this host has.
 *
 * ### Why every upload is `sendDocument`
 *
 * `sendPhoto` is the obvious choice for images and it is what the predecessor
 * used, but Telegram downsamples `sendPhoto` uploads to a maximum edge of 2560px
 * and recompresses them, and it refuses formats it cannot represent — SVG and
 * AVIF among them. This host's entire contract is that the bytes a user uploads
 * are the bytes the share link serves, so a transparent PNG that comes back as a
 * flattened JPEG is not a smaller file, it is a corrupted one.
 *
 * `sendDocument` stores the upload verbatim. The cost is that documents get no
 * inline preview in the Telegram client itself, which is an acceptable trade for
 * a host whose product *is* the file.
 *
 * One code path also means one thing to get wrong, rather than five MIME-specific
 * branches — of which the predecessor's was missing the `audio` case entirely,
 * so an uploaded sound file threw a `TypeError` and returned a 500.
 */
export class TelegramClient {
  constructor(
    private readonly env: TelegramClientEnv,
    private readonly fetchImpl: typeof fetch = globalFetch,
  ) {}

  /**
  Uploads a file into the configured group and returns its stored handle.
  */
  public async upload(file: File, fileName: string): Promise<TelegramUpload> {
    const form = new FormData();
    form.append('chat_id', this.env.TELEGRAM_CHAT_ID);
    form.append('document', file, fileName);

    const message = await this.call<TelegramMessage>('/sendDocument', form);

    const document = message.document;
    if (!document) {
      // Telegram answering `ok: true` with no document is not a shape this client
      // can serve, so it is an upstream failure rather than an empty result.
      throw new BadGatewayError('Telegram accepted the upload but returned no document.');
    }
    return {
      fileId: document.file_id,
      fileName: document.file_name || fileName,
      messageId: message.message_id,
    };
  }

  /**
  Resolves a `file_id` to the path `getFile` will serve it from.
  */
  public async resolveFilePath(fileId: string): Promise<string> {
    // The id goes in a JSON body rather than a query string. Telegram's Bot API
    // takes either, and a `file_id` is base64url — long enough that hand-building
    // the query is a chance to forget the encoding step, and the body form has no
    // such step.
    const file = await this.call<TelegramFile>('/getFile', { file_id: fileId });
    if (!file.file_path) {
      throw new BadGatewayError('Telegram returned no file path.');
    }
    if (file.file_size !== undefined && file.file_size > TELEGRAM_MAX_DOWNLOAD_BYTES) {
      throw new BadGatewayError('File exceeds the Telegram download limit and cannot be served.');
    }
    return file.file_path;
  }

  /**
   * Fetches the stored bytes.
   *
   * The response body is returned unbuffered rather than read into an ArrayBuffer:
   * a 20 MB image read whole costs the isolate its memory and shows up as error
   * 1102 under exactly the concurrent-load conditions this route exists for.
   */
  public async download(fileId: string): Promise<Response> {
    const filePath = await this.resolveFilePath(fileId);
    const url = `${FILE_BASE}/bot${this.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
    const upstream = await this.fetchImpl(url);
    if (!upstream.ok || !upstream.body) {
      log.warn('Telegram download failed', { fileId, status: upstream.status });
      throw new BadGatewayError('Unable to fetch the file from Telegram.');
    }
    return upstream;
  }

  /**
   * Removes a message from the group.
   *
   * Best-effort by design: the row is soft-deleted first and this is the cleanup
   * that follows, so a Telegram outage must not resurrect the image *or* fail the
   * user's delete. Callers treat a rejection as "the bytes are still in the
   * group", which is the true state.
   */
  public async deleteMessage(messageId: number): Promise<void> {
    try {
      await this.call<boolean>('/deleteMessage', { chat_id: this.env.TELEGRAM_CHAT_ID, message_id: messageId });
    } catch (error) {
      log.warn('Telegram deleteMessage failed', { messageId, error: error instanceof Error ? error.message : error });
    }
  }

  /**
   * One Bot API call.
   *
   * Both failure modes — a non-2xx HTTP status and a 200 with `ok: false` — are
   * the same outcome to a caller, so they raise the same error. Only `description`
   * goes to the log; it names the method and, for auth failures, enough of the
   * token to be worth not returning.
   */
  private async call<T>(method: string, body: FormData | Record<string, unknown>): Promise<T> {
    const url = `${API_BASE}/bot${this.env.TELEGRAM_BOT_TOKEN}${method}`;
    const isForm = body instanceof FormData;
    const init: RequestInit = {
      method: 'POST',
      body: isForm ? body : JSON.stringify(body),
      ...(!isForm && { headers: { 'Content-Type': 'application/json' } }),
    };

    let payload: TelegramApiResponse<T>;
    try {
      const response = await this.fetchImpl(url, init);
      payload = (await response.json()) as TelegramApiResponse<T>;
    } catch (error) {
      log.warn('Telegram request failed', { method, error: error instanceof Error ? error.message : error });
      throw new BadGatewayError('Telegram is unreachable.');
    }

    if (!payload.ok || payload.result === undefined) {
      log.warn('Telegram rejected a request', { method, description: payload.description, errorCode: payload.error_code });
      throw new BadGatewayError('Telegram rejected the request.');
    }
    return payload.result;
  }
}

/**
 * Picks the largest photo size from a `sendPhoto` response.
 *
 * Unused by `upload` — `sendDocument` does not return `photo` — but exported
 * because a group that predates this host was populated through `sendPhoto`, and
 * resolving one of *those* messages to a file id needs it.
 */
export function largestPhoto(photos: TelegramDocument[]): TelegramDocument | null {
  if (photos.length === 0) return null;
  return photos.reduce(
    (previous, current) => ((previous.file_size ?? 0) > (current.file_size ?? 0) ? previous : current),
    photos[0] ?? null,
  );
}
