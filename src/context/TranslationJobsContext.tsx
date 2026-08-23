import React, { useEffect, useRef } from 'react';
import { useTranslation as useTranslationJobsHook } from '../hooks/useTranslation';
import { translationApi } from '../api/translationApi';
import { TranslationJobsContext } from './translationJobsContextValue';

/**
 * Lifts the existing useTranslation() hook (previously only mounted inside
 * TranslationPage) up to the app shell, so both TranslationPage and the
 * shared Topbar UserMenu can read/observe the same in-flight job state.
 *
 * Also adds localStorage-based persistence so an in-progress batch survives
 * a page refresh or the browser being closed and reopened -- on mount, any
 * saved batch is re-validated live against the backend (POST /jobs/status,
 * which already enforces per-user ownership server-side) rather than being
 * trusted blindly. This keeps the backend as the sole source of truth for
 * both status and authorization; localStorage here only stores non-sensitive
 * job/batch identifiers (UUIDs), never credentials.
 */

const STORAGE_KEY = 'colt_translation_active_batch';
const STORAGE_VERSION = 1;

interface StoredBatch {
  version: number;
  batchId: string;
  jobOrder: string[];
  savedAt: string;
}

function loadStoredBatch(): StoredBatch | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBatch;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.jobOrder)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveStoredBatch(batchId: string, jobOrder: string[]): void {
  try {
    const payload: StoredBatch = {
      version: STORAGE_VERSION,
      batchId,
      jobOrder,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage unavailable (private mode / quota) -- resume simply won't work; non-fatal.
  }
}

function clearStoredBatch(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export const TranslationJobsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useTranslationJobsHook();
  const hasAttemptedResumeRef = useRef(false);

  // Persist the active batch whenever it changes.
  useEffect(() => {
    if (value.batchId && value.jobOrder.length > 0) {
      saveStoredBatch(value.batchId, value.jobOrder);
    }
  }, [value.batchId, value.jobOrder]);

  // Clear the persisted batch once every job reaches a terminal state.
  useEffect(() => {
    if (value.status === 'completed' || value.status === 'partial' || value.status === 'failed') {
      if (value.jobOrder.length === 0) return;
      const allTerminal = value.jobOrder.every((id) => {
        const job = value.jobs[id];
        return job && ['completed', 'failed', 'cancelled'].includes(job.status);
      });
      if (allTerminal) clearStoredBatch();
    }
  }, [value.status, value.jobOrder, value.jobs]);

  // On first mount, attempt to resume any previously in-progress batch by
  // re-validating it live against the backend -- never trust localStorage
  // alone for status or authorization.
  useEffect(() => {
    if (hasAttemptedResumeRef.current) return;
    hasAttemptedResumeRef.current = true;

    const stored = loadStoredBatch();
    if (!stored || stored.jobOrder.length === 0) return;

    // Only resume if nothing is already in flight (e.g. a fresh submit
    // beat this effect to the punch, which shouldn't normally happen on
    // mount but is guarded against defensively).
    if (value.batchId) return;

    (async () => {
      try {
        const { jobs: statusItems } = await translationApi.getMultipleJobStatuses(stored.jobOrder);
        if (statusItems.length === 0) {
          clearStoredBatch();
          return;
        }

        const allTerminal = statusItems.every((item) =>
          ['completed', 'failed', 'cancelled'].includes(item.status),
        );
        if (allTerminal) {
          // Nothing left to resume; drop the stale entry.
          clearStoredBatch();
          return;
        }

        // Rehydrate minimal job state and resume polling via the hook's
        // public API (mirrors what startTranslation does on submit).
        // Pass the persisted submit time through so resumed jobs keep their
        // real position in newest-first lists (Job Tracker / Recent runs).
        value.resumeBatch(stored.batchId, stored.jobOrder, statusItems, stored.savedAt);
      } catch {
        // Job IDs no longer valid, ownership mismatch, or network error --
        // fail closed by dropping the stale local entry rather than
        // retrying indefinitely.
        clearStoredBatch();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TranslationJobsContext.Provider value={value}>
      {children}
    </TranslationJobsContext.Provider>
  );
};
