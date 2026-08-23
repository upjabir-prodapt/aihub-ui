import React from 'react';
import { RefreshCw, Download, XCircle, AlertTriangle } from 'lucide-react';
import { timeAgo } from '../utils/time';
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
  limit = 5,
  onOpenTracker,
}) => {
  const visible = jobs.slice(0, limit);

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
            return (
              <div key={job.key} className="recent-run-row">
                <div className="recent-run-main">
                  <span className="recent-run-title">{job.title}</span>
                  <span className={`recent-run-badge recent-run-badge--${job.status}`}>
                    {STATUS_LABEL[job.status]}
                  </span>
                </div>
                <div className="recent-run-sub">
                  {job.subtitle} · {timeAgo(job.createdAt)}
                </div>

                {job.status === 'running' && (
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
