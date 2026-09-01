import { useState, useCallback, useRef, useEffect } from 'react';
import { getResearchStatus, cancelResearch } from './api';

/**
 * In-session registry of Sales Agent research runs started in this tab.
 *
 * This is NOT the history store — `GET /research/jobs` is (see
 * api/salesAgentApi.listResearchJobs). Its only job is to give a run started
 * just now immediate presence in the Hub's in-flight count and the Recent runs
 * panel, before the next server refresh picks it up, and to keep polling it
 * while it's active.
 *
 * Deliberately not persisted: the backend purges runs and their output files
 * after 7 days, so a localStorage copy would resurrect rows the server has
 * already dropped and contradict the rolling-week view.
 */

export type SalesJobStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface SalesJobRecord {
  job_id: string;
  company_name: string;
  account_id: string;
  status: SalesJobStatus;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

const REFRESH_INTERVAL_MS = 60 * 1000;

const IN_PROGRESS: ReadonlySet<SalesJobStatus> = new Set(['PENDING', 'QUEUED', 'PROCESSING']);

export const useSalesJobsState = () => {
  const [jobs, setJobs] = useState<Record<string, SalesJobRecord>>({});
  const [jobOrder, setJobOrder] = useState<string[]>([]);
  const isMountedRef = useRef(true);
  const jobsRef = useRef(jobs);
  const jobOrderRef = useRef(jobOrder);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keep "latest value" mirrors for callbacks that need current state without
  // becoming a dependency (refs are only written from effects, never render).
  useEffect(() => {
    jobsRef.current = jobs;
    jobOrderRef.current = jobOrder;
  }, [jobs, jobOrder]);

  /** Register a newly-started research job (called right after initiateResearch succeeds). */
  const registerJob = useCallback((jobId: string, companyName: string, accountId: string) => {
    setJobs((prev) => ({
      ...prev,
      [jobId]: {
        job_id: jobId,
        company_name: companyName,
        account_id: accountId,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        completedAt: null,
        errorMessage: null,
      },
    }));
    setJobOrder((prev) => [jobId, ...prev.filter((id) => id !== jobId)]);
  }, []);

  const refreshJob = useCallback(async (jobId: string) => {
    try {
      const res = await getResearchStatus(jobId);
      if (!isMountedRef.current) return;
      setJobs((prev) => {
        const existing = prev[jobId];
        if (!existing) return prev;
        const status = (res.status as SalesJobStatus) ?? existing.status;
        const terminal = status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
        return {
          ...prev,
          [jobId]: {
            ...existing,
            status,
            completedAt: terminal ? existing.completedAt ?? new Date().toISOString() : existing.completedAt,
            errorMessage: typeof res.error_message === 'string' ? res.error_message : existing.errorMessage,
          },
        };
      });
    } catch {
      // Network hiccup — leave the last-known status in place; next refresh retries.
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const nonTerminal = jobOrderRef.current.filter((id) => {
      const status = jobsRef.current[id]?.status;
      return status ? IN_PROGRESS.has(status) : false;
    });
    await Promise.all(nonTerminal.map((id) => refreshJob(id)));
  }, [refreshJob]);

  const cancelJob = useCallback(async (jobId: string) => {
    await cancelResearch(jobId);
    if (!isMountedRef.current) return;
    setJobs((prev) => {
      const existing = prev[jobId];
      if (!existing) return prev;
      return {
        ...prev,
        [jobId]: { ...existing, status: 'CANCELLED', completedAt: new Date().toISOString() },
      };
    });
  }, []);

  // Poll only while at least one locally-registered job is still in progress.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const hasActive = jobOrderRef.current.some((id) => {
        const status = jobsRef.current[id]?.status;
        return status ? IN_PROGRESS.has(status) : false;
      });
      if (hasActive) void refreshAll();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { jobs, jobOrder, registerJob, refreshJob, refreshAll, cancelJob };
};
