import React, { useState, useEffect, useCallback } from 'react';
import { translationApi } from '../api/translationApi';

const MAX_COMMENT = 2000;

interface ReviewModalProps {
  isOpen: boolean;
  jobId: string;
  onClose: () => void;
  onSubmitted: (ok: boolean, message: string) => void;
}

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

const ReviewModal: React.FC<ReviewModalProps> = ({ isOpen, jobId, onClose, onSubmitted }) => {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRating(0);
      setHovered(0);
      setComment('');
      setSubmitting(false);
    }
  }, [isOpen, jobId]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    },
    [submitting, onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleEscape]);

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
      onSubmitted(true, `Your ${rating}-star review was submitted. Thank you!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit review. Please try again.';
      onClose();
      onSubmitted(false, msg);
    }
  };

  if (!isOpen) return null;

  const displayRating = hovered || rating;

  return (
    <div
      className="modal-backdrop"
      onClick={() => { if (!submitting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Rate Translation"
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
            <span className="review-modal-heading">Rate this Translation</span>
          </div>
          {!submitting && (
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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

            {/* Stars */}
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
                type="button"
                className="retry-btn"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="login-btn review-submit-btn"
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
                    Submit Review
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
