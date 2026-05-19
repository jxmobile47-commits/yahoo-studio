'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiZap, FiX, FiClock } from 'react-icons/fi';
import {
  detectChordsFromFile,
  type BrowserChordResult,
} from '@/services/chord-analysis/browserChordDetector';

interface QuickChordPreviewProps {
  audioFile: File | null;
  className?: string;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function QuickChordPreview({ audioFile, className = '' }: QuickChordPreviewProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BrowserChordResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  const runQuickAnalysis = useCallback(async () => {
    if (!audioFile) return;
    setIsAnalyzing(true);
    setProgress(0);
    setError(null);
    setShowPanel(true);

    try {
      const r = await detectChordsFromFile(audioFile, undefined, {
        fftSize: 4096,
        hopSize: 2048,
        smoothWindow: 9,
        onProgress: (p) => setProgress(p),
      });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quick analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  }, [audioFile]);

  return (
    <div className={className}>
      <Button
        onPress={runQuickAnalysis}
        isDisabled={!audioFile || isAnalyzing}
        size="md"
        variant="flat"
        color="warning"
        startContent={<FiZap className="w-4 h-4" />}
        className="font-medium"
      >
        {isAnalyzing ? `${(progress * 100).toFixed(0)}%` : '⚡ Quick Preview'}
      </Button>

      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-4 rounded-xl border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 p-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FiZap className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                <h3 className="text-sm font-bold text-yellow-900 dark:text-yellow-100">
                  Quick Chord Preview (Browser FFT)
                </h3>
                {result && (
                  <span className="inline-flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-300">
                    <FiClock className="w-3 h-3" />
                    {(result.processingTimeMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowPanel(false)}
                className="p-1 rounded hover:bg-yellow-200 dark:hover:bg-yellow-800/40 text-yellow-700 dark:text-yellow-300"
                aria-label="Close"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>

            {/* Disclaimer */}
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-3 italic">
              ~70% accuracy · Triads only (Major/Minor) · For instant exploration. For best
              results use the full ML analysis.
            </p>

            {/* Progress */}
            {isAnalyzing && !result && (
              <div className="space-y-2">
                <div className="h-2 rounded-full bg-yellow-200 dark:bg-yellow-900/40 overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-yellow-500 to-orange-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress * 100}%` }}
                  />
                </div>
                <p className="text-xs text-yellow-700 dark:text-yellow-300">
                  Running FFT in browser… {(progress * 100).toFixed(0)}%
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded bg-red-100 dark:bg-red-900/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                ⚠️ {error}
              </div>
            )}

            {/* Results */}
            {result && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-yellow-800 dark:text-yellow-200">
                  <span className="font-semibold">
                    {result.chords.length} chord changes
                  </span>
                  <span>·</span>
                  <span>{formatTime(result.duration)} duration</span>
                  <span>·</span>
                  <span>
                    Avg confidence:{' '}
                    {(
                      (result.chords.reduce((s, c) => s + c.confidence, 0) /
                        Math.max(1, result.chords.length)) *
                      100
                    ).toFixed(0)}
                    %
                  </span>
                </div>

                {/* Chord timeline */}
                <div className="max-h-64 overflow-y-auto rounded bg-white/50 dark:bg-black/20 p-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                    {result.chords.map((c, i) => (
                      <div
                        key={i}
                        className="flex flex-col items-center justify-center rounded-md bg-yellow-100 dark:bg-yellow-800/40 px-2 py-1.5 border border-yellow-300/50 dark:border-yellow-700/50"
                        title={`${formatTime(c.time)} — confidence ${(c.confidence * 100).toFixed(0)}%`}
                      >
                        <span className="text-sm font-bold text-yellow-900 dark:text-yellow-100">
                          {c.chord}
                        </span>
                        <span className="text-[10px] text-yellow-700 dark:text-yellow-400 font-mono">
                          {formatTime(c.time)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tip */}
                <p className="text-[11px] text-yellow-600 dark:text-yellow-400">
                  💡 Click <strong>Analyze Audio</strong> for high-accuracy ML analysis with beats,
                  7th chords, and inversions.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
