import type { AuthUser } from '@/modules/auth/authStorage';
import type { SalesAuthUser } from '@/modules/sales-agent/salesAgentApi';
import type { ServiceEntitlements } from '@/modules/shell/Sidebar';

export type { AuthUser };

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
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
