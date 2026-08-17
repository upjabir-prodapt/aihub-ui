import { useContext } from 'react';
import { AuthContext } from '@/modules/auth/authContextValue';
import type { AuthState } from '@/modules/auth/authTypes';

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
