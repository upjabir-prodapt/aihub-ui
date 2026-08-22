import React, { useEffect, useRef, useState } from 'react';
import { User, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { useTranslationJobs } from '../context/useTranslationJobs';

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * Centralized user identity + active-jobs control, shared across every page
 * via Topbar. Replaces the previously duplicated per-page session bars
 * (Translation's .sales-session-bar and Sales Agent's .sa-session).
 */
const UserMenu: React.FC = () => {
  const { user, salesUser, isAuthenticated, isSalesAuthenticated, logout, logoutSales } = useAuth();
  const { batchId, jobs, jobOrder, status } = useTranslationJobs();

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const email = user?.email ?? salesUser?.email ?? null;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    if (isAuthenticated) logout();
    if (isSalesAuthenticated) logoutSales();
    setOpen(false);
  };

  const activeJobs = jobOrder
    .map((id) => jobs[id])
    .filter((job): job is NonNullable<typeof job> => !!job);

  const inProgressCount = activeJobs.filter(
    (job) => job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled',
  ).length;

  if (!email) return null;

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
      >
        <span className="user-menu-avatar">
          <User size={14} />
        </span>
        <span className="user-menu-email">{email}</span>
        {inProgressCount > 0 && (
          <span className="user-menu-badge" title={`${inProgressCount} job(s) in progress`}>
            {inProgressCount}
          </span>
        )}
        <ChevronDown size={14} className={`user-menu-chevron ${open ? 'rotated' : ''}`} />
      </button>

      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-header">
            <div className="user-menu-header-email">{email}</div>
          </div>

          <div className="user-menu-section">
            <div className="user-menu-section-title">
              Translation Jobs
              {batchId && (
                <span className="user-menu-batch-id" title={batchId}>
                  Batch {batchId.substring(0, 8)}…
                </span>
              )}
            </div>

            {activeJobs.length === 0 ? (
              <div className="user-menu-empty">No jobs running right now.</div>
            ) : (
              <ul className="user-menu-job-list">
                {activeJobs.map((job) => (
                  <li key={job.job_id} className="user-menu-job-item">
                    <span className={`user-menu-job-status user-menu-job-status--${job.status}`}>
                      {STATUS_LABELS[job.status] ?? job.status}
                    </span>
                    <span className="user-menu-job-id" title={job.job_id}>
                      {job.job_id.substring(0, 8)}…
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {status === 'failed' && (
              <div className="user-menu-error">There was a problem checking job status.</div>
            )}
          </div>

          <button className="user-menu-logout" onClick={handleLogout} id="user-menu-logout-btn">
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
