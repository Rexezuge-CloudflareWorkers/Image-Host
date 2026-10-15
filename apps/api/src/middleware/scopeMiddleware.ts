import type { Next } from 'hono';
import { createRequestScope, type Container } from '@image-host/backend-services/composition';
import { CACHE_CONTROL_NO_STORE } from '@image-host/shared/constants';
import type { ImageHostContext } from '@/types';

const SCOPE_KEY = 'Scope';

/**
 * Installs one `Container` per request.
 *
 * Middleware order matters here: registered on `*` after the shell and health
 * routes, so every *data* route resolves services through `getScope(c)` rather
 * than each minting its own container. One container means one `ImagesDAO` and one
 * Telegram client per request, and it is what lets a unit test swap one
 * collaborator without the route knowing.
 */
export async function scopeMiddleware(c: ImageHostContext, next: Next): Promise<void> {
  c.set(SCOPE_KEY, createRequestScope(c.env));
  await next();
}

/**
The request's container. Throws rather than returning undefined — a missing scope is a wiring bug.
*/
export function getScope(c: ImageHostContext): Container {
  const scope = c.get(SCOPE_KEY);
  if (!scope) {
    throw new Error('No request scope. Is scopeMiddleware registered on this route?');
  }
  return scope;
}

/**
 * Marks a response as uncacheable.
 *
 * Registered *first* in the chain so it wraps everything downstream: it awaits
 * `next()` and then sets the header, so a handler that returns early — an
 * authentication failure returning its JSON directly — still gets it. Without
 * this ordering a 401 could be served from a shared cache, which is how an
 * expired session outlives its own token.
 */
export async function noStoreHandler(c: ImageHostContext, next: Next): Promise<void> {
  await next();
  c.res.headers.set('Cache-Control', CACHE_CONTROL_NO_STORE);
}
