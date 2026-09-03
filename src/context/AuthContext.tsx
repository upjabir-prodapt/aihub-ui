import React, { useState, useCallback, useEffect } from 'react';
import {
  forceRefreshGoogleIdToken,
} from '../api/cloudRunAuth';
import {
  forceRefreshSalesGoogleIdToken,
  SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS,
} from '../api/salesCloudRunAuth';
import {
  hubLogin,
  logoutTranslationSession,
  refreshTranslationSession,
} from '../api/hubAuth';
import {
  type AuthUser,
  clearSession,
  loadSession,
  saveAccessTokenExpiry,
  saveSession,
} from './authStorage';
import {
  clearSalesSession,
  loadSalesSession,
  logoutSalesSession,
  refreshSalesSession,
  saveSalesAccessTokenExpiry,
  saveSalesSession,
  type SalesAuthUser,
} from '../api/salesAgentApi';
import { AuthContext } from './authContextValue';

export type { AuthUser, AuthState } from './authTypes';
export type { ServiceEntitlements } from '../components/Sidebar';

/** Background refresh interval for Cloud Run invoker token while logged in. */
const GOOGLE_TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

/**
 * How often to slide the app session forward.
 *
 * Fixed interval, deliberately: both services mint 30-minute tokens and there
 * is no refresh token, so renewal only works while the current token is still
 * valid. 25 minutes leaves a 5-minute margin for a failed attempt to be
 * retried before the token dies.
 *
 * Do NOT derive this from a stored expiry timestamp. That is what makes the
 * whole scheme silently fail: schedule off the wrong stored value and the
 * first renewal lands long after the access token is already dead.
 */
const SESSION_RENEW_INTERVAL_MS = 25 * 60 * 1000;

function readInitialSession() {
  return loadSession();
}

function readInitialSalesSession() {
  return loadSalesSession();
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialSession = readInitialSession();
  const initialSalesSession = readInitialSalesSession();
  const [user, setUser] = useState<AuthUser | null>(initialSession?.user ?? null);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(initialSession?.googleIdToken ?? null);
  const [iapEmail, setIapEmail] = useState<string | null>(
    initialSession?.user?.email ?? initialSalesSession?.user?.email ?? null,
  );
  const [salesUser, setSalesUser] = useState<SalesAuthUser | null>(initialSalesSession?.user ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session identity now lives in the httpOnly `colt_session` cookie (not
  // JS-readable), so "is the user logged in" is derived from the presence of
  // the (non-sensitive) locally-cached user record rather than a JWT we hold
  // in memory/localStorage. The cookie itself is validated server-side on
  // every API call; an expired/invalid cookie simply causes the next request
  // to 401, at which point the app re-prompts for login.
  useEffect(() => {
    if (!user) return;

    const refresh = async () => {
      try {
        const fresh = await forceRefreshGoogleIdToken();
        setGoogleIdToken(fresh);
      } catch (err) {
        console.warn('Background Google ID token refresh failed:', err);
      }
    };

    const intervalId = window.setInterval(refresh, GOOGLE_TOKEN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [user]);

  useEffect(() => {
    if (!salesUser) return;

    const refresh = async () => {
      try {
        await forceRefreshSalesGoogleIdToken();
      } catch (err) {
        console.warn('Background Sales Google ID token refresh failed:', err);
      }
    };

    const intervalId = window.setInterval(refresh, SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [salesUser]);

  // Sliding app session. Both services issue and validate the SAME
  // `colt_session` cookie, but each renews independently, so a user signed
  // into both writes the cookie twice per tick. The two tokens are
  // equivalent, so last-write-wins is harmless.
  //
  // A renewal can only be refused for a terminal reason (expired, past the
  // 8-hour absolute cap, or entitlement revoked in Firestore), so 401/403
  // ends that service's session immediately rather than waiting for the user
  // to trip over a failing API call.
  const hasTranslationSession = !!user;
  const hasSalesSession = !!salesUser;

  useEffect(() => {
    if (!hasTranslationSession && !hasSalesSession) return;

    let cancelled = false;

    const renew = async () => {
      const jobs: Promise<void>[] = [];

      if (hasTranslationSession) {
        jobs.push((async () => {
          const result = await refreshTranslationSession();
          if (cancelled) return;
          if (result.status === 'renewed') {
            saveAccessTokenExpiry(result.expiresIn);
          } else if (result.status === 'expired') {
            clearSession();
            setUser(null);
            setGoogleIdToken(null);
            setError('Your session has expired. Please sign in again.');
          }
          // 'unavailable' — transient; leave the session alone and retry on
          // the next tick, which still lands inside the token's lifetime.
        })());
      }

      if (hasSalesSession) {
        jobs.push((async () => {
          const result = await refreshSalesSession();
          if (cancelled) return;
          if (result.status === 'renewed') {
            saveSalesAccessTokenExpiry(result.expiresIn);
          } else if (result.status === 'expired') {
            clearSalesSession();
            setSalesUser(null);
            setError('Your session has expired. Please sign in again.');
          }
        })());
      }

      await Promise.all(jobs);
    };

    const intervalId = window.setInterval(renew, SESSION_RENEW_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [hasTranslationSession, hasSalesSession]);

  const login = useCallback(async (
    business_unit: string,
    organization: string,
    entitlements: { translation: boolean; sales: boolean },
  ) => {
    setError(null);

    if (!business_unit.trim()) {
      setError('Business Unit is required.');
      return;
    }
    if (!organization.trim()) {
      setError('Organization is required.');
      return;
    }
    if (!entitlements.translation && !entitlements.sales) {
      setError('You do not have access to any services. Contact your administrator.');
      return;
    }

    setIsLoading(true);

    // Local dev has no reachable Colt backend, VPN, or GCE metadata server —
    // mock a successful sign-in instead of calling the real hub/auth
    // endpoints, so the UI shell (Service Hub, Job Tracker, page layouts) can
    // be exercised offline. import.meta.env.DEV is false in any built
    // artifact (vite build / preview / prod), so this never runs outside
    // `npm run dev`.
    if (import.meta.env.DEV) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const bu = business_unit.trim();
      const org = organization.trim();
      const mockEmail = 'dev@colt.net';
      const mockToken = 'dev-mock-google-id-token';

      if (entitlements.translation) {
        const mockUser: AuthUser = { email: mockEmail, business_unit: bu, organization: org };
        // 1-hour mock lifetime — deliberately longer than the real 30-minute
        // token, because the 25-minute renewal tick has no backend to call in
        // dev and leaves the session alone on a failed attempt.
        saveSession(mockToken, mockUser, 3600);
        setGoogleIdToken(mockToken);
        setUser(mockUser);
        setIapEmail(mockEmail);
      }
      if (entitlements.sales) {
        const mockSalesUser: SalesAuthUser = { email: mockEmail, business_unit: bu, organization: org };
        saveSalesSession(mockToken, mockSalesUser, 3600);
        setSalesUser(mockSalesUser);
        setIapEmail((prev) => prev ?? mockEmail);
      }
      setIsLoading(false);
      return;
    }

    try {
      const result = await hubLogin(business_unit, organization, entitlements);

      if (result.translation) {
        setGoogleIdToken(result.translation.googleIdToken);
        setUser(result.translation.user);
        setIapEmail(result.translation.user.email);
      }

      if (result.sales) {
        setSalesUser(result.sales.user);
        setIapEmail((prev) => prev ?? result.sales!.user.email);
      }

      if (!result.translation && !result.sales) {
        setError(result.errors.join(' ') || 'Login failed. Please try again.');
        return;
      }

      if (result.errors.length > 0) {
        setError(result.errors.join(' '));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // The session JWT lives in an httpOnly cookie that JS cannot delete, so
  // clearing localStorage alone would leave a live credential in the browser.
  // The server call is fire-and-forget and never throws: local state is
  // cleared immediately either way, so a failed request cannot strand the
  // user in a half-logged-out UI.
  const logout = useCallback(() => {
    void logoutTranslationSession();
    setGoogleIdToken(null);
    setUser(null);
    setError(null);
    clearSession();
  }, []);

  const logoutSales = useCallback(() => {
    void logoutSalesSession();
    setSalesUser(null);
    setError(null);
    clearSalesSession();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{
      user,
      googleIdToken,
      iapEmail,
      salesUser,
      isAuthenticated: !!user,
      isSalesAuthenticated: !!salesUser,
      isLoading,
      error,
      login,
      logout,
      logoutSales,
      clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
