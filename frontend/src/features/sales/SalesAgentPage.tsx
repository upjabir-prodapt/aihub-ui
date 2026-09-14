import React, { useState } from 'react';
import { Search, AlertCircle, ShieldCheck, Zap, Globe, PieChart, Hash } from 'lucide-react';
import { initiateResearch } from './api';
import { useEntitlements } from '../auth/useAuth';
import { useSalesJobs } from './useSalesJobs';
import { useServiceJobs } from '../../shared/hooks/useServiceJobs';
import RecentRuns from '../tracker/RecentRuns';
import RunJobModal from '../translation/RunJobModal';
import ServiceLanding from '../hub/ServiceLanding';
import '../../styles/service-detail.css';
import '../../styles/sales-agent.css';

/**
 * This page launches research runs; it does not display their results.
 *
 * Results live in Recent runs (and the Job Tracker), one row per run, the same
 * arrangement Translation uses. The page previously rendered a progress
 * tracker and the full markdown report for a single "current" run, which meant
 * starting a second run replaced the first one's report on screen. Per-run
 * cost/tokens/time/model now come from expanding a row — see
 * `extractSalesDetail` in shared/utils/jobs.ts.
 */

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
  const { sales: canSales } = useEntitlements();
  const { registerJob, jobOrder } = useSalesJobs();
  const serviceJobs = useServiceJobs('sales');
  const [runOpen, setRunOpen] = useState(false);

  const [company, setCompany] = useState('');
  const [accountId, setAccountId] = useState('');
  /** Submit-time failure only. Per-run failures surface on the run's own row. */
  const [error, setError] = useState<string | null>(null);
  /**
   * True only while `POST /research/initiate` is in flight.
   *
   * Deliberately NOT the running job's status: gating the run dialog on that
   * meant a second research run could not be started until the first finished.
   * The registry in useSalesJobsState already tracks and polls any number of
   * concurrent runs, so the only limit was this button.
   */
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Invoked by RunJobModal's form submit, which already calls preventDefault.
  const startResearch = async () => {
    if (!company.trim() || !accountId.trim() || !canSales) return;

    // Close the run dialog immediately — the new run appears as a row in
    // Recent runs below, which is where its progress and result live.
    setRunOpen(false);
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await initiateResearch(accountId.trim(), company.trim());
      // Register with the shared registry so Recent runs, the Service Hub and
      // the Job Tracker pick the run up immediately, and so it keeps polling
      // regardless of what else is started afterwards.
      registerJob(res.job_id, company.trim(), accountId.trim());
      setCompany('');
      setAccountId('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start research.');
    } finally {
      setIsSubmitting(false);
    }
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
        canSubmit={!!company.trim() && !!accountId.trim() && !isSubmitting}
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

      {/* A submit that never produced a run. Once any run exists, failures
          belong to that run and are shown on its row in Recent runs, which is
          how Translation handles the same case. */}
      {error && jobOrder.length === 0 && (
        <section className="sa-error">
          <div className="sa-error-icon"><AlertCircle size={30} /></div>
          <h3 className="sa-error-title">Could not start research</h3>
          <p className="sa-error-msg">{error}</p>
          <button onClick={() => setRunOpen(true)} className="sa-cta sa-cta--ghost">
            Try again
          </button>
        </section>
      )}

      <RecentRuns
        jobs={serviceJobs.jobs}
        loading={serviceJobs.loading}
        loadError={serviceJobs.loadError}
        actionError={serviceJobs.actionError}
        busyKey={serviceJobs.busyKey}
        onRefresh={serviceJobs.refresh}
        onCancel={serviceJobs.cancelJob}
        onDownload={serviceJobs.downloadJob}
        onOpenTracker={onOpenTracker}
        // Expanding a completed row now loads the run's model/tokens/time/cost
        // from GET /research/result — the figures the removed report panel used
        // to show. There is still no review flow for research runs, so onRate
        // stays omitted.
        onLoadDetail={serviceJobs.loadDetail}
      />
    </div>
  );
};

export default SalesAgentPage;
