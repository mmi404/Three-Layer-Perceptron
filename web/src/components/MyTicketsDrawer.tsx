import React from 'react';
import { Ticket, X, Smartphone, ShoppingBag, Calendar, MapPin, Printer } from 'lucide-react';
import { Booking } from '../types';
import { QrCodeSvg } from './QrCodeSvg';

interface MyTicketsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tickets: Booking[];
  onCancelTicket?: (bookingRef: string) => void;
}

export const MyTicketsDrawer: React.FC<MyTicketsDrawerProps> = ({
  isOpen,
  onClose,
  tickets,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-fade-in">
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity" 
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md glass-panel border-l border-white/10 shadow-2xl flex flex-col">
          {/* Drawer Header */}
          <div className="bg-gradient-to-r from-dark-800 to-dark-900 p-5 border-b border-gray-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-brand-600/20 text-brand-400 border border-brand-500/30">
                <Ticket className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-white text-base sm:text-lg tracking-tight font-sans">
                  Digital Ticket Wallet
                </h3>
                <p className="text-xs text-gray-400 font-medium">
                  {tickets.length} Active Digital Movie Pass{tickets.length === 1 ? '' : 'es'}
                </p>
              </div>
            </div>

            <button 
              onClick={onClose}
              className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-dark-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Content Body */}
          <div className="p-4 sm:p-6 space-y-6 overflow-y-auto flex-1 no-scrollbar">
            {tickets.length > 0 ? (
              tickets.map((ticket, idx) => {
                const qrPayload = `CINEMASEAT|REF:${ticket.booking_ref}|SEAT:${ticket.seat_code || 'C6'}|STATUS:CONFIRMED`;
                const displayAmount = ticket.amount || (ticket.amount_cents ? Math.round(ticket.amount_cents / 100) : 450);

                return (
                  <div 
                    key={ticket.booking_ref || idx}
                    className="glass-card rounded-2xl p-5 border border-brand-500/30 relative shadow-xl space-y-4"
                  >
                    {/* Ticket Header */}
                    <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                        <span className="text-xs font-extrabold text-emerald-400 uppercase tracking-wider">
                          CONFIRMED TICKET
                        </span>
                      </div>
                      <span className="px-2.5 py-1 text-xs font-black bg-brand-600 text-white rounded-lg">
                        Seat {ticket.seat_code || (ticket.seats && ticket.seats[0]?.label) || 'C6'}
                      </span>
                    </div>

                    {/* Movie Information */}
                    <div className="flex gap-3 items-center">
                      <div className="w-14 h-20 rounded-xl overflow-hidden shrink-0 border border-gray-700 bg-dark-800">
                        <img 
                          src="https://images.unsplash.com/photo-1635805737707-575885ab0820?w=300&q=80" 
                          alt={ticket.movie_title || 'Movie Poster'} 
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-white text-sm line-clamp-1">
                          {ticket.movie_title || 'Spider-Man: Brand New Day'}
                        </h4>
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                          <MapPin className="w-3 h-3 text-brand-400 shrink-0" />
                          <span>{ticket.screen_name || 'Grand Hall IMAX 1'}</span>
                        </p>
                        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5 font-mono">
                          <Calendar className="w-3 h-3 text-brand-400 shrink-0" />
                          <span>Ref: {ticket.booking_ref.slice(0, 14)}...</span>
                        </p>
                      </div>
                    </div>

                    {/* Price & Concessions Badge */}
                    <div className="bg-dark-900/80 p-3 rounded-xl border border-gray-800 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-[10px] text-gray-400 font-bold block uppercase">Total Amount Paid</span>
                        <span className="text-emerald-400 font-black text-sm">৳{displayAmount}</span>
                      </div>
                      {ticket.snacks && ticket.snacks.length > 0 && (
                        <div className="text-right">
                          <span className="text-[10px] text-amber-400 font-bold block flex items-center gap-1">
                            <ShoppingBag className="w-3 h-3" />
                            <span>Concessions Included</span>
                          </span>
                          <span className="text-[10px] text-gray-300 font-medium">
                            {ticket.snacks.reduce((sum, item) => sum + item.quantity, 0)} Items
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Scannable Digital QR Code */}
                    <div className="pt-2 border-t border-dashed border-gray-800 flex flex-col items-center">
                      <div className="bg-white p-2.5 rounded-2xl shadow-lg mb-2 border-2 border-brand-500/20">
                        <QrCodeSvg value={qrPayload} size={105} />
                      </div>
                      <span className="text-[10px] text-gray-300 font-bold flex items-center gap-1">
                        <Smartphone className="w-3 h-3 text-emerald-400" />
                        <span>Present QR code at theatre gate</span>
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-16 text-center space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-dark-800 border border-gray-800 text-gray-500 flex items-center justify-center mx-auto">
                  <Ticket className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="font-extrabold text-white text-base">No Active Digital Tickets</h4>
                  <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                    You haven't confirmed any movie tickets yet. Pick a premiere movie showtime to generate your digital QR pass!
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Drawer Footer */}
          <div className="bg-dark-900/90 p-4 border-t border-gray-800 shrink-0 flex gap-2">
            <button
              onClick={() => window.print()}
              className="px-4 py-3 rounded-xl bg-dark-800 hover:bg-dark-700 text-gray-200 font-bold text-xs border border-gray-700 flex items-center justify-center gap-1.5 transition"
            >
              <Printer className="w-4 h-4" />
              <span>Print Passes</span>
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-lg transition"
            >
              Close Ticket Wallet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
