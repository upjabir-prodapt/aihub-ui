import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
  ShieldCheck,
  Zap,
  Globe,
  PieChart,
  Download,
  Hash,
  Cpu,
  Clock,
  Coins,
} from 'lucide-react';
import {
  initiateResearch,
  getResearchStatus,
  getResearchResult,
  downloadResearchFile,
} from './api';
import type { ResearchModelCard } from './api';
import { useEntitlements } from '../auth/useAuth';
import { useSalesJobs } from './useSalesJobs';
import { useServiceJobs } from '../../shared/hooks/useServiceJobs';
import RecentRuns from '../tracker/RecentRuns';
import RunJobModal from '../translation/RunJobModal';
import ServiceLanding from '../hub/ServiceLanding';
import '../../styles/service-detail.css';
import '../../styles/sales-agent.css';

// ── Types ──────────────────────────────────────────────────────────────────

// Note: the backend persists the initial job state as 'QUEUED' even though the
// initiate response reports 'PENDING', so both must be treated as in-progress.
type Status = 'IDLE' | 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

// Statuses for which we should keep polling / show the progress tracker.
const IN_PROGRESS: ReadonlySet<Status> = new Set<Status>(['PENDING', 'QUEUED', 'PROCESSING']);

/** Status poll interval — jobs often run 20–30+ minutes. */
const STATUS_POLL_INTERVAL_MS = 2 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

// Human-readable duration from a number of seconds.
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// The model that produced the report, e.g. "gemini-2.5-pro".
function formatModelName(card: ResearchModelCard | null): string {
  const version = card?.model_version?.trim();
  return version || 'Unknown';
}

// Prefer the backend's model_card.latency_seconds; when it is missing, fall
// back to the client-measured elapsed time (start → completion) so the report
// never renders a bare unit or nothing at all.
function getResearchDuration(
  card: ResearchModelCard | null,
  startedAt: Date | null,
  completedAt: Date | null,
): string {
  const latency = asFiniteNumber(card?.latency_seconds);
  if (latency !== null && latency > 0) {
    return formatDuration(latency);
  }
  if (startedAt && completedAt) {
    const diffSec = (completedAt.getTime() - startedAt.getTime()) / 1000;
    if (diffSec > 0) return formatDuration(diffSec);
  }
  return 'N/A';
}

function formatTokens(card: ResearchModelCard | null): string {
  const tokens = asFiniteNumber(card?.tokens_used);
  if (tokens !== null) {
    return Math.round(tokens).toLocaleString();
  }
  return 'N/A';
}

function formatCost(card: ResearchModelCard | null): string {
  const cost = asFiniteNumber(card?.cost_usd);
  if (cost !== null) {
    return `$${cost.toFixed(4)}`;
  }
  return 'N/A';
}

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
  const { registerJob } = useSalesJobs();
  const serviceJobs = useServiceJobs('sales');
  const [runOpen, setRunOpen] = useState(false);

  // ── Research state ─────────────────────────────────────────────────────────
  const [company,    setCompany]    = useState('');
  const [accountId,  setAccountId]  = useState('');
  const [jobId,      setJobId]      = useState<string | null>(null);
  const [status,     setStatus]     = useState<Status>('IDLE');
  const [report,     setReport]     = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [lastCheck,  setLastCheck]  = useState<Date | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [modelCard,  setModelCard]  = useState<ResearchModelCard | null>(null);
  const [startedAt,  setStartedAt]  = useState<Date | null>(null);
  const [completedAt, setCompletedAt] = useState<Date | null>(null);

  const fetchResult = useCallback(async () => {
    if (!jobId || !canSales) return;
    try {
      const res = await getResearchResult(jobId);
      // Canonical key is `report_content` (FastAPI ResearchResultResponse, no
      // alias; the dev/nginx proxy is a pure path-rewrite pass-through and does
      // not remap the body). `report_markdown` kept only as a legacy fallback.
      setReport(res.report_content ?? res.report_markdown ?? 'No report content available.');
      setModelCard(res.model_card ?? null);
    } catch (err) {
      console.error('Result fetch error:', err);
      setError('Failed to fetch research results.');
    }
  }, [jobId, canSales]);

  const checkStatus = useCallback(async () => {
    if (!jobId || !canSales) return;
    try {
      const res = await getResearchStatus(jobId);
      const newStatus = res.status as Status;
      setStatus(newStatus);
      setLastCheck(new Date());
      if (newStatus === 'COMPLETED') {
        // Stamp completion once, as a fallback source for elapsed time.
        setCompletedAt((prev) => prev ?? new Date());
        void fetchResult();
      }
    } catch (err) {
      console.error('Status check error:', err);
    }
  }, [jobId, canSales, fetchResult]);

  // The background Cloud Run invoker-token refresh that used to live here is
  // gone. Token lifetime is the BFF's problem now: it refreshes the Entra
  // access token at 80% of its life behind a Firestore lease (docs 13 §3), and
  // the browser holds no token to keep fresh.

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let immediate: ReturnType<typeof setTimeout> | undefined;
    if (IN_PROGRESS.has(status) && jobId && canSales) {
      immediate = setTimeout(() => void checkStatus(), 0);
      interval = setInterval(() => void checkStatus(), STATUS_POLL_INTERVAL_MS);
    }
    return () => {
      if (immediate) clearTimeout(immediate);
      if (interval) clearInterval(interval);
    };
  }, [status, jobId, canSales, checkStatus]);

  const resetResearch = () => {
    setCompany('');
    setAccountId('');
    setJobId(null);
    setStatus('IDLE');
    setReport(null);
    setError(null);
    setLastCheck(null);
    setModelCard(null);
    setStartedAt(null);
    setCompletedAt(null);
  };

  // Invoked by RunJobModal's form submit, which already calls preventDefault.
  const startResearch = async () => {
    if (!company.trim() || !accountId.trim() || !canSales) return;

    // Close the run dialog immediately — progress and the report render on
    // the page itself once the job is in flight.
    setRunOpen(false);
    setStatus('PENDING');
    setError(null);
    setReport(null);
    setJobId(null);
    setModelCard(null);
    setCompletedAt(null);
    setStartedAt(new Date());

    try {
      const res = await initiateResearch(accountId.trim(), company.trim());
      setJobId(res.job_id);
      setStatus((res.status as Status) || 'PENDING');
      // Register with the shared registry so Service Hub / Job Tracker can
      // see this run too (see hooks/useSalesJobsState.ts).
      registerJob(res.job_id, company.trim(), accountId.trim());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start research.';
      setError(msg);
      setStatus('FAILED');
    }
  };

  const handleDownload = async () => {
    if (!jobId || !canSales) return;
    setDownloading(true);
    try {
      await downloadResearchFile(jobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download failed.';
      setError(msg);
    } finally {
      setDownloading(false);
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
        submitting={IN_PROGRESS.has(status)}
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
      <main className="sa-body">
        {/* ── PENDING / QUEUED / PROCESSING: Status tracker ───────────────── */}
        {IN_PROGRESS.has(status) && (
          <section className="sa-tracker">
            <div className="sa-tracker-head">
              <div className="sa-tracker-pulse"><RefreshCw className="spin" size={18} /></div>
              <div>
                <h3 className="sa-tracker-title">Researching {company}</h3>
                <p className="sa-tracker-meta">Job {jobId} · Account {accountId}</p>
              </div>
            </div>

            <div className="sa-steps">
              <div className={`sa-step ${status === 'PROCESSING' ? 'done' : 'active'}`}>
                <div className="sa-step-icon">
                  {status === 'PROCESSING'
                    ? <CheckCircle2 size={16} />
                    : <RefreshCw className="spin" size={15} />}
                </div>
                <div className="sa-step-label">Initializing agent</div>
              </div>
              <div className={`sa-step ${status === 'PROCESSING' ? 'active' : ''}`}>
                <div className="sa-step-icon">
                  {status === 'PROCESSING'
                    ? <RefreshCw className="spin" size={15} />
                    : <span className="sa-step-dot" />}
                </div>
                <div className="sa-step-label">Parallel data extraction (10+ agents)</div>
              </div>
              <div className="sa-step">
                <div className="sa-step-icon"><span className="sa-step-dot" /></div>
                <div className="sa-step-label">Markdown report compilation</div>
              </div>
            </div>

            {lastCheck && (
              <div className="sa-tracker-foot">
                <span className="sa-live-dot" /> Last updated {lastCheck.toLocaleTimeString()}
              </div>
            )}
          </section>
        )}

        {/* ── FAILED ──────────────────────────────────────────────────────── */}
        {status === 'FAILED' && (
          <section className="sa-error">
            <div className="sa-error-icon"><AlertCircle size={30} /></div>
            <h3 className="sa-error-title">Research failed</h3>
            <p className="sa-error-msg">{error}</p>
            <button onClick={resetResearch} className="sa-cta sa-cta--ghost">
              Start new research
            </button>
          </section>
        )}

        {/* ── COMPLETED: Report ────────────────────────────────────────────── */}
        {status === 'COMPLETED' && report && (
          <section className="sa-report">
            <div className="sa-report-toolbar">
              <div className="sa-report-title">
                <div className="sa-report-title-icon"><FileText size={18} /></div>
                <div className="sa-report-title-copy">
                  <h3>Research report · {company}</h3>
                  <span>Job {jobId} · Account {accountId}</span>
                  <div className="sa-report-meta">
                    <span className="sa-report-meta-item" title="Model used for this research run">
                      <Cpu size={12} /> {formatModelName(modelCard)}
                    </span>
                    <span className="sa-report-meta-item" title="End-to-end processing time">
                      <Clock size={12} /> {getResearchDuration(modelCard, startedAt, completedAt)}
                    </span>
                    <span className="sa-report-meta-item" title="Total tokens consumed">
                      <Hash size={12} /> {formatTokens(modelCard)}
                    </span>
                    <span className="sa-report-meta-item" title="Estimated cost in USD">
                      <Coins size={12} /> {formatCost(modelCard)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="sa-report-actions">
                <button
                  id="res-download-btn"
                  className="sa-btn download-btn"
                  onClick={handleDownload}
                  disabled={downloading}
                  title="Download research report file"
                >
                  {downloading
                    ? <><RefreshCw size={14} className="spin" /> <span className="btn-label">Downloading…</span></>
                    : <><Download size={15} /> <span className="btn-label">Download</span></>}
                </button>
                <button className="sa-btn sa-btn--primary" onClick={resetResearch}>
                  New research
                </button>
              </div>
            </div>
            <div className="sa-report-body markdown-content">
              <ReactMarkdown>{report}</ReactMarkdown>
            </div>
          </section>
        )}

        {/* ── COMPLETED but report not yet loaded ──────────────────────────── */}
        {status === 'COMPLETED' && !report && (
          <section className="sa-loading">
            <RefreshCw className="spin" size={30} />
            <p>Compiling final markdown report…</p>
          </section>
        )}
      </main>

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
        // Sales research jobs have no per-job detail endpoint or review flow
        // yet — onLoadDetail/onRate are intentionally omitted.
      />
    </div>
  );
};

export default SalesAgentPage;
