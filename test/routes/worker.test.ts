import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@image-host/api/workers/ImageHostWorker';
import { fakeEnv } from '../helpers/fakeD1';
import { testContext, json, type ErrorEnvelope } from '../helpers/worker';
import { urlOf } from '../helpers/fetchUrl';

/**
 * The routing and middleware around the DAOs.
 *
 * `test/integration/**` is the authority on anything SQLite-specific. This suite
 * covers the layer above it — the auth boundary, the CSRF check, the error mask,
 * the three-state root — which integration tests cannot reach without driving a
 * `fetch` handler through workerd.
 */

const app = createApp();

/**
The upload flow's Telegram call, stubbed.
*/
function stubTelegram() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('/sendDocument')) {
      return Response.json(
        {
          ok: true,
          result: {
            message_id: 900,
            date: 1,
            chat: { id: -100_999, type: 'supergroup' },
            document: { file_id: 'TELEGRAM-FILE-ID', file_unique_id: 'U', file_name: 'photo.png' },
          },
        },
        { headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/getFile')) {
      return Response.json(
        { ok: true, result: { file_id: 'TELEGRAM-FILE-ID', file_path: 'documents/photo.png' } },
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return new Response('image-bytes', { status: 200, headers: { 'Content-Length': '11' } });
  });
}

let env: Env;
let db: ReturnType<typeof fakeEnv>['db'];

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(path, 'https://img.example.com');
  const request = new Request(url, {
    ...init,
    // Origin present and matching, so the CSRF guard is exercised rather than
    // short-circuited by the absent-header path.
    headers: { Origin: url.origin, ...(init.headers as Record<string, string> | undefined) },
  });
  return app.fetch(request, env, testContext());
}

beforeEach(() => {
  ({ db, env } = fakeEnv());
  vi.stubGlobal('fetch', stubTelegram());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /', () => {
  it('serves the shell to an anonymous visitor', async () => {
    // Not a redirect and not a 401: the client probes, and this is what lets `/`
    // be a public landing page and the console at once.
    const response = await call('/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('carries the security headers', async () => {
    const response = await call('/');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});

describe('GET /user', () => {
  it('redirects to the Access entry point, preserving the query', async () => {
    const response = await call('/user?q=1');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/user/?q=1');
  });
});

describe('GET /health', () => {
  it('answers without touching D1', async () => {
    const response = await call('/health');
    expect(response.status).toBe(200);
    await expect(json<{ ok: boolean; service: string }>(response)).resolves.toMatchObject({ ok: true, service: 'image-host' });
    expect(db.preparedStatements()).toHaveLength(0);
  });
});

describe('GET /i/:slug', () => {
  it('404s a slug that cannot be one we generated, before any query', async () => {
    // Checked before the database so a malformed path costs no round-trip — and
    // so it cannot become a slow oracle.
    const response = await call('/i/not-a-valid-slug');
    expect(response.status).toBe(404);
    expect(db.preparedStatements()).toHaveLength(0);
  });

  it('404s a well-shaped slug that matches nothing', async () => {
    const response = await call('/i/AbCdEfGh12345678');
    expect(response.status).toBe(404);
  });

  it('serves the bytes with the stored MIME type and an inline disposition', async () => {
    const uploaded = await call('/user/images', {
      method: 'POST',
      body: await imageBody(),
    });
    expect(uploaded.status).toBe(201);
    const { image } = await json<{ image: { slug: string; mimeType: string } }>(uploaded);
    expect(image.mimeType).toBe('image/png');

    const served = await call(`/i/${image.slug}`);
    expect(served.status).toBe(200);
    // From the row, not from Telegram — which serves documents as octet-stream.
    expect(served.headers.get('Content-Type')).toBe('image/png');
    expect(served.headers.get('Content-Disposition')).toBe('inline');
    expect(served.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    await expect(served.text()).resolves.toBe('image-bytes');
  });

  it('404s a blocked image rather than serving it', async () => {
    const { image } = await json<{ image: { id: number; slug: string } }>(
      await call('/user/images', { method: 'POST', body: await imageBody() }),
    );
    const blocked = await call(`/user/images/${image.id}/block`, {
      method: 'PUT',
      body: JSON.stringify({ blocked: true }),
    });
    expect(blocked.status).toBe(200);
    expect((await call(`/i/${image.slug}`)).status).toBe(404);
  });

  it('404s a soft-deleted image', async () => {
    const { image } = await json<{ image: { id: number; slug: string } }>(
      await call('/user/images', { method: 'POST', body: await imageBody() }),
    );
    expect((await call(`/user/images/${image.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/i/${image.slug}`)).status).toBe(404);
  });

  it('never leaks the owner or the Telegram file id', async () => {
    const { image } = await json<{ image: { id: number; slug: string } }>(
      await call('/user/images', { method: 'POST', body: await imageBody() }),
    );
    const serialised = JSON.stringify(image);
    expect(serialised).not.toContain('tester@example.com');
    expect(serialised).not.toContain('TELEGRAM-FILE-ID');
  });
});

describe('GET /user/me', () => {
  it('answers the probe with the caller address', async () => {
    const response = await call('/user/me');
    expect(response.status).toBe(200);
    await expect(json<{ email: string }>(response)).resolves.toEqual({ email: 'tester@example.com' });
  });

  it('is never cacheable', async () => {
    // Without this a 401 could be served from a shared cache, which is how an
    // expired session outlives its own token.
    expect((await call('/user/me')).headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('POST /user/images', () => {
  it('stores an upload and returns a share link', async () => {
    const response = await call('/user/images', { method: 'POST', body: await imageBody() });
    expect(response.status).toBe(201);
    const { image } = await json<{ image: { slug: string; url: string } }>(response);
    expect(image.url).toBe(`https://img.example.com/i/${image.slug}`);
    expect(image.slug).toMatch(/^[A-Z0-9]{16}$/i);
  });

  it('rejects a body with no file, naming the field', async () => {
    const form = new FormData();
    const response = await call('/user/images', { method: 'POST', body: form });
    expect(response.status).toBe(400);
    await expect(json<ErrorEnvelope>(response)).resolves.toMatchObject({ Exception: { Message: expect.stringContaining('file') } });
  });

  it('rejects a non-multipart body', async () => {
    const response = await call('/user/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(400);
  });

  it('rejects an unsupported type', async () => {
    const form = new FormData();
    form.append('file', new File(['x'], 'a.zip', { type: 'application/zip' }));
    const response = await call('/user/images', { method: 'POST', body: form });
    expect(response.status).toBe(415);
  });

  it('refuses a cross-origin mutation', async () => {
    const response = await call('/user/images', {
      method: 'POST',
      body: await imageBody(),
      headers: { Origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
  });

  it('refuses a mutation with neither Origin nor Referer', async () => {
    // A browser always sends one of the two for a cross-origin mutation, so
    // their joint absence means the request did not come from one.
    const url = new URL('/user/images', 'https://img.example.com');
    const request = new Request(url, { method: 'POST', body: await imageBody() });
    const response = await app.fetch(request, env, testContext());
    expect(response.status).toBe(403);
  });

  it('401s when the session is absent', async () => {
    // The production guard is what refuses the bypass; the route's behaviour
    // without one is the same as any unauthenticated request.
    const anonymous = fakeEnv({ DEV_AUTH_EMAIL: undefined }).env;
    const request = new Request(new URL('/user/images', 'https://img.example.com'));
    const response = await app.fetch(request, anonymous, testContext());
    expect(response.status).toBe(401);
  });
});

describe('GET /user/images', () => {
  it('lists only the caller rows', async () => {
    await call('/user/images', { method: 'POST', body: await imageBody() });
    const response = await call('/user/images');
    const page = await json<{ success: boolean; data: unknown[]; total: number }>(response);
    expect(page.success).toBe(true);
    expect(page.data).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  it('rejects an out-of-range page size rather than clamping it', async () => {
    const response = await call('/user/images?pageSize=10000');
    expect(response.status).toBe(400);
  });

  it('treats an empty search as no search', async () => {
    await call('/user/images', { method: 'POST', body: await imageBody() });
    // `?q=` reaching the DAO as `%` would match every row.
    const page = await json<{ total: number }>(await call('/user/images?q='));
    expect(page.total).toBe(1);
  });
});

describe('ownership', () => {
  it('404s a delete for an image the caller does not own', async () => {
    const { image } = await json<{ image: { id: number; slug: string } }>(
      await call('/user/images', { method: 'POST', body: await imageBody() }),
    );

    const other = fakeEnv({ DEV_AUTH_EMAIL: 'someone-else@example.com' }).env;
    const request = new Request(new URL(`/user/images/${image.id}`, 'https://img.example.com'), {
      method: 'DELETE',
      headers: { Origin: 'https://img.example.com' },
    });
    const response = await app.fetch(request, other, testContext());

    expect(response.status).toBe(404);
    // And the image survived.
    expect((await call(`/i/${image.slug}`)).status).toBe(200);
  });

  it('404s a malformed id rather than coercing it', async () => {
    // `Number('')` is 0 and `Number('12abc')` is NaN; a permissive parse turns a
    // bad URL into a delete of image 0.
    expect((await call('/user/images/abc', { method: 'DELETE' })).status).toBe(400);
    expect((await call('/user/images/0', { method: 'DELETE' })).status).toBe(400);
  });
});

describe('error mask', () => {
  it('answers a 500 with the envelope and no internals', async () => {
    const broken = fakeEnv({ DEV_AUTH_EMAIL: 'tester@example.com' });
    // No ImageHostDB: the DAO cannot be constructed, so the handler throws.
    (broken.env as { ImageHostDB?: unknown }).ImageHostDB = undefined;

    const request = new Request(new URL('/user/images', 'https://img.example.com'), {
      headers: { Origin: 'https://img.example.com' },
    });
    const response = await app.fetch(request, broken.env, testContext());

    expect(response.status).toBe(500);
    const body = await json<ErrorEnvelope>(response);
    // The message is substituted, not the type: a `DatabaseError` type name says
    // "a database call failed" and nothing about which query or which binding.
    expect(body.Exception.Type).toBe('DatabaseError');
    expect(body.Exception.Message).not.toContain('ImageHostDB');
    expect(body.Exception.Message).not.toContain('undefined');
  });

  it('uses the Exception envelope for 4xx too', async () => {
    const response = await call('/i/nope');
    await expect(json<ErrorEnvelope>(response)).resolves.toMatchObject({ Exception: { Message: expect.any(String) } });
  });
});

/**
A one-pixel PNG, so the upload is a real image the size check accepts.
*/
async function imageBody(): Promise<FormData> {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'photo.png', { type: 'image/png' }));
  return form;
}
