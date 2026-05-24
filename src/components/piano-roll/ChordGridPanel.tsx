'use client';

import React from 'react';

interface ChordGridPanelProps {
  chords: string[];
  romanMap: Record<string, string>;
  activeCell: number | null;
  onCellClick: (index: number, chord: string) => void;
}

export default function ChordGridPanel({ chords, romanMap, activeCell, onCellClick }: ChordGridPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Chord Progression</span>
      </div>
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="grid grid-cols-8 gap-1.5">
          {chords.map((chord, i) => (
            <button
              key={i}
              onClick={() => onCellClick(i, chord)}
              className={`
                aspect-square rounded-md flex flex-col items-center justify-center
                transition-all duration-150 min-h-[48px]
                ${
                  chord
                    ? activeCell === i
                      ? 'bg-gradient-to-br from-amber-500/30 to-yellow-500/20 border-amber-400 shadow-[0_0_16px_rgba(255,215,0,0.35)] scale-[1.02]'
                      : 'bg-gradient-to-br from-[#2e3650]/80 to-[#242b3d]/80 border border-amber-400/60 hover:border-amber-300 hover:shadow-[0_0_12px_rgba(255,215,0,0.2)] hover:-translate-y-0.5'
                    : 'bg-[#1e2435]/40 border border-white/5 hover:border-amber-400/30'
                }
              `}
            >
              {chord && (
                <>
                  <span className="text-sm font-bold text-white drop-shadow">{chord}</span>
                  {romanMap[chord] && (
                    <span className="text-[10px] text-gray-400 mt-0.5 font-medium">{romanMap[chord]}</span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
