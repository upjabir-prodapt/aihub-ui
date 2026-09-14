import React from 'react';

export interface ToastState {
  ok: boolean;
  message: string;
}

interface FeedbackToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

/**
 * Result banner for a feedback/review submission.
 *
 * Extracted because Translation, the Job Tracker and Sales all raise the same
 * toast; the markup was already duplicated between the first two before Sales
 * needed a third copy. Classes are unchanged and still live in translation.css.
 */
const FeedbackToast: React.FC<FeedbackToastProps> = ({ toast, onDismiss }) => {
  if (!toast) return null;

  return (
    <div
      className={`review-toast ${toast.ok ? 'review-toast--success' : 'review-toast--error'}`}
      role="status"
      aria-live="polite"
    >
      <div className="review-toast-icon">
        {toast.ok ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        )}
      </div>
      <span className="review-toast-message">{toast.message}</span>
      <button className="review-toast-close" onClick={onDismiss} aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};

export default FeedbackToast;
