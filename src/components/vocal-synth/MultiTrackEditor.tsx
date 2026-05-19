'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';

interface TrackNote {
  id: string;
  start_time: number;
  end_time: number;
  avg_pitch_midi: number;
  label: string;
  type?: 'melody' | 'harmony' | 'backing';
  voice?: number;
  interval?: number;
  muted?: boolean;
  solo?: boolean;
  gain?: number;
}

interface Track {
  id: string;
  name: string;
  color: string;
  notes: TrackNote[];
  muted: boolean;
  solo: boolean;
  gain: number;
  type: 'melody' | 'harmony' | 'backing' | 'custom';
}

interface MultiTrackEditorProps {
  melodyNotes: TrackNote[];
  scale?: string;
  onTracksChange?: (tracks: Track[]) => void;
  currentTime?: number;
  isPlaying?: boolean;
}

const TRACK_COLORS = [
  { bg: 'rgba(236,72,153,0.3)', border: '#ec4899', text: '#fce7f3' },   // Pink - Melody
  { bg: 'rgba(59,130,246,0.3)', border: '#3b82f6', text: '#dbeafe' },   // Blue - Harmony 1
  { bg: 'rgba(34,197,94,0.3)', border: '#22c55e', text: '#dcfce7' },    // Green - Harmony 2
  { bg: 'rgba(168,85,247,0.3)', border: '#a855f7', text: '#f3e8ff' },   // Purple - Backing 1
  { bg: 'rgba(245,158,11,0.3)', border: '#f59e0b', text: '#fef3c7' },   // Amber - Backing 2
  { bg: 'rgba(6,182,212,0.3)', border: '#06b6d4', text: '#cffafe' },    // Cyan - Custom
];

const HARMONY_TYPES = [
  { value: '3rd', label: '3rd (Triad)', desc: 'Adds diatonic 3rd' },
  { value: '5th', label: '5th (Power)', desc: 'Adds perfect 5th' },
  { value: 'octave', label: 'Octave', desc: 'One octave up' },
  { value: 'power_chord', label: 'Power Chord', desc: '5th + octave' },
  { value: 'full_triad', label: 'Full Triad', desc: '3rd + 5th' },
  { value: '6th', label: '6th', desc: 'Adds 6th interval' },
];

const SEMITONE_HEIGHT = 10;
const PIXELS_PER_SECOND = 60;
const PITCH_MIN = 48;
const PITCH_MAX = 84;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNote(midi: number): string {
  const idx = Math.round(midi) % 12;
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return `${NOTE_NAMES[idx]}${octave}`;
}

export default function MultiTrackEditor({
  melodyNotes,
  scale = 'C major',
  onTracksChange,
  currentTime = 0,
  isPlaying = false,
}: MultiTrackEditorProps) {
  const [tracks, setTracks] = useState<Track[]>([
    {
      id: 'melody',
      name: 'Lead Vocal',
      color: 'pink',
      notes: melodyNotes.map(n => ({ ...n, type: 'melody' as const })),
      muted: false,
      solo: false,
      gain: 1.0,
      type: 'melody',
    },
  ]);
  const [selectedTrack, setSelectedTrack] = useState<string>('melody');
  const [showHarmonyPanel, setShowHarmonyPanel] = useState(false);
  const [harmonyType, setHarmonyType] = useState('3rd');

  const duration = useMemo(() => {
    const allNotes = tracks.flatMap(t => t.notes);
    return allNotes.length > 0 ? Math.max(...allNotes.map(n => n.end_time)) : 10;
  }, [tracks]);

  const editorWidth = Math.max(duration * PIXELS_PER_SECOND, 600);
  const editorHeight = (PITCH_MAX - PITCH_MIN + 2) * SEMITONE_HEIGHT;

  const generateHarmony = useCallback(() => {
    const melodyTrack = tracks.find(t => t.type === 'melody');
    if (!melodyTrack) return;

    const harmonyNotes = computeHarmony(melodyTrack.notes, harmonyType, scale);
    const newTrack: Track = {
      id: `harmony_${harmonyType}_${tracks.length}`,
      name: `Harmony (${harmonyType})`,
      color: 'blue',
      notes: harmonyNotes,
      muted: false,
      solo: false,
      gain: 0.7,
      type: 'harmony',
    };

    const updated = [...tracks, newTrack];
    setTracks(updated);
    onTracksChange?.(updated);
    setShowHarmonyPanel(false);
  }, [tracks, harmonyType, scale, onTracksChange]);

  const generateBacking = useCallback(() => {
    const melodyTrack = tracks.find(t => t.type === 'melody');
    if (!melodyTrack) return;

    const tracksToAdd = computeBackingVocals(melodyTrack.notes, scale);
    const newTracks = tracksToAdd.map((t, i) => ({
      id: `backing_${tracks.length + i}`,
      name: t.name,
      color: ['purple', 'amber'][i] as string,
      notes: t.notes,
      muted: false,
      solo: false,
      gain: 0.5,
      type: 'backing' as const,
    }));

    const updated = [...tracks, ...newTracks];
    setTracks(updated);
    onTracksChange?.(updated);
  }, [tracks, scale, onTracksChange]);

  const toggleMute = (trackId: string) => {
    const updated = tracks.map(t => t.id === trackId ? { ...t, muted: !t.muted } : t);
    setTracks(updated);
    onTracksChange?.(updated);
  };

  const toggleSolo = (trackId: string) => {
    const updated = tracks.map(t => t.id === trackId ? { ...t, solo: !t.solo } : t);
    setTracks(updated);
    onTracksChange?.(updated);
  };

  const setGain = (trackId: string, gain: number) => {
    const updated = tracks.map(t => t.id === trackId ? { ...t, gain } : t);
    setTracks(updated);
    onTracksChange?.(updated);
  };

  const deleteTrack = (trackId: string) => {
    if (trackId === 'melody') return; // Can't delete melody
    const updated = tracks.filter(t => t.id !== trackId);
    setTracks(updated);
    onTracksChange?.(updated);
  };

  // Determine which tracks to show (solo logic)
  const hasSolo = tracks.some(t => t.solo);
  const visibleTracks = tracks.filter(t => {
    if (hasSolo) return t.solo;
    return !t.muted;
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-800 rounded-xl border border-gray-700">
        <button
          onClick={() => setShowHarmonyPanel(!showHarmonyPanel)}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
        >
          + Add Harmony
        </button>
        <button
          onClick={generateBacking}
          className="px-3 py-1.5 text-xs rounded bg-purple-600 text-white hover:bg-purple-500 transition-colors"
        >
          + Backing Vocals
        </button>
        <div className="h-6 w-px bg-gray-600" />
        <span className="text-xs text-gray-400">
          {tracks.length} tracks | {tracks.reduce((sum, t) => sum + t.notes.length, 0)} notes
        </span>
      </div>

      {/* Harmony Panel */}
      {showHarmonyPanel && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="p-3 bg-gray-800 rounded-xl border border-gray-700"
        >
          <div className="text-xs text-gray-400 mb-2">Select Harmony Type</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
            {HARMONY_TYPES.map(h => (
              <button
                key={h.value}
                onClick={() => setHarmonyType(h.value)}
                className={`p-2 rounded text-left text-xs transition-colors ${
                  harmonyType === h.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <div className="font-medium">{h.label}</div>
                <div className="text-[10px] opacity-70">{h.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={generateHarmony} className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-500">
              Generate
            </button>
            <button onClick={() => setShowHarmonyPanel(false)} className="px-3 py-1 text-xs rounded bg-gray-600 text-white hover:bg-gray-500">
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      {/* Track mixer */}
      <div className="space-y-1">
        {tracks.map((track, idx) => {
          const color = TRACK_COLORS[idx % TRACK_COLORS.length];
          return (
            <div
              key={track.id}
              className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                selectedTrack === track.id ? 'bg-gray-700' : 'bg-gray-800'
              }`}
              onClick={() => setSelectedTrack(track.id)}
            >
              {/* Color indicator */}
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color?.border ?? '#ec4899' }} />

              {/* Track name */}
              <span className="text-xs text-gray-300 w-24 truncate">{track.name}</span>

              {/* Mute */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
                className={`px-1.5 py-0.5 text-[10px] rounded font-bold transition-colors ${
                  track.muted ? 'bg-red-600 text-white' : 'bg-gray-600 text-gray-400 hover:text-white'
                }`}
              >
                M
              </button>

              {/* Solo */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
                className={`px-1.5 py-0.5 text-[10px] rounded font-bold transition-colors ${
                  track.solo ? 'bg-yellow-600 text-white' : 'bg-gray-600 text-gray-400 hover:text-white'
                }`}
              >
                S
              </button>

              {/* Gain */}
              <input
                type="range"
                min={0}
                max={100}
                value={track.gain * 100}
                onChange={(e) => setGain(track.id, Number(e.target.value) / 100)}
                onClick={(e) => e.stopPropagation()}
                className="w-16 accent-pink-500"
              />
              <span className="text-[10px] text-gray-500 w-6">{Math.round(track.gain * 100)}</span>

              {/* Note count */}
              <span className="text-[10px] text-gray-500 ml-auto">{track.notes.length} notes</span>

              {/* Delete */}
              {track.type !== 'melody' && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteTrack(track.id); }}
                  className="text-gray-500 hover:text-red-400 text-xs px-1"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Multi-track editor */}
      <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: '50vh' }}>
          <svg width={editorWidth + 60} height={editorHeight + 20}>
            {/* Grid background */}
            {Array.from({ length: PITCH_MAX - PITCH_MIN + 2 }, (_, i) => {
              const midi = PITCH_MAX - i;
              const y = i * SEMITONE_HEIGHT;
              const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
              return (
                <g key={`grid-${midi}`}>
                  <rect x={60} y={y} width={editorWidth} height={SEMITONE_HEIGHT}
                    fill={isBlack ? 'rgba(255,255,255,0.03)' : 'transparent'} />
                  <text x={55} y={y + SEMITONE_HEIGHT - 1} fontSize="7"
                    textAnchor="end" fill={isBlack ? '#666' : '#888'}>
                    {midiToNote(midi)}
                  </text>
                </g>
              );
            })}

            {/* Time grid */}
            {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
              <g key={`time-${i}`}>
                <line x1={60 + i * PIXELS_PER_SECOND} y1={0}
                  x2={60 + i * PIXELS_PER_SECOND} y2={editorHeight}
                  stroke={i % 4 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)'}
                  strokeWidth={i % 4 === 0 ? 1 : 0.5} />
                <text x={60 + i * PIXELS_PER_SECOND + 2} y={10} fontSize="7"
                  fill="rgba(255,255,255,0.3)">{i}s</text>
              </g>
            ))}

            {/* Notes for all visible tracks */}
            {visibleTracks.map((track, trackIdx) => {
              const color = TRACK_COLORS[tracks.indexOf(track) % TRACK_COLORS.length] ?? TRACK_COLORS[0];
              return track.notes.map((note) => {
                const x = 60 + note.start_time * PIXELS_PER_SECOND;
                const y = (PITCH_MAX - note.avg_pitch_midi) * SEMITONE_HEIGHT;
                const w = (note.end_time - note.start_time) * PIXELS_PER_SECOND;
                const isActive = isPlaying && currentTime >= note.start_time && currentTime < note.end_time;

                return (
                  <g key={note.id}>
                    <rect
                      x={x + 1}
                      y={y - SEMITONE_HEIGHT * 0.2}
                      width={Math.max(w - 2, 2)}
                      height={SEMITONE_HEIGHT * 1.4}
                      rx={2}
                      fill={isActive ? (color?.border ?? '#ec4899') : (color?.bg ?? 'rgba(236,72,153,0.3)')}
                      stroke={selectedTrack === track.id ? (color?.border ?? '#ec4899') : 'transparent'}
                      strokeWidth={1}
                      opacity={0.85}
                    />
                    {w > 20 && (
                      <text x={x + 3} y={y + 7} fontSize="7"
                        fill={color?.text ?? '#fce7f3'} className="pointer-events-none select-none">
                        {note.label}
                      </text>
                    )}
                  </g>
                );
              });
            })}

            {/* Playhead */}
            {isPlaying && (
              <g>
                <line x1={60 + currentTime * PIXELS_PER_SECOND} y1={0}
                  x2={60 + currentTime * PIXELS_PER_SECOND} y2={editorHeight}
                  stroke="#f43f5e" strokeWidth={1.5} opacity={0.8} />
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* Track summary */}
      <div className="text-xs text-gray-500 flex gap-4">
        <span>Visible: {visibleTracks.length} tracks</span>
        <span>Total notes: {visibleTracks.reduce((sum, t) => sum + t.notes.length, 0)}</span>
        <span>Duration: {duration.toFixed(1)}s</span>
      </div>
    </div>
  );
}

// Harmony computation
function computeHarmony(melodyNotes: TrackNote[], harmonyType: string, scale: string): TrackNote[] {
  const scaleTones = parseScaleTones(scale);

  return melodyNotes.map(note => {
    const midi = note.avg_pitch_midi;
    const semitone = Math.round(midi) % 12;

    let intervals: number[] = [];
    switch (harmonyType) {
      case '3rd':
        intervals = [scaleTones.has((semitone + 4) % 12) ? 4 : 3];
        break;
      case '5th':
        intervals = [7];
        break;
      case 'octave':
        intervals = [12];
        break;
      case 'power_chord':
        intervals = [7, 12];
        break;
      case 'full_triad':
        intervals = [scaleTones.has((semitone + 4) % 12) ? 4 : 3, 7];
        break;
      case '6th':
        intervals = [9];
        break;
      default:
        intervals = [3];
    }

    // Return the first interval note (simplified)
    const interval = intervals[0] ?? 3;
    const harmonyMidi = midi + interval;

    return {
      id: `${note.id}_h${interval}`,
      start_time: note.start_time,
      end_time: note.end_time,
      avg_pitch_midi: harmonyMidi,
      label: midiToNote(harmonyMidi),
      type: 'harmony' as const,
      interval,
    };
  });
}

function computeBackingVocals(melodyNotes: TrackNote[], scale: string): { name: string; notes: TrackNote[] }[] {
  const voices = [
    { name: 'Backing Vocal 1 (Below)', offset: -3 },
    { name: 'Backing Vocal 2 (Above)', offset: 3 },
  ];

  return voices.map(voice => ({
    name: voice.name,
    notes: melodyNotes.map(note => {
      let midi = note.avg_pitch_midi + voice.offset;
      // Keep in vocal range
      if (midi < 48) midi += 12;
      if (midi > 84) midi -= 12;

      return {
        id: `${note.id}_bv${voice.offset}`,
        start_time: note.start_time,
        end_time: note.end_time,
        avg_pitch_midi: midi,
        label: midiToNote(midi),
        type: 'backing' as const,
        voice: voice.offset,
      };
    }),
  }));
}

function parseScaleTones(scale: string): Set<number> {
  const scales: Record<string, number[]> = {
    'c major': [0, 2, 4, 5, 7, 9, 11],
    'g major': [0, 2, 4, 5, 7, 9, 11],
    'd major': [0, 2, 4, 5, 7, 9, 11],
    'a major': [0, 2, 4, 5, 7, 9, 11],
    'e major': [0, 2, 4, 5, 7, 9, 11],
    'b major': [0, 2, 4, 5, 7, 9, 11],
    'f# major': [0, 2, 4, 5, 7, 9, 11],
    'f major': [0, 2, 4, 5, 7, 9, 10],
    'bb major': [0, 2, 4, 5, 7, 9, 10],
    'eb major': [0, 2, 4, 5, 7, 9, 10],
    'a minor': [0, 2, 3, 5, 7, 8, 10],
    'e minor': [0, 2, 3, 5, 7, 8, 10],
    'd minor': [0, 2, 3, 5, 7, 8, 10],
    'g minor': [0, 2, 3, 5, 7, 8, 10],
    'c minor': [0, 2, 3, 5, 7, 8, 10],
    'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  };
  return new Set(scales[scale.toLowerCase()] ?? scales['chromatic']);
}
