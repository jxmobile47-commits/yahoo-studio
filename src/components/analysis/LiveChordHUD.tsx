"use client";

import React, { useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { formatChordWithMusicalSymbols } from "@/utils/chordFormatting/formatChord";

type LiveStatusVariant = "live" | "ready";

interface LiveStatusMeta {
  label?: string;
  variant?: LiveStatusVariant;
}

interface LiveChordHUDProps {
  chord?: string | null;
  beatIndex?: number;
  notes?: string[];
  status?: LiveStatusMeta;
}

// ── Note helpers ──────────────────────────────────────────────────────────────

const NOTE_INDEX_MAP: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

function noteNameToMidi(note: string): number {
  const match = note.match(/^([A-G][#b]?)(\d+)$/);
  if (!match) return -1;
  const idx = NOTE_INDEX_MAP[match[1]];
  if (idx === undefined) return -1;
  return (parseInt(match[2], 10) + 1) * 12 + idx;
}

// ── Mini Piano component ──────────────────────────────────────────────────────

// White-key semitone indices (C D E F G A B)
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
// Black-key: { semitone, whiteIndex (position between white keys, 0-based left) }
const BLACK_KEY_DEF = [
  { semitone: 1,  whiteIdx: 0 }, // C#
  { semitone: 3,  whiteIdx: 1 }, // D#
  { semitone: 6,  whiteIdx: 3 }, // F#
  { semitone: 8,  whiteIdx: 4 }, // G#
  { semitone: 10, whiteIdx: 5 }, // A#
];

interface MiniPianoProps {
  activeMidi: Set<number>;
  startOctave: number;
  endOctave: number;
}

const MiniPiano: React.FC<MiniPianoProps> = ({ activeMidi, startOctave, endOctave }) => {
  const octaves = useMemo(() => {
    const result = [];
    for (let o = startOctave; o < endOctave; o++) result.push(o);
    return result;
  }, [startOctave, endOctave]);

  const WW = 32; // white key width px
  const WH = 88; // white key height px
  const BW = 20; // black key width px
  const BH = 54; // black key height px
  const OCTAVE_W = WW * 7;
  const totalW = OCTAVE_W * octaves.length;
  const totalH = WH;

  return (
    <svg
      viewBox={`0 0 ${totalW} ${totalH}`}
      className="w-full max-w-xl"
      style={{ height: 110 }}
      aria-label="Chord keyboard"
    >
      {/* White keys */}
      {octaves.map((oct, oi) =>
        WHITE_SEMITONES.map((semi, wi) => {
          const midi = oct * 12 + semi;
          const active = activeMidi.has(midi);
          const x = oi * OCTAVE_W + wi * WW;
          return (
            <g key={`w-${midi}`}>
              <rect
                x={x + 1}
                y={0}
                width={WW - 2}
                height={WH}
                rx={3}
                fill={active ? "#22d3ee" : "#e8eef8"}
                stroke={active ? "#0891b2" : "#94a3b8"}
                strokeWidth={1}
              />
              {active && (
                <text
                  x={x + WW / 2}
                  y={WH - 10}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight="700"
                  fill="#0c4a6e"
                >
                  {["C","D","E","F","G","A","B"][wi]}{oct}
                </text>
              )}
            </g>
          );
        })
      )}

      {/* Black keys (drawn on top) */}
      {octaves.map((oct, oi) =>
        BLACK_KEY_DEF.map(({ semitone, whiteIdx }) => {
          const midi = oct * 12 + semitone;
          const active = activeMidi.has(midi);
          const x = oi * OCTAVE_W + whiteIdx * WW + WW - BW / 2;
          return (
            <rect
              key={`b-${midi}`}
              x={x}
              y={0}
              width={BW}
              height={BH}
              rx={3}
              fill={active ? "#06b6d4" : "#1e293b"}
              stroke={active ? "#0e7490" : "#475569"}
              strokeWidth={1}
            />
          );
        })
      )}
    </svg>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const LiveChordHUD: React.FC<LiveChordHUDProps> = ({ chord, beatIndex, notes = [], status }) => {
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";

  const chordMarkup = useMemo(() => {
    if (!chord || chord.trim() === "") return null;
    return formatChordWithMusicalSymbols(chord, isDarkMode);
  }, [chord, isDarkMode]);

  const noteLine = useMemo(() => {
    if (!notes.length) return null;
    return notes.join("  \u00b7  ");
  }, [notes]);

  const resolvedStatus = useMemo(() => {
    const variant: LiveStatusVariant = status?.variant ?? (chord ? "live" : "ready");
    const label = status?.label ?? (variant === "live" ? "Live" : "Ready");
    const classes =
      variant === "live"
        ? "bg-rose-500/20 text-rose-100 border border-rose-400/30"
        : "bg-slate-500/20 text-slate-200 border border-slate-400/30";
    const dotClasses =
      variant === "live" ? "animate-pulse bg-rose-300" : "bg-slate-300";
    return { label, classes, dotClasses, variant };
  }, [status, chord]);

  // Compute MIDI set + keyboard range from notes
  const { activeMidi, startOctave, endOctave } = useMemo(() => {
    const midis = notes
      .map(noteNameToMidi)
      .filter((m) => m >= 0);
    const set = new Set(midis);
    if (midis.length === 0) {
      return { activeMidi: set, startOctave: 3, endOctave: 5 };
    }
    const minMidi = Math.min(...midis);
    const maxMidi = Math.max(...midis);
    // C of the octave one below lowest note
    const so = Math.max(0, Math.floor(minMidi / 12) - 1);
    // end octave — at least 2 octaves wide
    const eo = Math.max(so + 2, Math.floor(maxMidi / 12) + 1);
    return { activeMidi: set, startOctave: so, endOctave: Math.min(eo, so + 3) };
  }, [notes]);

  return (
    <div className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-[0_24px_60px_rgba(8,12,30,0.5)] backdrop-blur">

      {/* Top row: status pill + chord name + beat */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.4em] ${resolvedStatus.classes}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${resolvedStatus.dotClasses}`} aria-hidden="true" />
            {resolvedStatus.label}
          </span>

          {chordMarkup ? (
            <span
              className="text-4xl font-extrabold leading-none text-white [text-shadow:0_0_18px_rgba(34,211,238,0.5)]"
              dangerouslySetInnerHTML={{ __html: chordMarkup }}
            />
          ) : (
            <span className="text-2xl font-semibold leading-none text-slate-400">No chord</span>
          )}
        </div>

        <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-400">
          {typeof beatIndex === "number" && beatIndex >= 0 ? `Beat ${beatIndex + 1}` : "Idle"}
        </div>
      </div>

      {/* Note names */}
      <div className={`text-sm font-semibold uppercase tracking-[0.32em] text-emerald-300 ${noteLine ? "" : "opacity-30"}`}>
        {noteLine ?? "—"}
      </div>

      {/* Piano keyboard */}
      <div className="flex justify-center overflow-x-auto rounded-xl bg-slate-800/60 p-4">
        <MiniPiano
          activeMidi={activeMidi}
          startOctave={startOctave}
          endOctave={endOctave}
        />
      </div>

      {/* Note legend below keyboard */}
      {notes.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {notes.map((n) => (
            <span
              key={n}
              className="rounded-full bg-cyan-500/20 px-3 py-0.5 text-xs font-semibold text-cyan-200 border border-cyan-400/25"
            >
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default LiveChordHUD;
