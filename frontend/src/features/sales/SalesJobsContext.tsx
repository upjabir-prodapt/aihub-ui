import React from 'react';
import { useSalesJobsState } from './useSalesJobsState';
import { SalesJobsContext } from './salesJobsContextValue';

/**
 * Lifts the Sales Agent job registry up to the app shell so both
 * SalesAgentPage (which registers new jobs as it starts them) and the
 * Service Hub / Job Tracker pages (which read the registry) share the same
 * state. See hooks/useSalesJobsState.ts for why this is a client-tracked
 * registry rather than a server-side history fetch.
 */
export const SalesJobsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useSalesJobsState();
  return <SalesJobsContext.Provider value={value}>{children}</SalesJobsContext.Provider>;
};
