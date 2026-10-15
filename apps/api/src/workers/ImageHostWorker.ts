import { Hono } from 'hono';
import { MiddlewareHandlers, noStoreHandler, scopeMiddleware, securityHeaders } from '@/middleware';
import type { AppEnv } from '@/types';
import { registerPublicRoutes } from './routes/PublicRoutes';
import { registerUserRoutes } from './routes/UserRoutes';
import { toErrorResponse } from '@/errors/routeHelpers';
import { SPA_HTML } from '@/generated/spa-shell';

/**
 * Builds the application.
 *
 * A factory rather than a module-level singleton so a test can construct an
 * isolated app without the previous one's middleware chain, and so the ordering
 * below is visible in one place instead of implied by import order.
 *
 * ### Route surfaces
 *
 * Two, and the split is the security design rather than a routing convenience:
 *
 * - **`/user/*` is the human surface and sits behind Cloudflare Access.** Upload,
 *   management and the console live here.
 * - **Everything else is public.** `GET /i/:slug` has to work in an `<img src>`
 *   with no cookie, no header and no session — that is what makes a shared link
 *   sharable — and `GET /` serves the SPA shell so an anonymous visitor sees a
 *   landing page instead of a login redirect.
 *
 * The client's auth state is discovered by probing `GET /user/me` (see
 * `UserRoutes`), not by the server choosing which document to send.
 */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // First, so even the shell and the health check carry them.
  app.use('*', securityHeaders());

  // The global mask. `handle()` covers route bodies; this covers middleware, the SPA
  // catch-all, and anything Hono raises outside a handler, so there is no path to
  // the client that skips the mask.
  //
  // It routes through `toErrorResponse` rather than masking unconditionally,
  // because middleware raises `ServiceError`s too: `csrfProtection` raises
  // `ForbiddenError` and `userAuthentication` raises `UnauthorizedError`. Masking
  // those as 500 would answer a rejected cross-origin mutation and an expired
  // session with "Internal Server Error" — which is a lie the SPA cannot act on,
  // and the reason the auth probe treats any non-200 as "not signed in" while a
  // 500 means something else entirely.
  app.onError((error) => toErrorResponse(error));

  // The public shell. Served to everyone: the SPA renders an anonymous landing
  // page or the console depending on what `GET /user/me` reports. Navigating to
  // `/user/` instead is what triggers the Zero Trust login flow.
  app.get('/', (c) => c.html(SPA_HTML));

  // Preserves the query string across the redirect, so a deep link that was
  // rewritten to `/user` does not silently lose its parameters.
  app.get('/user', (c) => c.redirect('/user/' + new URL(c.req.url).search));

  // The scope must exist before **any** data route, including the public ones:
  // `GET /i/:slug` resolves through the container to read the row and to reach
  // the Telegram client. Registered above `registerPublicRoutes` on purpose — the
  // ordering here is load-bearing, not incidental.
  app.use('*', scopeMiddleware);

  registerPublicRoutes(app);

  // Order within `/user/*`:
  //   noStore → csrf → authenticate
  // `noStore` is first because it awaits `next()` and then sets the header, so a
  // handler that returns early — an auth failure returning its JSON directly —
  // still gets it. `csrf` precedes `authenticate` because a rejected cross-origin
  // mutation should not cost a JWKS round-trip.
  app.use('/user/*', noStoreHandler);
  app.use('/user/*', MiddlewareHandlers.csrfProtection());
  app.use('/user/*', MiddlewareHandlers.userAuthentication());

  registerUserRoutes(app);

  /**
   * The SPA catch-all.
   *
   * Serves the shell for `/user/*` — the authenticated console, and any
   * client-side route beneath it — and 404s everything else.
   *
   * `/i/` is an exact registered route so it can never reach here, but the guard is
   * written explicitly rather than relying on that: a catch-all that falls through
   * would answer a dead share link with a 200 and an HTML page, which reads to the
   * caller as a working image.
   */
  app.get('*', (c) => {
    const path = new URL(c.req.url).pathname;
    return path.startsWith('/user/') ? c.html(SPA_HTML) : c.notFound();
  });

  return app;
}

const app = createApp();

export default {
  // `await` rather than returning the promise directly: Hono's `fetch` may answer
  // synchronously on a cache hit, and a `fetch` handler typed as returning a bare
  // `Promise<Response>` is a lie the Workers runtime would not catch at compile
  // time but would at runtime.
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => app.fetch(request, env, ctx),
};

export { type AppEnv } from '@/types';
