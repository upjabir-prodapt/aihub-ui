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
} from '../api/salesAgentApi';
import type { ResearchModelCard } from '../api/salesAgentApi';
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
  const { isSalesAuthenticated } = useAuth();
  const { registerJob } = useSalesJobs();
  const serviceJobs = useServiceJobs('sales');
  const [runOpen, setRunOpen] = useState(false);

  // ── Research state ─────────────────────────────────────────────────────────
  const [company, setCompany] = useState('');
  const [accountId, setAccountId] = useState('');
  const [submitting, setSubmitting] = useState(false);


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


  const resetResearch = () => {
    setCompany('');
    setAccountId('');
  };

  // Invoked by RunJobModal's form submit, which already calls preventDefault.
  const startResearch = async () => {
    if (!company.trim() || !accountId.trim() || !isSalesAuthenticated) return;

    setRunOpen(false);
    setSubmitting(true);

    try {
      const res = await initiateResearch(accountId.trim(), company.trim());
      // Register with the shared registry so Service Hub / Job Tracker can
      // see this run too (see hooks/useSalesJobsState.ts).
      registerJob(res.job_id, company.trim(), accountId.trim());
      // Clear form for next submission
      setCompany('');
      setAccountId('');
    } catch (err: unknown) {
      console.error('Failed to start research:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (jobId: string) => {
    if (!isSalesAuthenticated) return;
    try {
      await downloadResearchFile(jobId);
    } catch (err: unknown) {
      console.error('Download failed:', err);
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
        submitLabel={submitting ? 'Submitting...' : 'Start job'}
        submitting={false}
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
      <main className="sa-body" />


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
