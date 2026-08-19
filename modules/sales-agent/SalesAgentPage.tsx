'use client';

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
  ArrowRight,
  Download,
  Hash,
  Sparkles,
  Cpu,
  Clock,
  Coins,
} from 'lucide-react';
import {
  initiateResearch,
  getResearchStatus,
  getResearchResult,
  downloadResearchFile,
} from '@/modules/sales-agent/salesAgentApi';
import type { ResearchModelCard } from '@/modules/sales-agent/salesAgentApi';
import { useAuth } from '@/modules/auth/useAuth';
import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────
type Status = 'IDLE' | 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

const IN_PROGRESS: ReadonlySet<Status> = new Set<Status>(['PENDING', 'QUEUED', 'PROCESSING']);

const STATUS_POLL_INTERVAL_MS = 2 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────
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

function formatModelName(card: ResearchModelCard | null): string {
  const version = card?.model_version?.trim();
  return version || 'Unknown';
}

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

const SalesAgentPage: React.FC = () => {
  const { isSalesAuthenticated } = useAuth();

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
    if (!jobId || !isSalesAuthenticated) return;
    try {
      const res = await getResearchResult(jobId);
      setReport(res.report_content ?? res.report_markdown ?? 'No report content available.');
      setModelCard(res.model_card ?? null);
    } catch (err) {
      console.error('Result fetch error:', err);
      setError('Failed to fetch research results.');
    }
  }, [jobId, isSalesAuthenticated]);

  const checkStatus = useCallback(async () => {
    if (!jobId || !isSalesAuthenticated) return;
    try {
      const res = await getResearchStatus(jobId);
      const newStatus = res.status as Status;
      setStatus(newStatus);
      setLastCheck(new Date());
      if (newStatus === 'COMPLETED') {
        setCompletedAt((prev) => prev ?? new Date());
        void fetchResult();
      }
    } catch (err) {
      console.error('Status check error:', err);
    }
  }, [jobId, isSalesAuthenticated, fetchResult]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    let immediate: ReturnType<typeof setTimeout> | undefined;
    if (IN_PROGRESS.has(status) && jobId && isSalesAuthenticated) {
      immediate = setTimeout(() => void checkStatus(), 0);
      interval = setInterval(() => void checkStatus(), STATUS_POLL_INTERVAL_MS);
    }
    return () => {
      if (immediate) clearTimeout(immediate);
      if (interval) clearInterval(interval);
    };
  }, [status, jobId, isSalesAuthenticated, checkStatus]);

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

  const startResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim() || !accountId.trim() || !isSalesAuthenticated) return;

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start research.';
      setError(msg);
      setStatus('FAILED');
    }
  };

  const handleDownload = async () => {
    if (!jobId || !isSalesAuthenticated) return;
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
    <div className="flex-1 overflow-y-auto p-6 bg-bg-base">
      {/* ── IDLE: Research console ──────────────────────────────────────── */}
      {status === 'IDLE' && (
        <div className="max-w-2xl mx-auto py-8">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-bg-surface to-bg-elevated border border-border-subtle p-8 text-center shadow-md">
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-colt-teal/10 rounded-full blur-3xl" />
            <div className="relative">
              <Badge className="mb-4 gap-1.5 px-3 py-1">
                <Sparkles className="w-3 h-3" /> Agentic research engine
              </Badge>
              <h2 className="text-2xl font-bold text-text-primary mb-2">Who are we researching today?</h2>
              <p className="text-sm text-text-secondary max-w-md mx-auto mb-8">
                Enter an account ID and company name to generate a deep-dive sales alignment report.
              </p>

              <form onSubmit={startResearch} className="space-y-4 text-left">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="res-account-id" className="flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5" /> Account ID <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      id="res-account-id"
                      name="account_id"
                      type="text"
                      placeholder="e.g. ACC-123"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="res-company-name" className="flex items-center gap-1.5">
                      <Search className="w-3.5 h-3.5" /> Company name <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      id="res-company-name"
                      name="company_name"
                      type="text"
                      placeholder="e.g. Acme Corp, OpenAI…"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  id="res-start-btn"
                  className="w-full h-10 cursor-pointer"
                  disabled={!company.trim() || !accountId.trim()}
                >
                  Generate research report <ArrowRight className="w-4 h-4" />
                </Button>
              </form>

              <div className="grid grid-cols-3 gap-3 mt-8 pt-6 border-t border-border-subtle">
                <div className="flex flex-col items-center gap-1.5 text-xs text-text-secondary">
                  <ShieldCheck className="w-4 h-4 text-colt-teal" /> Compliance audit
                </div>
                <div className="flex flex-col items-center gap-1.5 text-xs text-text-secondary">
                  <Globe className="w-4 h-4 text-colt-teal" /> Market strategy
                </div>
                <div className="flex flex-col items-center gap-1.5 text-xs text-text-secondary">
                  <PieChart className="w-4 h-4 text-colt-teal" /> Tech stack
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PENDING / QUEUED / PROCESSING: Status tracker ───────────────── */}
      {IN_PROGRESS.has(status) && (
        <div className="max-w-2xl mx-auto py-8">
          <Card className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-11 h-11 rounded-full bg-colt-teal/10 text-colt-teal flex items-center justify-center shrink-0">
                <RefreshCw className="w-5 h-5 animate-spin" />
              </div>
              <div>
                <h3 className="text-base font-bold text-text-primary">Researching {company}</h3>
                <p className="text-xs text-text-muted">Job {jobId} · Account {accountId}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className={cn(
                "flex items-center gap-3 p-3 rounded-lg",
                status === 'PROCESSING' ? "bg-emerald-500/5" : "bg-colt-teal/5"
              )}>
                {status === 'PROCESSING'
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  : <RefreshCw className="w-4 h-4 text-colt-teal animate-spin shrink-0" />}
                <span className="text-sm text-text-secondary">Initializing agent</span>
              </div>
              <div className={cn(
                "flex items-center gap-3 p-3 rounded-lg",
                status === 'PROCESSING' && "bg-colt-teal/5"
              )}>
                {status === 'PROCESSING'
                  ? <RefreshCw className="w-4 h-4 text-colt-teal animate-spin shrink-0" />
                  : <span className="w-1.5 h-1.5 rounded-full bg-text-muted ml-1.5 mr-1.5 shrink-0" />}
                <span className="text-sm text-text-secondary">Parallel data extraction (10+ agents)</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted ml-1.5 mr-1.5 shrink-0" />
                <span className="text-sm text-text-secondary">Markdown report compilation</span>
              </div>
            </div>

            {lastCheck && (
              <div className="flex items-center gap-2 mt-6 pt-4 border-t border-border-subtle text-xs text-text-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-colt-teal animate-pulse" />
                Last updated {lastCheck.toLocaleTimeString()}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── FAILED ──────────────────────────────────────────────────────── */}
      {status === 'FAILED' && (
        <div className="max-w-md mx-auto py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-text-primary mb-2">Research failed</h3>
          <p className="text-sm text-text-secondary mb-6">{error}</p>
          <Button variant="outline" onClick={resetResearch} className="cursor-pointer">
            Start new research
          </Button>
        </div>
      )}

      {/* ── COMPLETED: Report ────────────────────────────────────────────── */}
      {status === 'COMPLETED' && report && (
        <Card className="max-w-4xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5 border-b border-border-subtle">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-colt-teal/10 text-colt-teal flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-primary">Research report · {company}</h3>
                <span className="text-xs text-text-muted">Job {jobId} · Account {accountId}</span>
                <div className="flex flex-wrap items-center gap-3 mt-1.5">
                  <span className="flex items-center gap-1 text-[11px] text-text-secondary" title="Model used for this research run">
                    <Cpu className="w-3 h-3" /> {formatModelName(modelCard)}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-text-secondary" title="End-to-end processing time">
                    <Clock className="w-3 h-3" /> {getResearchDuration(modelCard, startedAt, completedAt)}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-text-secondary" title="Total tokens consumed">
                    <Hash className="w-3 h-3" /> {formatTokens(modelCard)}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-text-secondary" title="Estimated cost in USD">
                    <Coins className="w-3 h-3" /> {formatCost(modelCard)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                id="res-download-btn"
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={downloading}
                title="Download research report file"
                className="cursor-pointer"
              >
                {downloading
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Downloading…</>
                  : <><Download className="w-3.5 h-3.5" /> Download</>}
              </Button>
              <Button size="sm" onClick={resetResearch} className="cursor-pointer">
                New research
              </Button>
            </div>
          </div>
          <CardContent className="pt-6 prose prose-sm prose-invert max-w-none">
            <ReactMarkdown>{report}</ReactMarkdown>
          </CardContent>
        </Card>
      )}

      {/* ── COMPLETED but report not yet loaded ──────────────────────────── */}
      {status === 'COMPLETED' && !report && (
        <div className="flex flex-col items-center justify-center py-24 text-text-secondary gap-3">
          <RefreshCw className="w-7 h-7 animate-spin text-colt-teal" />
          <p className="text-sm">Compiling final markdown report…</p>
        </div>
      )}
    </div>
  );
};

export default SalesAgentPage;
