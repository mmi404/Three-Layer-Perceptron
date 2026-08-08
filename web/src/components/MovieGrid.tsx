import React, { useState, useMemo } from 'react';
import { Movie } from '../types';
import { MovieCard } from './MovieCard';
import { Search, SlidersHorizontal, X, Film } from 'lucide-react';

interface MovieGridProps {
  movies: Movie[];
  onBookSeats: (movie: Movie) => void;
  onWatchTrailer?: (movie: Movie) => void;
}

export const MovieGrid: React.FC<MovieGridProps> = ({ movies, onBookSeats, onWatchTrailer }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [sortBy, setSortBy] = useState<'FEATURED' | 'RATING' | 'DURATION'>('FEATURED');

  const genres = ['All', 'Action', 'Sci-Fi', 'Drama', 'Adventure', 'Crime', 'Premiere Rush'];

  const filteredMovies = useMemo(() => {
    return movies
      .filter((m) => {
        const matchesQuery = 
          m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (m.genre || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (m.description || '').toLowerCase().includes(searchQuery.toLowerCase());

        const matchesGenre = 
          selectedGenre === 'All' ? true :
          selectedGenre === 'Premiere Rush' ? (m.badge === 'HOT RUSH' || m.badge === 'PREMIERE' || m.is_premiere) :
          (m.genre || '').toLowerCase().includes(selectedGenre.toLowerCase());

        return matchesQuery && matchesGenre;
      })
      .sort((a, b) => {
        if (sortBy === 'RATING') return (b.imdb_rating || 0) - (a.imdb_rating || 0);
        if (sortBy === 'DURATION') return (b.duration_mins || b.duration_min) - (a.duration_mins || a.duration_min);
        return 0;
      });
  }, [movies, searchQuery, selectedGenre, sortBy]);

  return (
    <section className="space-y-6">
      {/* Controls & Filter Header */}
      <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-white/10 space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4">
          {/* Search Input */}
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 35+ movies by title, genre..."
              className="w-full bg-dark-800 text-white pl-10 pr-10 py-2.5 rounded-xl border border-gray-700 text-xs focus:border-brand-500 focus:outline-none transition min-h-[44px]"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-3 text-gray-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end text-xs">
            <div className="flex items-center gap-1.5 text-gray-400 font-semibold shrink-0">
              <SlidersHorizontal className="w-3.5 h-3.5 text-brand-400" />
              <span>Sort:</span>
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-dark-800 text-gray-200 border border-gray-700 rounded-xl px-3 py-2.5 text-xs focus:border-brand-500 focus:outline-none min-h-[44px] w-full md:w-auto"
            >
              <option value="FEATURED">Featured & High Demand</option>
              <option value="RATING">Highest IMDb Rating</option>
              <option value="DURATION">Duration (Longest First)</option>
            </select>
          </div>
        </div>

        {/* Genre Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 text-xs -mx-1 px-1">
          <span className="text-gray-500 font-bold uppercase tracking-wider text-[10px] shrink-0 mr-1 hidden sm:inline">
            Genre:
          </span>
          {genres.map((g) => {
            const isActive = selectedGenre === g;
            return (
              <button
                key={g}
                onClick={() => setSelectedGenre(g)}
                className={`px-3.5 py-2 rounded-xl font-bold shrink-0 transition text-xs min-h-[38px] ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-md shadow-brand-500/30'
                    : 'bg-dark-800 text-gray-400 hover:text-white hover:bg-dark-700 border border-gray-800'
                }`}
              >
                {g}
              </button>
            );
          })}
        </div>
      </div>

      {/* Result Counter */}
      <div className="flex items-center justify-between text-xs text-gray-400 px-1">
        <span className="font-semibold text-gray-300">
          Showing <strong className="text-white">{filteredMovies.length}</strong> Movies
        </span>
        {(searchQuery || selectedGenre !== 'All') && (
          <button
            onClick={() => { setSearchQuery(''); setSelectedGenre('All'); }}
            className="text-brand-400 hover:underline font-semibold"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Movie Cards Grid */}
      {filteredMovies.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {filteredMovies.map((m) => (
            <MovieCard key={m.id} movie={m} onBookSeats={onBookSeats} onWatchTrailer={onWatchTrailer} />
          ))}
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-8 sm:p-12 text-center text-gray-400 space-y-3">
          <Film className="w-10 h-10 sm:w-12 sm:h-12 text-gray-600 mx-auto" />
          <h3 className="text-base sm:text-lg font-bold text-white">No Movies Found</h3>
          <p className="text-xs max-w-sm mx-auto">No movies matched "{searchQuery}". Try searching for another title or resetting your genre filters.</p>
          <button
            onClick={() => { setSearchQuery(''); setSelectedGenre('All'); }}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl text-xs font-bold shadow-lg"
          >
            Reset Search
          </button>
        </div>
      )}
    </section>
  );
};
