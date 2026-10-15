import type { Next } from 'hono';
import { ForbiddenError } from '@rexezuge/errors';
import { log } from '@image-host/shared/utils/Logger';
import { Tokens, type AccessIdentityContext } from '@image-host/backend-services';
import { getScope } from './scopeMiddleware';
import type { ImageHostContext } from '@/types';

const EMAIL_KEY = 'AuthenticatedUserEmailAddress';

/**
 * Authenticates the request and publishes the caller's address.
 *
 * Mounted on `/user/*` only. `GET /i/:slug` — the anonymous share link — never
 * reaches this, which is the property the whole auth design rests on: a share
 * link must work in an `<img src>` with no session, no cookie and no header.
 */
export async function userAuthenticationHandler(c: ImageHostContext, next: Next): Promise<void> {
  const email = await authenticateUserIdentity(c);
  c.set(EMAIL_KEY, email);
  await next();
}

/**
 * Resolves the address, for a handler that runs outside the middleware chain.
 *
 * `MiddlewareHandlers.requireUser` is the route-side entry point: it returns the
 * address when one is already on the context and only authenticates otherwise,
 * so a handler mounted on a path that is not covered by
 * `app.use('/user/*', ...)` still gets an identity rather than `undefined`.
 */
export async function requireUser(c: ImageHostContext): Promise<string> {
  const existing = c.get(EMAIL_KEY);
  if (existing) return existing;
  return authenticateUserIdentity(c);
}

/**
 * The one place identity is derived.
 *
 * `c.executionCtx` is passed through as the `AccessIdentityContext` because that
 * is where the platform attaches `ctx.access` — the worker-level Access
 * fallback in `ImageHostAuthService` reads it from there.
 */
async function authenticateUserIdentity(c: ImageHostContext): Promise<string> {
  const scope = getScope(c);
  const service = scope.get(Tokens.ImageHostAuthService);
  return service.getAuthenticatedUserEmail(c.req.raw, c.executionCtx as unknown as AccessIdentityContext);
}

/**
 * Rejects cross-origin mutations on the authenticated surface.
 *
 * A Zero Trust session cookie is sent by the browser automatically, which is
 * exactly what makes it a CSRF target: without this check, a page on any origin
 * could POST to `/user/images` as the signed-in user. Cloudflare Access cookies
 * are `SameSite=None` by design (they must survive the cross-site redirect that
 * the login flow performs), so the cookie alone is not the protection.
 *
 * Read from `Origin`, falling back to `Referer` — `Origin` is absent on some
 * same-origin navigations, and a check that fails open when the header is missing
 * would not be a check at all.
 */
export async function csrfProtectionHandler(c: ImageHostContext, next: Next): Promise<void> {
  if (isMutation(c.req.method)) {
    const origin = c.req.header('origin');
    const referer = c.req.header('referer');
    const expected = new URL(c.req.url).origin;

    if (origin ? origin !== expected : !sameOriginReferer(referer, expected)) {
      log.warn('Rejected cross-origin mutation', { path: new URL(c.req.url).pathname, origin, referer });
      throw new ForbiddenError('Cross-origin request rejected.');
    }
  }
  await next();
}

function isMutation(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/**
 * `Origin` is absent on some same-origin requests, so `Referer` is consulted
 * instead — and an absent *both* is rejected, not allowed. A browser always
 * sends one of the two for a cross-origin mutation, so their joint absence means
 * the request did not come from a browser, which is not a request this surface
 * accepts.
 */
function sameOriginReferer(referer: string | undefined, expectedOrigin: string): boolean {
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export class MiddlewareHandlers {
  public static userAuthentication(): typeof userAuthenticationHandler {
    return userAuthenticationHandler;
  }

  public static csrfProtection(): typeof csrfProtectionHandler {
    return csrfProtectionHandler;
  }

  public static requireUser(c: ImageHostContext): Promise<string> {
    return requireUser(c);
  }
}
