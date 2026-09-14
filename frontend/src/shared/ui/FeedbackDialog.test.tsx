import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const submitReview = vi.fn();
const submitResearchFeedback = vi.fn();

vi.mock('../../features/translation/api', () => ({
  translationApi: { submitReview: (...a: unknown[]) => submitReview(...a) },
}));
vi.mock('../../features/sales/api', () => ({
  submitResearchFeedback: (...a: unknown[]) => submitResearchFeedback(...a),
}));

import ReviewModal from '../../features/translation/ReviewModal';
import FeedbackModal from '../../features/sales/FeedbackModal';

/**
 * Translation reviews and Sales research feedback are one flow with two
 * wordings. They were separate components once and drifted — different
 * textarea height, submit label, comment limit, and different behaviour after a
 * failed submit. These assert the parts that must stay identical.
 */

const MODALS = [
  { name: 'Translation', Component: ReviewModal, heading: 'Translation Feedback' },
  { name: 'Sales', Component: FeedbackModal, heading: 'Research Feedback' },
] as const;

describe('feedback dialog parity', () => {
  beforeEach(() => {
    submitReview.mockReset().mockResolvedValue({ status: 'success', review_id: 'r1' });
    submitResearchFeedback.mockReset().mockResolvedValue({ status: 'SUCCESS' });
  });

  it.each(MODALS)('$name shows its own heading', ({ Component, heading }) => {
    render(<Component isOpen jobId="j1" onClose={vi.fn()} onSubmitted={vi.fn()} />);
    expect(screen.getByText(heading)).toBeInTheDocument();
  });

  it.each(MODALS)('$name offers the same 1-5 star control', ({ Component }) => {
    render(<Component isOpen jobId="j1" onClose={vi.fn()} onSubmitted={vi.fn()} />);
    const stars = within(screen.getByRole('group', { name: /rating/i })).getAllByRole('button');
    expect(stars).toHaveLength(5);
    expect(screen.getByText(/select a rating/i)).toBeInTheDocument();
  });

  it.each(MODALS)('$name requires a rating and treats the comment as optional', ({ Component }) => {
    render(<Component isOpen jobId="j1" onClose={vi.fn()} onSubmitted={vi.fn()} />);
    const submit = screen.getByRole('button', { name: /submit feedback/i });

    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A comment.' } });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '4 stars' }));
    expect(submit).toBeEnabled();
    expect(screen.getByText(/\(optional\)/i)).toBeInTheDocument();
  });

  it.each(MODALS)('$name caps the comment at the same 2000 characters', ({ Component }) => {
    render(<Component isOpen jobId="j1" onClose={vi.fn()} onSubmitted={vi.fn()} />);
    expect(screen.getByText('0 / 2000')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x'.repeat(2500) } });
    expect(screen.getByText('2000 / 2000')).toBeInTheDocument();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toHaveLength(2000);
  });

  it.each(MODALS)('$name keeps the dialog open when the submit fails', async ({ Component }) => {
    submitReview.mockRejectedValue(new Error('Upstream unavailable'));
    submitResearchFeedback.mockRejectedValue(new Error('Upstream unavailable'));

    const onClose = vi.fn();
    const onSubmitted = vi.fn();
    render(<Component isOpen jobId="j1" onClose={onClose} onSubmitted={onSubmitted} />);

    fireEvent.click(screen.getByRole('button', { name: '3 stars' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Worth keeping.' } });
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(false, 'Upstream unavailable'));
    expect(onClose).not.toHaveBeenCalled();
    // The typed comment survives, and the form is usable again.
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Worth keeping.');
    expect(screen.getByRole('button', { name: /submit feedback/i })).toBeEnabled();
  });

  it.each(MODALS)('$name closes and reports success', async ({ Component }) => {
    const onClose = vi.fn();
    const onSubmitted = vi.fn();
    render(<Component isOpen jobId="j1" onClose={onClose} onSubmitted={onSubmitted} />);

    fireEvent.click(screen.getByRole('button', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(true, expect.any(String)));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('sends each service its own payload shape', async () => {
    const { unmount } = render(
      <ReviewModal isOpen jobId="t1" onClose={vi.fn()} onSubmitted={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '5 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));
    // Translation nests the comment in a request object; a blank one is omitted.
    await waitFor(() => expect(submitReview).toHaveBeenCalledWith('t1', { rating: 5 }));
    unmount();

    render(<FeedbackModal isOpen jobId="s1" onClose={vi.fn()} onSubmitted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '2 stars' }));
    fireEvent.click(screen.getByRole('button', { name: /submit feedback/i }));
    // Sales takes positional args, with undefined for an absent comment.
    await waitFor(() => expect(submitResearchFeedback).toHaveBeenCalledWith('s1', 2, undefined));
  });
});
