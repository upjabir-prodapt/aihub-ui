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

  it('offers no star rating — the research service has no rating field', () => {
    renderModal();
    expect(screen.queryByRole('group', { name: /rating/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /star/i })).not.toBeInTheDocument();
  });

  it('will not submit empty or whitespace-only feedback', () => {
    renderModal();
    const submit = screen.getByRole('button', { name: /submit feedback/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    expect(submitResearchFeedback).not.toHaveBeenCalled();
  });

  it('submits trimmed text and reports success', async () => {
    const { onSubmitted, onClose } = renderModal();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  Missed their recent acquisition.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() =>
      expect(submitResearchFeedback).toHaveBeenCalledWith(
        'sales-job-1',
        'Missed their recent acquisition.',
      ),
    );
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(true, expect.any(String)));
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a failure without closing, so the text is not lost', async () => {
    submitResearchFeedback.mockRejectedValue(new Error('Upstream unavailable'));
    const { onSubmitted, onClose } = renderModal();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Useful brief.' } });
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() =>
      expect(onSubmitted).toHaveBeenCalledWith(false, 'Upstream unavailable'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
