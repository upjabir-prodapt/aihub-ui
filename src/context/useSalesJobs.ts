import { useContext } from 'react';
import { SalesJobsContext } from './salesJobsContextValue';
import type { SalesJobsContextValue } from './salesJobsContextValue';

export function useSalesJobs(): SalesJobsContextValue {
  const ctx = useContext(SalesJobsContext);
  if (!ctx) throw new Error('useSalesJobs must be used within SalesJobsProvider');
  return ctx;
}
