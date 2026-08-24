import type { ResearchJobListItem, ResearchResultResponse } from '../types/sales.ts';
import { INITIAL_SALES_JOBS, type MockSalesJob } from './mockSalesSeed.ts';
import { generateCustomReport } from './mockReports.ts';


export class MockSalesManager {
  private jobs: MockSalesJob[] = [...INITIAL_SALES_JOBS];

  public getJobs(): ResearchJobListItem[] {
    return this.jobs.map((j) => ({
      job_id: j.job_id,
      company_name: j.company_name,
      company: j.company_name,
      account_id: j.account_id,
      status: j.status,
      progress: j.progress,
      created_at: j.created_at,
      completed_at: j.completed_at,
      error_message: j.error_message,
    }));
  }

  public getStatus(jobId: string) {
    const job = this.jobs.find((j) => j.job_id === jobId);
    if (!job) return null;
    return {
      job_id: job.job_id,
      status: job.status,
      error_message: job.error_message,
    };
  }

  public getResult(jobId: string): ResearchResultResponse | null {
    const job = this.jobs.find((j) => j.job_id === jobId);
    if (!job) return null;
    return {
      job_id: job.job_id,
      request_id: job.job_id,
      status: job.status,
      report_content: job.report_content ?? undefined,
      model_card: job.model_card,
    };
  }

  public initiateResearch(companyName: string, accountId: string) {
    const jobId = `sales-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const job: MockSalesJob = {
      job_id: jobId,
      company_name: companyName,
      account_id: accountId || `ACC-${companyName.slice(0, 3).toUpperCase()}-101`,
      status: 'PENDING',
      progress: 0.1,
      created_at: new Date().toISOString(),
      completed_at: null,
      error_message: null,
      report_content: null,
      model_card: null,
    };

    this.jobs.unshift(job);

    setTimeout(() => {
      const j = this.jobs.find((x) => x.job_id === jobId);
      if (j && j.status === 'PENDING') {
        j.status = 'PROCESSING';
        j.progress = 0.5;
      }
    }, 1500);

    setTimeout(() => {
      const j = this.jobs.find((x) => x.job_id === jobId);
      if (j && (j.status === 'PROCESSING' || j.status === 'PENDING')) {
        j.status = 'COMPLETED';
        j.progress = 1.0;
        j.completed_at = new Date().toISOString();
        j.model_card = {
          model_version: 'gemini-2.5-pro',
          latency_seconds: parseFloat((Math.random() * 8 + 16).toFixed(1)),
          tokens_used: Math.floor(Math.random() * 5000 + 14000),
          cost_usd: parseFloat((Math.random() * 0.08 + 0.12).toFixed(3)),
        };
        j.report_content = generateCustomReport(companyName, job.account_id);
      }
    }, 4500);

    return { job_id: jobId, status: 'PENDING' };
  }

  public cancelResearch(jobId: string): boolean {
    const job = this.jobs.find((j) => j.job_id === jobId);
    if (!job) return false;
    job.status = 'CANCELLED';
    job.completed_at = new Date().toISOString();
    return true;
  }
}
