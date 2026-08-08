import React, { useState } from 'react';
import { MapPin, X, Building2, Check, Sparkles, Navigation } from 'lucide-react';
import { CinemaBranch } from '../types';

export const CINEMA_BRANCHES: CinemaBranch[] = [
  {
    id: 'theatre-cuet',
    name: 'CUET Grand Cinema',
    city: 'Chittagong',
    location: 'CUET Campus, Raozan, Chittagong',
    formats: ['IMAX 3D', 'Dolby Atmos', 'VIP Lounge'],
    totalScreens: 3
  },
  {
    id: 'theatre-gec',
    name: 'GEC Circle Cineplex',
    city: 'Chittagong',
    location: 'GEC Circle, Nasirabad, Chittagong',
    formats: ['4DX Motion', 'Dolby Atmos'],
    totalScreens: 4
  },
  {
    id: 'theatre-agrabad',
    name: 'Agrabad Star Theatre',
    city: 'Chittagong',
    location: 'Agrabad Commercial Area, Chittagong',
    formats: ['VIP Luxe', '3D Digital'],
    totalScreens: 2
  },
  {
    id: 'theatre-bashundhara',
    name: 'Star Cineplex Bashundhara',
    city: 'Dhaka',
    location: 'Bashundhara City Shopping Mall, Panthapath',
    formats: ['IMAX Laser', 'Dolby Atmos', 'VIP Platinum'],
    totalScreens: 8
  },
  {
    id: 'theatre-jamuna',
    name: 'Jamuna Blockbuster Cinemas',
    city: 'Dhaka',
    location: 'Jamuna Future Park, Kuril, Dhaka',
    formats: ['4DX Motion', 'IMAX 3D', 'Gold Class'],
    totalScreens: 7
  },
  {
    id: 'theatre-mirpur',
    name: 'Sony Square Cineplex',
    city: 'Dhaka',
    location: 'Sony Square, Mirpur 2, Dhaka',
    formats: ['Dolby Atmos', 'VIP Luxe'],
    totalScreens: 3
  },
  {
    id: 'theatre-sylhet',
    name: 'Sylhet Grand Cineplex',
    city: 'Sylhet',
    location: 'Zindabazar Central, Sylhet',
    formats: ['IMAX 3D', 'Dolby Surround'],
    totalScreens: 3
  }
];

interface BranchSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBranch: CinemaBranch;
  onSelectBranch: (branch: CinemaBranch) => void;
}

export const BranchSelectorModal: React.FC<BranchSelectorModalProps> = ({
  isOpen,
  onClose,
  selectedBranch,
  onSelectBranch
}) => {
  const [activeCityFilter, setActiveCityFilter] = useState<string>('All');

  if (!isOpen) return null;

  const cities = ['All', 'Chittagong', 'Dhaka', 'Sylhet'];

  const filteredBranches = activeCityFilter === 'All'
    ? CINEMA_BRANCHES
    : CINEMA_BRANCHES.filter(b => b.city === activeCityFilter);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-2xl max-h-[90vh] rounded-3xl border border-brand-500/40 shadow-2xl flex flex-col relative overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-dark-800 to-dark-900 p-5 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand-600/20 text-brand-400 border border-brand-500/30">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-white text-base sm:text-lg tracking-tight font-sans">
                Select Cinema Location & City
              </h3>
              <p className="text-xs text-gray-400">Choose your preferred cinema branch for live seat availability</p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-dark-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* City Filter Pills */}
        <div className="px-5 pt-4 pb-2 border-b border-gray-800/80 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
          <span className="text-[10px] uppercase font-bold text-gray-500 mr-1 hidden xs:inline">City:</span>
          {cities.map(city => (
            <button
              key={city}
              onClick={() => setActiveCityFilter(city)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition shrink-0 ${
                activeCityFilter === city
                  ? 'bg-brand-600 text-white shadow-md shadow-brand-500/30'
                  : 'bg-dark-800 text-gray-400 hover:text-white hover:bg-dark-700 border border-gray-800'
              }`}
            >
              {city}
            </button>
          ))}
        </div>

        {/* Branch List Grid */}
        <div className="p-5 sm:p-6 space-y-3 overflow-y-auto flex-1 no-scrollbar">
          {filteredBranches.map(branch => {
            const isSelected = selectedBranch.id === branch.id;
            return (
              <div
                key={branch.id}
                onClick={() => {
                  onSelectBranch(branch);
                  onClose();
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                  isSelected
                    ? 'bg-brand-950/60 border-brand-500 shadow-lg shadow-brand-500/20'
                    : 'glass-card border-white/10 hover:border-brand-500/40 hover:bg-dark-800/80'
                }`}
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-extrabold text-white text-sm sm:text-base">{branch.name}</h4>
                    <span className="px-2 py-0.5 text-[10px] font-black rounded bg-dark-800 text-amber-300 border border-amber-500/30">
                      {branch.city}
                    </span>
                    {isSelected && (
                      <span className="px-2 py-0.5 text-[10px] font-black rounded bg-brand-500 text-white flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <span>Active</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                    <span>{branch.location}</span>
                  </p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {branch.formats.map((fmt, idx) => (
                      <span key={idx} className="px-2 py-0.5 rounded-md bg-dark-900 text-[10px] font-semibold text-gray-300 border border-gray-700">
                        {fmt}
                      </span>
                    ))}
                    <span className="px-2 py-0.5 rounded-md bg-dark-900 text-[10px] font-semibold text-brand-400 border border-gray-700">
                      {branch.totalScreens} Screens
                    </span>
                  </div>
                </div>

                <div className="shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center border transition ${
                    isSelected
                      ? 'bg-brand-600 border-brand-400 text-white shadow-md'
                      : 'border-gray-700 text-gray-500 hover:border-gray-500'
                  }`}>
                    <Check className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="bg-dark-900/90 p-4 border-t border-gray-800 flex items-center justify-between shrink-0">
          <p className="text-xs text-gray-400">
            Selected: <strong className="text-white">{selectedBranch.name} ({selectedBranch.city})</strong>
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-dark-800 hover:bg-dark-700 text-gray-200 font-bold text-xs border border-gray-700 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
