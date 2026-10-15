import type { CurrentUserResponse } from '../types';
import { apiGet } from '../lib/api';

/**
 * Deduplicates concurrent probes.
 *
 * React 19's StrictMode mounts effects twice in development, which without this
 * issues two `GET /user/me` requests on every page load and — worse on the
 * deployed shell — would make the auth probe's answer depend on which of the two
 * resolved last. The holder is an object rather than a reassigned binding because
 * two calls in the same tick must see the same promise, and a `let` reassigned
 * after `finally` has run would let a late caller start a third request.
 *
 * Cleared once settled so a later explicit reload after a sign-in fetches again.
 */
const currentUserRequest: { inflight: Promise<CurrentUserResponse> | null } = { inflight: null };

/**
 * Probes for an authenticated session.
 *
 * Resolves only on a 200. Every other outcome rejects, and every rejection means
 * the same thing to the caller: not authenticated — a 401, a 302 to the Access
 * login page, or the login page's HTML all arrive here as a rejection.
 */
export function loadCurrentUser(): Promise<CurrentUserResponse> {
  currentUserRequest.inflight ??= apiGet<CurrentUserResponse>('/user/me').finally(() => {
    currentUserRequest.inflight = null;
  });
  return currentUserRequest.inflight;
}

/**
Drops the memoized probe. Test-only.
*/
export function resetCurrentUserProbeForTests(): void {
  currentUserRequest.inflight = null;
}
