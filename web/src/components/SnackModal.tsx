import React, { useState } from 'react';
import { ShoppingBag, Plus, Minus, ArrowRight, X } from 'lucide-react';
import { SnackItem } from '../types';

interface SnackModalProps {
  seatCode: string;
  ticketPrice: number;
  onClose: () => void;
  onConfirmSnacks: (selectedSnacks: SnackItem[], totalAmount: number) => void;
}

const DEFAULT_SNACKS: SnackItem[] = [
  {
    id: 'snack-combo-xl',
    name: 'Ultimate Blockbuster Couple Combo',
    category: 'Combos',
    price: 550,
    image_url: 'https://images.unsplash.com/photo-1585647347483-22b66260dfff?w=500&q=80',
    quantity: 0,
    badge: '🔥 BESTSELLER'
  },
  {
    id: 'snack-popcorn-caramel',
    name: 'XL Gourmet Caramel Popcorn Tub',
    category: 'Popcorn',
    price: 250,
    image_url: 'https://images.unsplash.com/photo-1578849278619-e73505e9610f?w=500&q=80',
    quantity: 0,
    badge: 'POPULAR'
  },
  {
    id: 'snack-nachos-cheese',
    name: 'Loaded Triple Cheese Nachos',
    category: 'Snacks',
    price: 280,
    image_url: 'https://images.unsplash.com/photo-1513456852971-30c0b8199d4d?w=500&q=80',
    quantity: 0
  },
  {
    id: 'snack-drink-pepsi',
    name: 'Jumbo Fountain Cold Drink (1L)',
    category: 'Drinks',
    price: 120,
    image_url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500&q=80',
    quantity: 0
  }
];

export const SnackModal: React.FC<SnackModalProps> = ({
  seatCode,
  ticketPrice,
  onClose,
  onConfirmSnacks
}) => {
  const [snacks, setSnacks] = useState<SnackItem[]>(DEFAULT_SNACKS);

  const updateQuantity = (id: string, delta: number) => {
    setSnacks(prev =>
      prev.map(s => {
        if (s.id === id) {
          const newQty = Math.max(0, s.quantity + delta);
          return { ...s, quantity: newQty };
        }
        return s;
      })
    );
  };

  const snacksTotal = snacks.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const grandTotal = ticketPrice + snacksTotal;
  const selectedCount = snacks.reduce((sum, item) => sum + item.quantity, 0);

  const handleProceed = () => {
    const chosen = snacks.filter(s => s.quantity > 0);
    onConfirmSnacks(chosen, grandTotal);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-xl max-h-[85vh] rounded-3xl border border-white/10 shadow-2xl flex flex-col relative overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-dark-800 to-dark-900 p-5 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-white text-base sm:text-lg tracking-tight font-sans flex items-center gap-2">
                <span>Cinema Concessions Bar</span>
                <span className="px-2 py-0.5 text-[10px] bg-brand-500/20 text-brand-400 font-bold rounded">
                  Seat {seatCode}
                </span>
              </h3>
              <p className="text-xs text-gray-400">Add fresh popcorn & cold drinks to your movie ticket</p>
            </div>
          </div>

          <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-dark-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Snack List Body */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 no-scrollbar">
          {snacks.map(snack => (
            <div
              key={snack.id}
              className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${
                snack.quantity > 0
                  ? 'bg-dark-800/90 border-brand-500/60 shadow-lg shadow-brand-500/10'
                  : 'bg-dark-800/50 border-gray-800 hover:border-gray-700'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 border border-gray-700 relative">
                  <img src={snack.image_url} alt={snack.name} className="w-full h-full object-cover" />
                  {snack.badge && (
                    <span className="absolute top-1 left-1 bg-amber-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded shadow">
                      {snack.badge}
                    </span>
                  )}
                </div>

                <div>
                  <h4 className="font-bold text-white text-sm font-sans">{snack.name}</h4>
                  <p className="text-xs text-brand-400 font-extrabold font-mono mt-0.5">৳{snack.price}</p>
                </div>
              </div>

              {/* Quantity Counter Controls */}
              <div className="flex items-center gap-2 bg-dark-900/90 p-1.5 rounded-xl border border-gray-700">
                <button
                  onClick={() => updateQuantity(snack.id, -1)}
                  disabled={snack.quantity === 0}
                  className="w-8 h-8 rounded-lg bg-dark-800 hover:bg-dark-700 text-gray-300 flex items-center justify-center disabled:opacity-30 transition"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>

                <span className="w-6 text-center font-bold text-white text-sm font-mono">{snack.quantity}</span>

                <button
                  onClick={() => updateQuantity(snack.id, 1)}
                  className="w-8 h-8 rounded-lg bg-brand-600 hover:bg-brand-500 text-white flex items-center justify-center transition shadow"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer Breakdown & Action Buttons */}
        <div className="bg-dark-900/90 p-5 border-t border-gray-800 space-y-4 shrink-0">
          <div className="flex items-center justify-between text-xs text-gray-300 font-semibold border-b border-gray-800 pb-3">
            <span>Ticket (Seat {seatCode}): <strong className="text-white">৳{ticketPrice}</strong></span>
            <span>Snacks ({selectedCount} items): <strong className="text-amber-400">৳{snacksTotal}</strong></span>
            <span className="text-sm font-black text-brand-400">Total: ৳{grandTotal}</span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => onConfirmSnacks([], ticketPrice)}
              className="px-4 py-3 rounded-xl bg-dark-800 hover:bg-dark-700 text-gray-300 font-bold text-xs border border-gray-700 transition"
            >
              Skip Snacks (৳{ticketPrice})
            </button>

            <button
              onClick={handleProceed}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white font-extrabold text-xs shadow-lg shadow-brand-500/30 flex items-center justify-center gap-2 transition transform hover:scale-105 active:scale-95"
            >
              <span>Proceed to Payment (৳{grandTotal})</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
