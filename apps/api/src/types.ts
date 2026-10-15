import type { Context } from 'hono';
import type { Container } from '@image-host/backend-services/composition';

/**
 * What the middleware chain publishes on the Hono context.
 *
 * Named properties rather than an index signature, so `c.get('Scope')` is typed
 * and a typo is a compile error. Both are `set` by middleware before any route
 * handler runs: `Scope` by `scopeMiddleware` on `*`, and
 * `AuthenticatedUserEmailAddress` by `userAuthentication` on `/user/*`.
 */
export interface AppVariables {
  Scope: Container;
  AuthenticatedUserEmailAddress: string;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };

export type ImageHostContext = Context<AppEnv>;
