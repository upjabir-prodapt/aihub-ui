import React, { useState, useEffect, useCallback } from 'react';
import { submitFeedback } from '../api/salesAgentApi';

// Mirrors the backend's `ResearchFeedbackRequest` (src/api/schemas/research_schemas.py
// in the Sales-Agent repo): a free-text comment only — there is no numeric
// rating field, unlike Translation's review endpoint.
const MAX_FEEDBACK = 1000;

interface FeedbackExampleItem {
  topic: string;
  example: string;
}

/** Illustrative examples to guide users on framing clear, actionable feedback. */
const EXAMPLE_FEEDBACK_ITEMS: FeedbackExampleItem[] = [
  {
    topic: 'Compliance audit',
    example: 'The GDPR section missed Acme Corp\'s recent data-residency changes announced last quarter.',
  },
  {
    topic: 'Market strategy',
    example: 'Competitor analysis was thin — only 2 competitors listed when 5+ are relevant in this market.',
  },
  {
    topic: 'Tech stack',
    example: 'Tech stack section correctly identified their CRM but missed their cloud provider migration.',
  },
];

/** Failure reports need reproduction detail, not quality judgements. */
const FAILED_FEEDBACK_ITEMS: FeedbackExampleItem[] = [
  {
    topic: 'What you asked for',
    example: 'Research on Acme Corp, account 4471 — submitted twice, failed both times.',
  },
  {
    topic: 'Where it stopped',
    example: 'It ran for about a minute on "Gathering sources", then failed with no report.',
  },
  {
    topic: 'Impact',
    example: 'Needed for a pitch on Thursday — a workaround would help.',
  },
];

interface SalesFeedbackModalProps {
  isOpen: boolean;
  jobId: string;
  /**
   * True when the run failed. There is no report to comment on, so the modal
   * asks what went wrong instead — same endpoint either way.
   */
  jobFailed?: boolean;
  onClose: () => void;
  onSubmitted: (ok: boolean, message: string) => void;
}

const SalesFeedbackModal: React.FC<SalesFeedbackModalProps> = ({ isOpen, jobId, jobFailed, onClose, onSubmitted }) => {
  if (!isOpen) return null;
  return (
    <SalesFeedbackModalPanel
      key={jobId}
      jobId={jobId}
      jobFailed={jobFailed}
      onClose={onClose}
      onSubmitted={onSubmitted}
    />
  );
};

const SalesFeedbackModalPanel: React.FC<Omit<SalesFeedbackModalProps, 'isOpen'>> = ({
  jobId,
  jobFailed = false,
  onClose,
  onSubmitted,
}) => {
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
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_FEEDBACK;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    try {
      await submitFeedback(jobId, trimmed);
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

  return (
    <div
      className="modal-backdrop"
      onClick={() => { if (!submitting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={jobFailed ? 'Report a failed sales research run' : 'Sales Agent Feedback'}
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
              {jobFailed ? 'Report a Failed Run' : 'Sales Agent Feedback'}
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
                ? 'This run failed before it produced a report. Tell us what you asked for and what went wrong.'
                : 'How was the quality of this research report?'}
            </p>

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

            <div className="login-field">
              <label className="login-label" htmlFor="sales-feedback-comment">
                {jobFailed ? 'What went wrong' : 'Comment'}
              </label>
              <textarea
                id="sales-feedback-comment"
                className="review-comment-textarea"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value.slice(0, MAX_FEEDBACK))}
                placeholder={
                  jobFailed
                    ? 'Describe the company, the account and the error you saw…'
                    : "Share details about the report's accuracy, depth or relevance…"
                }
                rows={4}
                disabled={submitting}
                autoFocus
              />
              <div className={`review-char-counter ${feedback.length >= MAX_FEEDBACK ? 'at-limit' : ''}`}>
                {feedback.length} / {MAX_FEEDBACK}
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

export default SalesFeedbackModal;
