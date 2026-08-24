import type { ResearchModelCard } from '../types/sales.ts';
import { VODAFONE_REPORT, DEUTSCHE_TELEKOM_REPORT } from './mockReports.ts';


export interface MockSalesJob {
  job_id: string;
  company_name: string;
  account_id: string;
  status: 'PENDING' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  report_content: string | null;
  model_card: ResearchModelCard | null;
}

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 3600 * 1000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86400 * 1000).toISOString();

export const INITIAL_SALES_JOBS: MockSalesJob[] = [
  {
    job_id: 'sales-job-7001',
    company_name: 'Vodafone Group Plc',
    account_id: 'ACC-VOD-8821',
    status: 'COMPLETED',
    progress: 1.0,
    created_at: minutesAgo(40),
    completed_at: minutesAgo(39),
    error_message: null,
    model_card: {
      model_version: 'gemini-2.5-pro',
      latency_seconds: 24.5,
      tokens_used: 18450,
      cost_usd: 0.185,
    },
    report_content: VODAFONE_REPORT,
  },
  {
    job_id: 'sales-job-7002',
    company_name: 'Deutsche Telekom AG',
    account_id: 'ACC-DT-4412',
    status: 'COMPLETED',
    progress: 1.0,
    created_at: hoursAgo(2),
    completed_at: hoursAgo(1.9),
    error_message: null,
    model_card: {
      model_version: 'gemini-2.5-pro',
      latency_seconds: 21.0,
      tokens_used: 15200,
      cost_usd: 0.152,
    },
    report_content: DEUTSCHE_TELEKOM_REPORT,
  },
  {
    job_id: 'sales-job-7003',
    company_name: 'Santander Consumer Finance',
    account_id: 'ACC-SAN-5521',
    status: 'FAILED',
    progress: 0.2,
    created_at: daysAgo(3),
    completed_at: daysAgo(3),
    error_message: 'Public intelligence extraction failed: target company filings could not be verified in the public registry.',
    report_content: null,
    model_card: null,
  },
];
