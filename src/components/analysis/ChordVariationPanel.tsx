'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateMagentaStyleVariations, ChordVariation } from '@/utils/chordStyling';
import { useTheme } from '@/contexts/ThemeContext';

interface ChordVariationPanelProps {
  chords: string[];
  className?: string;
}

function ChordBadge({ chord }: { chord: string }) {
  const isEmpty = !chord || chord === '' || chord === 'N.C.' || chord === 'N' || chord === 'N/C';
  return (
    <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-semibold min-w-[1.5rem] ${
      isEmpty
        ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
        : 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700/50'
    }`}>
      {isEmpty ? '–' : chord}
    </span>
  );
}

export default function ChordVariationPanel({ chords, className = '' }: ChordVariationPanelProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [isOpen, setIsOpen] = useState(false);
  const [selectedVariation, setSelectedVariation] = useState<number | null>(null);

  // Filter out empty/padding chords for variation generation
  const effectiveChords = useMemo(() => {
    return chords.filter(c => c && c !== '' && c !== 'N.C.' && c !== 'N' && c !== 'N/C');
  }, [chords]);

  const variations = useMemo(() => {
    if (effectiveChords.length === 0) return [];
    // Deduplicate consecutive identical chords to get a progression
    const progression: string[] = [];
    let last = '';
    for (const chord of effectiveChords) {
      const base = chord.replace(/maj7|7|6|9|:.*$|\/.*$/, '').trim();
      if (base !== last) {
        progression.push(base);
        last = base;
      }
    }
    if (progression.length < 2) return [];
    return generateMagentaStyleVariations(progression, 3);
  }, [effectiveChords]);

  if (variations.length === 0) return null;

  return (
    <div className={`mt-3 ${className}`}>
      <button
        onClick={() => setIsOpen(v => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
          isOpen
            ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700/50 shadow-md'
            : 'bg-white dark:bg-[#1E252E] border-gray-200 dark:border-gray-600/60 shadow-sm hover:shadow-md'
        }`}
      >
        <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
        <span className={`text-xs font-semibold ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
          Magenta AI Variations
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">
          ({variations.length} suggestions)
        </span>
        <div className="flex-1" />
        <span className={`text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-2">
              {variations.map((variation, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08, duration: 0.3 }}
                  onClick={() => setSelectedVariation(selectedVariation === idx ? null : idx)}
                  className={`rounded-xl border p-3 cursor-pointer transition-all ${
                    selectedVariation === idx
                      ? 'bg-purple-50/80 dark:bg-purple-900/20 border-purple-300 dark:border-purple-600/60 shadow-md'
                      : 'bg-white dark:bg-[#1E252E] border-gray-200 dark:border-gray-600/40 shadow-sm hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300">
                        #{idx + 1}
                      </span>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                        {variation.description}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-purple-500"
                          style={{ width: `${variation.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 w-8 text-right">
                        {Math.round(variation.confidence * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {variation.progression.map((chord, cidx) => (
                      <ChordBadge key={cidx} chord={chord} />
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
