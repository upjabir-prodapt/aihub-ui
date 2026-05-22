import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  fetchGoogleIdToken,
  forceRefreshGoogleIdToken,
  persistGoogleIdToken,
} from '../api/cloudRunAuth';
/** Same-origin; UI nginx / Vite proxy to Translation. */
const API_BASE = '/api/v1';

/** Background refresh interval for Cloud Run invoker token while logged in. */
const GOOGLE_TOKEN_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuthUser {
  email: string;
  business_unit: string;
  organization: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  googleIdToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, business_unit: string, organization: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}

// ── Validation ─────────────────────────────────────────────────────────────

export function isColtEmail(email: string): boolean {
  return /^[^\s@]+@colt\.net$/i.test(email.trim());
}

// ── Storage helpers ────────────────────────────────────────────────────────

const TOKEN_KEY = 'colt_auth_token';
const GOOGLE_TOKEN_KEY = 'colt_google_id_token';
const USER_KEY = 'colt_auth_user';
const EXPIRY_KEY = 'colt_auth_expiry';

function saveSession(token: string, googleIdToken: string, user: AuthUser, expiresIn: number) {
  const expiry = Date.now() + expiresIn * 1000;
  sessionStorage.setItem(TOKEN_KEY, token);
  persistGoogleIdToken(googleIdToken);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  sessionStorage.setItem(EXPIRY_KEY, String(expiry));
}

function loadSession(): { token: string; googleIdToken: string; user: AuthUser } | null {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const googleIdToken = sessionStorage.getItem(GOOGLE_TOKEN_KEY);
  const userRaw = sessionStorage.getItem(USER_KEY);
  const expiryRaw = sessionStorage.getItem(EXPIRY_KEY);

  if (!token || !googleIdToken || !userRaw || !expiryRaw) return null;
  if (Date.now() > parseInt(expiryRaw, 10)) {
    clearSession();
    return null;
  }

  try {
    const user: AuthUser = JSON.parse(userRaw);
    return { token, googleIdToken, user };
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(GOOGLE_TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(EXPIRY_KEY);
}

// ── Context ────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [googleIdToken, setGoogleIdToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore session on mount
  useEffect(() => {
    const session = loadSession();
    if (session) {
      setToken(session.token);
      setGoogleIdToken(session.googleIdToken);
      setUser(session.user);
    }
  }, []);

  // Keep Cloud Run invoker token fresh while the user session is active
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

  const login = useCallback(async (email: string, business_unit: string, organization: string) => {
    setError(null);

    // Validate Colt email
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    if (!isColtEmail(email)) {
      setError('Only Colt email addresses (@colt.net) are allowed.');
      return;
    }
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
      // Step 1: Cloud Run invoker token (UI service account via metadata proxy)
      const fetchedGoogleIdToken = await fetchGoogleIdToken();
      persistGoogleIdToken(fetchedGoogleIdToken);

      // Step 2: Get YOUR JWT (/auth/token)
      const response = await fetch(`${API_BASE}/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'accept': 'application/json',
          'Authorization': `Bearer ${fetchedGoogleIdToken}`
        },
        body: JSON.stringify({ email: email.trim(), business_unit: business_unit.trim(), organization: organization.trim() }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Authentication failed.' }));
        throw new Error(err.detail || err.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const authUser: AuthUser = { email: email.trim(), business_unit: business_unit.trim(), organization: organization.trim() };

      setToken(data.access_token);
      setGoogleIdToken(fetchedGoogleIdToken);
      setUser(authUser);
      saveSession(data.access_token, fetchedGoogleIdToken, authUser, data.expires_in ?? 3600);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
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

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
