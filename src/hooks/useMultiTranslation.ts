import { useState, useCallback, useRef, useEffect } from 'react';
import { translationApi } from '../api/translationApi';
import type { JobStatusResponse, DownloadUrlResponse } from '../types/translation';

/**
 * Lifecycle of a single per-language translation job.
 * A `const` object (not a TS `enum`) so it stays erasable-syntax compatible.
 */
export const LangJobStatus = {
  Submitting: 'submitting',
  Polling: 'polling',
  Completed: 'completed',
  Failed: 'failed',
} as const;

export type LangJobStatus = (typeof LangJobStatus)[keyof typeof LangJobStatus];

/** One independent translation job, keyed by its target language. */
export interface LanguageJob {
  targetLang: string;
  status: LangJobStatus;
  jobId: string | null;
  jobData: JobStatusResponse | null;
  downloadInfo: DownloadUrlResponse | null;
  error: string | null;
}

// ── Retry helper ─────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retry `fn` up to `maxAttempts` times with exponential back-off.
 * The FormData factory is called fresh on every attempt (see startTranslations).
 */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseMs = 1000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) await delay(baseMs * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages N parallel translation jobs — one per selected target language.
 * Every job is submitted concurrently (fire-and-forget) and then polls
 * independently via the existing translationApi, so a slow or failed language
 * never blocks the others.
 */
export const useMultiTranslation = () => {
  const [jobs, setJobs] = useState<LanguageJob[]>([]);

  /** Polling interval id per target language. */
  const intervalsRef = useRef<Record<string, number>>({});
  /**
   * Session generation. Incremented on every new run/reset so in-flight
   * callbacks from a previous run become no-ops when they resolve.
   */
  const genRef = useRef(0);
  const isMountedRef = useRef(true);
  /** When each language's signed download URL was last fetched (ms since epoch). */
  const downloadFetchedAtRef = useRef<Record<string, number>>({});
  /** Live mirror of `jobs` so async callbacks read fresh state without re-binding. */
  const jobsRef = useRef<LanguageJob[]>([]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ── Interval management ──
  const clearLangInterval = useCallback((targetLang: string) => {
    const id = intervalsRef.current[targetLang];
    if (id) {
      window.clearInterval(id);
      delete intervalsRef.current[targetLang];
    }
  }, []);

  const clearAllIntervals = useCallback(() => {
    Object.keys(intervalsRef.current).forEach((lang) => {
      window.clearInterval(intervalsRef.current[lang]);
    });
    intervalsRef.current = {};
  }, []);

  /** Merge a patch into the job entry for `targetLang`. */
  const patchJob = useCallback((targetLang: string, patch: Partial<LanguageJob>) => {
    if (!isMountedRef.current) return;
    setJobs((prev) => prev.map((j) => (j.targetLang === targetLang ? { ...j, ...patch } : j)));
  }, []);

  const fetchDownloadUrl = useCallback(
    async (targetLang: string, jobId: string) => {
      try {
        const info = await translationApi.getDownloadUrl(jobId);
        if (!isMountedRef.current) return;
        downloadFetchedAtRef.current[targetLang] = Date.now();
        patchJob(targetLang, { downloadInfo: info });
      } catch (err) {
        // Non-fatal: the result payload may still carry an inline download_url.
        console.warn(`Could not fetch signed download URL for ${targetLang}:`, err);
      }
    },
    [patchJob],
  );

  /** A single poll tick for one language's job. */
  const pollOnce = useCallback(
    async (targetLang: string, jobId: string, myGen: number) => {
      if (!isMountedRef.current || myGen !== genRef.current) return;
      try {
        const data = await translationApi.getJobStatus(jobId);
        if (!isMountedRef.current || myGen !== genRef.current) return;

        if (data.status === 'completed') {
          clearLangInterval(targetLang);
          patchJob(targetLang, { jobData: data, status: LangJobStatus.Completed });
          await fetchDownloadUrl(targetLang, jobId);
        } else if (data.status === 'failed' || data.status === 'cancelled') {
          clearLangInterval(targetLang);
          patchJob(targetLang, {
            jobData: data,
            status: LangJobStatus.Failed,
            error: data.error_message || 'Translation job failed.',
          });
        } else {
          // queued | processing → keep polling
          patchJob(targetLang, { jobData: data });
        }
      } catch (err) {
        if (!isMountedRef.current || myGen !== genRef.current) return;
        // A transient poll error is non-fatal; the interval retries on the next tick.
        console.warn(`Polling error for ${targetLang}:`, err);
      }
    },
    [clearLangInterval, fetchDownloadUrl, patchJob],
  );

  const startPolling = useCallback(
    (targetLang: string, jobId: string, myGen: number) => {
      clearLangInterval(targetLang);
      intervalsRef.current[targetLang] = window.setInterval(() => {
        pollOnce(targetLang, jobId, myGen);
      }, 3000);
      pollOnce(targetLang, jobId, myGen); // kick off immediately
    },
    [clearLangInterval, pollOnce],
  );

  /** Submit one language and begin polling it. */
  const submitLang = useCallback(
    async (targetLang: string, buildFormData: (targetLang: string) => FormData, myGen: number) => {
      try {
        const start = await withRetry(
          () => translationApi.startTranslation(buildFormData(targetLang)),
          3,
          1000,
        );
        if (!isMountedRef.current || myGen !== genRef.current) return;
        patchJob(targetLang, { jobId: start.job_id, status: LangJobStatus.Polling });
        startPolling(targetLang, start.job_id, myGen);
      } catch (err) {
        if (!isMountedRef.current || myGen !== genRef.current) return;
        patchJob(targetLang, {
          status: LangJobStatus.Failed,
          error: err instanceof Error ? err.message : 'Failed to start translation job.',
        });
      }
    },
    [patchJob, startPolling],
  );

  /**
   * Fire one translation request per target language, all in parallel.
   * `buildFormData(targetLang)` must return a fresh FormData for each call so
   * every request carries its own unconsumed file stream.
   */
  const startTranslations = useCallback(
    (targetLangs: string[], buildFormData: (targetLang: string) => FormData) => {
      genRef.current += 1;
      const myGen = genRef.current;
      clearAllIntervals();
      downloadFetchedAtRef.current = {};

      setJobs(
        targetLangs.map((targetLang) => ({
          targetLang,
          status: LangJobStatus.Submitting,
          jobId: null,
          jobData: null,
          downloadInfo: null,
          error: null,
        })),
      );

      // Fire-and-forget: every language submits concurrently (not awaited).
      targetLangs.forEach((targetLang) => {
        void submitLang(targetLang, buildFormData, myGen);
      });
    },
    [clearAllIntervals, submitLang],
  );

  /** Retry a single language (e.g. after a failure), reusing the same factory. */
  const retryLang = useCallback(
    (targetLang: string, buildFormData: (targetLang: string) => FormData) => {
      const myGen = genRef.current; // keep the current session alive
      clearLangInterval(targetLang);
      patchJob(targetLang, { status: LangJobStatus.Submitting, error: null, jobData: null, downloadInfo: null });
      void submitLang(targetLang, buildFormData, myGen);
    },
    [clearLangInterval, patchJob, submitLang],
  );

  /**
   * Returns a guaranteed-valid signed download URL for one language, re-fetching
   * if the cached URL is expired or expiring within 60s.
   */
  const getValidDownloadUrl = useCallback(
    async (targetLang: string): Promise<string | null> => {
      const job = jobsRef.current.find((j) => j.targetLang === targetLang);
      const jobId = job?.jobId;
      if (!jobId) return null;

      if (job?.downloadInfo) {
        const ageMs = Date.now() - (downloadFetchedAtRef.current[targetLang] ?? 0);
        const expiresInMs = job.downloadInfo.expires_in * 1000;
        if (ageMs < expiresInMs - 60_000) return job.downloadInfo.download_url;
      }

      try {
        const info = await translationApi.getDownloadUrl(jobId);
        if (isMountedRef.current) {
          downloadFetchedAtRef.current[targetLang] = Date.now();
          patchJob(targetLang, { downloadInfo: info });
        }
        return info.download_url;
      } catch {
        return job?.downloadInfo?.download_url ?? null;
      }
    },
    [patchJob],
  );

  /** Full reset — clears all jobs and cancels every in-flight poll. */
  const reset = useCallback(() => {
    genRef.current += 1;
    clearAllIntervals();
    downloadFetchedAtRef.current = {};
    setJobs([]);
  }, [clearAllIntervals]);

  useEffect(() => {
    return () => clearAllIntervals();
  }, [clearAllIntervals]);

  const isRunning = jobs.some(
    (j) => j.status === LangJobStatus.Submitting || j.status === LangJobStatus.Polling,
  );

  return {
    jobs,
    isRunning,
    startTranslations,
    retryLang,
    getValidDownloadUrl,
    reset,
  };
};
