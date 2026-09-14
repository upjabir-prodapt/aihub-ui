import React, { useCallback, useEffect } from 'react';

interface SubmitErrorModalProps {
  isOpen: boolean;
  /** Service name, used in the heading — e.g. "Translation", "Sales Agent". */
  serviceName: string;
  message: string;
  onClose: () => void;
  /** Reopens the run dialog so the failed submit can be retried. */
  onRetry?: () => void;
}

/**
 * Failure to *start* a job.
 *
 * Scoped deliberately: this is only for a submit that produced no run at all,
 * so there is no row to attach the message to. Once a run exists, its failures
 * belong to that run and are shown on its row in Recent runs and the Job
 * Tracker — never here, or the same error would appear in two places.
 *
 * A dialog rather than the inline panel both pages used to render, because a
 * panel further down the page is easy to miss when the run dialog has just
 * closed and the eye is still where the button was.
 */
const SubmitErrorModal: React.FC<SubmitErrorModalProps> = ({
  isOpen,
  serviceName,
  message,
  onClose,
  onRetry,
}) => {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="submit-error-title"
      aria-describedby="submit-error-message"
    >
      <div className="modal-panel submit-error-modal" onClick={(e) => e.stopPropagation()}>
        <div className="submit-error-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h2 className="submit-error-title" id="submit-error-title">
          Could not start {serviceName} job
        </h2>
        <p className="submit-error-message" id="submit-error-message">
          {message}
        </p>

        <div className="submit-error-actions">
          <button type="button" className="run-modal-btn run-modal-btn--ghost" onClick={onClose}>
            Dismiss
          </button>
          {onRetry && (
            <button
              type="button"
              className="run-modal-btn run-modal-btn--primary"
              onClick={onRetry}
              autoFocus
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubmitErrorModal;
