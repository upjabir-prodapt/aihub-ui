import type { JobStatusResponse, LegacyJobStatusResponse } from '../types/translation';
import type { ResearchJobListItem } from '../api/salesAgentApi';
import type { SalesJobRecord } from '../hooks/useSalesJobsState';
import type { UnifiedJob, UnifiedJobStatus } from '../types/jobs';

function toFinitePercent(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
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

  // Prefer a real source filename; the key it arrives under is unconfirmed, so
  // try the plausible names before falling back to a truncated run id (a full
  // UUID as the row title is unreadable).
  const filename =
    item.filename?.trim() ||
    item.file_name?.trim() ||
    item.original_filename?.trim() ||
    item.document_name?.trim() ||
    '';

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
    progress: toFinitePercent(item.progress),
    createdAt: item.created_at ?? null,
    completedAt: item.completed_at ?? null,
    errorMessage: item.error_message ?? null,
    canCancel: status === 'queued' || status === 'running',
    canDownload: status === 'completed',
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
    startedBy: null,
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
    progress: toFinitePercent(item.progress),
    createdAt: item.created_at ?? null,
    completedAt: item.completed_at ?? null,
    errorMessage: item.error_message ?? null,
    canCancel: status === 'queued' || status === 'running',
    canDownload: status === 'completed',
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
    startedBy: null,
  };
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
