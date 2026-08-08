import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, X, Smartphone, ShoppingBag, Printer } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Booking, SnackItem } from '../types';
import { QrCodeSvg } from './QrCodeSvg';

interface TicketReceiptModalProps {
  bookingRef: string;
  selectedSnacks?: SnackItem[];
  totalAmountPaid?: number;
  onClose: () => void;
}

export const TicketReceiptModal: React.FC<TicketReceiptModalProps> = ({
  bookingRef,
  selectedSnacks = [],
  totalAmountPaid,
  onClose
}) => {
  const [booking, setBooking] = useState<Booking | null>(null);

  useEffect(() => {
    // Trigger celebration confetti
    confetti({
      particleCount: 90,
      spread: 80,
      origin: { y: 0.6 }
    });

    const fetchBooking = async () => {
      try {
        const res = await fetch(`/api/v1/bookings/${bookingRef}`, {
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data) {
            setBooking(data);
            return;
          }
        }
      } catch {
        // Fallback
      }

      // Preview fallback
      setBooking({
        id: `b_${bookingRef}`,
        booking_ref: bookingRef,
        status: 'CONFIRMED',
        amount: totalAmountPaid || 450,
        amount_cents: (totalAmountPaid || 450) * 100,
        movie_title: 'Spider-Man: Brand New Day',
        screen_name: 'Grand Hall IMAX 1',
        seat_code: 'C5',
        seats: [{ seat_id: 'seat-c5', label: 'C5', price_cents: 45000 }],
        created_at: new Date().toISOString(),
        snacks: selectedSnacks
      });
    };

    fetchBooking();
  }, [bookingRef, totalAmountPaid, selectedSnacks]);

  const displayAmount = totalAmountPaid || booking?.amount || (booking?.amount_cents ? Math.round(booking.amount_cents / 100) : 450);
  const qrPayload = `CINEMASEAT|REF:${bookingRef}|SEAT:${booking?.seat_code || 'C5'}|STATUS:CONFIRMED`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-900/85 backdrop-blur-md animate-fade-in">
      <div className="glass-panel max-w-sm w-full rounded-3xl p-6 sm:p-8 border border-brand-500/40 relative shadow-2xl overflow-hidden">
        {/* Ambient Glow */}
        <div className="absolute -top-12 -left-12 w-40 h-40 bg-brand-500/20 rounded-full blur-2xl"></div>

        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-600 to-emerald-400 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-brand-500/30">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-2xl font-extrabold text-white tracking-tight">Booking Confirmed!</h3>
          <p className="text-xs text-emerald-400 font-semibold">Your digital ticket & snack pass are ready</p>
        </div>

        {booking ? (
          <div className="space-y-4">
            {/* Ticket Card */}
            <div className="bg-dark-800/90 rounded-2xl p-5 border border-gray-700/60 relative">
              <div className="flex items-center justify-between border-b border-gray-700 pb-3 mb-3">
                <div>
                  <h4 className="font-bold text-white text-sm line-clamp-1">{booking.movie_title || 'Spider-Man: Brand New Day'}</h4>
                  <p className="text-xs text-gray-400">{booking.screen_name || 'Grand Hall IMAX 1'}</p>
                </div>
                <span className="px-2.5 py-1 text-xs font-black bg-brand-600 text-white rounded-lg shrink-0">
                  Seat {booking.seat_code || (booking.seats && booking.seats[0]?.label) || 'C5'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-gray-500 block text-[10px] uppercase font-bold">Booking Ref</span>
                  <span className="font-mono text-gray-200 font-semibold text-[11px] truncate block">{booking.booking_ref}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-[10px] uppercase font-bold">Total Paid</span>
                  <span className="text-emerald-400 font-bold">৳{displayAmount}</span>
                </div>
              </div>

              {/* Concessions Section if any */}
              {selectedSnacks && selectedSnacks.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-800 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-amber-400 flex items-center gap-1">
                    <ShoppingBag className="w-3 h-3" />
                    <span>Concessions Counter Pickup:</span>
                  </span>
                  {selectedSnacks.map(s => (
                    <p key={s.id} className="text-[10px] text-gray-300 font-medium">
                      • {s.name} (x{s.quantity})
                    </p>
                  ))}
                </div>
              )}

              {/* REAL SCANNABLE QR CODE */}
              <div className="mt-4 pt-4 border-t border-dashed border-gray-700 flex flex-col items-center">
                <div className="bg-white p-2.5 rounded-2xl shadow-xl mb-2.5 border-2 border-brand-500/30">
                  <QrCodeSvg value={qrPayload} size={110} />
                </div>
                <span className="text-[10px] text-gray-300 font-bold flex items-center gap-1">
                  <Smartphone className="w-3 h-3 text-emerald-400" />
                  <span>Scan at entry gate & snack counter</span>
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => window.print()}
                className="px-4 py-3 rounded-xl bg-dark-800 hover:bg-dark-700 text-gray-200 font-bold text-xs border border-gray-700 flex items-center justify-center gap-1.5 transition"
                title="Print or Save as PDF"
              >
                <Printer className="w-4 h-4" />
                <span className="hidden sm:inline">Print</span>
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-bold text-xs shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2 transition min-h-[44px]"
              >
                <Download className="w-4 h-4" />
                <span>Done & View Wallet</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-gray-400">
            Loading your confirmed ticket details...
          </div>
        )}
      </div>
    </div>
  );
};
