import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ServiceUnavailableError,
  UnauthenticatedError,
  apiJson,
  apiPostJson,
  redirectToLogin,
  setCsrfToken,
} from '../../shared/api/client';
import { AuthContext } from './authContextValue';
import type { AuthStatus, AuthState, SessionUser } from './authTypes';

/**
 * Identity comes from one place now: `GET /auth/session` on the BFF
 * (decision D7). The browser never sees a token, never calls a metadata
 * server, and never probes each backend's `/auth/whoami`.
 *
 * The two failure paths must stay distinct:
 *
 *  - **401** the BFF has decided we need to sign in. Full-page redirect to
 *    `/auth/login?return_to=<here>`; the BFF then drives Entra silently.
 *  - **503** the BFF is up but degraded (Firestore, KMS, Entra). Retry with
 *    backoff and show a "temporarily unavailable" state. Redirecting here
 *    would put every open tab into a login loop during an outage.
 */

const RETRY_SCHEDULE_MS = [1000, 2000, 4000, 8000, 15000, 30000];

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attemptRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  // `probe` reschedules itself on failure. Going through a ref keeps the
  // callback from referencing its own binding before it is initialised.
  const probeRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const probe = useCallback(async (): Promise<void> => {
    try {
      // `suppressAuthRedirect` so this call decides what a 401 means, rather
      // than the generic client redirecting out from under us.
      const session = await apiJson<SessionUser>('/auth/session', {
        suppressAuthRedirect: true,
      });
      if (!mountedRef.current) return;
      attemptRef.current = 0;
      setCsrfToken(session.csrfToken);
      setUser(session);
      setError(null);
      setStatus('authenticated');
    } catch (err) {
      if (!mountedRef.current) return;

      if (err instanceof UnauthenticatedError) {
        setCsrfToken(null);
        setUser(null);
        redirectToLogin();
        return;
      }

      const attempt = attemptRef.current;
      attemptRef.current = Math.min(attempt + 1, RETRY_SCHEDULE_MS.length - 1);
      const baseDelay = RETRY_SCHEDULE_MS[attempt] ?? 30000;

      if (err instanceof ServiceUnavailableError) {
        setStatus('unavailable');
        setError('The AI Hub is temporarily unavailable. Retrying automatically.');
        timerRef.current = window.setTimeout(
          () => void probeRef.current(),
          Math.max(baseDelay, err.retryAfterSeconds * 1000),
        );
        return;
      }

      // Network failure or an unexpected status. Same treatment as 503: this is
      // not evidence that the user is signed out.
      setStatus('unavailable');
      setError(err instanceof Error ? err.message : 'Could not reach the AI Hub.');
      timerRef.current = window.setTimeout(() => void probeRef.current(), baseDelay);
    }
  }, []);

  useEffect(() => {
    probeRef.current = probe;
    // Deferred so no setState can run synchronously inside the effect body
    // (react-hooks/set-state-in-effect); the same pattern the old shell used.
    void Promise.resolve().then(() => probeRef.current());
  }, [probe]);

  const refresh = useCallback(async () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    attemptRef.current = 0;
    setStatus('loading');
    await probe();
  }, [probe]);

  const logout = useCallback(async (options?: { everywhere?: boolean }) => {
    const everywhere = options?.everywhere ?? true;
    try {
      const result = await apiPostJson<{ ok: boolean; redirectTo: string }>(
        `/auth/logout?everywhere=${everywhere}`,
        {},
        { suppressAuthRedirect: true },
      );
      setCsrfToken(null);
      setUser(null);
      // The BFF has already cleared its own cookie; the browser still has to
      // visit IAP (and optionally Entra) to clear theirs.
      window.location.assign(result.redirectTo || '/');
    } catch {
      // Even a failed logout must not strand the user on an authenticated view.
      setCsrfToken(null);
      setUser(null);
      window.location.assign('/');
    }
  }, []);

  const roles = useMemo(() => user?.roles ?? [], [user]);

  const hasRole = useCallback(
    (...wanted: string[]) => wanted.some((role) => roles.includes(role)),
    [roles],
  );

  const value = useMemo<AuthState>(
    () => ({ status, user, error, roles, hasRole, refresh, logout }),
    [status, user, error, roles, hasRole, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
