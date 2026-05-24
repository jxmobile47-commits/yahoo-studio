'use client';

import React, { useMemo } from 'react';
import { NoteData } from './PianoRollAnalyzer';

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const CHORD_TEMPLATES = [
  { name: 'Major 7',    intervals: [0,4,7,11]    },
  { name: 'Dominant 7', intervals: [0,4,7,10]    },
  { name: 'Minor 7',    intervals: [0,3,7,10]    },
  { name: 'Dim 7',      intervals: [0,3,6,9]     },
  { name: 'Half-Dim 7', intervals: [0,3,6,10]    },
  { name: 'Min/Maj 7',  intervals: [0,3,7,11]    },
  { name: 'Major 9',    intervals: [0,4,7,11,14] },
  { name: 'Dominant 9', intervals: [0,4,7,10,14] },
  { name: 'Minor 9',    intervals: [0,3,7,10,14] },
  { name: 'Add 9',      intervals: [0,4,7,14]    },
  { name: 'Major 6',    intervals: [0,4,7,9]     },
  { name: 'Minor 6',    intervals: [0,3,7,9]     },
  { name: 'Sus4',       intervals: [0,5,7]       },
  { name: 'Sus2',       intervals: [0,2,7]       },
  { name: 'Augmented',  intervals: [0,4,8]       },
  { name: 'Diminished', intervals: [0,3,6]       },
  { name: 'Minor',      intervals: [0,3,7]       },
  { name: 'Major',      intervals: [0,4,7]       },
];

interface DetectionPanelProps {
  notes: NoteData[];
}

function noteToMidi(noteName: string): number {
  const name = noteName.replace(/\d/g, '');
  const match = noteName.match(/\d/);
  const octave = match ? parseInt(match[0]!) : 4;
  const idx = NOTES.indexOf(name);
  return (octave + 1) * 12 + idx;
}

function detectChord(noteNames: string[]): string | null {
  if (noteNames.length < 2) return null;
  const pcs = [...new Set(noteNames.map(n => noteToMidi(n) % 12))];
  let best: string | null = null;
  let bestScore = 0;
  for (let root = 0; root < 12; root++) {
    for (const tmpl of CHORD_TEMPLATES) {
      const expected = tmpl.intervals.map(iv => (root + iv) % 12);
      const hit = expected.filter(e => pcs.includes(e)).length;
      const score = hit / Math.max(expected.length, pcs.length);
      if (score > bestScore) { bestScore = score; best = tmpl.name; }
    }
  }
  if (best && bestScore >= 0.6) return best;
  if (noteNames.length === 2) return 'Interval';
  return 'Unknown';
}

export default function DetectionPanel({ notes }: DetectionPanelProps) {
  const uniqueNotes = useMemo(() => [...new Set(notes.map(n => n.note))], [notes]);
  const chordType = useMemo(() => detectChord(uniqueNotes), [uniqueNotes]);
  const rootNote = notes.length > 0 ? notes[0]!.note.replace(/\d/g, '') : null;

  return (
    <div className="px-5 py-4 border-t border-white/10 bg-[#1e2435] shrink-0">
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
        AI Chord Detection
      </div>
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-[30px] font-extrabold text-cyan-400 leading-none drop-shadow-[0_0_14px_rgba(34,211,238,0.45)]">
          {notes.length >= 2 && rootNote ? rootNote : notes.length === 1 ? notes[0]!.note : '—'}
        </span>
        <span className="text-[15px] font-semibold text-gray-400">
          {notes.length >= 2 && chordType ? chordType : notes.length === 1 ? '(single note)' : ''}
        </span>
      </div>
      <div className="text-[11px] text-green-400/65 tracking-wide">
        {uniqueNotes.length > 0 ? uniqueNotes.join('  ·  ') : ''}
      </div>
    </div>
  );
}
