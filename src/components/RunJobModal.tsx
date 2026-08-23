import React, { useEffect } from 'react';

interface RunJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Service name shown in the summary chip, e.g. "Translation". */
  serviceName: string;
  serviceIcon: React.ReactNode;
  submitLabel: string;
  submitting?: boolean;
  canSubmit?: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
}

/**
 * "Start a job" dialog used by the service pages — the run form lives here
 * rather than permanently on the page, so a service opens on its overview
 * (what it does, recent runs) and running is an explicit action.
 */
const RunJobModal: React.FC<RunJobModalProps> = ({
  isOpen,
  onClose,
  serviceName,
  serviceIcon,
  submitLabel,
  submitting = false,
  canSubmit = true,
  onSubmit,
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, submitting]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={() => !submitting && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={`Run ${serviceName}`}
    >
      <div className="modal-panel run-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-glow" />

        <div className="run-modal-header">
          <p className="run-modal-eyebrow">New run</p>
          <h2 className="run-modal-title">Start a job</h2>
          <p className="run-modal-subtitle">Fill in what this service needs and it starts immediately.</p>
        </div>

        <div className="run-modal-body">
          <div className="run-modal-service">
            <span className="run-modal-service-icon">{serviceIcon}</span>
            <div className="run-modal-service-name">{serviceName}</div>
          </div>

          <form
            className="run-modal-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit && !submitting) onSubmit();
            }}
          >
            {children}

            <div className="run-modal-footer">
              <button
                type="button"
                className="run-modal-btn run-modal-btn--ghost"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="run-modal-btn run-modal-btn--primary"
                disabled={!canSubmit || submitting}
              >
                {submitting ? (
                  <>
                    <span className="spinner" /> Starting…
                  </>
                ) : (
                  submitLabel
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RunJobModal;
