import React from 'react';
import { submitResearchFeedback } from './api';
import FeedbackDialog, { type FeedbackExample } from '../../shared/ui/FeedbackDialog';

interface FeedbackModalProps {
  isOpen: boolean;
  jobId: string;
  onClose: () => void;
  onSubmitted: (ok: boolean, message: string) => void;
}

/** Illustrative prompts, mirroring the guidance on Translation's review form. */
const EXAMPLE_FEEDBACK_ITEMS: FeedbackExample[] = [
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
 * Shares its dialog with Translation's review: the research service takes the
 * same 1-5 rating plus optional comment, so only the wording and the call
 * differ.
 */
const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, jobId, onClose, onSubmitted }) => (
  <FeedbackDialog
    isOpen={isOpen}
    jobId={jobId}
    heading="Research Feedback"
    subtitle="How useful was this research brief?"
    examples={EXAMPLE_FEEDBACK_ITEMS}
    commentPlaceholder="Share what was accurate, missing or useful…"
    onSubmit={(rating, comment) => submitResearchFeedback(jobId, rating, comment)}
    onClose={onClose}
    onSubmitted={onSubmitted}
  />
);

export default FeedbackModal;
