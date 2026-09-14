import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const submitResearchFeedback = vi.fn();

vi.mock('./api', () => ({
  MAX_RESEARCH_FEEDBACK: 1000,
  submitResearchFeedback: (...args: unknown[]) => submitResearchFeedback(...args),
}));

import FeedbackModal from './FeedbackModal';

function renderModal(onSubmitted = vi.fn(), onClose = vi.fn()) {
  render(<FeedbackModal isOpen jobId="sales-job-1" onClose={onClose} onSubmitted={onSubmitted} />);
  return { onSubmitted, onClose };
}

describe('sales FeedbackModal', () => {
  beforeEach(() => {
    submitResearchFeedback.mockReset();
    submitResearchFeedback.mockResolvedValue({
      job_id: 'sales-job-1',
      status: 'SUCCESS',
      message: 'ok',
    });
  });

  it('offers a 1-5 star rating, like a translation review', () => {
    renderModal();
    expect(screen.getByRole('group', { name: /rating/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /star/i })).toHaveLength(5);
  });

  it('requires a rating — a comment alone will not submit', () => {
    renderModal();
    const submit = screen.getByRole('button', { name: /submit feedback/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Useful brief.' } });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    expect(submit).toBeEnabled();
  });

  it('submits a rating on its own, omitting the optional comment', async () => {
    const { onSubmitted } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));

    // undefined, not '': the service rejects an empty comment.
    await waitFor(() =>
      expect(submitResearchFeedback).toHaveBeenCalledWith('sales-job-1', 5, undefined),
    );
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(true, expect.any(String)));
  });

  it('submits the rating with trimmed comment text', async () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: '3 stars' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  Missed their recent acquisition.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() =>
      expect(submitResearchFeedback).toHaveBeenCalledWith(
        'sales-job-1',
        3,
        'Missed their recent acquisition.',
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('treats a whitespace-only comment as no comment', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '1 star' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() =>
      expect(submitResearchFeedback).toHaveBeenCalledWith('sales-job-1', 1, undefined),
    );
  });

  it('reports a failure without closing, so the text is not lost', async () => {
    submitResearchFeedback.mockRejectedValue(new Error('Upstream unavailable'));
    const { onSubmitted, onClose } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: '2 stars' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Useful brief.' } });
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() =>
      expect(onSubmitted).toHaveBeenCalledWith(false, 'Upstream unavailable'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
