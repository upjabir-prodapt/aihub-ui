import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslationJobs } from '../../features/translation/useTranslationJobs';
import { useSalesJobs } from '../../features/sales/useSalesJobs';
import { translationApi } from '../../features/translation/api';
import { downloadResearchFile, listResearchJobs } from '../../features/sales/api';
import {
  normalizeTranslationHistoryItem,
  normalizeTranslationActiveItem,
  normalizeSalesHistoryItem,
  normalizeSalesJob,
  mergeJobLists,
  loadJobDetail,
} from '../utils/jobs';
import type { UnifiedJob } from '../types/jobs';

export interface ServiceJobStats {
  inFlight: number;
  completed: number;
  failed: number;
}

/** How often to silently re-pull server-side history while a run is in flight. */
const AUTO_REFRESH_INTERVAL_MS = 20_000;

/**
 * All known runs for a single service, merged from that service's server-side
 * history endpoint and the live in-session job state, plus the cancel/download
 * actions for them.
 *
 * Both backends retain only the last 7 days and purge generated output files
 * after that, so the history is inherently a rolling week — the UI adds no
 * date filtering of its own.
 *
 * Owned by the service page and passed down to both the stat grid and the
 * Recent-runs panel so the history is fetched once, not once per consumer.
 */
export function useServiceJobs(service: 'translation' | 'sales') {
  const translationCtx = useTranslationJobs();
  const salesCtx = useSalesJobs();

  const [history, setHistory] = useState<UnifiedJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (service === 'translation') {
        const items = await translationApi.listJobs();
        setHistory(items.map(normalizeTranslationHistoryItem));
      } else {
        const items = await listResearchJobs();
        setHistory(items.map(normalizeSalesHistoryItem));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load run history.');
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    // Deferred via a microtask so the first setState doesn't run synchronously
    // within the effect body (react-hooks/set-state-in-effect).
    Promise.resolve().then(() => {
      void loadHistory();
    });
  }, [loadHistory]);

  // Keep server-side history current without a manual refresh, so every tab
  // reflects live progress — but only while something is actually in flight,
  // and paused while the tab is hidden so a backgrounded browser tab doesn't
  // keep hammering the API.
  const hasInFlight = history.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!hasInFlight) return undefined;

    const tick = () => {
      if (document.visibilityState === 'visible') void loadHistory();
    };
    const intervalId = setInterval(tick, AUTO_REFRESH_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadHistory();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [hasInFlight, loadHistory]);

  /** Lazily fetches cost/tokens/time/model for a completed translation job, on row expand. */
  const loadDetail = useCallback((job: UnifiedJob) => {
    void loadJobDetail(job, setHistory);
  }, []);

  const activeItems = useMemo(() => {
    if (service === 'translation') {
      return translationCtx.jobOrder
        .map((id) => translationCtx.jobs[id])
        .filter((j): j is NonNullable<typeof j> => !!j)
        .map(normalizeTranslationActiveItem);
    }
    return salesCtx.jobOrder
      .map((id) => salesCtx.jobs[id])
      .filter((j): j is NonNullable<typeof j> => !!j)
      .map(normalizeSalesJob);
  }, [service, translationCtx.jobOrder, translationCtx.jobs, salesCtx.jobOrder, salesCtx.jobs]);

  const jobs = useMemo(() => mergeJobLists(history, activeItems), [history, activeItems]);

  const stats: ServiceJobStats = useMemo(
    () => ({
      inFlight: jobs.filter((j) => j.status === 'running' || j.status === 'queued').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed' || j.status === 'cancelled').length,
    }),
    [jobs],
  );

  const refresh = useCallback(() => {
    void loadHistory();
    if (service === 'sales') void salesCtx.refreshAll();
  }, [loadHistory, service, salesCtx]);

  const cancelJob = useCallback(
    async (job: UnifiedJob) => {
      setActionError(null);
      setBusyKey(job.key);
      try {
        if (job.service === 'translation') await translationCtx.cancelJob(job.id);
        else await salesCtx.cancelJob(job.id);
        // The service contexts only track jobs started in this session, so a
        // row that came from the backend history wouldn't otherwise update
        // until the next refresh. Patch it here too.
        setHistory((prev) =>
          prev.map((j) =>
            j.key === job.key
              ? { ...j, status: 'cancelled' as const, canCancel: false, canDownload: false }
              : j,
          ),
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to cancel job.');
      } finally {
        setBusyKey(null);
      }
    },
    [translationCtx, salesCtx],
  );

  const downloadJob = useCallback(
    async (job: UnifiedJob) => {
      setActionError(null);
      setBusyKey(job.key);
      try {
        if (job.service === 'translation') {
          const url = await translationCtx.getValidDownloadUrl(job.id);
          if (url) window.open(url, '_blank', 'noopener');
          else setActionError('Download link is not available for this job.');
        } else {
          await downloadResearchFile(job.id);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Download failed.');
      } finally {
        setBusyKey(null);
      }
    },
    [translationCtx],
  );

  return {
    jobs,
    stats,
    loading,
    loadError,
    actionError,
    busyKey,
    refresh,
    cancelJob,
    downloadJob,
    loadDetail,
  };
}
