import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Tokens } from '@image-host/backend-services/composition';
import { fakeEnv } from '../helpers/fakeD1';
import { urlOf } from '../helpers/fetchUrl';

/**
 * The composition root, and specifically how it reads the bot token.
 *
 * The binding is a `SecretsStoreSecret`: no readable properties, one async
 * `get()`. This suite exists because the alternative was invisible — the token
 * used to be read as `env.IMAGE_HOST_SECRETS.TELEGRAM_BOT_TOKEN`, which is
 * `undefined` on every request, and the test double faked a
 * `{ TELEGRAM_BOT_TOKEN: … }` shape that no runtime has. Every route test passed
 * and every upload in production failed.
 *
 * So the assertions here are about the *shape* of the binding rather than about
 * `Container`'s own logic: a double that does not match the platform is what let
 * the bug ship, and only an assertion that goes all the way to the outgoing
 * request can tell the two apart.
 */

const TOKEN = '424242:SECRET-TOKEN-FROM-THE-STORE';

/**
A binding that fails the way a Secrets Store does when the entry is absent.
*/
function unreadableBinding(reason: string) {
  return {
    get: async (): Promise<string> => {
      throw new Error(reason);
    },
  };
}

/**
The `/sendDocument` response an upload needs to complete.
*/
function sendDocumentResponse(): Response {
  return Response.json({
    ok: true,
    result: {
      message_id: 900,
      date: 1,
      chat: { id: -100_999, type: 'supergroup' },
      document: { file_id: 'TELEGRAM-FILE-ID', file_unique_id: 'U', file_name: 'photo.png' },
    },
  });
}

function pngFile(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'photo.png', { type: 'image/png' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Container', () => {
  it('sends the token from the Secrets Store binding on upload', async () => {
    const requested: string[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(urlOf(input));
      return sendDocumentResponse();
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { env } = fakeEnv({ IMAGE_HOST_SECRETS: { get: async (): Promise<string> => TOKEN } });
    const container = new Container(env);

    const images = await container.get(Tokens.ImageService);
    await images.upload('owner@example.com', 'https://img.example.com', pngFile());

    // The token has to appear in the *URL path*, which is where Telegram reads it.
    // Asserting it reached the client at all would pass while the upload still
    // 404s, because a client holding `undefined` builds `botundefined/sendDocument`
    // — and Telegram answers that with `404 Not Found`.
    expect(requested[0]).toContain(`/bot${TOKEN}/sendDocument`);
    expect(requested[0]).not.toContain('undefined');
  });

  it('reads the secret once per container, however many services are asked for', async () => {
    const get = vi.fn(async (): Promise<string> => TOKEN);
    const { env } = fakeEnv({ IMAGE_HOST_SECRETS: { get } });
    const container = new Container(env);

    await container.get(Tokens.ImageService);
    await container.get(Tokens.ImageService);
    await container.get(Tokens.ImagesDAO);

    // The token is read once and memoized under a private key. A second read is
    // a second chance to observe a half-initialised binding.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('names the secret when the binding cannot be read', async () => {
    const { env } = fakeEnv({ IMAGE_HOST_SECRETS: unreadableBinding('secret not found') });
    const container = new Container(env);

    // A named 500 beats a `BadGatewayError` that reads like Telegram being down.
    // The secret is named because `get()` takes no name argument: the binding
    // itself carries no properties, so there is nothing else to quote.
    await expect(container.get(Tokens.ImageService)).rejects.toThrow(
      /image-host-telegram-bot-token.*IMAGE_HOST_SECRETS.*secret not found/i,
    );
  });

  it('refuses an empty secret rather than sending one Telegram cannot resolve', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => sendDocumentResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const { env } = fakeEnv({ IMAGE_HOST_SECRETS: { get: async (): Promise<string> => '' } });
    const container = new Container(env);

    await expect(container.get(Tokens.ImageService)).rejects.toThrow(/is empty/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('names the var when the chat id is missing', async () => {
    const { env } = fakeEnv({ TELEGRAM_CHAT_ID: '' });
    const container = new Container(env);

    await expect(container.get(Tokens.ImageService)).rejects.toThrow(/TELEGRAM_CHAT_ID/);
  });
});
