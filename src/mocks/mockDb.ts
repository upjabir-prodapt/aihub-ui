import { MockTranslationManager } from './mockTranslationManager.ts';
import { MockSalesManager } from './mockSalesManager.ts';


class MockDatabase {
  public translation = new MockTranslationManager();
  public sales = new MockSalesManager();

  // ── Translation aliases ───────────────────────────────────────────────────
  public getTranslationJobs() {
    return this.translation.getJobs();
  }

  public getTranslationJobStatus(jobId: string) {
    return this.translation.getJobStatus(jobId);
  }

  public getMultipleTranslationJobStatuses(jobIds: string[]) {
    return this.translation.getMultipleStatuses(jobIds);
  }

  public createTranslationJobs(
    filename: string,
    sourceLanguage: string,
    targetLanguages: string[],
    domain: string,
  ) {
    return this.translation.createJobs(filename, sourceLanguage, targetLanguages, domain);
  }

  public cancelTranslationJob(jobId: string) {
    return this.translation.cancelJob(jobId);
  }

  public addReview(jobId: string, rating: number, comment?: string) {
    return this.translation.addReview(jobId, rating, comment);
  }

  // ── Sales aliases ─────────────────────────────────────────────────────────
  public getSalesJobs() {
    return this.sales.getJobs();
  }

  public getSalesJobStatus(jobId: string) {
    return this.sales.getStatus(jobId);
  }

  public getSalesJobResult(jobId: string) {
    return this.sales.getResult(jobId);
  }

  public initiateSalesResearch(companyName: string, accountId: string) {
    return this.sales.initiateResearch(companyName, accountId);
  }

  public cancelSalesResearch(jobId: string) {
    return this.sales.cancelResearch(jobId);
  }
}

export const mockDb = new MockDatabase();
