import { useCallback, useEffect, useState } from 'react';
import type { CurrentUserResponse } from '../types';
import { loadCurrentUser } from '../services/userService';

export interface CurrentUserState {
  user: CurrentUserResponse | null;
  /**
   * `null` while the probe is still in flight.
   *
   * Three states rather than two, and the third is the point: with a boolean, a
   * component that renders on `authorized === false` shows the anonymous view for
   * as long as the probe takes, then swaps it for the console. The user sees a
   * flash of the wrong page on every load. `null` is what lets the caller hold
   * both views back until the answer is known.
   */
  authorized: boolean | null;
  refresh: () => void;
}

/**
 * Discovers whether the visitor has a Zero Trust session.
 *
 * The server sends the same document to everyone and the client asks this
 * question, which is what lets `/` be a public landing page *and* the console
 * without the worker choosing between two documents.
 */
export function useCurrentUser(): CurrentUserState {
  const [user, setUser] = useState<CurrentUserResponse | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    loadCurrentUser()
      .then((me) => {
        if (!active) return;
        setUser(me);
        setAuthorized(true);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setAuthorized(false);
      });
    // `active` guards against setting state after unmount, which under React 19's
    // StrictMode double-mount would warn and can resurrect a stale user.
    return () => {
      active = false;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return { user, authorized, refresh };
}
