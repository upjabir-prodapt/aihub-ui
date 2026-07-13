import React, { useState, useCallback, useEffect } from 'react';
import {
  forceRefreshGoogleIdToken,
} from '../api/cloudRunAuth';
import {
  forceRefreshSalesGoogleIdToken,
  SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS,
} from '../api/salesCloudRunAuth';
import { hubLogin } from '../api/hubAuth';
import {
  type AuthUser,
  clearSession,
  loadSession,
} from './authStorage';
import {
  clearSalesSession,
  loadSalesSession,
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
  const [token, setToken] = useState<string | null>(initialSession?.token ?? null);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(initialSession?.googleIdToken ?? null);
  const [iapEmail, setIapEmail] = useState<string | null>(
    initialSession?.user?.email ?? initialSalesSession?.user?.email ?? null,
  );
  const [salesUser, setSalesUser] = useState<SalesAuthUser | null>(initialSalesSession?.user ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

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
  }, [token]);

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

    try {
      const result = await hubLogin(business_unit, organization, entitlements);

      if (result.translation) {
        setToken(result.translation.token);
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
    setToken(null);
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
      token,
      googleIdToken,
      iapEmail,
      salesUser,
      isAuthenticated: !!token,
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
