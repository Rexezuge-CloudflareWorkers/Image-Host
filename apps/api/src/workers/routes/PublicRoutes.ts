import type { Hono } from 'hono';
import { NotFoundError } from '@rexezuge/errors';
import { Tokens } from '@image-host/backend-services/composition';
import { mimeForFileName } from '@image-host/shared/utils';
import { getScope } from '@/middleware';
import type { AppEnv, ImageHostContext } from '@/types';
import { handle } from '@/errors/routeHelpers';

/**
 * The slug shape `makeSlug` produces: 16 characters from a 62-character alphabet.
 *
 * The pattern is checked *before* any database round-trip. A slug that cannot be
 * one we generated is a 404 whatever the query would have returned, so there is no
 * reason to ask — and bounding the length stops a 100 KB path segment from being
 * bound into a prepared statement.
 */
const SLUG_SHAPE = /^[A-Z0-9]{8,64}$/i;

/**
 * The anonymous half of the API: the health check and the share link.
 *
 * Nothing here authenticates, and nothing here mutates user-owned data. The one
 * write these routes perform is anonymous view telemetry, which is fire-and-forget
 * inside `waitUntil` and never affects the response.
 */
export function registerPublicRoutes(app: Hono<AppEnv>): void {
  app.get('/health', (c) => handle(async () => c.json({ ok: true, service: 'image-host' })));

  app.get('/i/:slug', (c) =>
    handle(async () => {
      const slug = c.req.param('slug');
      if (!SLUG_SHAPE.test(slug)) {
        throw new NotFoundError('Image not found.');
      }
      return serveSharedImage(c, slug);
    }),
  );
}

/**
 * Serves the bytes for a share link.
 *
 * Three decisions worth stating:
 *
 * 1. **The body is streamed, not buffered.** `ImageService.download` returns the
 *    upstream `Response` with its body intact, so a 20 MB image costs a pipe rather
 *    than the isolate's heap. Reading it into an `ArrayBuffer` here is what produces
 *    Workers error 1102 under exactly the concurrent-load conditions this route
 *    exists for.
 * 2. **The `Content-Type` comes from the stored row**, not from the upstream
 *    response. Telegram serves documents as `application/octet-stream` regardless of
 *    content, so trusting the header would make every image download instead of
 *    display.
 * 3. **`Content-Disposition` is `inline`, not `attachment`.** The predecessor set
 *    `attachment`, which made every shared image download rather than render.
 *    Images are meant to be embedded.
 */
async function serveSharedImage(c: ImageHostContext, slug: string): Promise<Response> {
  const images = await getScope(c).get(Tokens.ImageService);

  const row = await images.resolveShare(slug);
  const upstream = await images.download(row);

  // Fire-and-forget. The `.catch` is load-bearing: an unhandled rejection inside
  // `waitUntil` surfaces as an isolate-level error rather than a failed request,
  // so telemetry that fails must be swallowed here rather than merely awaited.
  c.executionCtx.waitUntil(
    images.recordView(row.id, c.req.header('referer') ?? 'direct', c.req.header('cf-connecting-ip') ?? 'unknown').catch(() => {}),
  );

  const headers = new Headers();
  headers.set('Content-Type', row.mime_type || mimeForFileName(row.file_name));
  const length = upstream.headers.get('Content-Length');
  if (length) headers.set('Content-Length', length);
  // `immutable` because a slug identifies one stored file: once deleted it is
  // never reused, so a cached copy cannot outlive its own content.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('ETag', `"${row.slug}"`);
  headers.set('Content-Disposition', 'inline');

  return new Response(upstream.body, { status: 200, headers });
}
