import React, { useState, useCallback } from 'react';
import { hubLogin } from '@/modules/auth/hubAuth';
import { type AuthUser, clearSession, loadSession } from '@/modules/auth/authStorage';
import { clearSalesSession, loadSalesSession, type SalesAuthUser } from '@/modules/sales-agent/salesAgentApi';
import { AuthContext } from '@/modules/auth/authContextValue';

export type { AuthUser, AuthState } from '@/modules/auth/authTypes';
export type { ServiceEntitlements } from '@/modules/shell/Sidebar';

/**
 * NOTE: this provider no longer manages Cloud Run identity tokens on a
 * background refresh loop. Authentication to Translation/Sales Agent is
 * handled entirely server-side by the Next.js proxy routes (see
 * app/api/translation/v1/[...path]/route.ts and app/api/sales/v1/[...path]),
 * which mint their own IAP identity tokens per-request. The browser only
 * needs to hold the per-service app JWT (from `/auth/token`) plus the
 * ambient IAP session cookie for the `aihub` resource (`credentials:
 * 'include'` on every fetch handles that automatically).
 */

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
  const [iapEmail, setIapEmail] = useState<string | null>(
    initialSession?.user?.email ?? initialSalesSession?.user?.email ?? null,
  );
  const [salesUser, setSalesUser] = useState<SalesAuthUser | null>(initialSalesSession?.user ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(
    async (
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
    },
    [],
  );

  const logout = useCallback(() => {
    setToken(null);
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
    <AuthContext.Provider
      value={{
        user,
        token,
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
