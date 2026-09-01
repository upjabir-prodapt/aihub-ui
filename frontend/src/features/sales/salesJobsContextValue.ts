import { createContext } from 'react';
import type { useSalesJobsState } from './useSalesJobsState';

export type SalesJobsContextValue = ReturnType<typeof useSalesJobsState>;

export const SalesJobsContext = createContext<SalesJobsContextValue | null>(null);
