import type {
  InitiateResearchResponse,
  ResearchStatusResponse,
  ResearchModelCard,
  ResearchResultResponse,
  ResearchJobListItem,
} from './types';
import { apiDownload, apiJson, apiPostJson } from '../../shared/api/client';

export type {
  InitiateResearchResponse,
  ResearchStatusResponse,
  ResearchModelCard,
  ResearchResultResponse,
  ResearchJobListItem,
};

/**
 * Same-origin `/api/sales/v1/*`, proxied by the BFF to Apigee.
 *
 * The per-service session that used to live here is gone: no `salesAuthenticate`,
 * no `sales_auth_user` / `sales_google_id_token` in localStorage, no business
 * unit / organization prompt. Those are now `department` and `companyName` on
 * the single BFF session, sourced from MS Graph at sign-in (decision D6).
 */
const API_BASE = '/api/sales/v1';

/** `POST /research/initiate` */
export async function initiateResearch(
  account_id: string,
  company_name: string,
): Promise<InitiateResearchResponse> {
  return await apiPostJson<InitiateResearchResponse>(
    `${API_BASE}/research/initiate`,
    { account_id, company_name },
    { errorMessage: 'Failed to initiate research' },
  );
}

/** `GET /research/status/{job_id}` */
export async function getResearchStatus(job_id: string): Promise<ResearchStatusResponse> {
  return await apiJson<ResearchStatusResponse>(`${API_BASE}/research/status/${job_id}`, {
    errorMessage: 'Failed to fetch status',
  });
}

/** `GET /research/result/{job_id}` */
export async function getResearchResult(job_id: string): Promise<ResearchResultResponse> {
  return await apiJson<ResearchResultResponse>(`${API_BASE}/research/result/${job_id}`, {
    errorMessage: 'Failed to fetch result',
  });
}

/**
 * `GET /research/jobs` — this user's research runs.
 *
 * The backend retains only the last 7 days (older runs and their output files
 * are purged), so this is inherently a rolling window; the UI does not filter
 * by date on top of it.
 */
export async function listResearchJobs(): Promise<ResearchJobListItem[]> {
  const data = await apiJson<{ jobs?: ResearchJobListItem[] } | ResearchJobListItem[]>(
    `${API_BASE}/research/jobs`,
    { errorMessage: 'Failed to fetch research history' },
  );
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.jobs)) return data.jobs;
  return [];
}

/** `DELETE /research/{job_id}` — cancel a running research job. */
export async function cancelResearch(job_id: string): Promise<{ message: string }> {
  return await apiJson<{ message: string }>(`${API_BASE}/research/${job_id}`, {
    method: 'DELETE',
    errorMessage: 'Failed to cancel research job',
  });
}

/** `GET /research/download/{job_id}` */
export async function downloadResearchFile(job_id: string): Promise<void> {
  await apiDownload(`${API_BASE}/research/download/${job_id}`, `research-${job_id}.md`);
}
