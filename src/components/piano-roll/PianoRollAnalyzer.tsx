'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import PianoRoll from './PianoRoll';
import DetectionPanel from './DetectionPanel';
import { useAudioEngine } from './useAudioEngine';

export interface NoteData {
  id: number;
  note: string;
  start: number; // beat index
  duration: number; // in beats
}

const ROW_NOTES = [
  'B10','A#10','A10','G#10','G10','F#10','F10','E10','D#10','D10','C#10','C10',
  'B9','A#9','A9','G#9','G9','F#9','F9','E9','D#9','D9','C#9','C9',
  'B8','A#8','A8','G#8','G8','F#8','F8','E8','D#8','D8','C#8','C8',
  'B7','A#7','A7','G#7','G7','F#7','F7','E7','D#7','D7','C#7','C7',
  'B6','A#6','A6','G#6','G6','F#6','F6','E6','D#6','D6','C#6','C6',
  'B5','A#5','A5','G#5','G5','F#5','F5','E5','D#5','D5','C#5','C5',
  'B4','A#4','A4','G#4','G4','F#4','F4','E4','D#4','D4','C#4','C4',
  'B3','A#3','A3','G#3','G3','F#3','F3','E3','D#3','D3','C#3','C3',
  'B2','A#2','A2','G#2','G2','F#2','F2','E2','D#2','D2','C#2','C2',
  'B1','A#1','A1','G#1','G1','F#1','F1','E1','D#1','D1','C#1','C1',
  'B0','A#0','A0','G#0','G0','F#0','F0','E0','D#0','D0','C#0','C0'
];

const BLACK_KEYS = new Set(['C#','D#','F#','G#','A#']);

export default function PianoRollAnalyzer() {
  const [notes, setNotes] = useState<NoteData[]>([
    { note: 'C5', start: 0, duration: 4, id: 1 },
    { note: 'E5', start: 0, duration: 4, id: 2 },
    { note: 'G5', start: 0, duration: 4, id: 3 },
  ]);
  const [nextId, setNextId] = useState(4);
  const [quantize, setQuantize] = useState(8);
  const [bpm, setBpm] = useState(120);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadPos, setPlayheadPos] = useState(0);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { playTone } = useAudioEngine();

  const totalBars = 8;
  const beatsPerBar = 4;
  const totalBeats = totalBars * beatsPerBar;

  const snapBeat = useCallback((beat: number) => {
    const step = beatsPerBar / quantize;
    return Math.max(0, Math.round(beat / step) * step);
  }, [quantize, beatsPerBar]);

  const handleAddNote = useCallback((noteName: string, startBeat: number) => {
    const newNote: NoteData = {
      note: noteName,
      start: startBeat,
      duration: 1,
      id: nextId,
    };
    setNotes(prev => [...prev, newNote]);
    setNextId(prev => prev + 1);
    playTone(noteName, 0.5, 'triangle');
  }, [nextId, playTone]);

  const handleUpdateNote = useCallback((id: number, updates: Partial<NoteData>) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  }, []);

  const handleDeleteNote = useCallback((id: number) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleClear = useCallback(() => {
    setNotes([]);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      setPlayheadPos(0);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    } else {
      setIsPlaying(true);
      let pos = playheadPos;
      playIntervalRef.current = setInterval(() => {
        pos += 0.05;
        if (pos >= totalBeats) {
          pos = 0;
        }
        setPlayheadPos(pos);
        // Trigger notes at exact start
        setNotes(currentNotes => {
          currentNotes.forEach(note => {
            const margin = 0.025;
            if (Math.abs(pos - note.start) < margin) {
              playTone(note.note, 0.5, 'triangle');
            }
          });
          return currentNotes;
        });
      }, 50);
    }
  }, [isPlaying, playheadPos, totalBeats, playTone]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    setPlayheadPos(0);
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-gradient-to-r from-[#1e2435] to-[#1a1f2e] shrink-0 gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
          <h1 className="text-lg font-bold text-white tracking-tight">Piano Roll & Chord Analyzer</h1>
        </div>
        <div className="flex gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-blue-500/90 to-cyan-500/90 border border-white/10 shadow-sm">
            Time: 4/4
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-amber-500/90 to-orange-500/90 border border-white/10 shadow-sm">
            Key: B♭ major
          </span>
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Piano Roll */}
        <div className="w-full min-w-[400px] flex flex-col">
          <PianoRoll
            notes={notes}
            rowNotes={ROW_NOTES}
            blackKeys={BLACK_KEYS}
            totalBars={totalBars}
            beatsPerBar={beatsPerBar}
            quantize={quantize}
            isPlaying={isPlaying}
            playheadPos={playheadPos}
            onAddNote={handleAddNote}
            onUpdateNote={handleUpdateNote}
            onDeleteNote={handleDeleteNote}
            onQuantizeChange={setQuantize}
            snapBeat={snapBeat}
          />
        </div>
      </div>

      {/* Detection Panel */}
      <DetectionPanel notes={notes} />

      {/* Bottom Controls */}
      <div className="flex items-center justify-center gap-4 px-5 py-3 border-t border-white/10 bg-[#1e2435] shrink-0">
        <button
          onClick={togglePlay}
          className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 hover:-translate-y-0.5"
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          )}
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        <button
          onClick={stopPlayback}
          className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-gray-200 bg-[#2e3650] hover:bg-[#3a4566] border border-white/10 transition-all hover:-translate-y-0.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
          Stop
        </button>

        <div className="text-sm font-semibold text-gray-400 font-mono">BPM: {bpm}</div>

        <button
          onClick={handleClear}
          className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 transition-all shadow-lg shadow-red-500/20 hover:shadow-red-500/40 hover:-translate-y-0.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          Clear
        </button>
      </div>
    </div>
  );
}
