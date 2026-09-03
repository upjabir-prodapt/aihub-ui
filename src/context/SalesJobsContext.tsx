import React, { useEffect, useRef, useState } from 'react';
import { useSalesJobsState } from '../hooks/useSalesJobsState';
import { getResearchStatus } from '../api/salesAgentApi';
import { SalesJobsContext } from './salesJobsContextValue';

/**
 * Lifts the Sales Agent job registry up to the app shell so both
 * SalesAgentPage (which registers new jobs as it starts them) and the
 * Service Hub / Job Tracker pages (which read the registry) share the same
 * state. See hooks/useSalesJobsState.ts for why this is a client-tracked
 * registry rather than a server-side history fetch.
 *
 * Also adds localStorage-based persistence so a run started just before a
 * page refresh (or the browser being closed and reopened) keeps its
 * immediate presence in the Hub's in-flight count / Recent runs / Job
 * Tracker instead of waiting on the next server-side history fetch to pick
 * it back up -- mirrors TranslationJobsContext, one job at a time (Sales has
 * no batch endpoint). Each restored job is re-validated live against the
 * backend (GET /research/status/{id}, which already enforces per-user
 * ownership server-side) rather than trusted blindly; one that 404s or
 * errors is simply dropped rather than shown as a phantom row.
 */

const STORAGE_KEY = 'colt_sales_active_jobs';
const STORAGE_VERSION = 1;

interface StoredSalesJob {
  job_id: string;
  company_name: string;
  account_id: string;
  createdAt: string;
}

interface StoredPayload {
  version: number;
  jobs: StoredSalesJob[];
}

const IN_PROGRESS_STATUSES = new Set(['PENDING', 'QUEUED', 'PROCESSING']);

function loadStoredJobs(): StoredSalesJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredPayload;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.jobs)) return [];
    return parsed.jobs;
  } catch {
    return [];
  }
}

function saveStoredJobs(jobs: StoredSalesJob[]): void {
  try {
    if (jobs.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, jobs } satisfies StoredPayload));
  } catch {
    // localStorage unavailable (private mode / quota) -- resume simply won't work; non-fatal.
  }
}

export const SalesJobsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useSalesJobsState();
  const hasAttemptedResumeRef = useRef(false);
  /**
   * Gates the persistence-save effect until the initial resume attempt below
   * has finished. Without this, that effect's very first run — before any
   * resumed job has made it back into state — would see an empty registry
   * and immediately clear localStorage, wiping the entries the resume
   * effect is about to read (both effects fire in the same initial commit;
   * the resume effect's `restoreJob` calls only land after its `await`s).
   */
  const [hydrated, setHydrated] = useState(false);

  // Persist identifying info for every still-in-progress job so a refresh
  // can re-attach to it. Terminal jobs are dropped from storage -- by then
  // GET /research/jobs already carries them.
  useEffect(() => {
    if (!hydrated) return;
    const active = value.jobOrder
      .map((id) => value.jobs[id])
      .filter((j): j is NonNullable<typeof j> => !!j && IN_PROGRESS_STATUSES.has(j.status))
      .map((j) => ({
        job_id: j.job_id,
        company_name: j.company_name,
        account_id: j.account_id,
        createdAt: j.createdAt,
      }));
    saveStoredJobs(active);
  }, [hydrated, value.jobs, value.jobOrder]);

  // On first mount, re-attach to any jobs that were still in progress before
  // the page was reloaded/reopened.
  useEffect(() => {
    if (hasAttemptedResumeRef.current) return;
    hasAttemptedResumeRef.current = true;

    const stored = loadStoredJobs();
    if (stored.length === 0) {
      // Deferred via a microtask so this setState doesn't run synchronously
      // within the effect body (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => setHydrated(true));
      return;
    }

    (async () => {
      try {
        await Promise.all(
          stored.map(async (job) => {
            try {
              const res = await getResearchStatus(job.job_id);
              value.restoreJob(
                job.job_id,
                job.company_name,
                job.account_id,
                job.createdAt,
                res.status,
                typeof res.error_message === 'string' ? res.error_message : null,
              );
            } catch {
              // No longer accessible (expired, purged, ownership mismatch) --
              // fail closed by simply not restoring it.
            }
          }),
        );
      } finally {
        setHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <SalesJobsContext.Provider value={value}>{children}</SalesJobsContext.Provider>;
};
