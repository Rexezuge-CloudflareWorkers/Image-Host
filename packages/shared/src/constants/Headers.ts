/**
 * Header names.
 *
 * `CF_ACCESS_AUTHENTICATED_USER_EMAIL` is listed so its absence is deliberate
 * and greppable. That header is a *client's* claim about who it is, and nothing
 * in this repository reads it — identity comes from `ctx.access.getIdentity()` or
 * a verified `CF-Access-Jwt-Assertion`, both of which the platform produces.
 */
export const CF_ACCESS_JWT_ASSERTION = 'cf-access-jwt-assertion';
export const CF_CONNECTING_IP = 'cf-connecting-ip';

/**
Set on responses that carry no-store semantics; see `noStoreHandler`.
*/
export const CACHE_CONTROL_NO_STORE = 'no-store';
