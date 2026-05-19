'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ChordSegment {
  chord: string;
  start: number;
  end: number;
  confidence: number;
}

interface ChordDisplayProps {
  segments: ChordSegment[];
  currentTime: number;
  duration: number;
  onCorrectChord?: (segmentIndex: number, correctedChord: string) => void;
  onReportIssue?: (segmentIndex: number, issueType: string) => void;
  showConfidence?: boolean;
  isRealtime?: boolean;
}

const CHORD_COLORS: Record<string, string> = {
  'maj': 'bg-green-500',
  'min': 'bg-blue-500',
  'maj7': 'bg-emerald-500',
  'min7': 'bg-cyan-500',
  'dom7': 'bg-orange-500',
  'maj9': 'bg-teal-500',
  'min9': 'bg-indigo-500',
};

function getChordColor(chord: string): string {
  if (chord === 'N') return 'bg-gray-600';
  const quality = chord.split(':')[1] || 'maj';
  return CHORD_COLORS[quality] || 'bg-gray-500';
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function ChordDisplay({
  segments,
  currentTime,
  duration,
  onCorrectChord,
  onReportIssue,
  showConfidence = true,
  isRealtime = false,
}: ChordDisplayProps) {
  const [activeSegment, setActiveSegment] = useState<number>(-1);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [correctionInput, setCorrectionInput] = useState('');

  // Find active segment based on current time
  useEffect(() => {
    const idx = segments.findIndex(
      (s) => currentTime >= s.start && currentTime < s.end
    );
    setActiveSegment(idx);
  }, [currentTime, segments]);

  const handleCorrect = useCallback((index: number) => {
    setEditingIndex(index);
    const seg = segments[index];
    if (seg) {
      setCorrectionInput(seg.chord);
    }
  }, [segments]);

  const submitCorrection = useCallback(() => {
    if (editingIndex !== null && correctionInput && onCorrectChord) {
      onCorrectChord(editingIndex, correctionInput);
      setEditingIndex(null);
    }
  }, [editingIndex, correctionInput, onCorrectChord]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submitCorrection();
    if (e.key === 'Escape') setEditingIndex(null);
  }, [submitCorrection]);

  // Progress percentage
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="w-full max-w-4xl mx-auto bg-gray-900 rounded-xl p-6 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-bold text-white">
            {isRealtime ? '🔴 Live Chord Detection' : 'Chord Chart'}
          </h3>
          <p className="text-gray-400 text-sm">
            {isRealtime ? 'Real-time BiMamba + CRF' : 'ChordNet-2026 AI'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono text-white">
            {formatTime(currentTime)}
          </div>
          <div className="text-gray-500 text-sm">
            / {formatTime(duration)}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-gray-700 rounded-full mb-6 overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
          style={{ width: `${progress}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>

      {/* Active chord display */}
      {(() => {
        const seg = activeSegment >= 0 && activeSegment < segments.length
          ? segments[activeSegment]
          : null;
        if (!seg) return null;
        return (
          <motion.div
            key={activeSegment}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="mb-6 text-center"
          >
            <div className={`inline-block px-8 py-4 rounded-2xl ${getChordColor(seg.chord)}`}>
              <span className="text-4xl font-bold text-white">
                {seg.chord}
              </span>
            </div>
            {showConfidence && (
              <div className="mt-2 text-gray-400 text-sm">
                Confidence: {(seg.confidence * 100).toFixed(1)}%
              </div>
            )}
          </motion.div>
        );
      })()}

      {/* Chord timeline */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {segments.map((segment, index) => {
          const isActive = index === activeSegment;
          const isEditing = index === editingIndex;

          return (
            <motion.div
              key={`${segment.start}-${segment.chord}`}
              layout
              className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                isActive ? 'bg-gray-800 border-l-4 border-purple-500' : 'bg-gray-800/50'
              }`}
            >
              {/* Time */}
              <div className="text-gray-500 text-sm font-mono w-24 shrink-0">
                {formatTime(segment.start)}
              </div>

              {/* Chord badge */}
              {isEditing ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={correctionInput}
                    onChange={(e) => setCorrectionInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="px-3 py-1 bg-gray-700 text-white rounded border border-purple-500 focus:outline-none"
                    placeholder="Enter correct chord..."
                    autoFocus
                  />
                  <button
                    onClick={submitCorrection}
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-500"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => setEditingIndex(null)}
                    className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-500"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <div className={`px-3 py-1 rounded-lg text-white font-semibold ${getChordColor(segment.chord)}`}>
                    {segment.chord}
                  </div>

                  {/* Confidence bar */}
                  {showConfidence && (
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-green-400 to-green-600"
                          style={{ width: `${segment.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-gray-500 text-xs w-10">
                        {(segment.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}

                  {/* Actions */}
                  {onCorrectChord && (
                    <button
                      onClick={() => handleCorrect(index)}
                      className="text-gray-500 hover:text-yellow-400 transition-colors text-sm"
                      title="Correct this chord"
                    >
                      ✏️
                    </button>
                  )}
                  {onReportIssue && (
                    <button
                      onClick={() => onReportIssue(index, 'wrong_chord')}
                      className="text-gray-500 hover:text-red-400 transition-colors text-sm"
                      title="Report issue"
                    >
                      🚩
                    </button>
                  )}
                </>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Stats footer */}
      <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between text-gray-500 text-sm">
        <span>{segments.length} segments detected</span>
        <span>
          Avg confidence:{' '}
          {(
            (segments.reduce((s, seg) => s + seg.confidence, 0) / segments.length) * 100
          ).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
