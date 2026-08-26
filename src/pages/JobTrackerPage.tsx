import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, Download, XCircle, AlertTriangle, MessageSquare } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { useTranslationJobs } from '../context/useTranslationJobs';
import { useSalesJobs } from '../context/useSalesJobs';
import { translationApi } from '../api/translationApi';
import { downloadResearchFile, listResearchJobs } from '../api/salesAgentApi';
import {
  normalizeTranslationHistoryItem,
  normalizeTranslationActiveItem,
  normalizeSalesHistoryItem,
  normalizeSalesJob,
  mergeJobLists,
  loadJobDetail,
  formatDuration,
  formatModel,
  formatCost,
} from '../utils/jobs';
import ReviewModal from '../components/ReviewModal';
import type { ResearchJobListItem } from '../api/salesAgentApi';
import type { LegacyJobStatusResponse } from '../types/translation';
import type { UnifiedJob, UnifiedJobStatus } from '../types/jobs';
import { timeAgo, dayBucket } from '../utils/time';
import '../styles/job-tracker.css';
// ReviewModal and the review toast styles live in translation.css (shared with
// TranslationPage) — imported here too since this page can be the first to
// mount them if a user opens Job Tracker before ever visiting Translation.
import '../styles/translation.css';

/** How often to silently re-pull server-side history while a run is in flight. */
const AUTO_REFRESH_INTERVAL_MS = 20_000;

type StatusFilter = 'all' | UnifiedJobStatus;
type ServiceFilter = 'all' | 'translation' | 'sales';

const STATUS_LABEL: Record<UnifiedJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_FILTERS: StatusFilter[] = ['all', 'running', 'queued', 'completed', 'failed'];

interface JobTrackerPageProps {
  /** Pre-selected service filter, set when arriving from a service page's "All jobs". */
  serviceFilter?: ServiceFilter;
}

const JobTrackerPage: React.FC<JobTrackerPageProps> = ({ serviceFilter: initialServiceFilter = 'all' }) => {
  const { isAuthenticated, isSalesAuthenticated } = useAuth();
  const translationCtx = useTranslationJobs();
  const salesCtx = useSalesJobs();

  const [history, setHistory] = useState<UnifiedJob[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>(initialServiceFilter);

  // This pane stays mounted while hidden, so a new incoming filter (from a
  // service page's "All jobs") has to be adopted on prop change rather than
  // just at mount. React's documented "adjust state during render" pattern.
  const [lastIncomingFilter, setLastIncomingFilter] = useState(initialServiceFilter);
  if (lastIncomingFilter !== initialServiceFilter) {
    setLastIncomingFilter(initialServiceFilter);
    setServiceFilter(initialServiceFilter);
  }
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // "Today" is capped to the 3 most recent runs by default to keep the top of
  // the list scannable; older-day buckets are small enough to show in full.
  const TODAY_BUCKET_LIMIT = 3;
  const [showAllToday, setShowAllToday] = useState(false);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);

  /**
   * Pulls both services' histories. Each backend retains only the last 7 days
   * and purges generated output files after that, so this list is inherently a
   * rolling week and needs no client-side date filter.
   *
   * Uses allSettled so one service being down (or not entitled) still shows
   * the other's runs rather than emptying the whole tracker.
   */
  const loadHistory = useCallback(async () => {
    if (!isAuthenticated && !isSalesAuthenticated) {
      setHistory([]);
      return;
    }
    setLoading(true);
    setHistoryError(null);

    const translationReq: Promise<LegacyJobStatusResponse[]> = isAuthenticated
      ? translationApi.listJobs()
      : Promise.resolve([]);
    const salesReq: Promise<ResearchJobListItem[]> = isSalesAuthenticated
      ? listResearchJobs()
      : Promise.resolve([]);

    const [translationRes, salesRes] = await Promise.allSettled([translationReq, salesReq]);

    const collected: UnifiedJob[] = [];
    const errors: string[] = [];

    if (translationRes.status === 'fulfilled') {
      collected.push(...translationRes.value.map(normalizeTranslationHistoryItem));
    } else {
      errors.push("Couldn't load Translation history.");
    }

    if (salesRes.status === 'fulfilled') {
      collected.push(...salesRes.value.map(normalizeSalesHistoryItem));
    } else {
      errors.push("Couldn't load Sales Agent history.");
    }

    setHistory(collected);
    setHistoryError(errors.length > 0 ? errors.join(' ') : null);
    setLoading(false);
  }, [isAuthenticated, isSalesAuthenticated]);

  useEffect(() => {
    // Deferred via a microtask so the first setState doesn't run synchronously
    // within the effect body (react-hooks/set-state-in-effect).
    Promise.resolve().then(() => {
      void loadHistory();
    });
  }, [loadHistory]);

  // Keep server-side history current without a manual refresh, so this tab
  // reflects live progress even when it isn't the one that started a run —
  // but only while something is actually in flight, and paused while the tab
  // is hidden so a backgrounded browser tab doesn't keep hammering the API.
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

  // Memoized so `allJobs` below actually caches — a fresh array here would
  // change the dependency identity on every render.
  const activeTranslationItems = useMemo(
    () =>
      translationCtx.jobOrder
        .map((id) => translationCtx.jobs[id])
        .filter((j): j is NonNullable<typeof j> => !!j)
        .map(normalizeTranslationActiveItem),
    [translationCtx.jobOrder, translationCtx.jobs],
  );

  const salesItems = useMemo(
    () =>
      salesCtx.jobOrder
        .map((id) => salesCtx.jobs[id])
        .filter((j): j is NonNullable<typeof j> => !!j)
        .map(normalizeSalesJob),
    [salesCtx.jobOrder, salesCtx.jobs],
  );

  const allJobs = useMemo(
    () => mergeJobLists(history, activeTranslationItems, salesItems),
    [history, activeTranslationItems, salesItems],
  );

  const stats = useMemo(
    () => ({
      running: allJobs.filter((j) => j.status === 'running').length,
      queued: allJobs.filter((j) => j.status === 'queued').length,
      completed: allJobs.filter((j) => j.status === 'completed').length,
      failed: allJobs.filter((j) => j.status === 'failed' || j.status === 'cancelled').length,
    }),
    [allJobs],
  );

  const filtered = allJobs.filter((j) => {
    if (serviceFilter !== 'all' && j.service !== serviceFilter) return false;
    if (statusFilter === 'all') return true;
    if (statusFilter === 'failed') return j.status === 'failed' || j.status === 'cancelled';
    return j.status === statusFilter;
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, UnifiedJob[]>();
    for (const job of filtered) {
      const bucket = dayBucket(job.createdAt);
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket)?.push(job);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  const handleRefresh = () => {
    void loadHistory();
    void salesCtx.refreshAll();
  };

  const toastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleReviewSubmitted = (ok: boolean, message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ ok, message });
    toastTimerRef.current = setTimeout(() => setToast(null), 4500);
  };

  const handleCancel = async (job: UnifiedJob) => {
    setActionError(null);
    setBusyKey(job.key);
    try {
      if (job.service === 'translation') await translationCtx.cancelJob(job.id);
      else await salesCtx.cancelJob(job.id);
      // The service contexts only track jobs started in this session, so a row
      // that came from the backend history wouldn't otherwise update until the
      // next refresh. Patch it here too.
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
  };

  const handleDownload = async (job: UnifiedJob) => {
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
  };

  return (
    <div className="page-content">
      <div className="tracker-page">
        <div className="tracker-header">
          <div>
            <p className="tracker-eyebrow">COLT AIHUB · Service Activity</p>
            <h1 className="tracker-title">Job Tracker</h1>
            <p className="tracker-subtitle">
              Unified job tracker across services in AI Hub. Only the latest 7 days of activity and outputs are displayed here.
            </p>
          </div>
          <button type="button" className="tracker-refresh-btn" onClick={handleRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {!isAuthenticated && !isSalesAuthenticated && (
          <div className="tracker-empty-banner">Sign in to a service to see its jobs here.</div>
        )}

        {historyError && (
          <div className="tracker-error-banner">
            <AlertTriangle size={14} /> {historyError}
          </div>
        )}

        <div className="tracker-stats">
          <div className="tracker-stat">
            <span className="tracker-stat-label">
              <span className="dot dot-running" />
              Running
            </span>
            <span className="tracker-stat-value">{stats.running}</span>
          </div>
          <div className="tracker-stat">
            <span className="tracker-stat-label">
              <span className="dot dot-queued" />
              Queued
            </span>
            <span className="tracker-stat-value">{stats.queued}</span>
          </div>
          <div className="tracker-stat">
            <span className="tracker-stat-label">
              <span className="dot dot-completed" />
              Completed
            </span>
            <span className="tracker-stat-value">{stats.completed}</span>
          </div>
          <div className="tracker-stat">
            <span className="tracker-stat-label">
              <span className="dot dot-failed" />
              Failed
            </span>
            <span className="tracker-stat-value">{stats.failed}</span>
          </div>
        </div>

        <div className="tracker-filters">
          <div className="tracker-chip-row">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={`tracker-chip ${statusFilter === f ? 'active' : ''}`}
                onClick={() => setStatusFilter(f)}
              >
                {f === 'all' ? 'All statuses' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>
          <select
            className="tracker-service-select"
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value as ServiceFilter)}
            aria-label="Filter by service"
          >
            <option value="all">All services</option>
            <option value="translation">Translation</option>
            <option value="sales">Sales Agent</option>
          </select>
          <span className="tracker-count">
            {filtered.length} of {allJobs.length}
          </span>
        </div>

        {actionError && (
          <div className="tracker-error-banner">
            <AlertTriangle size={14} /> {actionError}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="tracker-empty-state">
            {allJobs.length === 0
              ? 'No runs in the last 7 days.'
              : 'No jobs match these filters.'}
          </div>
        ) : (
          grouped.map(([bucket, jobsInBucket]) => {
            const isToday = bucket === 'Today';
            const visibleJobs =
              isToday && !showAllToday ? jobsInBucket.slice(0, TODAY_BUCKET_LIMIT) : jobsInBucket;
            const hiddenCount = jobsInBucket.length - visibleJobs.length;
            return (
              <div key={bucket} className="tracker-group">
                <div className="tracker-group-label">{bucket}</div>
                <div className="tracker-list">
                  {visibleJobs.map((job) => {
                    const expanded = expandedKey === job.key;
                    const busy = busyKey === job.key;
                    return (
                      <div key={job.key} className={`tracker-row status-${job.status}`}>
                        <button
                          type="button"
                          className="tracker-row-main"
                          onClick={() => {
                            const next = expanded ? null : job.key;
                            setExpandedKey(next);
                            if (next && job.status === 'completed') loadDetail(job);
                          }}
                        >
                          <span className="tracker-row-icon">{job.service === 'translation' ? 'T' : 'S'}</span>
                          <span className="tracker-row-body">
                            <span className="tracker-row-title-line">
                              <span className="tracker-row-title">{job.title}</span>
                              <span className={`tracker-badge tracker-badge--${job.status}`}>
                                {STATUS_LABEL[job.status]}
                              </span>
                            </span>
                            <span className="tracker-row-sub">
                              {job.subtitle} · {timeAgo(job.createdAt)}
                            </span>
                          </span>
                          <span className="tracker-row-right">
                            {job.status === 'running' && job.progress !== null ? `${job.progress}%` : null}
                          </span>
                        </button>

                        {job.status === 'running' && (
                          <div className="tracker-progress-track">
                            <div
                              className={`tracker-progress-fill ${job.progress === null ? 'indeterminate' : ''}`}
                              style={job.progress !== null ? { width: `${job.progress}%` } : undefined}
                            />
                          </div>
                        )}

                        {expanded && (
                          <div className="tracker-detail">
                            {job.errorMessage && <div className="tracker-detail-error">{job.errorMessage}</div>}
                            <div className="tracker-detail-grid">
                              <div>
                                <div className="tracker-detail-label">Run ID</div>
                                <div className="tracker-detail-value">{job.id}</div>
                              </div>
                              <div>
                                <div className="tracker-detail-label">Service</div>
                                <div className="tracker-detail-value">{job.serviceLabel}</div>
                              </div>
                              {job.startedBy && (
                                <div>
                                  <div className="tracker-detail-label">Started by</div>
                                  <div className="tracker-detail-value">{job.startedBy}</div>
                                </div>
                              )}
                              {job.status === 'completed' && job.detailStatus === 'loading' && (
                                <div className="tracker-detail-loading">Loading details…</div>
                              )}
                              {job.status === 'completed' && job.detailStatus === 'error' && (
                                <div className="tracker-detail-error">Couldn't load run details.</div>
                              )}
                              {job.status === 'completed' && job.detail && (
                                <>
                                  <div>
                                    <div className="tracker-detail-label">Cost</div>
                                    <div className="tracker-detail-value">{formatCost(job.detail.costUsd)}</div>
                                  </div>
                                  <div>
                                    <div className="tracker-detail-label">Tokens</div>
                                    <div className="tracker-detail-value">{job.detail.tokenCount ?? '—'}</div>
                                  </div>
                                  <div>
                                    <div className="tracker-detail-label">Time</div>
                                    <div className="tracker-detail-value">
                                      {job.detail.processingTimeSeconds !== null
                                        ? formatDuration(job.detail.processingTimeSeconds)
                                        : 'N/A'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="tracker-detail-label">Model</div>
                                    <div className="tracker-detail-value">
                                      {formatModel(job.detail.modelUsed, job.detail.modelVersion)}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                            <div className="tracker-detail-actions">
                              {job.canCancel && (
                                <button
                                  type="button"
                                  className="tracker-action-btn tracker-action-btn--danger"
                                  disabled={busy}
                                  onClick={() => void handleCancel(job)}
                                >
                                  <XCircle size={13} /> Cancel
                                </button>
                              )}
                              {job.canDownload && (
                                <button
                                  type="button"
                                  className="tracker-action-btn"
                                  disabled={busy}
                                  onClick={() => void handleDownload(job)}
                                >
                                  <Download size={13} /> Download output
                                </button>
                              )}
                              {job.canReview && (
                                <button
                                  type="button"
                                  className="tracker-action-btn"
                                  disabled={busy}
                                  onClick={() => setReviewJobId(job.id)}
                                >
                                  <MessageSquare size={13} /> Feedback
                                </button>
                              )}
                              {job.status === 'failed' && (
                                <span className="tracker-detail-hint">
                                  Fix the issue above, then start a similar job with the same settings.
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {isToday && hiddenCount > 0 && (
                  <button
                    type="button"
                    className="tracker-show-all-btn"
                    onClick={() => setShowAllToday(true)}
                  >
                    Show all {jobsInBucket.length} today
                  </button>
                )}
                {isToday && showAllToday && jobsInBucket.length > TODAY_BUCKET_LIMIT && (
                  <button
                    type="button"
                    className="tracker-show-all-btn"
                    onClick={() => setShowAllToday(false)}
                  >
                    Show fewer
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {reviewJobId && (
        <ReviewModal
          isOpen={!!reviewJobId}
          jobId={reviewJobId}
          onClose={() => setReviewJobId(null)}
          onSubmitted={handleReviewSubmitted}
        />
      )}

      {toast && (
        <div className={`review-toast ${toast.ok ? 'review-toast--success' : 'review-toast--error'}`} role="status" aria-live="polite">
          <div className="review-toast-icon">
            {toast.ok ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
          </div>
          <span className="review-toast-message">{toast.message}</span>
          <button className="review-toast-close" onClick={() => setToast(null)} aria-label="Dismiss">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default JobTrackerPage;
