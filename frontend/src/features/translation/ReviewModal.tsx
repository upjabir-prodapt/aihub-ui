import React from 'react';
import { translationApi } from './api';
import FeedbackDialog, { type FeedbackExample } from '../../shared/ui/FeedbackDialog';

interface ReviewModalProps {
  isOpen: boolean;
  jobId: string;
  onClose: () => void;
  onSubmitted: (ok: boolean, message: string) => void;
}

/** Illustrative examples to guide users on framing clear, actionable feedback. */
const EXAMPLE_FEEDBACK_ITEMS: FeedbackExample[] = [
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

/**
 * Review of a completed translation job.
 *
 * The dialog itself is shared with Sales' research feedback — both are a 1-5
 * rating plus an optional comment — so only the wording and the call live here.
 */
const ReviewModal: React.FC<ReviewModalProps> = ({ isOpen, jobId, onClose, onSubmitted }) => (
  <FeedbackDialog
    isOpen={isOpen}
    jobId={jobId}
    heading="Translation Feedback"
    subtitle="How would you rate the quality of this translation?"
    examples={EXAMPLE_FEEDBACK_ITEMS}
    commentPlaceholder="Share details about the translation quality…"
    onSubmit={(rating, comment) =>
      translationApi.submitReview(jobId, { rating, ...(comment ? { comment } : {}) })
    }
    onClose={onClose}
    onSubmitted={onSubmitted}
  />
);

export default ReviewModal;
