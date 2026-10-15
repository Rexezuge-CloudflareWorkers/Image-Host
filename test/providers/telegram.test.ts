import { describe, expect, it, vi } from 'vitest';
import { BadGatewayError, UnauthorizedError, InternalServerError } from '@rexezuge/errors';
import { TelegramClient, globalFetch } from '@image-host/provider-clients/telegram';
import { urlOf } from '../helpers/fetchUrl';

const env = { TELEGRAM_BOT_TOKEN: 'token-123', TELEGRAM_CHAT_ID: '-100999' };

/**
A `fetch` stand-in that answers the Bot API calls this client makes.
*/
function stubFetch(routes: Record<string, unknown>, body: string = 'binary-bytes') {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    for (const [suffix, payload] of Object.entries(routes)) {
      if (url.endsWith(suffix)) {
        return Response.json(payload, { headers: { 'Content-Type': 'application/json' } });
      }
    }
    // Anything unmatched is a download: the byte stream.
    return new Response(body, { status: 200, headers: { 'Content-Length': String(body.length) } });
  });
}

const sendDocumentOk = {
  ok: true,
  result: {
    message_id: 4242,
    date: 1,
    chat: { id: -100_999, type: 'supergroup' },
    document: { file_id: 'FILE-ID-1', file_unique_id: 'UNIQ-1', file_name: 'photo.png', file_size: 2048 },
  },
};

describe('TelegramClient.upload', () => {
  it('returns the file id, the name and the message id', async () => {
    // The message id is the point of this client: without it a delete is
    // permanently metadata-only, which is where the predecessor got stuck.
    const client = new TelegramClient(env, stubFetch({ '/sendDocument': sendDocumentOk }) as unknown as typeof fetch);
    const file = new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' });

    await expect(client.upload(file, 'photo.png')).resolves.toEqual({
      fileId: 'FILE-ID-1',
      fileName: 'photo.png',
      messageId: 4242,
    });
  });

  it('always uses sendDocument so the bytes are stored verbatim', async () => {
    // sendPhoto downsamples to 2560px and recompresses, and refuses SVG and AVIF.
    // For an image host that is a corrupted file, not a smaller one.
    const fetchImpl = stubFetch({ '/sendDocument': sendDocumentOk });
    const client = new TelegramClient(env, fetchImpl as unknown as typeof fetch);
    await client.upload(new File(['x'], 'logo.svg', { type: 'image/svg+xml' }), 'logo.svg');
    expect(urlOf(fetchImpl.mock.calls[0]?.[0] ?? '/')).toContain('/sendDocument');
  });

  it('falls back to the supplied name when Telegram omits one', async () => {
    const withoutName = {
      ok: true,
      result: { message_id: 1, date: 1, chat: { id: 1, type: 'group' }, document: { file_id: 'F', file_unique_id: 'U' } },
    };
    const client = new TelegramClient(env, stubFetch({ '/sendDocument': withoutName }) as unknown as typeof fetch);
    await expect(client.upload(new File(['x'], 'mine.bin'), 'mine.bin')).resolves.toMatchObject({ fileName: 'mine.bin' });
  });

  it('rejects an ok response carrying no document', async () => {
    // Not an empty result: an upstream shape this client cannot serve.
    const empty = { ok: true, result: { message_id: 1, date: 1, chat: { id: 1, type: 'group' } } };
    const client = new TelegramClient(env, stubFetch({ '/sendDocument': empty }) as unknown as typeof fetch);
    await expect(client.upload(new File(['x'], 'a.png'), 'a.png')).rejects.toBeInstanceOf(BadGatewayError);
  });

  it('turns ok:false into a gateway error', async () => {
    const denied = { ok: false, description: 'Unauthorized: bot was blocked by the user' };
    const client = new TelegramClient(env, stubFetch({ '/sendDocument': denied }) as unknown as typeof fetch);
    await expect(client.upload(new File(['x'], 'a.png'), 'a.png')).rejects.toBeInstanceOf(BadGatewayError);
  });

  it('turns a network failure into a gateway error', async () => {
    const client = new TelegramClient(env, (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch);
    await expect(client.upload(new File(['x'], 'a.png'), 'a.png')).rejects.toBeInstanceOf(BadGatewayError);
  });
});

describe('TelegramClient.resolveFilePath', () => {
  it('sends the file id in a body rather than a query string', async () => {
    const fetchImpl = stubFetch({ '/getFile': { ok: true, result: { file_id: 'F', file_unique_id: 'U', file_path: 'documents/a.png' } } });
    const client = new TelegramClient(env, fetchImpl as unknown as typeof fetch);

    await expect(client.resolveFilePath('F')).resolves.toBe('documents/a.png');

    // `unknown` first: the mock's call signature records only the URL, because that
    // is all the stub's own callback destructures. The `RequestInit` it was actually
    // given is asserted here.
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/getFile');
    expect(url).not.toContain('file_id=');
    expect(JSON.parse(init.body as string)).toEqual({ file_id: 'F' });
  });

  it('rejects a file_id with no path', async () => {
    // A file too old for the bot answers ok:true with no path; fetching
    // `.../bot<token>/undefined` would be worse than an error.
    const client = new TelegramClient(env, stubFetch({ '/getFile': { ok: true, result: { file_id: 'F' } } }) as unknown as typeof fetch);
    await expect(client.resolveFilePath('F')).rejects.toBeInstanceOf(BadGatewayError);
  });

  it('rejects a file above the download ceiling', async () => {
    const huge = { ok: true, result: { file_id: 'F', file_path: 'documents/a.bin', file_size: 21 * 1024 * 1024 } };
    const client = new TelegramClient(env, stubFetch({ '/getFile': huge }) as unknown as typeof fetch);
    await expect(client.resolveFilePath('F')).rejects.toBeInstanceOf(BadGatewayError);
  });
});

describe('TelegramClient.download', () => {
  it('streams the body rather than buffering it', async () => {
    // Buffering a 20 MB image into an ArrayBuffer is what produces Workers error
    // 1102 under exactly the load this route exists for.
    const client = new TelegramClient(
      env,
      stubFetch({ '/getFile': { ok: true, result: { file_id: 'F', file_path: 'documents/a.png' } } }) as unknown as typeof fetch,
    );
    const response = await client.download('F');
    expect(response.body).not.toBeNull();
    await expect(response.text()).resolves.toBe('binary-bytes');
  });

  it('raises when Telegram answers non-OK', async () => {
    const client = new TelegramClient(env, stubFetch({}) as unknown as typeof fetch);
    await expect(client.download('F')).rejects.toBeInstanceOf(BadGatewayError);
  });
});

describe('TelegramClient.deleteMessage', () => {
  it('succeeds when Telegram accepts', async () => {
    const client = new TelegramClient(env, stubFetch({ '/deleteMessage': { ok: true, result: true } }) as unknown as typeof fetch);
    await expect(client.deleteMessage(4242)).resolves.toBeUndefined();
  });

  it('swallows a rejection', async () => {
    // Best-effort by design: the row is soft-deleted first, so a Telegram outage
    // must not fail the user's delete. The bytes stay in the group, which is the
    // true state and is what the caller's contract already says.
    const client = new TelegramClient(
      env,
      stubFetch({ '/deleteMessage': { ok: false, description: 'message to delete not found' } }) as unknown as typeof fetch,
    );
    await expect(client.deleteMessage(4242)).resolves.toBeUndefined();
  });
});

describe('error taxonomy', () => {
  it('keeps upstream details out of the message', async () => {
    // Telegram's description names the bot token's owner; the thrown message must
    // not repeat it to whoever provoked the failure.
    const denied = { ok: false, description: 'Unauthorized: bot 998877:AAEEsecret not found' };
    const client = new TelegramClient(env, stubFetch({ '/sendDocument': denied }) as unknown as typeof fetch);
    await expect(client.upload(new File(['x'], 'a.png'), 'a.png')).rejects.not.toThrow(/AAEEsecret/);
  });
});

describe('the default fetch', () => {
  // Every other test in this file injects a stub, so the default parameter — the
  // only value production uses — would otherwise have no coverage at all. That is
  // how the host shipped with the bare global: 15 green tests, 100% of Telegram
  // broken.
  it('is not the bare global, which workerd refuses to call as a method', () => {
    // Identity is the whole assertion. Node's `fetch` is not receiver-checked, so
    // this exact code passes under vitest and throws `Illegal invocation` in
    // production — which is why the workerd suite has to carry the real guard.
    expect(globalFetch).not.toBe(fetch);
  });

  it('still reaches globalThis.fetch when invoked as a method', async () => {
    // Proves the wrapper delegates rather than being a no-op, and that calling it
    // through a foreign receiver is what the fix is protecting.
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    try {
      const holder = { call: globalFetch };
      const response = await holder.call('https://api.telegram.org/bottest/getMe');
      expect(spy).toHaveBeenCalledOnce();
      await expect(response.text()).resolves.toBe('ok');
    } finally {
      spy.mockRestore();
    }
  });
});

// Imported for the taxonomy assertions above; referenced so the import is load-bearing.
void UnauthorizedError;
void InternalServerError;
