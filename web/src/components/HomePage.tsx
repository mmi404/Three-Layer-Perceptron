import React from 'react';
import { Movie } from '../types';
import { Sparkles, ShieldCheck, Zap, Film, ArrowRight, Play, Star, Flame, Ticket, Clock } from 'lucide-react';

interface HomePageProps {
  movies: Movie[];
  onExploreMovies: () => void;
  onQuickBook: (movie: Movie) => void;
  onWatchTrailer?: (movie: Movie) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  movies,
  onExploreMovies,
  onQuickBook,
  onWatchTrailer,
}) => {
  const topMovies = movies.slice(0, 4);

  return (
    <div className="space-y-16 animate-fade-in pb-12">
      {/* Hero Section */}
      <section className="relative rounded-3xl overflow-hidden glass-panel border border-white/10 p-6 sm:p-12 md:p-16 shadow-2xl">
        {/* Glowing Background Orbs */}
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] bg-brand-600/30 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-amber-500/20 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none"></div>

        <div className="relative z-10 max-w-4xl mx-auto text-center space-y-6 sm:space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-500/20 border border-brand-500/40 text-brand-300 text-xs sm:text-sm font-extrabold uppercase tracking-wider shadow-lg">
            <Sparkles className="w-4 h-4 text-amber-400 animate-spin" />
            <span>Zero to Production • Midnight Premiere Ticketing</span>
          </div>

          {/* Headline */}
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight leading-[1.15]">
            Experience Cinema Like Never Before with{' '}
            <span className="bg-gradient-to-r from-brand-400 via-amber-300 to-rose-400 bg-clip-text text-transparent">
              Instant Atomic Seat Booking
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-gray-300 text-sm sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Book midnight premieres, 4K IMAX 3D blockbusters, and VIP seats in real-time with zero double-booking under extreme high-concurrency demand.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <button
              onClick={onExploreMovies}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-brand-600 via-brand-500 to-amber-500 hover:from-brand-500 hover:to-amber-400 text-white font-extrabold text-sm sm:text-base shadow-xl shadow-brand-500/30 flex items-center justify-center gap-3 transition transform hover:scale-105 active:scale-95 min-h-[52px]"
            >
              <Film className="w-5 h-5 text-white" />
              <span>Explore 35+ Blockbuster Movies</span>
              <ArrowRight className="w-5 h-5 text-amber-200" />
            </button>

            {movies[0] && onWatchTrailer && (
              <button
                onClick={() => onWatchTrailer(movies[0])}
                className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-dark-800/90 hover:bg-dark-700 text-gray-200 hover:text-white font-bold text-xs sm:text-sm border border-gray-700/80 shadow-lg flex items-center justify-center gap-2 transition min-h-[52px]"
              >
                <Play className="w-4 h-4 text-brand-400 fill-brand-400" />
                <span>Watch {movies[0].title.split(':')[0]} Trailer</span>
              </button>
            )}
          </div>

          {/* Stats Bar */}
          <div className="pt-10 border-t border-gray-800/80 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div className="p-3 rounded-2xl bg-dark-800/50 border border-gray-800">
              <div className="text-xl sm:text-2xl font-black text-brand-400 font-sans">35+</div>
              <div className="text-[11px] text-gray-400 font-medium mt-0.5">Curated Movies</div>
            </div>
            <div className="p-3 rounded-2xl bg-dark-800/50 border border-gray-800">
              <div className="text-xl sm:text-2xl font-black text-amber-400 font-sans">100+</div>
              <div className="text-[11px] text-gray-400 font-medium mt-0.5">Concurrent Protection</div>
            </div>
            <div className="p-3 rounded-2xl bg-dark-800/50 border border-gray-800">
              <div className="text-xl sm:text-2xl font-black text-emerald-400 font-sans">&lt; 50ms</div>
              <div className="text-[11px] text-gray-400 font-medium mt-0.5">Atomic Lock Speed</div>
            </div>
            <div className="p-3 rounded-2xl bg-dark-800/50 border border-gray-800">
              <div className="text-xl sm:text-2xl font-black text-cyan-400 font-sans">100%</div>
              <div className="text-[11px] text-gray-400 font-medium mt-0.5">Scannable QR Tickets</div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Highlights Grid */}
      <section className="space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Why Moviegoers & Judges Choose CinemaSeat
          </h2>
          <p className="text-xs sm:text-sm text-gray-400 max-w-xl mx-auto">
            Built from the ground up to solve the hardest high-concurrency ticket booking challenges.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-3 hover:border-brand-500/40 transition duration-300">
            <div className="w-12 h-12 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30 flex items-center justify-center">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white">Atomic Concurrency Engine</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Powered by Redis single-thread atomic key locks (`NX`). When 100 users try to book Seat F12 at the same millisecond, exactly 1 succeeds and 99 get instant 409 Conflict.
            </p>
          </div>

          <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-3 hover:border-brand-500/40 transition duration-300">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
              <Film className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white">Interactive 3D Viewing Tooltips</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Hover over any seat on the live screen layout to preview viewing angles, IMAX sweet spots, elevated VIP back rows, and viewing distance quality tags.
            </p>
          </div>

          <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-3 hover:border-brand-500/40 transition duration-300">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white">Two-Step Gateway & Scannable QR</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Includes Bangladeshi phone validation, 6-digit gateway OTP verification, and instant generation of 100% scannable mobile digital QR ticket receipts.
            </p>
          </div>
        </div>
      </section>

      {/* Featured Trending Movies Showcase */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <Flame className="w-5 h-5 text-amber-400" />
              <span>Trending Blockbusters Now Showing</span>
            </h2>
            <p className="text-xs text-gray-400">Explore top picks or browse our full 35+ movie catalog</p>
          </div>

          <button
            onClick={onExploreMovies}
            className="text-xs font-bold text-brand-400 hover:text-brand-300 flex items-center gap-1 transition"
          >
            <span>View All 35+</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {topMovies.map((m) => (
            <div
              key={m.id}
              className="group glass-card rounded-2xl overflow-hidden border border-white/10 flex flex-col hover:border-brand-500/50 hover:shadow-2xl transition duration-300"
            >
              <div
                onClick={() => onWatchTrailer && onWatchTrailer(m)}
                className="relative h-64 overflow-hidden bg-dark-800 cursor-pointer"
              >
                <img
                  src={m.poster_url}
                  alt={m.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent"></div>

                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-12 h-12 rounded-full bg-brand-600/90 text-white flex items-center justify-center shadow-xl transform group-hover:scale-110 transition">
                    <Play className="w-5 h-5 fill-white ml-0.5" />
                  </div>
                </div>

                <div className="absolute top-3 left-3">
                  <span className="px-2.5 py-1 text-[10px] font-black bg-dark-900/90 text-white rounded-lg border border-white/20">
                    {m.rating || 'PG-13'}
                  </span>
                </div>

                <div className="absolute bottom-3 left-3 bg-dark-900/85 px-2.5 py-1 rounded-lg border border-gray-700/80 text-amber-400 font-bold text-xs flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>{m.imdb_rating || 8.8}</span>
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <h3 className="font-extrabold text-white text-sm line-clamp-1 group-hover:text-brand-400 transition-colors">
                    {m.title}
                  </h3>
                  <p className="text-xs text-gray-400 line-clamp-2 mt-1">{m.description}</p>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-800">
                  <span>{m.genre}</span>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-brand-400" />
                    <span>{m.duration_mins || m.duration_min}m</span>
                  </div>
                </div>

                <button
                  onClick={() => onQuickBook(m)}
                  className="w-full py-2.5 rounded-xl bg-dark-800 group-hover:bg-gradient-to-r group-hover:from-brand-600 group-hover:to-brand-500 text-gray-200 group-hover:text-white font-bold text-xs border border-gray-700 group-hover:border-brand-500/50 transition-all flex items-center justify-center gap-2"
                >
                  <Ticket className="w-4 h-4 text-brand-400 group-hover:text-white" />
                  <span>Book Premiere Seats</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
