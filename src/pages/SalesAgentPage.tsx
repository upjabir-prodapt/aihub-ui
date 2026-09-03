import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, X, Search, ShieldCheck, Zap, Globe, PieChart, Hash } from 'lucide-react';
import { initiateResearch } from '../api/salesAgentApi';
import { useAuth } from '../context/useAuth';
import { useSalesJobs } from '../context/useSalesJobs';
import { useServiceJobs } from '../hooks/useServiceJobs';
import RecentRuns from '../components/RecentRuns';
import RunJobModal from '../components/RunJobModal';
import ServiceLanding from '../components/ServiceLanding';
import '../styles/service-detail.css';
import {
  forceRefreshSalesGoogleIdToken,
  SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS,
} from '../api/salesCloudRunAuth';
import '../styles/sales-agent.css';

// ══════════════════════════════════════════════════════════════════════════════
// Main Sales Agent Page
// ══════════════════════════════════════════════════════════════════════════════

const SALES_ICON = <Zap size={24} />;

const SALES_FEATURES = [
  {
    title: 'Parallel agent research',
    description: '10+ specialized sub-agents gather public company signals concurrently.',
  },
  {
    title: 'Sales alignment brief',
    description: 'Findings are compiled into a deep-dive report covering compliance, market strategy and tech stack.',
  },
  {
    title: 'Cost and model transparency',
    description: 'Every completed run reports the model used, elapsed time, tokens consumed and estimated cost.',
  },
];

interface SalesAgentPageProps {
  /** Optional "view all" link into the shared Job Tracker page. */
  onOpenTracker?: () => void;
  /** Optional back link to the hub. */
  onBack?: () => void;
}

const SalesAgentPage: React.FC<SalesAgentPageProps> = ({ onOpenTracker, onBack }) => {
  const { isSalesAuthenticated } = useAuth();
  const { registerJob } = useSalesJobs();
  const serviceJobs = useServiceJobs('sales');
  const [runOpen, setRunOpen] = useState(false);

  // ── Research form ──────────────────────────────────────────────────────────
  const [company, setCompany] = useState('');
  const [accountId, setAccountId] = useState('');
  /**
   * True only while the initiate-research request is in flight — NOT while
   * the resulting job is queued/processing. A research run can take 20-30+
   * minutes; gating the "Start job" button on the job's own lifecycle (as an
   * earlier version of this page did) meant a second run couldn't be started
   * until the first one finished. Progress and results for every run started
   * (this session or a previous one) show in Recent runs below, exactly like
   * Translation — so nothing here needs to track an individual job further
   * than getting it registered.
   */
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** Recent runs is scrolled into view after submit — it's the only place progress/results show. */
  const resultRef = useRef<HTMLDivElement>(null);

  // Keep Cloud Run invoker token fresh while sales session is active
  useEffect(() => {
    if (!isSalesAuthenticated) return;

    const refresh = async () => {
      try {
        await forceRefreshSalesGoogleIdToken();
      } catch (err) {
        console.warn('Background Sales Google ID token refresh failed:', err);
      }
    };

    const intervalId = window.setInterval(refresh, SALES_GOOGLE_TOKEN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [isSalesAuthenticated]);

  // Invoked by RunJobModal's form submit, which already calls preventDefault.
  const startResearch = async () => {
    if (!company.trim() || !accountId.trim() || !isSalesAuthenticated) return;

    const currentCompany = company.trim();
    const currentAccountId = accountId.trim();

    // Close the run dialog immediately and clear the form so the next run
    // starts fresh — the user doesn't have to wait for this one to finish
    // (or even to be accepted) before opening the dialog again.
    setRunOpen(false);
    setCompany('');
    setAccountId('');
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const res = await initiateResearch(currentAccountId, currentCompany);
      // Register with the shared registry so Service Hub / Recent runs / Job
      // Tracker can see this run too (see hooks/useSalesJobsState.ts).
      registerJob(res.job_id, currentCompany, currentAccountId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start research.';
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }

    setTimeout(() => {
      if (resultRef.current) {
        resultRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, 500);
  };

  // ── Authenticated app (hub middleware guarantees sales session) ────────────
  return (
    <div className="sa-page">
      <ServiceLanding
        category="Revenue"
        name="Sales Agent"
        description="Automated company research and sales alignment, powered by 10+ specialized agents. Enter an account and company, and it returns a deep-dive brief built from public signals."
        icon={SALES_ICON}
        runLabel="Run research"
        onRun={() => setRunOpen(true)}
        onOpenTracker={onOpenTracker}
        onBack={onBack}
        stats={serviceJobs.stats}
        features={SALES_FEATURES}
        returns={['brief', 'pdf']}
      />

      {/* Run dialog — the research console lives here, not on the page. */}
      <RunJobModal
        isOpen={runOpen}
        onClose={() => setRunOpen(false)}
        serviceName="Sales Agent"
        serviceIcon={SALES_ICON}
        submitLabel="Start job"
        submitting={isSubmitting}
        canSubmit={!!company.trim() && !!accountId.trim()}
        onSubmit={startResearch}
      >
        <div className="sa-field">
          <label className="sa-field-label" htmlFor="res-account-id">
            <Hash size={13} /> Account ID <span className="required">*</span>
          </label>
          <input
            id="res-account-id"
            name="account_id"
            type="text"
            className="sa-input"
            placeholder="e.g. ACC-123"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="sa-field">
          <label className="sa-field-label" htmlFor="res-company-name">
            <Search size={13} /> Company name <span className="required">*</span>
          </label>
          <input
            id="res-company-name"
            name="company_name"
            type="text"
            className="sa-input"
            placeholder="e.g. Acme Corp, OpenAI…"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="sa-capabilities">
          <div className="sa-cap"><ShieldCheck size={16} /> Compliance audit</div>
          <div className="sa-cap"><Globe size={16} /> Market strategy</div>
          <div className="sa-cap"><PieChart size={16} /> Tech stack</div>
        </div>
      </RunJobModal>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {submitError && (
        <main className="sa-body">
          <div className="sa-submit-error">
            <AlertCircle size={14} /> {submitError}
            <button
              type="button"
              className="sa-submit-error-dismiss"
              onClick={() => setSubmitError(null)}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </main>
      )}

      <div ref={resultRef}>
        <RecentRuns
          jobs={serviceJobs.jobs}
          loading={serviceJobs.loading}
          loadError={serviceJobs.loadError}
          actionError={serviceJobs.actionError}
          busyKey={serviceJobs.busyKey}
          onRefresh={serviceJobs.refresh}
          onCancel={serviceJobs.cancelJob}
          onDownload={serviceJobs.downloadJob}
          onLoadDetail={serviceJobs.loadDetail}
          onOpenTracker={onOpenTracker}
          // Sales research jobs have no review flow yet — onRate is
          // intentionally omitted.
        />
      </div>
    </div>
  );
};

export default SalesAgentPage;
