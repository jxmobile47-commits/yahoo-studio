'use client';

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { NoteData } from './PianoRollAnalyzer';

interface PianoRollProps {
  notes: NoteData[];
  rowNotes: string[];
  blackKeys: Set<string>;
  totalBars: number;
  beatsPerBar: number;
  quantize: number;
  isPlaying: boolean;
  playheadPos: number;
  onAddNote: (noteName: string, startBeat: number) => void;
  onUpdateNote: (id: number, updates: Partial<NoteData>) => void;
  onDeleteNote: (id: number) => void;
  onQuantizeChange: (q: number) => void;
  snapBeat: (beat: number) => number;
}

const BEAT_WIDTH = 60;
const ROW_HEIGHT = 28;

export default function PianoRoll({
  notes,
  rowNotes,
  blackKeys,
  totalBars,
  beatsPerBar,
  quantize,
  isPlaying,
  playheadPos,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onQuantizeChange,
  snapBeat,
}: PianoRollProps) {
  const gridColumnRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    noteId: number;
    type: 'move' | 'resize';
    startX: number;
    startBeat: number;
    startDuration: number;
  } | null>(null);

  const totalBeats = totalBars * beatsPerBar;
  const totalWidth = Math.max(totalBeats * BEAT_WIDTH, 400);
  const totalHeight = rowNotes.length * ROW_HEIGHT;

  const getRowIndex = useCallback((noteName: string) => rowNotes.indexOf(noteName), [rowNotes]);

  // Mouse interactions
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const block = target.closest('.note-block') as HTMLElement | null;

    if (block) {
      const id = parseInt(block.dataset.id || '0');
      const note = notes.find(n => n.id === id);
      if (!note) return;
      e.preventDefault();

      if (target.classList.contains('resize-handle')) {
        setDragState({
          noteId: id,
          type: 'resize',
          startX: e.clientX,
          startBeat: note.duration,
          startDuration: note.duration,
        });
      } else {
        setDragState({
          noteId: id,
          type: 'move',
          startX: e.clientX,
          startBeat: note.start,
          startDuration: note.duration,
        });
      }
      return;
    }
  }, [notes]);

  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.note-block')) return;

    const canvas = canvasRef.current;
    const gridColumn = gridColumnRef.current;
    if (!canvas || !gridColumn) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left + gridColumn.scrollLeft;
    const y = e.clientY - rect.top + gridColumn.scrollTop;

    const rawBeat = x / BEAT_WIDTH;
    const snapped = snapBeat(rawBeat);
    const rowIdx = Math.floor(y / ROW_HEIGHT);
    if (rowIdx < 0 || rowIdx >= rowNotes.length) return;

    const noteName = rowNotes[rowIdx]!;
    onAddNote(noteName, snapped);
  }, [rowNotes, snapBeat, onAddNote]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const beatDelta = dx / BEAT_WIDTH;

      if (dragState.type === 'move') {
        const newStart = Math.max(0, snapBeat(dragState.startBeat + beatDelta));
        onUpdateNote(dragState.noteId, { start: newStart });
      } else if (dragState.type === 'resize') {
        const newDur = Math.max(0.25, snapBeat(dragState.startBeat + beatDelta));
        onUpdateNote(dragState.noteId, { duration: newDur });
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete selected note logic could go here
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dragState, snapBeat, onUpdateNote]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Piano Roll</span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Quantize:</label>
          <select
            value={quantize}
            onChange={(e) => onQuantizeChange(parseInt(e.target.value))}
            className="bg-[#2e3650] text-gray-200 border border-white/10 rounded px-2 py-0.5 text-xs outline-none focus:border-cyan-400/50"
          >
            <option value={4}>1/4</option>
            <option value={8}>1/8</option>
            <option value={16}>1/16</option>
            <option value={32}>1/32</option>
            <option value={64}>1/64</option>
          </select>
        </div>
      </div>

      {/* Measure labels */}
      <div className="flex h-6 border-b border-white/10 bg-[#1e2435] shrink-0">
        <div className="w-[60px] border-r border-white/10 shrink-0" />
        <div className="flex-1 overflow-hidden relative">
          <div className="flex" style={{ width: totalWidth }}>
            {Array.from({ length: totalBars }, (_, b) => (
              <div
                key={b}
                className="text-[10px] font-semibold text-gray-500 text-center flex items-center justify-center select-none"
                style={{ width: beatsPerBar * BEAT_WIDTH, flexShrink: 0 }}
              >
                {b + 1}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Piano Roll Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Keys column */}
        <div className="w-[60px] shrink-0 border-r border-white/10 overflow-hidden">
          {rowNotes.map((noteName) => {
            const base = noteName.replace(/\d/g, '');
            const isBlack = blackKeys.has(base);
            return (
              <div
                key={noteName}
                className={`h-[28px] flex items-center justify-end pr-2 text-[11px] font-semibold border-b border-white/5 select-none ${
                  isBlack
                    ? 'bg-[#1e2535] text-gray-500'
                    : 'bg-[#d4d8e0] text-[#1a1f2e]'
                }`}
              >
                {noteName}
              </div>
            );
          })}
        </div>

        {/* Grid column */}
        <div
          ref={gridColumnRef}
          className="flex-1 overflow-auto relative"
          style={{ background: '#1a1f2e' }}
        >
          <div
            ref={canvasRef}
            className="relative"
            style={{ width: totalWidth, height: totalHeight }}
            onMouseDown={handleCanvasMouseDown}
            onDoubleClick={handleCanvasDoubleClick}
          >
            {/* Grid lines */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Vertical lines */}
              {Array.from({ length: totalBeats + 1 }, (_, i) => (
                <div
                  key={`v-${i}`}
                  className="absolute top-0 bottom-0"
                  style={{
                    left: i * BEAT_WIDTH,
                    width: i % beatsPerBar === 0 ? '1.5px' : '1px',
                    background: i % beatsPerBar === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)',
                  }}
                />
              ))}
              {/* Horizontal lines */}
              {rowNotes.map((_, idx) => (
                <div
                  key={`h-${idx}`}
                  className="absolute left-0 right-0"
                  style={{
                    top: (idx + 1) * ROW_HEIGHT,
                    height: '1px',
                    background: 'rgba(255,255,255,0.05)',
                  }}
                />
              ))}
            </div>

            {/* Playhead */}
            {isPlaying && (
              <div
                className="absolute top-0 bottom-0 w-0.5 z-50 pointer-events-none"
                style={{
                  left: playheadPos * BEAT_WIDTH,
                  background: '#ff4757',
                  boxShadow: '0 0 10px #ff4757, 0 0 20px rgba(255,71,87,0.5)',
                }}
              />
            )}

            {/* Note blocks */}
            {notes.map((note) => {
              const rIdx = getRowIndex(note.note);
              if (rIdx < 0) return null;
              return (
                <div
                  key={note.id}
                  data-id={note.id}
                  className={`note-block absolute rounded-[3px] flex items-center justify-center text-[10px] font-bold text-[#1a3a1a] overflow-hidden select-none ${
                    dragState?.noteId === note.id ? 'cursor-grabbing opacity-90 z-50' : 'cursor-grab'
                  }`}
                  style={{
                    top: rIdx * ROW_HEIGHT + 2,
                    left: note.start * BEAT_WIDTH + 2,
                    width: Math.max(8, note.duration * BEAT_WIDTH - 4),
                    height: ROW_HEIGHT - 4,
                    background: 'linear-gradient(180deg, #90EE90, #5cb85c)',
                    border: '1px solid #7fdd7f',
                    boxShadow: '0 2px 6px rgba(144,238,144,0.25), inset 0 1px rgba(255,255,255,0.3)',
                  }}
                >
                  {note.duration > 0.75 && note.note}
                  <div
                    className="resize-handle absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
