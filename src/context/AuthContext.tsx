import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const API_BASE = 'https://translation-api-service-297743845367.europe-west1.run.app/api/v1';

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
  sessionStorage.setItem(GOOGLE_TOKEN_KEY, googleIdToken);
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
      // Step 1: Generate Google ID Token via Nginx Metadata Proxy
      let fetchedGoogleIdToken = '';
      try {
        const metaRes = await fetch(`/api/metadata/id-token?audience=${encodeURIComponent(API_BASE)}`);
        if (metaRes.ok) {
          fetchedGoogleIdToken = await metaRes.text();
        } else {
          console.warn('Metadata endpoint returned status:', metaRes.status);
          fetchedGoogleIdToken = 'mock_google_id_token_for_local_dev';
        }
      } catch (err) {
        console.warn('Failed to reach metadata endpoint (likely local dev environment):', err);
        fetchedGoogleIdToken = 'mock_google_id_token_for_local_dev';
      }

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
