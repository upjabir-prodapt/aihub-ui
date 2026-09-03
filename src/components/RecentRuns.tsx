import React, { useState } from 'react';
import { RefreshCw, Download, XCircle, AlertTriangle, MessageSquare, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { timeAgo } from '../utils/time';
import { formatDuration, formatModel, formatCost } from '../utils/jobs';
import type { UnifiedJob, UnifiedJobStatus } from '../types/jobs';
import '../styles/recent-runs.css';

interface RecentRunsProps {
  jobs: UnifiedJob[];
  loading: boolean;
  loadError: string | null;
  actionError: string | null;
  busyKey: string | null;
  onRefresh: () => void;
  onCancel: (job: UnifiedJob) => void;
  onDownload: (job: UnifiedJob) => void;
  /** Fetches cost/tokens/time/model for a completed job — called on row expand. */
  onLoadDetail?: (job: UnifiedJob) => void;
  /** Opens the feedback modal for a completed job. */
  onFeedback?: (job: UnifiedJob) => void;
  /** Legacy alias for onFeedback. */
  onRate?: (job: UnifiedJob) => void;
  /** How many of the most recent runs to show (default 5). */
  limit?: number;
  /** Optional "view all" link into the shared Job Tracker page. */
  onOpenTracker?: () => void;
}

const STATUS_LABEL: Record<UnifiedJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * Inline "recent runs" panel embedded on a service page — the same run data
 * as the Job Tracker, scoped to this service, so you don't have to leave the
 * page to see what you've started. Data comes from the page's useServiceJobs.
 * Rows expand to show cost/tokens/time/model (fetched lazily) and the rate
 * action, mirroring the Job Tracker's expanded detail.
 */
const RecentRuns: React.FC<RecentRunsProps> = ({
  jobs,
  loading,
  loadError,
  actionError,
  busyKey,
  onRefresh,
  onCancel,
  onDownload,
  onLoadDetail,
  onFeedback,
  onRate,
  limit = 5,
  onOpenTracker,
}) => {
  const visible = jobs.slice(0, limit);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  /** Sales research jobs carry a full markdown report — shown collapsed by default. */
  const [reportOpenKey, setReportOpenKey] = useState<string | null>(null);

  const toggleExpand = (job: UnifiedJob) => {
    const next = expandedKey === job.key ? null : job.key;
    setExpandedKey(next);
    if (next && job.status === 'completed') onLoadDetail?.(job);
  };

  return (
    <div className="recent-runs">
      <div className="recent-runs-header">
        <h3 className="recent-runs-title">Recent runs</h3>
        <div className="recent-runs-header-actions">
          <button type="button" className="recent-runs-refresh" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
          {onOpenTracker && (
            <button type="button" className="recent-runs-viewall" onClick={onOpenTracker}>
              View all in Job Tracker →
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="recent-runs-error">
          <AlertTriangle size={13} /> {loadError}
        </div>
      )}
      {actionError && (
        <div className="recent-runs-error">
          <AlertTriangle size={13} /> {actionError}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="recent-runs-empty">No runs yet — start one above.</div>
      ) : (
        <div className="recent-runs-list">
          {visible.map((job) => {
            const busy = busyKey === job.key;
            const expanded = expandedKey === job.key;
            return (
              <div key={job.key} className="recent-run-row">
                <button
                  type="button"
                  className="recent-run-main recent-run-main--clickable"
                  onClick={() => toggleExpand(job)}
                  aria-expanded={expanded}
                >
                  <span className="recent-run-title">{job.title}</span>
                  <span className={`recent-run-badge recent-run-badge--${job.status}`}>
                    {STATUS_LABEL[job.status]}
                  </span>
                </button>
                <div className="recent-run-sub">
                  {job.subtitle} · {timeAgo(job.createdAt)}
                </div>

                {(job.status === 'running' || job.status === 'queued') && (
                  <div className="recent-run-progress-track">
                    <div
                      className={`recent-run-progress-fill ${job.progress === null ? 'indeterminate' : ''}`}
                      style={job.progress !== null ? { width: `${job.progress}%` } : undefined}
                    />
                  </div>
                )}

                {job.errorMessage && <div className="recent-run-error-msg">{job.errorMessage}</div>}

                {(job.canCancel || job.canDownload) && (
                  <div className="recent-run-actions">
                    {job.canCancel && (
                      <button
                        type="button"
                        className="recent-run-action-btn recent-run-action-btn--danger"
                        disabled={busy}
                        onClick={() => onCancel(job)}
                      >
                        <XCircle size={12} /> Cancel
                      </button>
                    )}
                    {job.canDownload && (
                      <button
                        type="button"
                        className="recent-run-action-btn"
                        disabled={busy}
                        onClick={() => onDownload(job)}
                      >
                        <Download size={12} /> Download
                      </button>
                    )}
                    {job.canReview && (onFeedback || onRate) && (
                      <button
                        type="button"
                        className="recent-run-action-btn"
                        disabled={busy}
                        onClick={() => (onFeedback ?? onRate)?.(job)}
                      >
                        <MessageSquare size={12} /> Feedback
                      </button>
                    )}
                  </div>
                )}

                {expanded && job.status === 'completed' && (
                  <div className="recent-run-detail">
                    {job.detailStatus === 'loading' ? (
                      <div className="recent-run-detail-loading">Loading details…</div>
                    ) : job.detailStatus === 'error' ? (
                      <div className="recent-run-detail-error">Couldn't load run details.</div>
                    ) : job.detail ? (
                      <div className="recent-run-detail-grid">
                        <div>
                          <div className="recent-run-detail-label">Cost</div>
                          <div className="recent-run-detail-value">{formatCost(job.detail.costUsd)}</div>
                        </div>
                        <div>
                          <div className="recent-run-detail-label">Tokens</div>
                          <div className="recent-run-detail-value">{job.detail.tokenCount ?? '—'}</div>
                        </div>
                        <div>
                          <div className="recent-run-detail-label">Time</div>
                          <div className="recent-run-detail-value">
                            {job.detail.processingTimeSeconds !== null
                              ? formatDuration(job.detail.processingTimeSeconds)
                              : 'N/A'}
                          </div>
                        </div>
                        <div>
                          <div className="recent-run-detail-label">Model</div>
                          <div className="recent-run-detail-value">
                            {formatModel(job.detail.modelUsed, job.detail.modelVersion)}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {job.detailStatus === 'loaded' && job.detail?.reportContent && (
                      <div className="recent-run-report">
                        <button
                          type="button"
                          className="recent-run-report-toggle"
                          onClick={() =>
                            setReportOpenKey((prev) => (prev === job.key ? null : job.key))
                          }
                        >
                          <FileText size={12} />
                          {reportOpenKey === job.key ? 'Hide report' : 'View report'}
                        </button>
                        {reportOpenKey === job.key && (
                          <div className="recent-run-report-body markdown-content">
                            <ReactMarkdown>{job.detail.reportContent}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RecentRuns;
