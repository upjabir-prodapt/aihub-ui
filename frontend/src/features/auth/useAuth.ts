import { useContext } from 'react';
import { AuthContext } from './authContextValue';
import type { AuthState } from './authTypes';
import { ROLE_SALES, ROLE_TRANSLATION, type ServiceEntitlements } from './authTypes';

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Which services this user may see, derived from Entra App Roles.
 *
 * This drives navigation and empty states only. Apigee remains the
 * authorisation authority (runbook §19.4) and the BFF proxy refuses the call
 * independently, so hiding a nav item is a UX affordance, not a control.
 */
export function useEntitlements(): ServiceEntitlements {
  const { hasRole, status } = useAuth();
  if (status !== 'authenticated') {
    // Fail closed while loading or degraded — never flash entitled UI.
    return { translation: false, sales: false };
  }
  return {
    translation: hasRole(...ROLE_TRANSLATION),
    sales: hasRole(...ROLE_SALES),
  };
}
