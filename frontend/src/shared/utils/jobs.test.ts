import { describe, expect, it } from 'vitest';
import { extractSalesDetail } from './jobs';
import type { ResearchResultResponse } from '../../features/sales/types';

/**
 * The Sales page used to render model/tokens/time/cost in its own inline report
 * panel, which only ever described the newest run. That panel is gone and the
 * figures are surfaced per row instead, so this mapping is now the only path
 * those numbers travel.
 */

function result(card: ResearchResultResponse['model_card']): ResearchResultResponse {
  return { job_id: 'j1', status: 'COMPLETED', model_card: card } as ResearchResultResponse;
}

describe('extractSalesDetail', () => {
  it('maps the service model_card onto the shared detail shape', () => {
    const detail = extractSalesDetail(
      result({
        model_version: 'gemini-2.5-pro',
        tokens_used: 18_432,
        latency_seconds: 134.2,
        cost_usd: 0.4231,
      }),
    );

    expect(detail).toEqual({
      costUsd: 0.4231,
      tokenCount: 18_432,
      processingTimeSeconds: 134.2,
      modelUsed: 'gemini-2.5-pro',
      modelVersion: 'gemini-2.5-pro',
      // The research pipeline reports no per-run quality score.
      qualityScore: null,
    });
  });

  it('nulls every figure when the run carries no model_card', () => {
    expect(extractSalesDetail(result(null))).toEqual({
      costUsd: null,
      tokenCount: null,
      processingTimeSeconds: null,
      modelUsed: null,
      modelVersion: null,
      qualityScore: null,
    });
  });

  it('rejects non-numeric figures rather than rendering NaN', () => {
    const detail = extractSalesDetail(
      result({
        model_version: null,
        tokens_used: null,
        latency_seconds: undefined,
        cost_usd: null,
      }),
    );
    expect(detail.tokenCount).toBeNull();
    expect(detail.processingTimeSeconds).toBeNull();
    expect(detail.costUsd).toBeNull();
    expect(detail.modelUsed).toBeNull();
  });
});
