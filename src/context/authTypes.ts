import type { AuthUser } from './authStorage';
import type { SalesAuthUser } from '../api/salesAgentApi';
import type { ServiceEntitlements } from '../components/Sidebar';

export type { AuthUser };

export interface AuthState {
  user: AuthUser | null;
  googleIdToken: string | null;
  iapEmail: string | null;
  salesUser: SalesAuthUser | null;
  isAuthenticated: boolean;
  isSalesAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (business_unit: string, organization: string, entitlements: ServiceEntitlements) => Promise<void>;
  logout: () => void;
  logoutSales: () => void;
  clearError: () => void;
}
