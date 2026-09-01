/** Shape of `GET /auth/session` and the context built from it. */

export interface SessionUser {
  email: string;
  name: string;
  department: string | null;
  companyName: string | null;
  roles: string[];
  csrfToken: string;
  absoluteExpiresAt: string;
}

/**
 * `loading`     – the initial session probe is in flight
 * `authenticated` – we have a session
 * `unavailable` – the BFF returned 503; retrying with backoff, NOT a logout
 *
 * There is deliberately no `unauthenticated` state: a 401 means the BFF has
 * already decided we need to sign in, and the client responds with a full-page
 * redirect rather than rendering a login screen of its own.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unavailable';

export interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  /** Populated while `status === 'unavailable'`. */
  error: string | null;
  roles: string[];
  hasRole: (...roles: string[]) => boolean;
  /** Re-probe `/auth/session`. Used by the retry button and after rotation. */
  refresh: () => Promise<void>;
  /** POST /auth/logout, then navigate wherever the BFF tells us to. */
  logout: (options?: { everywhere?: boolean }) => Promise<void>;
}

/**
 * Entra App Roles (docs 15 appendix). `Sales.User` is accepted alongside
 * `SalesAgent.User` because the two spellings appear in different documents and
 * the tenant's actual value is not yet confirmed.
 */
export const ROLE_TRANSLATION = ['Translation.User', 'Platform.Admin'] as const;
export const ROLE_SALES = ['SalesAgent.User', 'Sales.User', 'Platform.Admin'] as const;

export interface ServiceEntitlements {
  translation: boolean;
  sales: boolean;
}
