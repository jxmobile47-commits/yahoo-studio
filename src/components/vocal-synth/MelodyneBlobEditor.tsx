'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';

interface PitchPoint {
  time: number;
  frequency: number;
  confidence: number;
  midi: number;
  voiced: boolean;
}

interface NoteBlob {
  id: string;
  start_time: number;
  end_time: number;
  avg_pitch_midi: number;
  min_pitch_midi: number;
  max_pitch_midi: number;
  label: string;
  confidence: number;
  amplitude: number;
  is_edited: boolean;
}

interface MelodyneBlobEditorProps {
  notes: NoteBlob[];
  pitchPoints: PitchPoint[];
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  onNoteMove?: (noteId: string, newMidi: number) => void;
  onNoteResize?: (noteId: string, newStart: number, newEnd: number) => void;
  onNoteSelect?: (noteId: string | null) => void;
  selectedNoteId?: string | null;
  scale?: string;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SEMITONE_HEIGHT = 12;
const PIXELS_PER_SECOND = 80;
const PITCH_MIN = 40;  // E2
const PITCH_MAX = 84;  // C6

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[Math.round(midi) % 12];
  return `${note}${octave}`;
}

function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(Math.round(midi) % 12);
}

export default function MelodyneBlobEditor({
  notes,
  pitchPoints,
  duration,
  currentTime,
  isPlaying,
  onNoteMove,
  onNoteResize,
  onNoteSelect,
  selectedNoteId,
  scale,
}: MelodyneBlobEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    noteId: string;
    type: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    startY: number;
    originalMidi: number;
    originalStart: number;
    originalEnd: number;
  } | null>(null);
  const [hoveredNote, setHoveredNote] = useState<string | null>(null);
  const [showPitchCurve, setShowPitchCurve] = useState(true);
  const [snapToScale, setSnapToScale] = useState(true);

  const editorWidth = Math.max(duration * PIXELS_PER_SECOND, 800);
  const editorHeight = (PITCH_MAX - PITCH_MIN + 1) * SEMITONE_HEIGHT;

  // Scale tones for highlighting
  const scaleTones = React.useMemo(() => {
    if (!scale) return new Set<number>();
    // Parse scale
    const parts = scale.split(' ');
    if (parts.length !== 2) return new Set<number>([0,2,4,5,7,9,11]);
    const root = NOTE_NAMES.indexOf(parts[0]);
    const isMinor = parts[1] === 'minor';
    const intervals = isMinor ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11];
    return new Set(intervals.map(i => (root + i) % 12));
  }, [scale]);

  // Pitch curve path
  const pitchPath = React.useMemo(() => {
    if (!pitchPoints.length || !showPitchCurve) return '';
    let path = '';
    let first = true;
    for (const p of pitchPoints) {
      if (!p.voiced || p.midi < PITCH_MIN || p.midi > PITCH_MAX) continue;
      const x = p.time * PIXELS_PER_SECOND;
      const y = (PITCH_MAX - p.midi) * SEMITONE_HEIGHT;
      if (first) {
        path += `M ${x} ${y}`;
        first = false;
      } else {
        path += ` L ${x} ${y}`;
      }
    }
    return path;
  }, [pitchPoints, showPitchCurve]);

  const handleMouseDown = useCallback((e: React.MouseEvent, note: NoteBlob, type: 'move' | 'resize-left' | 'resize-right') => {
    e.stopPropagation();
    onNoteSelect?.(note.id);
    setDragState({
      noteId: note.id,
      type,
      startX: e.clientX,
      startY: e.clientY,
      originalMidi: note.avg_pitch_midi,
      originalStart: note.start_time,
      originalEnd: note.end_time,
    });
  }, [onNoteSelect]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState) return;
    e.preventDefault();

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    if (dragState.type === 'move') {
      const midiDelta = -dy / SEMITONE_HEIGHT;
      let newMidi = dragState.originalMidi + midiDelta;
      if (snapToScale) {
        // Snap to nearest scale tone
        const rounded = Math.round(newMidi);
        const pc = ((rounded % 12) + 12) % 12;
        if (!scaleTones.has(pc)) {
          // Find nearest scale tone
          let nearest = rounded;
          let minDist = 12;
          for (const st of scaleTones) {
            const candidate = rounded - pc + st;
            const dist = Math.abs(candidate - newMidi);
            if (dist < minDist) {
              minDist = dist;
              nearest = candidate;
            }
          }
          newMidi = nearest;
        }
      }
      newMidi = Math.max(PITCH_MIN, Math.min(PITCH_MAX, newMidi));
      onNoteMove?.(dragState.noteId, newMidi);
    } else if (dragState.type === 'resize-left') {
      const timeDelta = dx / PIXELS_PER_SECOND;
      const newStart = Math.max(0, Math.min(dragState.originalEnd - 0.1, dragState.originalStart + timeDelta));
      onNoteResize?.(dragState.noteId, newStart, dragState.originalEnd);
    } else if (dragState.type === 'resize-right') {
      const timeDelta = dx / PIXELS_PER_SECOND;
      const newEnd = Math.max(dragState.originalStart + 0.1, Math.min(duration, dragState.originalEnd + timeDelta));
      onNoteResize?.(dragState.noteId, dragState.originalStart, newEnd);
    }
  }, [dragState, onNoteMove, onNoteResize, snapToScale, scaleTones, duration]);

  const handleMouseUp = useCallback(() => {
    setDragState(null);
  }, []);

  useEffect(() => {
    if (dragState) {
      window.addEventListener('mouseup', handleMouseUp);
      return () => window.removeEventListener('mouseup', handleMouseUp);
    }
  }, [dragState, handleMouseUp]);

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex items-center gap-4 mb-2 px-2">
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={showPitchCurve}
            onChange={(e) => setShowPitchCurve(e.target.checked)}
            className="rounded"
          />
          Show Pitch Curve
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={snapToScale}
            onChange={(e) => setSnapToScale(e.target.checked)}
            className="rounded"
          />
          Snap to Scale {scale && `(${scale})`}
        </label>
        <span className="text-xs text-gray-500 ml-auto">
          {notes.length} notes detected
        </span>
      </div>

      <div ref={containerRef} className="overflow-auto rounded-xl border border-gray-700 bg-[#1E252E]"
        style={{ maxHeight: '60vh' }}
      >
        <svg
          ref={svgRef}
          width={editorWidth + 60}
          height={editorHeight + 20}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className={dragState ? 'cursor-grabbing' : 'cursor-default'}
        >
          {/* Background grid */}
          {Array.from({ length: PITCH_MAX - PITCH_MIN + 2 }, (_, i) => {
            const midi = PITCH_MAX - i;
            const y = i * SEMITONE_HEIGHT;
            const isBlack = isBlackKey(midi);
            const isScale = scaleTones.has(midi % 12);
            return (
              <g key={`grid-${midi}`}>
                {/* Background */}
                <rect
                  x={60}
                  y={y}
                  width={editorWidth}
                  height={SEMITONE_HEIGHT}
                  fill={isBlack ? 'rgba(0,0,0,0.2)' : 'transparent'}
                />
                {isScale && (
                  <rect
                    x={60}
                    y={y}
                    width={editorWidth}
                    height={SEMITONE_HEIGHT}
                    fill="rgba(100,200,100,0.05)"
                  />
                )}
                {/* Label */}
                <text
                  x={55}
                  y={y + SEMITONE_HEIGHT - 2}
                  fontSize="8"
                  textAnchor="end"
                  fill={isBlack ? '#888' : '#ccc'}
                  className={midi % 12 === 0 ? 'font-bold' : ''}
                >
                  {midiToNoteName(midi)}
                </text>
                {/* Grid line */}
                <line
                  x1={60}
                  y1={y}
                  x2={60 + editorWidth}
                  y2={y}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth={0.5}
                />
              </g>
            );
          })}

          {/* Time grid */}
          {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => {
            const x = 60 + i * PIXELS_PER_SECOND;
            return (
              <g key={`time-${i}`}>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={editorHeight}
                  stroke={i % 4 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)'}
                  strokeWidth={i % 4 === 0 ? 1 : 0.5}
                />
                <text
                  x={x + 2}
                  y={12}
                  fontSize="8"
                  fill="rgba(255,255,255,0.3)"
                >
                  {i}s
                </text>
              </g>
            );
          })}

          {/* Pitch curve */}
          {showPitchCurve && pitchPath && (
            <path
              d={pitchPath}
              fill="none"
              stroke="rgba(100,200,255,0.4)"
              strokeWidth={1}
            />
          )}

          {/* Note blobs */}
          {notes.map((note) => {
            const x = 60 + note.start_time * PIXELS_PER_SECOND;
            const y = (PITCH_MAX - note.avg_pitch_midi) * SEMITONE_HEIGHT;
            const w = (note.end_time - note.start_time) * PIXELS_PER_SECOND;
            const h = SEMITONE_HEIGHT;
            const isSelected = selectedNoteId === note.id;
            const isHovered = hoveredNote === note.id;
            const isInScale = scaleTones.has(Math.round(note.avg_pitch_midi) % 12);

            return (
              <g
                key={note.id}
                onMouseDown={(e) => handleMouseDown(e, note, 'move')}
                onMouseEnter={() => setHoveredNote(note.id)}
                onMouseLeave={() => setHoveredNote(null)}
              >
                {/* Blob background */}
                <rect
                  x={x}
                  y={y - SEMITONE_HEIGHT * 0.3}
                  width={w}
                  height={h * 1.6}
                  rx={4}
                  fill={isSelected
                    ? 'rgba(236,72,153,0.6)'
                    : isHovered
                      ? 'rgba(236,72,153,0.4)'
                      : isInScale
                        ? 'rgba(100,200,100,0.3)'
                        : 'rgba(236,72,153,0.25)'
                  }
                  stroke={isSelected ? '#ec4899' : 'transparent'}
                  strokeWidth={isSelected ? 2 : 0}
                  className="transition-all duration-150"
                />

                {/* Pitch variation fill */}
                <rect
                  x={x + 2}
                  y={y - (note.max_pitch_midi - note.avg_pitch_midi) * SEMITONE_HEIGHT}
                  width={w - 4}
                  height={(note.max_pitch_midi - note.min_pitch_midi) * SEMITONE_HEIGHT}
                  rx={2}
                  fill={isSelected ? 'rgba(236,72,153,0.3)' : 'rgba(236,72,153,0.15)'}
                />

                {/* Label */}
                <text
                  x={x + 4}
                  y={y + 8}
                  fontSize="8"
                  fill="white"
                  fontWeight={isSelected ? 'bold' : 'normal'}
                  className="pointer-events-none select-none"
                >
                  {note.label}
                </text>

                {/* Confidence indicator */}
                <rect
                  x={x}
                  y={y + h * 0.8}
                  width={w * note.confidence}
                  height={2}
                  fill={note.confidence > 0.7 ? '#4ade80' : note.confidence > 0.4 ? '#fbbf24' : '#ef4444'}
                  rx={1}
                />

                {/* Resize handles */}
                {isSelected && (
                  <>
                    <rect
                      x={x - 4}
                      y={y - 2}
                      width={8}
                      height={h + 4}
                      fill="rgba(255,255,255,0.5)"
                      rx={2}
                      className="cursor-ew-resize"
                      onMouseDown={(e) => handleMouseDown(e, note, 'resize-left')}
                    />
                    <rect
                      x={x + w - 4}
                      y={y - 2}
                      width={8}
                      height={h + 4}
                      fill="rgba(255,255,255,0.5)"
                      rx={2}
                      className="cursor-ew-resize"
                      onMouseDown={(e) => handleMouseDown(e, note, 'resize-right')}
                    />
                  </>
                )}

                {/* Edited indicator */}
                {note.is_edited && (
                  <circle cx={x + w - 8} cy={y - 4} r={3} fill="#fbbf24" />
                )}
              </g>
            );
          })}

          {/* Playhead */}
          {isPlaying && (
            <g>
              <line
                x1={60 + currentTime * PIXELS_PER_SECOND}
                y1={0}
                x2={60 + currentTime * PIXELS_PER_SECOND}
                y2={editorHeight}
                stroke="#f43f5e"
                strokeWidth={2}
                opacity={0.8}
              />
              <circle
                cx={60 + currentTime * PIXELS_PER_SECOND}
                cy={0}
                r={4}
                fill="#f43f5e"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Note details panel */}
      {selectedNoteId && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 p-3 bg-gray-800 rounded-lg border border-gray-700"
        >
          {(() => {
            const note = notes.find((n) => n.id === selectedNoteId);
            if (!note) return null;
            return (
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-gray-400">Pitch:</span>{' '}
                  <span className="font-mono text-pink-400">{note.label}</span>
                  <span className="text-gray-500 ml-1">({note.avg_pitch_midi.toFixed(1)} MIDI)</span>
                </div>
                <div>
                  <span className="text-gray-400">Time:</span>{' '}
                  <span className="font-mono">{note.start_time.toFixed(2)}s - {note.end_time.toFixed(2)}s</span>
                </div>
                <div>
                  <span className="text-gray-400">Confidence:</span>{' '}
                  <span className={`font-mono ${note.confidence > 0.7 ? 'text-green-400' : note.confidence > 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {(note.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                {note.is_edited && (
                  <span className="text-yellow-400 text-xs">✏ Edited</span>
                )}
              </div>
            );
          })()}
        </motion.div>
      )}
    </div>
  );
}
