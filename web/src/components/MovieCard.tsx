import React from 'react';
import { Movie } from '../types';
import { Clock, Ticket, Star, Flame, Play } from 'lucide-react';

interface MovieCardProps {
  movie: Movie;
  onBookSeats: (movie: Movie) => void;
  onWatchTrailer?: (movie: Movie) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({ movie, onBookSeats, onWatchTrailer }) => {
  const getBadgeStyle = (badge?: string) => {
    switch (badge) {
      case 'HOT RUSH':
        return 'bg-gradient-to-r from-amber-500 to-rose-600 text-white shadow-amber-500/30';
      case 'IMAX 3D':
        return 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-cyan-500/30';
      case 'PREMIERE':
        return 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-purple-500/30';
      default:
        return 'bg-brand-600 text-white shadow-brand-500/30';
    }
  };

  return (
    <div className="group glass-card rounded-2xl overflow-hidden border border-white/10 flex flex-col hover:border-brand-500/50 hover:shadow-2xl hover:shadow-brand-500/20 transition-all duration-300">
      {/* Poster Header with Play Overlay */}
      <div 
        onClick={() => onWatchTrailer && onWatchTrailer(movie)}
        className="relative h-72 sm:h-80 overflow-hidden bg-dark-800 cursor-pointer"
      >
        <img 
          src={movie.poster_url} 
          alt={movie.title}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent"></div>

        {/* Hover Play Icon */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-brand-600/90 text-white flex items-center justify-center shadow-xl transform group-hover:scale-110 transition">
            <Play className="w-5 h-5 fill-white ml-0.5" />
          </div>
        </div>

        {/* Top Badges */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
          <span className="px-2.5 py-1 text-[11px] font-extrabold bg-dark-900/90 text-white rounded-lg border border-white/20 backdrop-blur-md">
            {movie.rating || 'PG-13'}
          </span>

          {movie.badge && (
            <span className={`px-2.5 py-1 text-[10px] uppercase font-black tracking-wider rounded-lg shadow-md flex items-center gap-1 ${getBadgeStyle(movie.badge)}`}>
              {movie.badge === 'HOT RUSH' && <Flame className="w-3 h-3 text-amber-200 animate-pulse" />}
              <span>{movie.badge}</span>
            </span>
          )}
        </div>

        {/* IMDb Rating Pill */}
        <div className="absolute bottom-3 left-3 bg-dark-900/85 px-2.5 py-1 rounded-lg border border-gray-700/80 text-amber-400 font-bold text-xs flex items-center gap-1 backdrop-blur-md">
          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
          <span>{movie.imdb_rating || 8.5}</span>
        </div>
      </div>

      {/* Content Section */}
      <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
        <div>
          <h3 className="font-extrabold text-white text-base tracking-tight group-hover:text-brand-400 transition-colors line-clamp-1">
            {movie.title}
          </h3>

          <p className="text-xs text-gray-400 line-clamp-2 mt-1 leading-relaxed">
            {movie.description}
          </p>
        </div>

        {/* Meta Info */}
        <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-800">
          <span className="font-medium text-gray-300">{movie.genre}</span>
          <div className="flex items-center gap-1 text-gray-400">
            <Clock className="w-3.5 h-3.5 text-brand-400" />
            <span>{movie.duration_mins || movie.duration_min}m</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-1">
          {onWatchTrailer && (
            <button
              onClick={() => onWatchTrailer(movie)}
              className="px-3 py-2.5 rounded-xl bg-dark-800 hover:bg-dark-700 text-gray-300 hover:text-white font-bold text-xs border border-gray-700 flex items-center justify-center gap-1 transition"
              title="Watch Trailer"
            >
              <Play className="w-3.5 h-3.5 text-brand-400 fill-brand-400" />
              <span className="hidden sm:inline">Trailer</span>
            </button>
          )}

          <button
            onClick={() => onBookSeats(movie)}
            className="flex-1 py-2.5 rounded-xl bg-dark-800 group-hover:bg-gradient-to-r group-hover:from-brand-600 group-hover:to-brand-500 text-gray-200 group-hover:text-white font-bold text-xs border border-gray-700 group-hover:border-brand-500/50 shadow-md transition-all duration-300 flex items-center justify-center gap-2"
          >
            <Ticket className="w-4 h-4 text-brand-400 group-hover:text-white transition-colors" />
            <span>Book Seats</span>
          </button>
        </div>
      </div>
    </div>
  );
};
