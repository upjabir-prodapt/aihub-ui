import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Guards the concurrency rule: starting a research run must never block
 * starting another one.
 *
 * The run dialog used to take `submitting={IN_PROGRESS.has(status)}`, i.e. the
 * *running job's* status rather than "a submit is in flight". While a run was
 * PENDING/QUEUED/PROCESSING that disabled the submit button — and, because
 * RunJobModal also ties Cancel, Escape and backdrop-dismiss to the same prop,
 * left a dialog that could not even be closed.
 */

const initiateResearch = vi.fn();
const registerJob = vi.fn();

vi.mock('./api', () => ({
  initiateResearch: (...args: unknown[]) => initiateResearch(...args),
  getResearchStatus: vi.fn(async () => ({ job_id: 'j1', status: 'PROCESSING' })),
  getResearchResult: vi.fn(async () => ({ job_id: 'j1', status: 'PROCESSING' })),
  downloadResearchFile: vi.fn(async () => undefined),
  listResearchJobs: vi.fn(async () => []),
  cancelResearch: vi.fn(async () => undefined),
}));

vi.mock('../auth/useAuth', () => ({
  useEntitlements: () => ({ translation: true, sales: true, naas: true }),
}));

vi.mock('./useSalesJobs', () => ({
  useSalesJobs: () => ({
    jobs: {},
    jobOrder: [],
    registerJob: (...args: unknown[]) => registerJob(...args),
    refreshJob: vi.fn(),
    refreshAll: vi.fn(),
    cancelJob: vi.fn(),
  }),
}));

vi.mock('../../shared/hooks/useServiceJobs', () => ({
  useServiceJobs: () => ({
    jobs: [],
    stats: { inFlight: 0, completed: 0, failed: 0 },
    loading: false,
    loadError: null,
    actionError: null,
    busyKey: null,
    refresh: vi.fn(),
    cancelJob: vi.fn(),
    downloadJob: vi.fn(),
    loadDetail: vi.fn(),
  }),
}));

import SalesAgentPage from './SalesAgentPage';

/** Open the run dialog, fill the form and submit it. */
function startOneRun(company: string) {
  fireEvent.click(screen.getByRole('button', { name: /run research/i }));
  fireEvent.change(screen.getByLabelText(/account id/i), { target: { value: 'ACC-1' } });
  fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: company } });
  fireEvent.click(screen.getByRole('button', { name: /start job/i }));
}

describe('SalesAgentPage concurrency', () => {
  beforeEach(() => {
    initiateResearch.mockReset();
    registerJob.mockReset();
    // Every run stays non-terminal, which is the case that used to lock the UI.
    let n = 0;
    initiateResearch.mockImplementation(async () => ({
      job_id: `sales-job-${++n}`,
      status: 'PENDING',
    }));
  });

  it('lets a second run be submitted while the first is still in progress', async () => {
    render(<SalesAgentPage />);

    startOneRun('First Co');
    await waitFor(() => expect(initiateResearch).toHaveBeenCalledTimes(1));

    // The first run is still PENDING here. Re-open the dialog and submit again.
    startOneRun('Second Co');
    await waitFor(() => expect(initiateResearch).toHaveBeenCalledTimes(2));

    // Both runs are handed to the shared registry, which is what keeps the
    // first one polling and visible in Recent runs / Job Tracker.
    expect(registerJob).toHaveBeenCalledTimes(2);
    expect(registerJob.mock.calls.map((c) => c[0])).toEqual([
      'sales-job-1',
      'sales-job-2',
    ]);
  });

  it('keeps the run dialog dismissable while a run is in progress', async () => {
    render(<SalesAgentPage />);

    startOneRun('First Co');
    await waitFor(() => expect(initiateResearch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /run research/i }));

    // The dialog must be dismissable even though a run is still in progress —
    // RunJobModal ties Cancel, Escape and backdrop-dismiss to the same
    // `submitting` prop that used to be driven by the job's status.
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeEnabled();

    // A successful submit clears the form, so Start is disabled until the next
    // run is described — then it must be live again, not blocked by the run
    // already going.
    expect(screen.getByRole('button', { name: /start job/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/account id/i), { target: { value: 'ACC-2' } });
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: 'Third Co' } });
    expect(screen.getByRole('button', { name: /start job/i })).toBeEnabled();
  });
});
