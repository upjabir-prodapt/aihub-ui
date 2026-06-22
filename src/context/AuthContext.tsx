import React, { useState, useCallback, useEffect } from 'react';
import {
  fetchGoogleIdToken,
  forceRefreshGoogleIdToken,
  persistGoogleIdToken,
} from '../api/cloudRunAuth';
import {
  type AuthUser,
  clearSession,
  loadSession,
  saveSession,
} from './authStorage';
import { AuthContext } from './authContext';

export type { AuthUser, AuthState } from './authTypes';

/** Same-origin; UI nginx / Vite proxy to Translation. */
const API_BASE = '/api/v1';

/** Background refresh interval for Cloud Run invoker token while logged in. */
const GOOGLE_TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

function readInitialSession() {
  return loadSession();
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialSession = readInitialSession();
  const [user, setUser] = useState<AuthUser | null>(initialSession?.user ?? null);
  const [token, setToken] = useState<string | null>(initialSession?.token ?? null);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(initialSession?.googleIdToken ?? null);
  const [iapEmail, setIapEmail] = useState<string | null>(initialSession?.user?.email ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/auth/whoami`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ email: string }>;
      })
      .then((data) => {
        if (data?.email) setIapEmail(data.email);
      })
      .catch(() => {
        // IAP identity unavailable (e.g. local dev without header)
      });
  }, []);

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

  const login = useCallback(async (business_unit: string, organization: string) => {
    setError(null);

    if (!business_unit.trim()) {
      setError('Business Unit is required.');
      return;
    }
    if (!organization.trim()) {
      setError('Organization is required.');
      return;
    }

    setIsLoading(true);

    try {
      const fetchedGoogleIdToken = await fetchGoogleIdToken();
      persistGoogleIdToken(fetchedGoogleIdToken);

      const response = await fetch(`${API_BASE}/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
          Authorization: `Bearer ${fetchedGoogleIdToken}`,
        },
        body: JSON.stringify({
          business_unit: business_unit.trim(),
          organization: organization.trim(),
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Authentication failed.' }));
        throw new Error(err.detail || err.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const authUser: AuthUser = {
        email: data.email,
        business_unit: business_unit.trim(),
        organization: organization.trim(),
      };

      setToken(data.access_token);
      setGoogleIdToken(fetchedGoogleIdToken);
      setUser(authUser);
      setIapEmail(data.email);
      saveSession(data.access_token, fetchedGoogleIdToken, authUser, data.expires_in ?? 3600);
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

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{
      user,
      token,
      googleIdToken,
      iapEmail,
      isAuthenticated: !!token,
      isLoading,
      error,
      login,
      logout,
      clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
