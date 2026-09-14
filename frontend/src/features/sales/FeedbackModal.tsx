import React, { useCallback, useEffect, useState } from 'react';
import { MAX_RESEARCH_FEEDBACK, submitResearchFeedback } from './api';
import StarRating from '../../shared/ui/StarRating';

interface FeedbackModalProps {
  isOpen: boolean;
  jobId: string;
  onClose: () => void;
  onSubmitted: (ok: boolean, message: string) => void;
}

/** Illustrative prompts, mirroring the guidance on Translation's review form. */
const EXAMPLE_FEEDBACK_ITEMS: { topic: string; example: string }[] = [
  {
    topic: 'Accuracy',
    example: 'The revenue figure in the market section is two years out of date.',
  },
  {
    topic: 'Coverage',
    example: 'The brief missed their recent acquisition, which changes the compliance picture.',
  },
  {
    topic: 'Usefulness',
    example: 'The tech-stack section was the most actionable part for the first call.',
  },
];

/**
 * Feedback on a completed research run.
 *
 * The Sales counterpart to Translation's ReviewModal, reached the same way (the
 * Feedback action on a run's row) and now carrying the same 1-5 rating: the
 * research service gained a `rating` field, so the two services collect
 * feedback in the same shape. The rating is required and the comment optional,
 * as in a translation review.
 */
const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, jobId, onClose, onSubmitted }) => {
  if (!isOpen) return null;
  return <FeedbackModalPanel key={jobId} jobId={jobId} onClose={onClose} onSubmitted={onSubmitted} />;
};

const FeedbackModalPanel: React.FC<Omit<FeedbackModalProps, 'isOpen'>> = ({
  jobId,
  onClose,
  onSubmitted,
}) => {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    },
    [submitting, onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const trimmed = feedback.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0 || submitting) return;

    setSubmitting(true);
    try {
      // The comment is optional; an empty one is omitted rather than sent as
      // "" , which the service rejects.
      await submitResearchFeedback(jobId, rating, trimmed || undefined);
      onSubmitted(true, 'Your feedback was submitted. Thank you!');
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to submit feedback.';
      onSubmitted(false, msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Research Feedback"
    >
      <div className="modal-panel review-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-glow" />

        <div className="modal-header">
          <div className="review-modal-header-left">
            <div className="review-modal-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span className="review-modal-heading">Research Feedback</span>
          </div>
          {!submitting && (
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="modal-body">
          <form onSubmit={handleSubmit} className="review-form" noValidate>
            <p className="review-form-subtitle">
              How useful was this research brief?
            </p>

            <StarRating value={rating} onChange={setRating} disabled={submitting} />

            <div className="review-guidance">
              <span className="review-guidance-heading">Example feedback:</span>
              <ul className="review-guidance-list">
                {EXAMPLE_FEEDBACK_ITEMS.map((item, idx) => (
                  <li key={idx} className="review-guidance-item">
                    <span className="review-guidance-topic">{item.topic}:</span>{' '}
                    <span className="review-guidance-text">"{item.example}"</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="research-feedback">
                Comment <span className="review-optional">(optional)</span>
              </label>
              <textarea
                id="research-feedback"
                className="review-comment-textarea"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value.slice(0, MAX_RESEARCH_FEEDBACK))}
                placeholder="Share what was accurate, missing or useful…"
                rows={5}
                disabled={submitting}
              />
              <div
                className={`review-char-counter ${
                  feedback.length >= MAX_RESEARCH_FEEDBACK ? 'at-limit' : ''
                }`}
              >
                {feedback.length} / {MAX_RESEARCH_FEEDBACK}
              </div>
            </div>

            <div className="review-actions">
              <button type="submit" className="review-submit-btn" disabled={rating === 0 || submitting}>
                {submitting ? (
                  <>
                    <span className="spinner" />
                    Submitting…
                  </>
                ) : (
                  'Submit feedback'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
