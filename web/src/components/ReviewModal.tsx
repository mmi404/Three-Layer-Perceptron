import React, { useState, useEffect } from 'react';
import { X, Star, CheckCircle2, MessageSquare, ThumbsUp, Sparkles, Send } from 'lucide-react';
import { ReviewItem } from '../types';

interface ReviewModalProps {
  movieId: string;
  movieTitle: string;
  onClose: () => void;
  onReviewsUpdated?: (newAvgRating: number, newTotalReviews: number) => void;
}

const INITIAL_REVIEWS: Record<string, ReviewItem[]> = {
  'movie-spiderman': [
    {
      id: 'rev-1',
      movie_id: 'movie-spiderman',
      author_name: 'Tanvir Hossain',
      rating: 5,
      comment: 'Mind-blowing IMAX 3D visuals! The sound design during the third act battle was truly sensational.',
      verified_purchaser: true,
      created_at: '2 hours ago'
    },
    {
      id: 'rev-2',
      movie_id: 'movie-spiderman',
      author_name: 'Sabrina Rahman',
      rating: 5,
      comment: 'Booking seats was instantaneous! Zero delay, zero double booking glitch. Fantastic experience at Star Cineplex.',
      verified_purchaser: true,
      created_at: '5 hours ago'
    },
    {
      id: 'rev-3',
      movie_id: 'movie-spiderman',
      author_name: 'Mahmudul Hasan (CUET)',
      rating: 4,
      comment: 'Great pacing and emotional depth. Best superhero cinema in years. Loved the Dolby Atmos mix!',
      verified_purchaser: true,
      created_at: '1 day ago'
    }
  ]
};

export const ReviewModal: React.FC<ReviewModalProps> = ({
  movieId,
  movieTitle,
  onClose,
  onReviewsUpdated
}) => {
  const [reviews, setReviews] = useState<ReviewItem[]>(() => {
    return INITIAL_REVIEWS[movieId] || [
      {
        id: 'rev-default-1',
        movie_id: movieId,
        author_name: 'Arif Chowdhury',
        rating: 5,
        comment: 'Absolute masterpiece. Must watch in IMAX 70mm or Dolby Atmos Hall!',
        verified_purchaser: true,
        created_at: '1 day ago'
      }
    ];
  });

  const [authorName, setAuthorName] = useState('');
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState(false);

  const avgRating = Number(
    (reviews.reduce((sum, r) => sum + r.rating, 0) / (reviews.length || 1)).toFixed(1)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;

    setIsSubmitting(true);
    const newReview: ReviewItem = {
      id: `rev-${Date.now()}`,
      movie_id: movieId,
      author_name: authorName.trim() || 'Verified Moviegoer',
      rating,
      comment: comment.trim(),
      verified_purchaser: true,
      created_at: 'Just now',
      isNew: true
    };

    setTimeout(() => {
      const updated = [newReview, ...reviews];
      setReviews(updated);
      setIsSubmitting(false);
      setComment('');
      setAuthorName('');
      setSuccessToast(true);

      const newAvg = Number(
        (updated.reduce((sum, r) => sum + r.rating, 0) / updated.length).toFixed(1)
      );
      if (onReviewsUpdated) {
        onReviewsUpdated(newAvg, updated.length);
      }

      setTimeout(() => setSuccessToast(false), 3000);
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-2xl max-h-[90vh] rounded-3xl border border-brand-500/40 shadow-2xl flex flex-col relative overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-dark-800 to-dark-900 p-5 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Star className="w-5 h-5 fill-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-white text-base sm:text-lg tracking-tight font-sans">
                  Audience Reviews & Ratings
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-black rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  ★ {avgRating} / 5.0
                </span>
              </div>
              <p className="text-xs text-gray-400 font-medium line-clamp-1">{movieTitle}</p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-dark-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1 no-scrollbar">
          {/* Write a Review Form */}
          <form onSubmit={handleSubmit} className="p-4 rounded-2xl glass-card border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-white text-xs sm:text-sm flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-brand-400" />
                <span>Write Your Verified Review</span>
              </h4>
              <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Verified Ticket Holder</span>
              </span>
            </div>

            {/* Interactive 5 Star Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium mr-1">Your Score:</span>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1 text-amber-400 hover:scale-125 transition transform"
                >
                  <Star
                    className={`w-5 h-5 ${
                      star <= (hoverRating || rating)
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-gray-600'
                    }`}
                  />
                </button>
              ))}
              <span className="text-xs font-bold text-amber-300 ml-2">
                {hoverRating || rating} / 5 Stars
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Your Name (e.g. Asif Mahmud)"
                className="bg-dark-800 text-white px-3 py-2 rounded-xl border border-gray-700 text-xs focus:border-brand-500 focus:outline-none"
              />
            </div>

            <textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your thoughts on the acting, plot, IMAX 3D visual effects, audio mix..."
              required
              className="w-full bg-dark-800 text-white p-3 rounded-xl border border-gray-700 text-xs focus:border-brand-500 focus:outline-none"
            />

            <div className="flex items-center justify-between pt-1">
              {successToast ? (
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 animate-pulse">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Review published successfully!</span>
                </span>
              ) : (
                <span className="text-[10px] text-gray-500">
                  Reviews are instantly verified and reflected in live aggregate ratings.
                </span>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !comment.trim()}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-bold text-xs shadow-lg shadow-brand-500/30 flex items-center gap-1.5 transition disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Posting...' : 'Post Review'}</span>
              </button>
            </div>
          </form>

          {/* Verified Reviews Stream */}
          <div className="space-y-3">
            <h4 className="font-extrabold text-white text-xs uppercase tracking-wider text-gray-400">
              Audience Reviews ({reviews.length})
            </h4>

            {reviews.map((rev) => (
              <div
                key={rev.id}
                className={`p-4 rounded-2xl border transition-all space-y-2 ${
                  rev.isNew
                    ? 'bg-brand-950/40 border-brand-500/50 shadow-lg'
                    : 'glass-card border-white/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-xs">{rev.author_name}</span>
                    {rev.verified_purchaser && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-extrabold border border-emerald-500/30 flex items-center gap-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        <span>Verified Buyer</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`w-3 h-3 ${
                          s <= rev.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-700'
                        }`}
                      />
                    ))}
                    <span className="text-[10px] text-gray-400 ml-1">{rev.created_at}</span>
                  </div>
                </div>

                <p className="text-xs text-gray-300 leading-relaxed">{rev.comment}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-dark-900/90 p-4 border-t border-gray-800 flex items-center justify-between shrink-0">
          <p className="text-xs text-gray-400">
            Aggregate Score: <strong className="text-amber-400">★ {avgRating} / 5.0</strong> ({reviews.length} Verified Reviews)
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-dark-800 hover:bg-dark-700 text-gray-200 font-bold text-xs border border-gray-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
