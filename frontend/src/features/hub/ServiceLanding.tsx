import React from 'react';
import { ArrowLeft, Play, ListChecks } from 'lucide-react';
import type { ServiceJobStats } from '../../shared/hooks/useServiceJobs';

export interface ServiceFeature {
  title: string;
  description: string;
}

interface ServiceLandingProps {
  category: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  /** Label for the primary action, e.g. "Run translation". */
  runLabel: string;
  onRun: () => void;
  runDisabled?: boolean;
  runDisabledHint?: string;
  onOpenTracker?: () => void;
  onBack?: () => void;
  stats: ServiceJobStats;
  features: ServiceFeature[];
  returns: string[];
}

/**
 * Overview header for a service page: what it is, the two entry points
 * (run it / see all its jobs), live run counts, and what it can do.
 */
const ServiceLanding: React.FC<ServiceLandingProps> = ({
  category,
  name,
  description,
  icon,
  runLabel,
  onRun,
  runDisabled = false,
  runDisabledHint,
  onOpenTracker,
  onBack,
  stats,
  features,
  returns,
}) => {
  return (
    <div className="svc-landing">
      {onBack && (
        <button type="button" className="svc-back" onClick={onBack}>
          <ArrowLeft size={13} /> All services
        </button>
      )}

      <div className="svc-head">
        <span className="svc-head-icon">{icon}</span>
        <div className="svc-head-copy">
          <p className="svc-category">{category}</p>
          <h1 className="svc-name">{name}</h1>
        </div>
      </div>

      <p className="svc-description">{description}</p>

      <div className="svc-actions">
        <button
          type="button"
          className="svc-btn svc-btn--primary"
          onClick={onRun}
          disabled={runDisabled}
          title={runDisabled ? runDisabledHint : undefined}
        >
          <Play size={14} /> {runLabel}
        </button>
        {onOpenTracker && (
          <button type="button" className="svc-btn svc-btn--ghost" onClick={onOpenTracker}>
            <ListChecks size={14} /> All jobs
          </button>
        )}
      </div>

      <div className="svc-stats">
        <div className="svc-stat">
          <div className="svc-stat-label">Completed</div>
          <div className="svc-stat-value">
            {stats.completed} run{stats.completed === 1 ? '' : 's'}
          </div>
        </div>
        <div className="svc-stat">
          <div className="svc-stat-label">In flight</div>
          <div className="svc-stat-value">
            {stats.inFlight > 0 ? (
              <>
                <span className="svc-stat-dot" /> {stats.inFlight} now
              </>
            ) : (
              'None'
            )}
          </div>
        </div>
        <div className="svc-stat">
          <div className="svc-stat-label">Failed</div>
          <div className="svc-stat-value">
            {stats.failed > 0 ? `${stats.failed} needs attention` : 'None'}
          </div>
        </div>
      </div>

      {features.length > 0 && (
        <>
          <h2 className="svc-section-title">What it does</h2>
          <div className="svc-features">
            {features.map((f) => (
              <div key={f.title} className="svc-feature">
                <h3 className="svc-feature-title">{f.title}</h3>
                <p className="svc-feature-desc">{f.description}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {returns.length > 0 && (
        <div className="svc-returns">
          <span className="svc-returns-label">Returns</span>
          {returns.map((r) => (
            <span key={r} className="svc-returns-tag">
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ServiceLanding;
