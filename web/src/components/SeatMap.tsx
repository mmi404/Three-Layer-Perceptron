import React, { useState, useEffect } from 'react';
import { Seat, Showtime } from '../types';
import { Lock, Sparkles, Clock, Zap, CheckCircle2, ShoppingBag, ArrowRight } from 'lucide-react';

interface SeatMapProps {
  showtime: Showtime;
  seats: Seat[];
  selectedSeatId: string | null;
  onSelectSeat: (seat: Seat) => void;
  heldUntil?: Date | null;
  onReleaseHold?: () => void;
  onProceedToCheckout?: () => void;
  onProceedDirectPayment?: () => void;
  isHoldingSeat?: boolean;
}

export const SeatMap: React.FC<SeatMapProps> = ({
  showtime,
  seats,
  selectedSeatId,
  onSelectSeat,
  heldUntil,
  onReleaseHold,
  onProceedToCheckout,
  onProceedDirectPayment,
  isHoldingSeat = false
}) => {
  const [hoveredSeat, setHoveredSeat] = useState<Seat | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  // Group seats by row
  const rows = ['A', 'B', 'C', 'D', 'E', 'F'];

  // Real-time countdown timer for active seat hold
  useEffect(() => {
    if (!heldUntil) {
      setSecondsRemaining(null);
      return;
    }

    const updateTimer = () => {
      const remainingMs = heldUntil.getTime() - Date.now();
      if (remainingMs <= 0) {
        setSecondsRemaining(0);
        if (onReleaseHold) onReleaseHold();
      } else {
        setSecondsRemaining(Math.ceil(remainingMs / 1000));
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [heldUntil, onReleaseHold]);

  const getSeatCategoryInfo = (seatCode: string) => {
    const row = seatCode[0];
    if (row === 'A' || row === 'B') {
      return { tier: 'VIP Premium Recliner', spot: 'Optimal Dolby Atmos Sweet Spot', price: '৳563' };
    }
    if (row === 'C' || row === 'D') {
      return { tier: 'Center Prime Viewing', spot: 'Direct Eye-Level IMAX Horizon', price: '৳450' };
    }
    return { tier: 'Classic Cinema', spot: 'Wide Panoramic Field of View', price: '৳450' };
  };

  const getSeatStatus = (seat: Seat) => {
    const isSelected = selectedSeatId === seat.seat_id || selectedSeatId === seat.id || selectedSeatId === seat.seat_code;
    if (isSelected) return 'SELECTED';
    const statusUpper = (seat.status || 'AVAILABLE').toUpperCase();
    if (statusUpper === 'BOOKED' || statusUpper === 'SOLD') return 'BOOKED';
    if (statusUpper === 'HELD') return 'HELD';
    return 'AVAILABLE';
  };

  return (
    <div className="glass-panel p-4 sm:p-8 rounded-3xl border border-white/10 shadow-2xl relative space-y-8 animate-fade-in">
      {/* Curved Screen Layout */}
      <div className="flex flex-col items-center justify-center space-y-2">
        <div className="w-full max-w-2xl h-10 rounded-t-full cinema-screen flex items-center justify-center relative overflow-hidden border-t-2 border-brand-500/60 shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-500/30 to-transparent"></div>
          <span className="text-[10px] sm:text-xs font-black uppercase tracking-[0.3em] text-white/90 z-10 text-glow">
            IMAX 4K DUAL LASER CURVED SCREEN
          </span>
        </div>
        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-mono">
          Click any seat to instantly lock • Direct atomic reservation
        </p>
      </div>

      {/* Seat Map Matrix */}
      <div className="space-y-3 sm:space-y-4 max-w-2xl mx-auto overflow-x-auto no-scrollbar py-2">
        {rows.map((rowLabel) => {
          const rowSeats = seats
            .filter((s) => (s.row || s.row_label || (s.seat_code && s.seat_code[0])) === rowLabel)
            .sort((a, b) => (a.col || a.seat_number || 1) - (b.col || b.seat_number || 1));

          return (
            <div key={rowLabel} className="flex items-center justify-center gap-2 sm:gap-3 min-w-[320px]">
              {/* Row Label Left */}
              <span className="w-5 text-center font-extrabold text-gray-500 text-xs font-mono">
                {rowLabel}
              </span>

              {/* Row Seat Buttons */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                {rowSeats.map((seat) => {
                  const status = getSeatStatus(seat);
                  const seatCode = seat.seat_code || seat.label || `${rowLabel}${seat.col || 1}`;

                  return (
                    <button
                      key={seat.seat_id || seat.id || seatCode}
                      disabled={status === 'BOOKED' || status === 'HELD' || (isHoldingSeat && status !== 'SELECTED')}
                      onClick={() => onSelectSeat(seat)}
                      onMouseEnter={() => setHoveredSeat(seat)}
                      onMouseLeave={() => setHoveredSeat(null)}
                      className={`relative w-8 h-8 sm:w-10 sm:h-10 rounded-xl font-mono text-[11px] sm:text-xs font-bold transition-all duration-200 flex items-center justify-center ${
                        status === 'SELECTED'
                          ? 'bg-gradient-to-tr from-brand-600 to-amber-400 text-white shadow-lg shadow-brand-500/50 scale-110 ring-2 ring-white/70 animate-pulse'
                          : status === 'BOOKED'
                          ? 'bg-dark-800/40 text-gray-600 border border-gray-800/80 cursor-not-allowed'
                          : status === 'HELD'
                          ? 'bg-amber-950/60 text-amber-500 border border-amber-500/40 cursor-not-allowed'
                          : 'bg-dark-800/90 text-gray-200 border border-gray-700 hover:border-brand-400 hover:text-white hover:scale-105 hover:bg-dark-700 active:scale-95'
                      }`}
                      title={`Seat ${seatCode} - Click to hold`}
                    >
                      {status === 'HELD' ? (
                        <Lock className="w-3.5 h-3.5 text-amber-400" />
                      ) : status === 'BOOKED' ? (
                        <span className="text-[10px] text-gray-600 font-black">✕</span>
                      ) : (
                        <span>{seat.col || seat.seat_number || seatCode.slice(1)}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Row Label Right */}
              <span className="w-5 text-center font-extrabold text-gray-500 text-xs font-mono">
                {rowLabel}
              </span>
            </div>
          );
        })}
      </div>

      {/* Seat Quality Hover Preview Tooltip */}
      {hoveredSeat && (
        <div className="max-w-md mx-auto p-3 rounded-2xl bg-dark-800/95 border border-brand-500/40 text-center space-y-1 animate-fade-in shadow-xl">
          <div className="flex items-center justify-center gap-2">
            <span className="text-xs font-extrabold text-white">
              Seat {hoveredSeat.seat_code || hoveredSeat.label}
            </span>
            <span className="px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 font-bold text-[10px]">
              {getSeatCategoryInfo(hoveredSeat.seat_code || hoveredSeat.label || 'A1').tier}
            </span>
            <span className="text-xs font-mono font-bold text-amber-400">
              {getSeatCategoryInfo(hoveredSeat.seat_code || hoveredSeat.label || 'A1').price}
            </span>
          </div>
          <p className="text-[11px] text-gray-400">
            {getSeatCategoryInfo(hoveredSeat.seat_code || hoveredSeat.label || 'A1').spot}
          </p>
        </div>
      )}

      {/* Legend Bar */}
      <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 text-xs text-gray-300 pt-2 border-t border-gray-800/80">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-lg bg-dark-800 border border-gray-700"></div>
          <span>Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-lg bg-brand-600 shadow-md shadow-brand-500/40"></div>
          <span className="font-bold text-brand-400">Selected (Held by You)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-lg bg-amber-950/80 border border-amber-500/40 flex items-center justify-center">
            <Lock className="w-2.5 h-2.5 text-amber-400" />
          </div>
          <span className="text-amber-300">Held (Under Checkout)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-lg bg-dark-800/40 border border-gray-800 text-gray-600 flex items-center justify-center text-[10px]">
            ✕
          </div>
          <span className="text-gray-500">Booked</span>
        </div>
      </div>

      {/* Active Seat Hold Bar with Live Expiring Countdown */}
      {selectedSeatId && (
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-dark-800 via-dark-900 to-dark-800 border border-brand-500/50 shadow-xl space-y-3 animate-fade-in">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="space-y-1 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span className="font-extrabold text-white text-sm">
                  Seat {selectedSeatId} Atomically Held
                </span>
                {secondsRemaining !== null && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-mono font-bold flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{secondsRemaining}s remaining</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">
                Seat is reserved in Postgres with row-level serialization.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              {onReleaseHold && (
                <button
                  onClick={onReleaseHold}
                  className="px-3.5 py-2.5 rounded-xl bg-dark-800 hover:bg-dark-700 text-gray-300 text-xs font-bold border border-gray-700 transition"
                >
                  Cancel Hold
                </button>
              )}

              {onProceedToCheckout && (
                <button
                  onClick={onProceedToCheckout}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-dark-800 hover:bg-dark-700 text-amber-300 font-bold text-xs border border-amber-500/40 shadow-sm flex items-center justify-center gap-1.5 transition"
                  title="Add Popcorn & Drinks"
                >
                  <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                  <span>+ Snacks</span>
                </button>
              )}

              <button
                onClick={onProceedDirectPayment || onProceedToCheckout}
                className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 via-brand-500 to-amber-500 hover:from-brand-500 hover:to-amber-400 text-white font-extrabold text-xs shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2 transition transform hover:scale-105 active:scale-95"
              >
                <span>Proceed to Payment</span>
                <Zap className="w-3.5 h-3.5 text-amber-200" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
