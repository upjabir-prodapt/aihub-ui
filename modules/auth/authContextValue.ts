import { createContext } from 'react';
import type { AuthState } from '@/modules/auth/authTypes';

export const AuthContext = createContext<AuthState | null>(null);
