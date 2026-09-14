import React, { useCallback, useEffect, useState } from 'react';
import StarRating from './StarRating';

/** Both services cap a feedback comment at the same length. */
export const MAX_FEEDBACK_COMMENT = 2000;

export interface FeedbackExample {
  topic: string;
  example: string;
}

interface FeedbackDialogProps {
  isOpen: boolean;
  /** Identifies the run; also resets the form when it changes. */
  jobId: string;
  /** Dialog heading, e.g. "Translation Feedback". */
  heading: string;
  /** Question above the stars. */
  subtitle: string;
  /** Domain-specific prompts shown as example feedback. */
  examples: FeedbackExample[];
  commentPlaceholder: string;
  /** Sends the feedback. The comment is omitted when the user left it blank. */
  onSubmit: (rating: number, comment?: string) => Promise<unknown>;
  onClose: () => void;
  onSubmitted: (ok: boolean, message: string) => void;
}

/**
 * Rate a finished run, optionally with a comment.
 *
 * One dialog for both services. Translation reviews and Sales research
 * feedback take the same shape — a required 1-5 rating plus an optional
 * comment, capped at the same length — and were previously two near-identical
 * components, which is how they came to differ in textarea height, submit
 * label, comment limit and what happened after a failed submit. Only the
 * wording and the call itself vary now; everything else is here.
 */
const FeedbackDialog: React.FC<FeedbackDialogProps> = ({ isOpen, jobId, ...rest }) => {
  if (!isOpen) return null;
  // Keyed on the run so opening a different one never inherits its form state.
  return <FeedbackDialogPanel key={jobId} {...rest} />;
};

const FeedbackDialogPanel: React.FC<Omit<FeedbackDialogProps, 'isOpen' | 'jobId'>> = ({
  heading,
  subtitle,
  examples,
  commentPlaceholder,
  onSubmit,
  onClose,
  onSubmitted,
}) => {
  const [rating, setRating] = useState(0);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0 || submitting) return;

    setSubmitting(true);
    try {
      // Blank comments are omitted, not sent as "": both services reject an
      // empty string as a malformed comment rather than an absent one.
      await onSubmit(rating, comment.trim() || undefined);
      onSubmitted(true, 'Your feedback was submitted. Thank you!');
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to submit feedback. Please try again.';
      // Stays open on failure so a transient error does not discard what the
      // user typed; they can simply submit again.
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
      aria-label={heading}
    >
      <div className="modal-panel review-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-glow" />

        <div className="modal-header">
          <div className="review-modal-header-left">
            <div className="review-modal-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <span className="review-modal-heading">{heading}</span>
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
            <p className="review-form-subtitle">{subtitle}</p>

            <StarRating value={rating} onChange={setRating} disabled={submitting} />

            <div className="review-guidance">
              <span className="review-guidance-heading">Example feedback:</span>
              <ul className="review-guidance-list">
                {examples.map((item, idx) => (
                  <li key={idx} className="review-guidance-item">
                    <span className="review-guidance-topic">{item.topic}:</span>{' '}
                    <span className="review-guidance-text">"{item.example}"</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="feedback-comment">
                Comment <span className="review-optional">(optional)</span>
              </label>
              <textarea
                id="feedback-comment"
                className="review-comment-textarea"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, MAX_FEEDBACK_COMMENT))}
                placeholder={commentPlaceholder}
                rows={4}
                disabled={submitting}
              />
              <div
                className={`review-char-counter ${
                  comment.length >= MAX_FEEDBACK_COMMENT ? 'at-limit' : ''
                }`}
              >
                {comment.length} / {MAX_FEEDBACK_COMMENT}
              </div>
            </div>

            <div className="review-actions">
              <button
                type="submit"
                className="review-submit-btn"
                disabled={rating === 0 || submitting}
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
                    Submit Feedback
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

export default FeedbackDialog;
