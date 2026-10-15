import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { createRemoteJWKSet as CreateRemoteJWKSet } from 'jose';
import { InternalServerError, UnauthorizedError } from '@rexezuge/errors';
import { log } from '@image-host/shared/utils/Logger';
import { ConfigurationManager } from '../config';

/**
 * Minimal structural view of the Workers `ExecutionContext` when worker-level
 * Cloudflare Access is enabled.
 *
 * The platform attaches `ctx.access` only after it has authenticated the request
 * itself, so an identity read from it is platform-verified. That is the whole
 * reason it is preferred over the `CF-Access-Authenticated-User-Email` request
 * header, which is a claim the *client* sent and which nothing here reads.
 */
export interface AccessIdentityContext {
  access?: {
    getIdentity: () => Promise<{ email?: string | null } | null>;
  };
}

/**
 * One remote JWKS per team domain, cached process-wide.
 *
 * A fresh `createRemoteJWKSet` per request re-fetches `/cdn-cgi/access/certs`
 * on every verification, which puts the team domain's latency on the hot auth
 * path and makes an Access outage an outage of every authenticated request —
 * including ones a cached key would have verified.
 */
const jwksCache = new Map<string, ReturnType<typeof CreateRemoteJWKSet>>();

function remoteJwksFor(teamDomain: string): ReturnType<typeof CreateRemoteJWKSet> {
  const url = `${teamDomain}/cdn-cgi/access/certs`;
  let jwks = jwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, jwks);
  }
  return jwks;
}

/**
Test-only: drop the memoized fetchers so a test does not inherit another's cache.
*/
export function resetJwksCacheForTests(): void {
  jwksCache.clear();
}

const DEMO_USER_EMAIL = 'demo@image-host.invalid';

export interface AuthEnv {
  ENVIRONMENT?: string;
  DEMO_MODE?: string;
  DEV_AUTH_EMAIL?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
}

export class ImageHostAuthService {
  constructor(private readonly env: AuthEnv) {}

  /**
   * Resolves the caller's address, or throws `UnauthorizedError`.
   *
   * The order is deliberate and each step is a fallback for a *different*
   * deployment shape, not a preference:
   *
   * 1. `DEMO_MODE` — a read-only showcase with a fixed identity.
   * 2. `DEV_AUTH_EMAIL` — `wrangler dev` and the integration suite, which have
   *    no Access in front of them. Read **before** verification and refused under
   *    `production`, because a value promoted from `.dev.vars` would otherwise
   *    authenticate every caller as that one address.
   * 3. JWT verification, when `TEAM_DOMAIN` and `POLICY_AUD` are both configured.
   *    This is the self-hosted Access application case.
   * 4. `ctx.access.getIdentity()` — the same-account one-click Access case,
   *    where the platform has already authenticated the request and published an
   *    identity without the worker issuing or validating a token.
   */
  public async getAuthenticatedUserEmail(request: Request, accessCtx?: AccessIdentityContext): Promise<string> {
    if (ConfigurationManager.auth.isDemoMode(this.env)) {
      return DEMO_USER_EMAIL;
    }

    const devEmail = ConfigurationManager.auth.getDevAuthEmail(this.env);
    if (devEmail) {
      // Fail closed rather than authenticate. See the comment above.
      if (!ConfigurationManager.auth.isBypassAllowed(this.env)) {
        throw new InternalServerError('DEV_AUTH_EMAIL is set in a production environment. Remove it and redeploy.');
      }
      log.warn('Bypassing Cloudflare Access: DEV_AUTH_EMAIL is set. This is only safe outside production.');
      return devEmail;
    }

    const teamDomain = ConfigurationManager.auth.getTeamDomain(this.env);
    const policyAud = ConfigurationManager.auth.getPolicyAud(this.env);
    if (teamDomain && policyAud) {
      return ImageHostAuthService.verifyAccessJwt(request, teamDomain, policyAud);
    }

    const identity = await accessCtx?.access?.getIdentity?.().catch(() => null);
    const email = identity?.email;
    if (email) return email;

    return ImageHostAuthService.verifyAccessJwt(request, teamDomain, policyAud);
  }

  /**
   * Verifies the `CF-Access-Jwt-Assertion` against the team domain's JWKS.
   *
   * Static so `MiddlewareHandlers.requireUser` can call it on a request that did
   * not pass through the middleware chain.
   */
  public static async verifyAccessJwt(request: Request, teamDomain?: string, policyAud?: string): Promise<string> {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) {
      throw new UnauthorizedError('No Cloudflare Access JWT token provided in request headers.');
    }
    if (!teamDomain || !policyAud) {
      throw new UnauthorizedError('Missing required JWT verification configuration.');
    }

    try {
      const { payload } = await jwtVerify(token, remoteJwksFor(teamDomain), {
        issuer: teamDomain,
        audience: policyAud,
      });
      const email = payload.email;
      if (typeof email !== 'string' || email.length === 0) {
        throw new UnauthorizedError('No email found in JWT token.');
      }
      return email;
    } catch (error) {
      // The `jose` message names the expected issuer and audience, and a cert
      // fetch failure quotes the endpoint. Log it, answer generically: a client
      // learns that verification failed and nothing about how this is configured.
      if (error instanceof UnauthorizedError) throw error;
      log.warn('JWT verification failed:', { error: error instanceof Error ? error.message : error });
      throw new UnauthorizedError('JWT verification failed.');
    }
  }
}
