'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface MidiKeyboardProps {
  activeNotes: Set<number>;
  startOctave?: number;
  numOctaves?: number;
  onNoteClick?: (note: number) => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_KEYS = [1, 3, 6, 8, 10]; // Semitones that are black keys

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

export default function MidiKeyboard({
  activeNotes,
  startOctave = 2,
  numOctaves = 4,
  onNoteClick,
}: MidiKeyboardProps) {
  const startNote = (startOctave + 1) * 12; // C2 = 36
  const endNote = startNote + numOctaves * 12;
  const whiteKeyWidth = 28;
  const whiteKeyHeight = 120;
  const blackKeyWidth = 18;
  const blackKeyHeight = 75;

  const keys: React.ReactNode[] = [];
  let whiteKeyIndex = 0;

  for (let midi = startNote; midi < endNote; midi++) {
    const isBlack = BLACK_KEYS.includes(midi % 12);
    const isActive = activeNotes.has(midi);

    if (!isBlack) {
      // White key
      const x = whiteKeyIndex * whiteKeyWidth;
      keys.push(
        <g key={`w-${midi}`}>
          <rect
            x={x}
            y={0}
            width={whiteKeyWidth - 1}
            height={whiteKeyHeight}
            rx={2}
            fill={isActive ? '#ec4899' : '#f3f4f6'}
            stroke={isActive ? '#db2777' : '#d1d5db'}
            strokeWidth={1}
            className="cursor-pointer transition-colors"
            onClick={() => onNoteClick?.(midi)}
          />
          {isActive && (
            <text
              x={x + whiteKeyWidth / 2}
              y={whiteKeyHeight - 10}
              textAnchor="middle"
              fontSize="8"
              fill="white"
              className="pointer-events-none select-none"
            >
              {midiToNoteName(midi)}
            </text>
          )}
        </g>
      );
      whiteKeyIndex++;
    }
  }

  // Black keys (rendered on top)
  whiteKeyIndex = 0;
  for (let midi = startNote; midi < endNote; midi++) {
    const isBlack = BLACK_KEYS.includes(midi % 12);
    if (!isBlack) {
      whiteKeyIndex++;
      continue;
    }

    const isActive = activeNotes.has(midi);
    // Position black key between previous and next white key
    const x = (whiteKeyIndex - 1) * whiteKeyWidth + whiteKeyWidth - blackKeyWidth / 2;

    keys.push(
      <g key={`b-${midi}`}>
        <rect
          x={x}
          y={0}
          width={blackKeyWidth}
          height={blackKeyHeight}
          rx={1}
          fill={isActive ? '#a855f7' : '#1f2937'}
          stroke={isActive ? '#9333ea' : '#374151'}
          strokeWidth={1}
          className="cursor-pointer transition-colors"
          onClick={() => onNoteClick?.(midi)}
        />
        {isActive && (
          <text
            x={x + blackKeyWidth / 2}
            y={blackKeyHeight - 8}
            textAnchor="middle"
            fontSize="6"
            fill="white"
            className="pointer-events-none select-none"
          >
            {NOTE_NAMES[midi % 12]}
          </text>
        )}
      </g>
    );
  }

  const totalWidth = whiteKeyIndex * whiteKeyWidth;

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-gray-700 bg-gray-900">
      <svg
        width={totalWidth}
        height={whiteKeyHeight}
        viewBox={`0 0 ${totalWidth} ${whiteKeyHeight}`}
        className="mx-auto"
      >
        {keys}
      </svg>
    </div>
  );
}
