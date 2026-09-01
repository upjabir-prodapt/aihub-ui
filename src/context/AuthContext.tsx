import React, { useState, useCallback, useEffect } from 'react';
import {
  forceRefreshGoogleIdToken,
} from '../api/cloudRunAuth';
import {
  forceRefreshSalesGoogleIdToken,
  SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS,
} from '../api/salesCloudRunAuth';
import { hubLogin, refreshAccessToken } from '../api/hubAuth';
import {
  type AuthUser,
  clearSession,
  loadSession,
  saveSession,
  getRefreshExpiryTime,
  saveRefreshExpiry,
  saveAccessTokenExpiry,
} from './authStorage';
import {
  clearSalesSession,
  loadSalesSession,
  saveSalesSession,
  type SalesAuthUser,
} from '../api/salesAgentApi';
import { AuthContext } from './authContextValue';

export type { AuthUser, AuthState } from './authTypes';
export type { ServiceEntitlements } from '../components/Sidebar';

/** Background refresh interval for Cloud Run invoker token while logged in. */
const GOOGLE_TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

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

  // Auto-refresh access token ~5 min before expiry to avoid 401s mid-session.
  // Refresh failure is graceful: the next API call will 401 and trigger re-login.
  useEffect(() => {
    if (!user) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      const refreshExpiryTime = getRefreshExpiryTime();
      if (!refreshExpiryTime) return;

      // Refresh 5 minutes before expiry
      const refreshTime = refreshExpiryTime - 5 * 60 * 1000;
      const now = Date.now();
      const delayMs = Math.max(0, refreshTime - now);

      timeoutId = window.setTimeout(async () => {
        try {
          const result = await refreshAccessToken();
          if (result) {
            // Update expiry times in localStorage for next refresh
            saveAccessTokenExpiry(result.expiresIn);
            if (result.refreshExpiresIn) {
              saveRefreshExpiry(result.refreshExpiresIn);
            }
            // Reschedule next refresh
            scheduleRefresh();
          }
        } catch (err) {
          console.warn('Background access token refresh failed:', err);
        }
      }, delayMs);
    };

    scheduleRefresh();
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
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
        // Mock login with 1-hour token and 7-day refresh expiry
        saveSession(mockToken, mockUser, 3600, 7 * 24 * 60 * 60);
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

  const logout = useCallback(() => {
    setGoogleIdToken(null);
    setUser(null);
    setError(null);
    clearSession();
  }, []);

  const logoutSales = useCallback(() => {
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
