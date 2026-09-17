import React, { useState, useEffect, useCallback } from 'react';
import { translationApi } from '../api/translationApi';

const MAX_COMMENT = 2000;

interface ReviewModalProps {
  isOpen: boolean;
  jobId: string;
  /**
   * True when the run failed. A failed run produced no translation to rate, so
   * the modal drops the star rating and asks what went wrong instead.
   */
  jobFailed?: boolean;
  onClose: () => void;
  onSubmitted: (ok: boolean, message: string) => void;
}

/**
 * Failed runs go to the same POST /reviews/{job_id} as rated ones, and that
 * contract requires a 1-5 rating -- so a run with no output to score is filed
 * at the floor and carries its actual detail in the comment.
 */
const FAILED_RUN_RATING = 1;

const StarIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Excellent',
};

const RATING_CLASSES: Record<number, string> = {
  1: 'rating-poor',
  2: 'rating-fair',
  3: 'rating-good',
  4: 'rating-great',
  5: 'rating-excellent',
};

interface FeedbackExampleItem {
  topic: string;
  example: string;
}

/** Illustrative examples to guide users on framing clear, actionable feedback. */
const EXAMPLE_FEEDBACK_ITEMS: FeedbackExampleItem[] = [
  {
    topic: 'Translation accuracy',
    example: 'Section 3.1 — "Clause termination" was translated literally and lost its legal context.',
  },
  {
    topic: 'Tone & domain fit',
    example: 'The executive summary is too informal for a formal commercial contract.',
  },
  {
    topic: 'Technical terminology',
    example: 'Network terms like "Optical Add-Drop Multiplexer (OADM)" should remain in English.',
  },
];

/** Failure reports need reproduction detail, not quality judgements. */
const FAILED_FEEDBACK_ITEMS: FeedbackExampleItem[] = [
  {
    topic: 'What you submitted',
    example: 'A 40-page scanned PDF contract, English to German — retried twice, same result.',
  },
  {
    topic: 'Where it stopped',
    example: 'It sat on "Extracting text" for ten minutes, then failed with no output.',
  },
  {
    topic: 'Impact',
    example: 'Blocking a customer contract review due Friday — a workaround would help.',
  },
];

const ReviewModal: React.FC<ReviewModalProps> = ({ isOpen, jobId, jobFailed, onClose, onSubmitted }) => {
  if (!isOpen) return null;
  return (
    <ReviewModalPanel
      key={jobId}
      jobId={jobId}
      jobFailed={jobFailed}
      onClose={onClose}
      onSubmitted={onSubmitted}
    />
  );
};

const ReviewModalPanel: React.FC<Omit<ReviewModalProps, 'isOpen'>> = ({ jobId, jobFailed = false, onClose, onSubmitted }) => {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
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

  const trimmedComment = comment.trim();
  // On a failed run the comment is the whole report, so it takes over from the
  // star rating as the field that gates submission.
  const canSubmit = jobFailed ? trimmedComment.length > 0 : rating > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    try {
      await translationApi.submitReview(jobId, {
        rating: jobFailed ? FAILED_RUN_RATING : rating,
        ...(trimmedComment ? { comment: trimmedComment } : {}),
      });
      onClose();
      onSubmitted(
        true,
        jobFailed
          ? 'Thanks — your report on this failed run was submitted.'
          : 'Your feedback was submitted. Thank you!',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit feedback. Please try again.';
      onClose();
      onSubmitted(false, msg);
    }
  };

  const displayRating = hovered || rating;

  return (
    <div
      className="modal-backdrop"
      onClick={() => { if (!submitting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={jobFailed ? 'Report a failed translation run' : 'Translation Feedback'}
    >
      <div className="modal-panel review-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-glow" />

        <div className="modal-header">
          <div className="review-modal-header-left">
            <div className="review-modal-icon">
              {jobFailed ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              )}
            </div>
            <span className="review-modal-heading">
              {jobFailed ? 'Report a Failed Run' : 'Translation Feedback'}
            </span>
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
              {jobFailed
                ? 'This run failed before it produced a translation. Tell us what you submitted and what went wrong.'
                : 'How would you rate the quality of this translation?'}
            </p>

            {/* Stars — a failed run has no output to score, so they are omitted. */}
            {!jobFailed && (
              <>
                <div className="review-stars-row" role="group" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={`review-star-btn ${star <= displayRating ? 'active' : ''}`}
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHovered(star)}
                      onMouseLeave={() => setHovered(0)}
                      aria-label={`${star} star${star !== 1 ? 's' : ''}`}
                      disabled={submitting}
                    >
                      <StarIcon filled={star <= displayRating} />
                    </button>
                  ))}
                </div>

                {/* Rating label */}
                <div className="review-rating-label" aria-live="polite">
                  {displayRating === 0
                    ? <span className="rating-hint">Select a rating</span>
                    : <span className={RATING_CLASSES[displayRating]}>{RATING_LABELS[displayRating]}</span>
                  }
                </div>
              </>
            )}

            {/* Example Feedback Guidance */}
            <div className="review-guidance">
              <span className="review-guidance-heading">
                {jobFailed ? 'Helpful to include:' : 'Example feedback:'}
              </span>
              <ul className="review-guidance-list">
                {(jobFailed ? FAILED_FEEDBACK_ITEMS : EXAMPLE_FEEDBACK_ITEMS).map((item, idx) => (
                  <li key={idx} className="review-guidance-item">
                    <span className="review-guidance-topic">{item.topic}:</span>{' '}
                    <span className="review-guidance-text">"{item.example}"</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Comment */}
            <div className="login-field">
              <label className="login-label" htmlFor="review-comment">
                {jobFailed ? 'What went wrong' : <>Comment <span className="review-optional">(optional)</span></>}
              </label>
              <textarea
                id="review-comment"
                className="review-comment-textarea"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
                placeholder={
                  jobFailed
                    ? 'Describe the document, the languages and the error you saw…'
                    : 'Share details about the translation quality…'
                }
                rows={4}
                disabled={submitting}
                autoFocus={jobFailed}
              />
              <div className={`review-char-counter ${comment.length >= MAX_COMMENT ? 'at-limit' : ''}`}>
                {comment.length} / {MAX_COMMENT}
              </div>
            </div>

            <div className="review-actions">
              <button
                type="submit"
                className="review-submit-btn"
                disabled={!canSubmit || submitting}
              >
                {submitting ? (
                  <>
                    <span className="spinner" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    {jobFailed ? 'Submit Report' : 'Submit Feedback'}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ReviewModal;
