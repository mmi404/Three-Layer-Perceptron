import React from 'react';
import { X, Play, Clock, Star, Calendar, Ticket, Film, ShieldCheck } from 'lucide-react';
import { Movie } from '../types';

interface TrailerModalProps {
  movie: Movie | null;
  isOpen: boolean;
  onClose: () => void;
  onBookNow: (movie: Movie) => void;
}

// Curated high-fidelity official trailers
const TRAILER_URLS: Record<string, string> = {
  'movie-spiderman': 'https://www.youtube-nocookie.com/embed/JfVOs4VSpmA?autoplay=1&rel=0&modestbranding=1',
  'movie-oppenheimer': 'https://www.youtube-nocookie.com/embed/uYPbbksJxIg?autoplay=1&rel=0&modestbranding=1',
  'movie-avatar-3': 'https://www.youtube-nocookie.com/embed/d9MyW72ELq0?autoplay=1&rel=0&modestbranding=1',
  'movie-dune-2': 'https://www.youtube-nocookie.com/embed/Way9Dexny3w?autoplay=1&rel=0&modestbranding=1',
  'movie-deadpool-wolverine': 'https://www.youtube-nocookie.com/embed/73_1biulkYk?autoplay=1&rel=0&modestbranding=1',
  'movie-dark-knight': 'https://www.youtube-nocookie.com/embed/EXeTwQWrcwY?autoplay=1&rel=0&modestbranding=1',
  'movie-interstellar': 'https://www.youtube-nocookie.com/embed/zSWdZVtXT7E?autoplay=1&rel=0&modestbranding=1',
  'movie-inception': 'https://www.youtube-nocookie.com/embed/YoHD9XEInc0?autoplay=1&rel=0&modestbranding=1',
};

export const TrailerModal: React.FC<TrailerModalProps> = ({
  movie,
  isOpen,
  onClose,
  onBookNow
}) => {
  if (!isOpen || !movie) return null;

  const trailerUrl = TRAILER_URLS[movie.id] || `https://www.youtube-nocookie.com/embed/JfVOs4VSpmA?autoplay=1&rel=0&modestbranding=1`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/90 backdrop-blur-lg animate-fade-in">
      <div className="glass-panel w-full max-w-4xl max-h-[92vh] rounded-3xl border border-brand-500/40 shadow-2xl flex flex-col relative overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-dark-800 to-dark-900 p-4 sm:p-5 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-brand-600/20 text-brand-400 border border-brand-500/30">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-white text-base sm:text-lg tracking-tight font-sans line-clamp-1">
                  {movie.title}
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-black rounded bg-brand-500/20 text-brand-300 border border-brand-500/30">
                  Official 4K Trailer
                </span>
              </div>
              <p className="text-xs text-gray-400 font-medium">Star Cineplex 4K IMAX Experience</p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-dark-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Player 16:9 */}
        <div className="relative w-full pb-[56.25%] bg-black shrink-0 border-b border-gray-800">
          <iframe
            src={trailerUrl}
            title={`${movie.title} Trailer`}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>

        {/* Modal Body & Movie Metadata */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 no-scrollbar">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 text-xs font-black bg-dark-800 text-white rounded-lg border border-white/20">
                  {movie.rating}
                </span>
                <span className="text-xs font-semibold text-gray-300">{movie.genre}</span>
                <div className="flex items-center gap-1 bg-amber-500/15 px-2 py-0.5 rounded-lg border border-amber-500/30 text-amber-300 font-bold text-xs">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>{movie.imdb_rating || 9.0} IMDb</span>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-gray-300 max-w-2xl leading-relaxed pt-1">
                {movie.description}
              </p>
            </div>

            <button
              onClick={() => {
                onClose();
                onBookNow(movie);
              }}
              className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-gradient-to-r from-brand-600 via-brand-500 to-amber-500 hover:from-brand-500 hover:to-amber-400 text-white font-extrabold text-xs sm:text-sm shadow-xl shadow-brand-500/30 flex items-center justify-center gap-2 transition transform hover:scale-105 active:scale-95 shrink-0"
            >
              <Ticket className="w-4 h-4" />
              <span>Book Seats Now</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
            <div className="p-3 rounded-xl bg-dark-800/80 border border-gray-800">
              <span className="text-[10px] text-gray-400 block uppercase font-bold">Runtime</span>
              <span className="font-bold text-white">{movie.duration_mins} Minutes</span>
            </div>
            <div className="p-3 rounded-xl bg-dark-800/80 border border-gray-800">
              <span className="text-[10px] text-gray-400 block uppercase font-bold">Audio System</span>
              <span className="font-bold text-brand-400">Dolby Atmos 7.1.4</span>
            </div>
            <div className="p-3 rounded-xl bg-dark-800/80 border border-gray-800">
              <span className="text-[10px] text-gray-400 block uppercase font-bold">Projection</span>
              <span className="font-bold text-cyan-400">IMAX 4K Laser 3D</span>
            </div>
            <div className="p-3 rounded-xl bg-dark-800/80 border border-gray-800">
              <span className="text-[10px] text-gray-400 block uppercase font-bold">Protection</span>
              <span className="font-bold text-emerald-400">Atomic CAS Locking</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
