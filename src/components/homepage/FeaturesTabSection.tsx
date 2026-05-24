'use client';

import { useState, useEffect, useMemo } from 'react';
import { Tabs, Tab, Tooltip } from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';
import HeroPianoVisualizerMock from '@/components/homepage/HeroPianoVisualizerMock';

// ============================================================
// Mock Data
// ============================================================

const MEASURES: string[][] = [
  ['C', 'C', 'C', 'C'],
  ['Am', 'Am', 'Am', 'Am'],
  ['F', 'F', 'F', 'F'],
  ['G', 'G', 'G', 'G'],
  ['C', 'C', 'C', 'C'],
  ['Em', 'Em', 'Am', 'Am'],
  ['F', 'F', 'G', 'G'],
  ['C', 'C', 'C', 'C'],
  ['Dm', 'Dm', 'Dm', 'Dm'],
  ['G', 'G', 'G7', 'G7'],
  ['Am', 'Am', 'F', 'F'],
  ['G', 'G', 'C', ''],
];

const ROMAN: Record<string, string> = {
  C: 'I', Am: 'vi', F: 'IV', G: 'V', Dm: 'ii', Em: 'iii', G7: 'V⁷',
};

const TOTAL_BEATS = MEASURES.reduce((s, m) => s + m.length, 0);
const BEAT_INTERVAL_MS = 800;

// Flat chord list for quick lookup
const FLAT_CHORDS: string[] = MEASURES.flat();

// Unique chord progression (consecutive duplicates collapsed)
interface ProgressionEntry { chord: string; startBeat: number }
const UNIQUE_PROGRESSION: ProgressionEntry[] = (() => {
  const result: ProgressionEntry[] = [];
  let last = '';
  FLAT_CHORDS.forEach((chord, i) => {
    if (chord && chord !== last) {
      result.push({ chord, startBeat: i });
      last = chord;
    }
  });
  return result;
})();

const CHORD_SHAPES: Record<string, number[]> = {
  C: [-1, 3, 2, 0, 1, 0], Am: [-1, 0, 2, 2, 1, 0],
  F: [1, 3, 3, 2, 1, 1], G: [3, 2, 0, 0, 0, 3],
  Dm: [-1, -1, 0, 2, 3, 1], Em: [0, 2, 2, 0, 0, 0],
  G7: [3, 2, 0, 0, 0, 1],
};

interface LyricWord { text: string; chord?: string }
interface MockLyricLine { section?: string; words: LyricWord[]; beatRange: [number, number] }

const LYRIC_LINES: MockLyricLine[] = [
  { section: 'Verse',
    words: [{ text: 'Sunlight', chord: 'C' }, { text: ' on the ' }, { text: 'water,', chord: 'Am' }, { text: ' morning breeze' }],
    beatRange: [0, 8] },
  { words: [{ text: 'Colors', chord: 'F' }, { text: ' paint the ' }, { text: 'sky', chord: 'G' }, { text: ' as darkness flees' }],
    beatRange: [8, 16] },
  { section: 'Chorus',
    words: [{ text: 'Oh,', chord: 'C' }, { text: ' we ' }, { text: 'dance', chord: 'Em' }, { text: ' beneath the sky' }],
    beatRange: [16, 24] },
  { words: [{ text: 'Stars', chord: 'F' }, { text: ' will ' }, { text: 'guide', chord: 'Dm' }, { text: ' us through the ' }, { text: 'night', chord: 'G' }],
    beatRange: [24, 32] },
  { words: [{ text: 'Hold', chord: 'C' }, { text: ' on ' }, { text: 'tight,', chord: 'Am' }, { text: " we'll be " }, { text: 'alright', chord: 'F' }],
    beatRange: [32, 40] },
];

const TAB_CONTENT = {
  'chord-grid': {
    title: 'Beat & Chord Grid',
    description: 'Real-time chord progression visualization synchronized with audio playback and optional song section overlays.',
    features: [
      { text: 'AI-powered chord detection with multiple models (Chord-CNN-LSTM, BTC)', color: 'blue' },
      { text: 'Beat-aligned grid with automatic time signature detection', color: 'blue' },
      { text: 'Roman numeral analysis & key detection via Gemini AI', color: 'blue' },
      { text: 'Song segmentation overlay for intro, verse, chorus, bridge, and outro', color: 'blue' },
      { text: 'Interactive click-to-seek playback navigation', color: 'blue' },
    ],
  },
  guitar: {
    title: 'Guitar Chord Diagrams',
    description: 'Interactive guitar fingering charts with accurate voicings from the official chord database.',
    features: [
      { text: 'Verified fingering patterns with multiple chord positions', color: 'green' },
      { text: 'Animated chord progression synced with audio playback', color: 'green' },
      { text: 'Responsive layout adapting to any screen size', color: 'green' },
      { text: 'To be updated ...', color: 'green' },
    ],
  },
  lyrics: {
    title: 'Lead Sheet & Lyrics',
    description: 'Synchronized lyrics with chord annotations and external-AI translation support.',
    features: [
      { text: 'Word-level timing synchronization via Music.ai', color: 'purple' },
      { text: 'Chords positioned precisely above corresponding words', color: 'purple' },
      { text: 'Multi-language translation powered by Gemini AI', color: 'purple' },
      { text: 'AI chat assistant for contextual music theory Q&A', color: 'purple' },
    ],
  },
  'piano-visualizer': {
    title: 'Piano Visualizer & MIDI Export',
    description: 'Interactive piano roll visualization with falling notes synced to chord progressions and multi-instrument support.',
    features: [
      { text: 'Falling notes visualization with real-time chord playback', color: 'orange' },
      { text: 'Full 88-key piano keyboard with active note highlighting', color: 'orange' },
      { text: 'Multi-instrument support: Piano, Guitar, Violin, Flute, Bass', color: 'orange' },
      { text: 'One-click MIDI export of chord progressions', color: 'orange' },
      { text: 'To be updated ...', color: 'orange' },
    ],
  },
  'vocal-synth': {
    title: 'Vocal Synth Studio',
    description: 'Web-based singing voice synthesis inspired by OpenUtau. Create vocal melodies with a piano roll editor and real-time audio preview.',
    features: [
      { text: 'Interactive piano roll editor for composing vocal melodies', color: 'pink' },
      { text: 'Lyrics & phoneme input per note with multi-language support', color: 'pink' },
      { text: 'Real-time Web Audio synthesis with multiple waveforms', color: 'pink' },
      { text: 'MIDI import/export for interoperability with DAWs', color: 'pink' },
      { text: 'Vibrato and expression controls for expressive vocal tuning', color: 'pink' },
    ],
  },
  'stem-separation': {
    title: 'Stem Separation Studio',
    description: 'HTDemucs (Meta AI) audio source separation. Isolate vocals, drums, bass, guitar, piano and other with Transformer-based AI.',
    features: [
      { text: '6-stem separation: vocals, drums, bass, guitar, piano, other', color: 'cyan' },
      { text: 'Powered by HTDemucs v4 — Transformer architecture like ChatGPT for audio', color: 'cyan' },
      { text: 'Local Python backend + browser DSP fallback', color: 'cyan' },
      { text: 'DAW-style waveform editor with per-stem lanes', color: 'cyan' },
      { text: 'Download each stem as individual WAV file', color: 'cyan' },
    ],
  },
  'beat-maker': {
    title: 'Beat Maker Studio',
    description: 'ADTLib-inspired drum transcription with FL Studio-style step sequencer. Auto-detect drum onsets from audio and create beats.',
    features: [
      { text: 'Automatic drum onset detection (kick, snare, hihat, tom)', color: 'green' },
      { text: '32-step sequencer with 8 drum channels', color: 'green' },
      { text: 'Web Audio drum synthesis (no samples needed)', color: 'green' },
      { text: 'Per-channel volume, mute, solo, and pan', color: 'green' },
      { text: 'Pattern export/import as JSON', color: 'green' },
    ],
  },
};

const SEGMENT_DEMO_SECTIONS = [
  { key: 'intro', label: 'Intro', startMeasure: 0, endMeasure: 1, badge: 'border-slate-400/50 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-200', cell: 'bg-slate-100/80 dark:bg-slate-500/10' },
  { key: 'verse', label: 'Verse', startMeasure: 2, endMeasure: 4, badge: 'border-emerald-400/50 bg-emerald-100 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200', cell: 'bg-emerald-100/80 dark:bg-emerald-500/10' },
  { key: 'pre', label: 'Pre-Chorus', startMeasure: 5, endMeasure: 5, badge: 'border-orange-400/50 bg-orange-100 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-200', cell: 'bg-orange-100/80 dark:bg-orange-500/10' },
  { key: 'chorus', label: 'Chorus', startMeasure: 6, endMeasure: 8, badge: 'border-rose-400/50 bg-rose-100 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200', cell: 'bg-rose-100/80 dark:bg-rose-500/10' },
  { key: 'bridge', label: 'Bridge', startMeasure: 9, endMeasure: 9, badge: 'border-violet-400/50 bg-violet-100 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200', cell: 'bg-violet-100/80 dark:bg-violet-500/10' },
  { key: 'outro', label: 'Outro', startMeasure: 10, endMeasure: 11, badge: 'border-sky-400/50 bg-sky-100 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200', cell: 'bg-sky-100/80 dark:bg-sky-500/10' },
];

function getSegmentForMeasure(measureIndex: number) {
  return SEGMENT_DEMO_SECTIONS.find(
    section => measureIndex >= section.startMeasure && measureIndex <= section.endMeasure,
  );
}

// ============================================================
// Shared helpers
// ============================================================

function useBeatAnimation() {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setBeat((p) => (p + 1) % TOTAL_BEATS), BEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  return beat;
}

function useProgressionIndex(beat: number): number {
  return useMemo(() => {
    for (let i = UNIQUE_PROGRESSION.length - 1; i >= 0; i--) {
      if (beat >= UNIQUE_PROGRESSION[i].startBeat) return i;
    }
    return 0;
  }, [beat]);
}

// ============================================================
// Shared chord grid — labels only on chord changes
// ============================================================

function ChordGrid({
  isDark, currentBeat, showRomanNumerals, measures, showSegmentation = false,
}: {
  isDark: boolean; currentBeat: number; showRomanNumerals: boolean; measures: string[][]; showSegmentation?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-1 gap-y-1 md:grid-cols-3 lg:grid-cols-4">
      {measures.map((measure, mIdx) => {
        const section = getSegmentForMeasure(mIdx);
        const showSectionBadge = showSegmentation && section && section.startMeasure === mIdx;

        return (
          <div key={mIdx} className="min-w-0 px-[2px]">
            {showSegmentation && (
              <div className="mb-1 flex h-6 items-center">
                {section && showSectionBadge ? (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${section.badge}`}>
                    {section.label}
                  </span>
                ) : null}
              </div>
            )}
            <div className={`grid grid-cols-4 gap-[2px] border-l-[3px] pl-1 ${
              isDark ? 'border-gray-500/60' : 'border-gray-400'
            }`}>
              {measure.map((chord, beatIdx) => {
                const globalIdx = mIdx * 4 + beatIdx;
                const isHighlighted = globalIdx === currentBeat;
                const isEmpty = !chord;

                const prevChord = globalIdx > 0
                  ? measures[Math.floor((globalIdx - 1) / 4)]?.[(globalIdx - 1) % 4] || ''
                  : '';
                const showLabel = !!chord && chord !== prevChord;
                const roman = showLabel ? ROMAN[chord] : undefined;

                return (
                  <div
                    key={beatIdx}
                    className={`flex flex-col items-center justify-center rounded-sm border transition-all duration-150 ${
                      showRomanNumerals ? 'aspect-[1/1.25]' : 'aspect-square'
                    } ${
                      isHighlighted
                        ? isDark
                          ? 'bg-blue-800 border-blue-400 text-blue-100'
                          : 'bg-blue-100 border-blue-600 text-blue-900'
                        : isEmpty
                          ? isDark ? 'bg-[#111720]/80 border-gray-600/40' : 'bg-gray-100 border-gray-300'
                          : showSegmentation && section
                            ? `${section.cell} ${isDark ? 'border-gray-600/50 text-gray-200' : 'border-gray-300 text-gray-900'}`
                            : isDark ? 'bg-[#111720] border-gray-600/50 text-gray-200' : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  >
                    {showLabel && (
                      <span className="font-varela text-[10px] leading-none sm:text-xs lg:text-sm">
                        {chord}
                      </span>
                    )}
                    {showRomanNumerals && roman && (
                      <span className={`mt-0.5 font-varela font-semibold leading-none ${
                        isHighlighted ? 'text-blue-200 dark:text-blue-200' : 'text-blue-700 dark:text-blue-300'
                      }`} style={{ fontSize: '8px' }}>
                        {roman}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Mockup: Beat & Chord Grid (with Roman numeral toggle)
// ============================================================

function ChordGridMockup({ isDark, currentBeat }: { isDark: boolean; currentBeat: number }) {
  const [showRoman, setShowRoman] = useState(false);
  const [showSegmentation, setShowSegmentation] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`rounded-xl p-3 sm:p-4 border shadow-lg ${
        isDark ? 'bg-[#1E252E] border-gray-600/60' : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
        <h4 className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
          Chord Progression
        </h4>
        <div className="flex items-center gap-2">
          <Tooltip content="Toggle Roman Numeral Analysis" placement="top">
            <button
              onClick={() => setShowRoman((v) => !v)}
              className={`rounded-lg px-2 py-0.5 text-xs font-medium border transition-colors cursor-pointer ${
                showRoman
                  ? isDark
                    ? 'bg-purple-800/40 border-purple-400 text-purple-100'
                    : 'bg-purple-50 border-purple-300 text-purple-800'
                  : isDark
                    ? 'bg-gray-700/40 border-gray-500 text-gray-400 hover:border-purple-400 hover:text-purple-300'
                    : 'bg-gray-50 border-gray-300 text-gray-500 hover:border-purple-300 hover:text-purple-700'
              }`}
            >Roman</button>
          </Tooltip>
          <Tooltip content="Preview song segmentation overlays" placement="top">
            <button
              onClick={() => setShowSegmentation((v) => !v)}
              className={`rounded-lg px-2 py-0.5 text-xs font-medium border transition-colors cursor-pointer ${
                showSegmentation
                  ? isDark
                    ? 'bg-emerald-800/40 border-emerald-400 text-emerald-100'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : isDark
                    ? 'bg-gray-700/40 border-gray-500 text-gray-400 hover:border-emerald-400 hover:text-emerald-300'
                    : 'bg-gray-50 border-gray-300 text-gray-500 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >Segments</button>
          </Tooltip>
          <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${
            isDark ? 'bg-blue-800/40 border border-blue-400 text-blue-50' : 'bg-blue-50 border border-blue-200 text-blue-800'
          }`}>Time: 4/4</span>
          <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${
            isDark ? 'bg-green-800/40 border border-green-400 text-green-50' : 'bg-green-50 border border-green-200 text-green-800'
          }`}>Key: C Major</span>
        </div>
      </div>
      <ChordGrid
        isDark={isDark}
        currentBeat={currentBeat}
        showRomanNumerals={showRoman}
        measures={MEASURES}
        showSegmentation={showSegmentation}
      />
      {showSegmentation && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SEGMENT_DEMO_SECTIONS.map((section) => (
            <span key={section.key} className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${section.badge}`}>
              {section.label}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ============================================================
// Mockup: Guitar Chord Diagrams (animated sliding window)
// ============================================================

function MiniChordDiagram({ frets, name, isActive, isDark }: {
  frets: number[]; name: string; isActive: boolean; isDark: boolean;
}) {
  const w = 52, h = 64;
  const pad = { top: 13, side: 7, bottom: 2 };
  const stringSp = (w - pad.side * 2) / 5;
  const fretSp = (h - pad.top - pad.bottom) / 4;
  const stroke = isDark ? '#e5e7eb' : '#6b7280';
  const dot = isActive ? '#3b82f6' : isDark ? '#d1d5db' : '#374151';

  return (
    <div className="flex flex-col items-center">
      <div className={`rounded-lg p-1 transition-colors duration-300 ${
        isActive
          ? isDark ? 'bg-blue-900/40 border border-blue-500/50' : 'bg-blue-50 border border-blue-200'
          : 'border border-transparent'
      }`}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <line x1={pad.side} y1={pad.top} x2={w - pad.side} y2={pad.top} stroke={stroke} strokeWidth="2.5" />
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={`s${i}`} x1={pad.side + stringSp * i} y1={pad.top} x2={pad.side + stringSp * i} y2={h - pad.bottom} stroke={stroke} strokeWidth="0.8" opacity="0.5" />
          ))}
          {Array.from({ length: 4 }).map((_, i) => (
            <line key={`f${i}`} x1={pad.side} y1={pad.top + fretSp * (i + 1)} x2={w - pad.side} y2={pad.top + fretSp * (i + 1)} stroke={stroke} strokeWidth="0.6" opacity="0.4" />
          ))}
          {frets.map((fret, i) => {
            const x = pad.side + stringSp * i;
            if (fret === -1) return <text key={`d${i}`} x={x} y={pad.top - 3} textAnchor="middle" fontSize="6" fill={stroke}>×</text>;
            if (fret === 0) return <circle key={`d${i}`} cx={x} cy={pad.top - 5} r="2" fill="none" stroke={stroke} strokeWidth="1" />;
            return <circle key={`d${i}`} cx={x} cy={pad.top + fretSp * (fret - 0.5)} r="3" fill={dot} />;
          })}
        </svg>
      </div>
      <span className={`font-varela text-[10px] sm:text-xs mt-0.5 transition-colors duration-300 ${
        isActive ? 'text-blue-500 dark:text-blue-400 font-semibold' : isDark ? 'text-gray-500' : 'text-gray-400'
      }`}>{name}</span>
    </div>
  );
}

function GuitarMockup({ isDark, currentBeat }: { isDark: boolean; currentBeat: number }) {
  const progIdx = useProgressionIndex(currentBeat);

  const VISIBLE_COUNT = 5;
  const CENTER_OFFSET = 2;
  const visibleWindow = useMemo(() => {
    let start = Math.max(0, progIdx - CENTER_OFFSET);
    const end = Math.min(UNIQUE_PROGRESSION.length, start + VISIBLE_COUNT);
    if (end - start < VISIBLE_COUNT) start = Math.max(0, end - VISIBLE_COUNT);
    return UNIQUE_PROGRESSION.slice(start, end);
  }, [progIdx]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`rounded-xl p-3 sm:p-4 border shadow-lg space-y-3 ${
        isDark ? 'bg-[#1E252E] border-gray-600/60' : 'bg-white border-gray-200'
      }`}
    >
      <div>
        <h4 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
          Chord Progression
        </h4>
        <ChordGrid isDark={isDark} currentBeat={currentBeat} showRomanNumerals={false} measures={MEASURES} />
      </div>

      <div className={`border-t ${isDark ? 'border-gray-600/40' : 'border-gray-200'}`} />

      <div>
        <h4 className={`text-sm font-semibold mb-2 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
          Guitar Chord Diagrams
        </h4>
        <div className="flex justify-center items-end gap-1 sm:gap-2 md:gap-3 min-h-[90px]">
          <AnimatePresence mode="popLayout">
            {visibleWindow.map((entry) => {
              const isCurrent = entry === UNIQUE_PROGRESSION[progIdx];
              return (
                <motion.div
                  key={`${entry.chord}-${entry.startBeat}`}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: isCurrent ? 1.12 : 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  style={{ opacity: isCurrent ? 1 : 0.5 }}
                >
                  <MiniChordDiagram
                    name={entry.chord}
                    frets={CHORD_SHAPES[entry.chord] || [0, 0, 0, 0, 0, 0]}
                    isActive={isCurrent}
                    isDark={isDark}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// Mockup: Lyrics & Chord Sync
// ============================================================

function LyricsMockup({ isDark, currentBeat }: { isDark: boolean; currentBeat: number }) {
  const activeIdx = LYRIC_LINES.findIndex(
    (l) => currentBeat >= l.beatRange[0] && currentBeat < l.beatRange[1]
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`rounded-xl p-3 sm:p-4 border shadow-lg ${
        isDark ? 'bg-[#1E252E] border-gray-600/60' : 'bg-white border-gray-200'
      }`}
    >
      <h4 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>
        Lead Sheet
      </h4>
      <div className="space-y-0.5">
        {LYRIC_LINES.map((line, idx) => {
          const isActive = idx === activeIdx;
          const isPast = idx < activeIdx;
          const lineProgress = isActive
            ? Math.min(1, (currentBeat - line.beatRange[0]) / (line.beatRange[1] - line.beatRange[0]))
            : 0;
          const totalChars = line.words.reduce((s, w) => s + w.text.length, 0);
          const colorPos = isActive ? Math.floor(lineProgress * totalChars) : 0;

          return (
            <div key={idx}>
              {line.section && (
                <div className="mb-1.5 mt-2 first:mt-0">
                  <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wide ${
                    isDark ? 'bg-[#111720] border border-gray-600 text-gray-400' : 'bg-gray-100 border border-gray-300 text-gray-500'
                  }`}>{line.section}</span>
                </div>
              )}
              <motion.div
                animate={{
                  backgroundColor: isActive
                    ? isDark ? 'rgba(30, 64, 175, 0.15)' : 'rgba(219, 234, 254, 0.7)'
                    : 'transparent',
                  borderLeftColor: isActive
                    ? isDark ? '#3b82f6' : '#60a5fa'
                    : 'transparent',
                  scale: isActive ? 1.01 : 1,
                }}
                transition={{ duration: 0.3 }}
                className="px-2 sm:px-3 py-1.5 rounded-md border-l-3 border-transparent"
              >
                <div className="flex flex-wrap">
                  {(() => {
                    let off = 0;
                    return line.words.map((word, wi) => {
                      const start = off;
                      off += word.text.length;
                      return (
                        <div key={wi} className="relative inline-flex flex-col justify-end" style={{ whiteSpace: 'pre-wrap' }}>
                          {word.chord && (
                            <div className="relative mb-0.5">
                              <span className={`font-varela text-[10px] sm:text-xs font-semibold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                                {word.chord}
                              </span>
                              <div className="absolute bottom-0 left-0 right-0 h-px" style={{ backgroundColor: isDark ? '#475569' : '#94a3b8' }} />
                            </div>
                          )}
                          <span className={`text-xs sm:text-sm ${word.chord ? 'font-medium' : ''}`}>
                            {isActive ? (
                              word.text.split('').map((ch, ci) => {
                                const played = (start + ci) < colorPos;
                                return (
                                  <span key={ci} style={{
                                    color: played ? (isDark ? '#60a5fa' : '#2563eb') : (isDark ? '#d1d5db' : '#374151'),
                                    transition: 'color 80ms',
                                  }}>{ch}</span>
                                );
                              })
                            ) : (
                              <span style={{
                                color: isPast ? (isDark ? '#60a5fa' : '#2563eb') : (isDark ? '#6b7280' : '#9ca3af'),
                                transition: 'color 0.4s',
                              }}>{word.text}</span>
                            )}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </motion.div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ============================================================
// Mockup: Piano Visualizer (falling notes + keyboard)
// ============================================================

function PianoVisualizerMockup() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <HeroPianoVisualizerMock
        preset="feature"
        className="mx-auto w-full max-w-[46rem] lg:max-w-[50rem]"
      />
    </motion.div>
  );
}

// ============================================================
// Mockup: Vocal Synth Piano Roll (OpenUtau-inspired)
// ============================================================

interface VocalNote { pitch: number; start: number; duration: number; lyric: string }

const VOCAL_DEMO_NOTES: VocalNote[] = [
  { pitch: 72, start: 0, duration: 2, lyric: 'き' },
  { pitch: 74, start: 2, duration: 1, lyric: 'ら' },
  { pitch: 76, start: 3, duration: 1, lyric: 'き' },
  { pitch: 77, start: 4, duration: 2, lyric: 'ら' },
  { pitch: 79, start: 6, duration: 2, lyric: 'ひ' },
  { pitch: 77, start: 8, duration: 1, lyric: 'か' },
  { pitch: 76, start: 9, duration: 1, lyric: 'る' },
  { pitch: 74, start: 10, duration: 2, lyric: 'よ' },
  { pitch: 72, start: 12, duration: 2, lyric: 'る' },
  { pitch: 71, start: 14, duration: 1, lyric: 'も' },
  { pitch: 72, start: 15, duration: 1, lyric: '' },
];

const PITCH_LABELS = ['B4', 'A#4', 'A4', 'G#4', 'G4', 'F#4', 'F4', 'E4', 'D#4', 'D4', 'C#4', 'C4', 'B3'];
const PITCH_BASE = 83; // B4

function VocalSynthMockup({ isDark, currentBeat }: { isDark: boolean; currentBeat: number }) {
  const playheadPos = (currentBeat % 16);
  const totalCols = 16;
  const pitchRows = PITCH_LABELS.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`rounded-xl border shadow-lg overflow-hidden ${
        isDark ? 'bg-[#1E252E] border-gray-600/60' : 'bg-white border-gray-200'
      }`}
    >
      {/* Toolbar */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${
        isDark ? 'border-gray-600/40 bg-[#181e27]' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
          isDark ? 'bg-pink-900/40 border border-pink-500/50 text-pink-200' : 'bg-pink-50 border border-pink-200 text-pink-700'
        }`}>
          <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
          Vocal Synth
        </div>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>BPM: 120</span>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>4/4</span>
        <div className="flex-1" />
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
        }`}>Sine</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          isDark ? 'bg-purple-900/40 border border-purple-500/40 text-purple-300' : 'bg-purple-50 border border-purple-200 text-purple-600'
        }`}>Vibrato</span>
      </div>

      <div className="flex">
        {/* Pitch labels */}
        <div className={`flex flex-col border-r ${isDark ? 'border-gray-600/40' : 'border-gray-200'}`}>
          {PITCH_LABELS.map((label, i) => (
            <div key={label} className={`flex items-center justify-end pr-1.5 text-[9px] font-mono ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`} style={{ height: 22, width: 36 }}>
              <span className={label.includes('#') ? 'opacity-50' : ''}>{label}</span>
            </div>
          ))}
        </div>

        {/* Piano roll grid */}
        <div className="flex-1 relative overflow-hidden">
          <svg width="100%" viewBox={`0 0 ${totalCols * 32} ${pitchRows * 22}`} className="block">
            {/* Grid lines */}
            {Array.from({ length: pitchRows }).map((_, row) => (
              <g key={`row-${row}`}>
                <rect
                  x={0} y={row * 22} width={totalCols * 32} height={22}
                  fill={PITCH_LABELS[row].includes('#')
                    ? (isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)')
                    : 'transparent'}
                />
                <line x1={0} y1={row * 22} x2={totalCols * 32} y2={row * 22}
                  stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} />
              </g>
            ))}
            {/* Beat lines */}
            {Array.from({ length: totalCols + 1 }).map((_, col) => (
              <line key={`col-${col}`} x1={col * 32} y1={0} x2={col * 32} y2={pitchRows * 22}
                stroke={col % 4 === 0
                  ? (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)')
                  : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)')}
                strokeWidth={col % 4 === 0 ? 1 : 0.5} />
            ))}

            {/* Notes */}
            {VOCAL_DEMO_NOTES.map((note, i) => {
              const row = PITCH_BASE - note.pitch;
              if (row < 0 || row >= pitchRows) return null;
              const x = note.start * 32;
              const w = note.duration * 32;
              const y = row * 22;
              const isActive = playheadPos >= note.start && playheadPos < note.start + note.duration;

              return (
                <g key={i}>
                  <rect x={x + 1} y={y + 2} width={w - 2} height={18} rx={3}
                    fill={isActive
                      ? (isDark ? '#ec4899' : '#f472b6')
                      : (isDark ? 'rgba(236,72,153,0.5)' : 'rgba(244,114,182,0.6)')}
                    stroke={isActive ? '#f9a8d4' : 'transparent'} strokeWidth={1} />
                  {note.lyric && (
                    <text x={x + 5} y={y + 14} fontSize="9" fontWeight="600"
                      fill={isActive ? '#fff' : (isDark ? '#fce7f3' : '#831843')}>
                      {note.lyric}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Playhead */}
            <line x1={playheadPos * 32} y1={0} x2={playheadPos * 32} y2={pitchRows * 22}
              stroke="#f43f5e" strokeWidth={1.5} opacity={0.8} />
            <circle cx={playheadPos * 32} cy={0} r={3} fill="#f43f5e" />
          </svg>
        </div>
      </div>

      {/* Lyric timeline bar */}
      <div className={`flex items-center gap-0.5 px-1 py-1.5 border-t ${
        isDark ? 'border-gray-600/40 bg-[#181e27]' : 'border-gray-200 bg-gray-50'
      }`}>
        {VOCAL_DEMO_NOTES.filter(n => n.lyric).map((note, i) => {
          const isActive = playheadPos >= note.start && playheadPos < note.start + note.duration;
          return (
            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              isActive
                ? 'bg-pink-500 text-white font-semibold'
                : isDark ? 'text-gray-400' : 'text-gray-500'
            }`}>{note.lyric}</span>
          );
        })}
      </div>
    </motion.div>
  );
}

// ============================================================
// Mockup: Stem Separation (HTDemucs)
// ============================================================

const STEM_COLORS = [
  { label: 'Vocals', color: '#f43f5e' },
  { label: 'Drums', color: '#f59e0b' },
  { label: 'Bass', color: '#10b981' },
  { label: 'Piano', color: '#3b82f6' },
  { label: 'Guitar', color: '#a855f7' },
  { label: 'Other', color: '#6b7280' },
];

function StemSeparationMockup({ isDark }: { isDark: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`rounded-xl border shadow-lg overflow-hidden ${
        isDark ? 'bg-[#1E252E] border-gray-600/60' : 'bg-white border-gray-200'
      }`}
    >
      {/* Toolbar */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${
        isDark ? 'border-gray-600/40 bg-[#181e27]' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
          isDark ? 'bg-cyan-900/40 border border-cyan-500/50 text-cyan-200' : 'bg-cyan-50 border border-cyan-200 text-cyan-700'
        }`}>
          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
          Stem Separation
        </div>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>6 stems</span>
        <div className="flex-1" />
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
        }`}>Web Audio</span>
      </div>

      {/* Main waveform */}
      <div className={`h-16 relative border-b ${isDark ? 'border-gray-600/30' : 'border-gray-100'}`}>
        <svg width="100%" height="100%" className="opacity-40" preserveAspectRatio="none">
          {Array.from({ length: 60 }, (_, i) => {
            const h = 15 + Math.sin(i * 0.4) * 12 + Math.random() * 8;
            return (
              <rect key={i} x={i * (100/60) + '%'} y={`${50 - h/2}%`} width="1.5%" height={`${h}%`}
                fill={isDark ? '#22d3ee' : '#06b6d4'} rx={1} />
            );
          })}
        </svg>
        <div className={`absolute left-1/3 top-0 bottom-0 w-px ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'}`}>
          <div className={`w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2 ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'}`} />
        </div>
      </div>

      {/* Stem lanes */}
      {STEM_COLORS.map((stem) => (
        <div key={stem.label} className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 ${
          isDark ? 'border-gray-600/20' : 'border-gray-100'
        }`}>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stem.color }} />
          <span className={`text-[10px] font-semibold w-10`} style={{ color: stem.color }}>{stem.label}</span>
          <div className="flex-1 h-6 relative overflow-hidden rounded bg-gray-100/50 dark:bg-gray-800/50">
            <svg width="100%" height="100%" className="opacity-30" preserveAspectRatio="none">
              {Array.from({ length: 40 }, (_, i) => {
                const h = 10 + Math.sin(i * 0.6 + STEM_COLORS.indexOf(stem)) * 8 + Math.random() * 6;
                return (
                  <rect key={i} x={i * (100/40) + '%'} y={`${50 - h/2}%`} width="2%" height={`${h}%`}
                    fill={stem.color} rx={1} />
                );
              })}
            </svg>
          </div>
          <div className="flex gap-1">
            <span className={`text-[8px] px-1 py-0.5 rounded border ${isDark ? 'border-gray-600 text-gray-400' : 'border-gray-300 text-gray-500'}`}>M</span>
            <span className={`text-[8px] px-1 py-0.5 rounded border ${isDark ? 'border-gray-600 text-gray-400' : 'border-gray-300 text-gray-500'}`}>S</span>
          </div>
          <div className="w-8 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: '60%', backgroundColor: stem.color, opacity: 0.7 }} />
          </div>
        </div>
      ))}
    </motion.div>
  );
}

// ============================================================
// Mockup: Beat Maker (ADTLib-inspired)
// ============================================================

const BEAT_CHANNELS = [
  { id: 'kick', name: 'Kick', color: '#E57373' },
  { id: 'snare', name: 'Snare', color: '#FFB74D' },
  { id: 'hihat', name: 'HiHat', color: '#FFF176' },
  { id: 'clap', name: 'Clap', color: '#BA68C8' },
];

const DEMO_PATTERN = [
  [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
  [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
  [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
  [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
];

function BeatMakerMockup({ isDark }: { isDark: boolean }) {
  const [demoBeat, setDemoBeat] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setDemoBeat((p) => (p + 1) % 16), 200);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`rounded-xl border shadow-lg overflow-hidden ${
        isDark ? 'bg-[#1E252E] border-gray-600/60' : 'bg-white border-gray-200'
      }`}
    >
      {/* Toolbar */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${
        isDark ? 'border-gray-600/40 bg-[#181e27]' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
          isDark ? 'bg-green-900/40 border border-green-500/50 text-green-200' : 'bg-green-50 border border-green-200 text-green-700'
        }`}>
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Beat Maker
        </div>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>32 steps</span>
        <div className="flex-1" />
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>Web Audio</span>
      </div>

      {/* Channel rack */}
      {BEAT_CHANNELS.map((ch, chIdx) => (
        <div key={ch.id} className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 ${
          isDark ? 'border-gray-600/20' : 'border-gray-100'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            DEMO_PATTERN[chIdx][demoBeat] ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' : 'bg-gray-700'
          }`} />
          <span className="text-[9px] font-bold text-gray-500 dark:text-gray-500 w-4">M</span>
          <span className="text-[9px] font-bold text-gray-500 dark:text-gray-500 w-4">S</span>
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ch.color }} />
          <span className={`text-[10px] font-semibold w-10`} style={{ color: ch.color }}>{ch.name}</span>

          {/* Step grid */}
          <div className="flex-1 flex gap-[2px]">
            {DEMO_PATTERN[chIdx].map((active, stepIdx) => (
              <div
                key={stepIdx}
                className="flex-1 h-5 rounded-sm transition-colors"
                style={{
                  backgroundColor: active
                    ? ch.color
                    : stepIdx === demoBeat
                      ? (isDark ? '#2a3544' : '#e5e7eb')
                      : (isDark ? '#1a2332' : '#f3f4f6'),
                  opacity: active ? 0.85 : 1,
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  );
}

// ============================================================
// Feature Content Panel
// ============================================================

const COLOR_MAP: Record<string, string> = { blue: 'text-blue-500', green: 'text-green-500', purple: 'text-purple-500', orange: 'text-orange-500', pink: 'text-pink-500', cyan: 'text-cyan-500' };
const FEATURE_PANEL_CLASS = 'grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-12 lg:items-stretch min-h-[40rem] md:min-h-[36rem] lg:min-h-[28rem]';
const FEATURE_TAB_CLASSNAMES = {
  base: 'mx-auto flex w-full max-w-4xl justify-center',
  tabList: 'mx-auto w-full justify-center rounded-full bg-white/75 px-2 py-1 shadow-sm backdrop-blur dark:bg-gray-800/50',
  cursor: 'bg-slate-900 dark:bg-gray-900',
  tab: 'text-sm sm:text-base text-gray-700 data-[selected=true]:text-white dark:text-gray-200 dark:data-[selected=true]:text-white',
  tabContent: 'text-gray-700 group-data-[selected=true]:text-white dark:text-gray-200 dark:group-data-[selected=true]:text-white',
};

function FeatureContent({ title, description, features }: {
  title: string; description: string; features: { text: string; color: string }[];
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: 0.05 }}
      className="flex h-full flex-col justify-center space-y-4 px-1 py-2 sm:px-2"
    >
      <h3 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">{title}</h3>
      <p className="text-gray-600 dark:text-gray-400 leading-relaxed">{description}</p>
      <ul className="space-y-3 mt-2">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-gray-600 dark:text-gray-400">
            <span className={`${COLOR_MAP[f.color] || 'text-blue-500'} mt-1.5 text-xs flex-shrink-0`}>●</span>
            <span className="text-sm leading-relaxed">{f.text}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

// ============================================================
// Main Export
// ============================================================

export default function FeaturesTabSection() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [activeTab, setActiveTab] = useState<string>('chord-grid');
  const beat = useBeatAnimation();

  return (
    <section id="features" className="relative py-20 bg-transparent transition-colors duration-300 overflow-hidden rounded-b-[36px]">
      <div className="absolute inset-0 z-0 pointer-events-none">
        {isDark ? (
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 50%)' }} />
        ) : (
          <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(255, 235, 59, 0.2) 0%, transparent 60%)' }} />
        )}
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.4 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">Features</h2>
          <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Music analysis tools for chord recognition, beat detection, and lyrics synchronization
          </p>
        </motion.div>

        <Tabs
          aria-label="Feature tabs"
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as string)}
          variant="light"
          color="primary"
          classNames={{
            ...FEATURE_TAB_CLASSNAMES,
            tabList: `${FEATURE_TAB_CLASSNAMES.tabList} mb-8 max-w-4xl gap-2 sm:gap-3`,
            tab: `${FEATURE_TAB_CLASSNAMES.tab} px-3 py-2 sm:px-4`,
            panel: 'pt-0',
          }}
        >
          <Tab key="chord-grid" title="Beat & Chord Grid">
            <div className={FEATURE_PANEL_CLASS}>
              <div className="lg:col-span-3"><ChordGridMockup isDark={isDark} currentBeat={beat} /></div>
              <div className="lg:col-span-2"><FeatureContent {...TAB_CONTENT['chord-grid']} /></div>
            </div>
          </Tab>
          <Tab key="guitar" title="Guitar Tab">
            <div className={FEATURE_PANEL_CLASS}>
              <div className="lg:col-span-3"><GuitarMockup isDark={isDark} currentBeat={beat} /></div>
              <div className="lg:col-span-2"><FeatureContent {...TAB_CONTENT.guitar} /></div>
            </div>
          </Tab>
          <Tab key="lyrics" title="Lyrics Sync">
            <div className={FEATURE_PANEL_CLASS}>
              <div className="lg:col-span-3"><LyricsMockup isDark={isDark} currentBeat={beat} /></div>
              <div className="lg:col-span-2"><FeatureContent {...TAB_CONTENT.lyrics} /></div>
            </div>
          </Tab>
          <Tab key="piano-visualizer" title="Piano Visualizer">
            <div className={FEATURE_PANEL_CLASS}>
              <div className="lg:col-span-3"><PianoVisualizerMockup /></div>
              <div className="lg:col-span-2"><FeatureContent {...TAB_CONTENT['piano-visualizer']} /></div>
            </div>
          </Tab>
          <Tab key="vocal-synth" title="Vocal Synth">
            <div className={FEATURE_PANEL_CLASS}>
              <div className="lg:col-span-3"><VocalSynthMockup isDark={isDark} currentBeat={beat} /></div>
              <div className="lg:col-span-2"><FeatureContent {...TAB_CONTENT['vocal-synth']} /></div>
            </div>
          </Tab>
          <Tab key="stem-separation" title="Stem Sep">
            <div className={FEATURE_PANEL_CLASS}>
              <div className="lg:col-span-3"><StemSeparationMockup isDark={isDark} /></div>
              <div className="lg:col-span-2"><FeatureContent {...TAB_CONTENT['stem-separation']} /></div>
            </div>
          </Tab>
          <Tab key="beat-maker" title="Beat Maker">
            <div className={FEATURE_PANEL_CLASS}>
              <div className="lg:col-span-3"><BeatMakerMockup isDark={isDark} /></div>
              <div className="lg:col-span-2"><FeatureContent {...TAB_CONTENT['beat-maker']} /></div>
            </div>
          </Tab>
        </Tabs>
      </div>
    </section>
  );
}
