import React, { useState } from 'react';

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

interface StarRatingProps {
  /** 0 means nothing chosen yet. */
  value: number;
  onChange: (rating: number) => void;
  disabled?: boolean;
  /** Shown in place of a label until a rating is picked. */
  hint?: string;
}

/**
 * 1-5 star picker shared by Translation's review and Sales' research feedback.
 *
 * Both services store a 1-5 rating, so the control, its labels and its classes
 * live here rather than being copied per feature — the styles are in
 * translation.css, where the first copy of this markup was.
 */
const StarRating: React.FC<StarRatingProps> = ({
  value,
  onChange,
  disabled = false,
  hint = 'Select a rating',
}) => {
  const [hovered, setHovered] = useState(0);
  const displayRating = hovered || value;

  return (
    <>
      <div className="review-stars-row" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={`review-star-btn ${star <= displayRating ? 'active' : ''}`}
            onClick={() => onChange(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            aria-label={`${star} star${star !== 1 ? 's' : ''}`}
            aria-pressed={value === star}
            disabled={disabled}
          >
            <StarIcon filled={star <= displayRating} />
          </button>
        ))}
      </div>

      <div className="review-rating-label" aria-live="polite">
        {displayRating === 0 ? (
          <span className="rating-hint">{hint}</span>
        ) : (
          <span className={RATING_CLASSES[displayRating]}>{RATING_LABELS[displayRating]}</span>
        )}
      </div>
    </>
  );
};

export default StarRating;
