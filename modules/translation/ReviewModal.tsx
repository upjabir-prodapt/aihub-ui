import React, { useState, useEffect, useCallback } from 'react';
import { Star, Send, Loader2, X } from 'lucide-react';
import { translationApi } from '@/modules/translation/translationApi';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MAX_COMMENT = 2000;

interface ReviewModalProps {
  isOpen: boolean;
  jobId: string;
  onClose: () => void;
  onSubmitted: (ok: boolean, message: string) => void;
}

const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Excellent',
};

const RATING_COLORS: Record<number, string> = {
  1: 'text-red-400',
  2: 'text-orange-400',
  3: 'text-amber-400',
  4: 'text-lime-400',
  5: 'text-emerald-400',
};

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

  const displayRating = hovered || rating;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={() => { if (!submitting) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Rate Translation"
    >
      <div className="w-full max-w-sm animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <Card className="relative overflow-hidden border-border-strong/40 shadow-2xl">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-amber-400/50 to-transparent" />
          
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              <span className="text-sm font-bold text-text-primary">Rate this Translation</span>
            </div>
            {!submitting && (
              <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-primary transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            )}
          </CardHeader>

          <CardContent className="pt-2">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <p className="text-xs text-text-secondary text-center">
                How would you rate the quality of this translation?
              </p>

              {/* Stars */}
              <div className="flex items-center justify-center gap-1.5" role="group" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={cn(
                      "transition-transform hover:scale-110 cursor-pointer",
                      star <= displayRating ? "text-amber-400" : "text-text-muted/30"
                    )}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHovered(star)}
                    onMouseLeave={() => setHovered(0)}
                    aria-label={`${star} star${star !== 1 ? 's' : ''}`}
                    disabled={submitting}
                  >
                    <Star className="w-7 h-7" fill={star <= displayRating ? 'currentColor' : 'none'} />
                  </button>
                ))}
              </div>

              {/* Rating label */}
              <div className="text-center h-5" aria-live="polite">
                {displayRating === 0
                  ? <span className="text-xs text-text-muted">Select a rating</span>
                  : <span className={cn("text-sm font-semibold", RATING_COLORS[displayRating])}>{RATING_LABELS[displayRating]}</span>
                }
              </div>

              {/* Comment */}
              <div className="space-y-1.5">
                <Label htmlFor="review-comment" className="flex items-center gap-1">
                  Comment <span className="text-text-muted font-normal normal-case">(optional)</span>
                </Label>
                <Textarea
                  id="review-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
                  placeholder="Share details about the translation quality…"
                  rows={4}
                  disabled={submitting}
                />
                <div className={cn(
                  "text-[10px] text-right",
                  comment.length >= MAX_COMMENT ? "text-red-400 font-semibold" : "text-text-muted"
                )}>
                  {comment.length} / {MAX_COMMENT}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 cursor-pointer"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 cursor-pointer"
                  disabled={rating === 0 || submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Submit Review
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ReviewModal;
