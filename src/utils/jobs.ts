import type { Dispatch, SetStateAction } from 'react';
import type { JobStatusResponse, LegacyJobStatusResponse } from '../types/translation';
import type { ResearchJobListItem } from '../api/salesAgentApi';
import type { SalesJobRecord } from '../hooks/useSalesJobsState';
import type { UnifiedJob, UnifiedJobDetail, UnifiedJobStatus } from '../types/jobs';
import { translationApi } from '../api/translationApi';
import { getResearchResult } from '../api/salesAgentApi';

// ── Shared formatting helpers (cost/tokens/time/model), used anywhere a job's
//    full detail is rendered — Recent runs and Job Tracker expanded rows. ──

/** Human-readable duration from a number of seconds. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

/** The model that produced a result, e.g. "gemini-2.5-flash (v1.2)". */
export function formatModel(modelUsed: string | null, modelVersion: string | null): string {
  const name = modelUsed?.trim();
  if (!name) return 'Unknown';
  const version = modelVersion?.trim();
  return version ? `${name} (${version})` : name;
}

/** Formats a job's cost in USD, or an em dash when unavailable. */
export function formatCost(costUsd: number | null): string {
  return typeof costUsd === 'number' ? `$${costUsd.toFixed(4)}` : '—';
}

/**
 * Builds the lazily-fetched detail fields from a translation job's full
 * detail response (`GET /translate/{job_id}`) — the only endpoint that
 * carries cost/tokens/model metadata.
 */
export function extractTranslationDetail(job: JobStatusResponse): UnifiedJobDetail {
  const result = job.result;
  const labels = result?.labels;
  const meta = result?.metadata;

  // The backend often leaves labels.processing_time_seconds null, so fall
  // back to deriving elapsed time from submitted_at → completed_at.
  let processingTimeSeconds = typeof labels?.processing_time_seconds === 'number'
    ? labels.processing_time_seconds
    : null;
  if (processingTimeSeconds === null && job.submitted_at && job.completed_at) {
    const diffMs = new Date(job.completed_at).getTime() - new Date(job.submitted_at).getTime();
    if (diffMs > 0) processingTimeSeconds = diffMs / 1000;
  }

  return {
    costUsd: typeof labels?.cost_usd === 'number' ? labels.cost_usd : null,
    tokenCount: typeof labels?.token_count === 'number' ? labels.token_count : null,
    processingTimeSeconds,
    modelUsed: meta?.model_used ?? null,
    modelVersion: meta?.model_version ?? null,
    qualityScore: typeof meta?.quality_score === 'number' ? meta.quality_score : null,
  };
}

/** Converts the backend's 0.0–1.0 progress fraction to a 0–100 percentage. */
function fractionToPercent(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n * 100));
}

const TRANSLATION_STATUS_MAP: Record<string, UnifiedJobStatus> = {
  queued: 'queued',
  pending: 'queued',
  processing: 'running',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

/** Short, readable stand-in when the backend gives us no source filename. */
function shortRunLabel(jobId: string): string {
  return `Run ${jobId.slice(0, 8)}`;
}

/** Normalizes an item from `GET /jobs` (history, richer/legacy shape). */
export function normalizeTranslationHistoryItem(item: LegacyJobStatusResponse): UnifiedJob {
  const status = TRANSLATION_STATUS_MAP[item.status?.toLowerCase?.() ?? ''] ?? 'queued';

  // Prefer the real source filename returned by the backend; fall back to a
  // truncated run id (a full UUID as the row title is unreadable) when absent.
  const filename = item.filename?.trim() || '';

  const languagePair =
    item.source_language && item.target_language
      ? `${item.source_language} → ${item.target_language}`
      : item.target_language
        ? `→ ${item.target_language}`
        : '';

  const subtitle = ['Translation', languagePair, item.current_stage]
    .filter((part) => !!part && part.trim() !== '')
    .join(' · ');

  return {
    key: `translation:${item.job_id}`,
    id: item.job_id,
    service: 'translation',
    serviceLabel: 'Translation',
    title: filename || shortRunLabel(item.job_id),
    subtitle,
    status,
    progress: fractionToPercent(item.progress),
    createdAt: item.created_at ?? null,
    completedAt: item.completed_at ?? null,
    errorMessage: item.error_message ?? null,
    canCancel: status === 'queued' || status === 'running',
    canDownload: status === 'completed',
    canReview: status === 'completed',
    startedBy: item.user ?? null,
  };
}

/** Normalizes an item from the live in-session batch (TranslationJobsContext). */
export function normalizeTranslationActiveItem(item: JobStatusResponse): UnifiedJob {
  const status = TRANSLATION_STATUS_MAP[item.status] ?? 'queued';
  const targetLang = item.result?.metadata?.target_language;
  const filename = item.result?.translated_document?.filename;
  return {
    key: `translation:${item.job_id}`,
    id: item.job_id,
    service: 'translation',
    serviceLabel: 'Translation',
    title: filename || shortRunLabel(item.job_id),
    subtitle: targetLang ? `Translation · → ${targetLang}` : 'Translation',
    status,
    // No numeric progress is exposed for in-flight jobs by this endpoint —
    // render an indeterminate bar rather than fabricate a percentage.
    progress: status === 'completed' ? 100 : null,
    createdAt: item.submitted_at || null,
    completedAt: item.completed_at ?? null,
    errorMessage: item.error_message ?? null,
    canCancel: status === 'queued' || status === 'running',
    canDownload: status === 'completed',
    canReview: status === 'completed',
    startedBy: null,
    detail: item.result ? extractTranslationDetail(item) : undefined,
    detailStatus: item.result ? 'loaded' : undefined,
  };
}

const SALES_STATUS_MAP: Record<string, UnifiedJobStatus> = {
  pending: 'queued',
  queued: 'queued',
  processing: 'running',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

function mapSalesStatus(raw: string | undefined): UnifiedJobStatus {
  return SALES_STATUS_MAP[raw?.toLowerCase?.() ?? ''] ?? 'queued';
}

/** Normalizes an item from `GET /research/jobs` (server-side history). */
export function normalizeSalesHistoryItem(item: ResearchJobListItem): UnifiedJob {
  const status = mapSalesStatus(item.status);
  const company = item.company_name?.trim() || item.company?.trim() || '';
  return {
    key: `sales:${item.job_id}`,
    id: item.job_id,
    service: 'sales',
    serviceLabel: 'Sales research',
    title: company || shortRunLabel(item.job_id),
    subtitle: item.account_id
      ? `Sales research · Account ${item.account_id}`
      : 'Sales research',
    status,
    // The backend reports progress as a 0.0-1.0 fraction, same convention as
    // Translation — this used to be passed straight through unscaled, which
    // rendered a 50%-complete job's progress bar at 0.5% width (effectively
    // invisible).
    progress: fractionToPercent(item.progress),
    createdAt: item.created_at ?? null,
    completedAt: item.completed_at ?? null,
    errorMessage: item.error_message ?? null,
    canCancel: status === 'queued' || status === 'running',
    canDownload: status === 'completed',
    canReview: false,
    startedBy: null,
  };
}

/** Normalizes a locally-tracked in-session run (instant feedback before refresh). */
export function normalizeSalesJob(item: SalesJobRecord): UnifiedJob {
  const status = mapSalesStatus(item.status);
  return {
    key: `sales:${item.job_id}`,
    id: item.job_id,
    service: 'sales',
    serviceLabel: 'Sales research',
    title: item.company_name || item.job_id,
    subtitle: item.account_id ? `Sales research · Account ${item.account_id}` : 'Sales research',
    status,
    progress: null,
    createdAt: item.createdAt,
    completedAt: item.completedAt,
    errorMessage: item.errorMessage,
    canCancel: status === 'queued' || status === 'running',
    canDownload: status === 'completed',
    canReview: false,
    startedBy: null,
  };
}

/**
 * Builds a sales research job's cost/tokens/time/model + full report detail
 * from its result endpoint (the only one that carries `model_card` and the
 * report body) — mirrors `extractTranslationDetail` for the other service.
 */
function extractSalesDetail(res: Awaited<ReturnType<typeof getResearchResult>>): UnifiedJobDetail {
  const card = res.model_card ?? null;
  const latency = typeof card?.latency_seconds === 'number' ? card.latency_seconds : null;
  return {
    costUsd: typeof card?.cost_usd === 'number' ? card.cost_usd : null,
    tokenCount: typeof card?.tokens_used === 'number' ? Math.round(card.tokens_used) : null,
    processingTimeSeconds: latency !== null && latency > 0 ? latency : null,
    modelUsed: card?.model_version?.trim() || null,
    modelVersion: null,
    qualityScore: null,
  };
}

/**
 * Lazily fetches and merges a job's cost/tokens/time/model detail into
 * whichever state array (Recent runs' local list, Job Tracker's history)
 * holds it — called on row expand, and cached so repeat expands are free.
 * For sales, the report body itself is intentionally not surfaced here —
 * Download is the only way to get it.
 */
export async function loadJobDetail(
  job: UnifiedJob,
  setJobs: Dispatch<SetStateAction<UnifiedJob[]>>,
): Promise<void> {
  if (job.detailStatus === 'loading' || job.detailStatus === 'loaded') return;

  setJobs((prev) =>
    prev.map((j) => (j.key === job.key ? { ...j, detailStatus: 'loading' } : j)),
  );

  try {
    const detail =
      job.service === 'translation'
        ? extractTranslationDetail(await translationApi.getJobStatus(job.id))
        : extractSalesDetail(await getResearchResult(job.id));
    setJobs((prev) =>
      prev.map((j) => (j.key === job.key ? { ...j, detail, detailStatus: 'loaded' } : j)),
    );
  } catch {
    setJobs((prev) =>
      prev.map((j) => (j.key === job.key ? { ...j, detailStatus: 'error' } : j)),
    );
  }
}

/** Merges job lists by key; later lists win over earlier ones for the same job, then sorts newest-first. */
export function mergeJobLists(...lists: UnifiedJob[][]): UnifiedJob[] {
  const byKey = new Map<string, UnifiedJob>();
  for (const list of lists) {
    for (const job of list) {
      byKey.set(job.key, job);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
}
