import type { AuthUser } from './authStorage';

export type { AuthUser };

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  googleIdToken: string | null;
  iapEmail: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (business_unit: string, organization: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
}
