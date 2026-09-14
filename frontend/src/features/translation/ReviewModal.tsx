import React, { useState, useEffect, useCallback } from 'react';
import { translationApi } from './api';
import StarRating from '../../shared/ui/StarRating';

const MAX_COMMENT = 2000;

interface ReviewModalProps {
  isOpen: boolean;
  jobId: string;
  onClose: () => void;
  onSubmitted: (ok: boolean, message: string) => void;
}

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

const ReviewModal: React.FC<ReviewModalProps> = ({ isOpen, jobId, onClose, onSubmitted }) => {
  if (!isOpen) return null;
  return (
    <ReviewModalPanel
      key={jobId}
      jobId={jobId}
      onClose={onClose}
      onSubmitted={onSubmitted}
    />
  );
};

const ReviewModalPanel: React.FC<Omit<ReviewModalProps, 'isOpen'>> = ({ jobId, onClose, onSubmitted }) => {
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
      await translationApi.submitReview(jobId, {
        rating,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      onClose();
      onSubmitted(true, 'Your feedback was submitted. Thank you!');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit feedback. Please try again.';
      onClose();
      onSubmitted(false, msg);
    }
  };


  return (
    <div
      className="modal-backdrop"
      onClick={() => { if (!submitting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Translation Feedback"
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
            <span className="review-modal-heading">Translation Feedback</span>
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
              How would you rate the quality of this translation?
            </p>

            <StarRating value={rating} onChange={setRating} disabled={submitting} />

            {/* Example Feedback Guidance */}
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

            {/* Comment */}
            <div className="login-field">
              <label className="login-label" htmlFor="review-comment">
                Comment <span className="review-optional">(optional)</span>
              </label>
              <textarea
                id="review-comment"
                className="review-comment-textarea"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
                placeholder="Share details about the translation quality…"
                rows={4}
                disabled={submitting}
              />
              <div className={`review-char-counter ${comment.length >= MAX_COMMENT ? 'at-limit' : ''}`}>
                {comment.length} / {MAX_COMMENT}
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

export default ReviewModal;
