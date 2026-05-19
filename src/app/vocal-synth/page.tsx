'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import { AudioContextManager } from '@/services/audio/audioContextManager';
import MelodyneBlobEditor from '@/components/vocal-synth/MelodyneBlobEditor';
import RealtimePitchCorrection from '@/components/vocal-synth/RealtimePitchCorrection';
import MultiTrackEditor from '@/components/vocal-synth/MultiTrackEditor';
import MidiControllerPanel from '@/components/vocal-synth/MidiControllerPanel';
import { exportMelodyToMidi, exportMultiTrackMidi } from '@/utils/vocal-synth/midiExport';

// ============================================================
// Types
// ============================================================

interface SynthNote {
  id: string;
  pitch: number;       // MIDI note number (e.g., 60 = C4)
  start: number;       // Start beat
  duration: number;    // Duration in beats
  lyric: string;       // Lyric/phoneme text
}

type WaveformType = 'sine' | 'triangle' | 'sawtooth' | 'square';

// ============================================================
// Constants
// ============================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DEFAULT_TOTAL_BEATS = 32;
const MAX_TOTAL_BEATS = 256; // up to 64 measures
const CELL_WIDTH = 40;
const CELL_HEIGHT = 20;
const PITCH_MIN = 48; // C3
const PITCH_MAX = 84; // C6
const PITCH_RANGE = PITCH_MAX - PITCH_MIN;
const LABEL_WIDTH = 48;
const DEFAULT_BPM = 120;

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[midi % 12];
  return `${note}${octave}`;
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

// ============================================================
// Web Audio Synth Engine
// ============================================================

class VocalSynthEngine {
  private activeOscillators: Map<string, { osc: OscillatorNode; gain: GainNode }> = new Map();
  waveform: WaveformType = 'sine';
  vibratoEnabled: boolean = true;
  vibratoRate: number = 5;
  vibratoDepth: number = 8;

  private getContext(): AudioContext {
    const ctx = AudioContextManager.instance.getContext();
    void AudioContextManager.instance.resume();
    return ctx;
  }

  playNote(noteId: string, midi: number, durationSec: number) {
    this.stopNote(noteId);
    const ctx = this.getContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = this.waveform;
    osc.frequency.value = midiToFrequency(midi);

    // Vibrato via LFO
    if (this.vibratoEnabled) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = this.vibratoRate;
      lfoGain.gain.value = this.vibratoDepth;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start();
      setTimeout(() => lfo.stop(), (durationSec + 0.2) * 1000);
    }

    // ADSR-like envelope
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
    gain.gain.setValueAtTime(0.2, now + durationSec - 0.05);
    gain.gain.linearRampToValueAtTime(0, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec);

    this.activeOscillators.set(noteId, { osc, gain });
    osc.onended = () => this.activeOscillators.delete(noteId);
  }

  stopNote(noteId: string) {
    const active = this.activeOscillators.get(noteId);
    if (active) {
      try { active.osc.stop(); } catch { /* already stopped */ }
      this.activeOscillators.delete(noteId);
    }
  }

  stopAll() {
    this.activeOscillators.forEach((_, id) => this.stopNote(id));
  }
}

// ============================================================
// Pitch Detection (Autocorrelation)
// ============================================================

function autocorrelationPitchDetect(buffer: Float32Array, sampleRate: number): number | null {
  const n = buffer.length;
  const rms = Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / n);
  if (rms < 0.01) return null; // silence

  // Autocorrelation
  const ac = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n - i; j++) {
      const a = buffer[j];
      const b = buffer[j + i];
      if (a !== undefined && b !== undefined) {
        sum += a * b;
      }
    }
    ac[i] = sum;
  }

  // Find peaks
  let maxVal = -Infinity;
  let maxPos = -1;
  const minPeriod = Math.floor(sampleRate / 2000); // ~2000 Hz max
  const maxPeriod = Math.floor(sampleRate / 50);   // ~50 Hz min

  for (let i = minPeriod; i < maxPeriod && i < n; i++) {
    const val = ac[i] ?? 0;
    if (val > maxVal) {
      maxVal = val;
      maxPos = i;
    }
  }

  if (maxPos <= 0 || maxPos >= n - 1) return null;

  // Parabolic interpolation for better accuracy
  const y1 = ac[maxPos - 1] ?? 0;
  const y2 = ac[maxPos] ?? 0;
  const y3 = ac[maxPos + 1] ?? 0;
  const denom = 2 * (2 * y2 - y1 - y3);
  const shift = denom !== 0 ? (y3 - y1) / denom : 0;
  const interpolatedPos = maxPos + shift;

  return sampleRate / interpolatedPos;
}

function frequencyToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

// Compute RMS energy for a frame (used to detect silence/noise)
function computeRMS(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / frame.length);
}

// Median filter to smooth out noisy pitch detections
function medianFilter(values: (number | null)[], windowSize: number): (number | null)[] {
  const half = Math.floor(windowSize / 2);
  return values.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    const slice = values.slice(start, end).filter((v): v is number => v !== null);
    if (slice.length === 0) return null;
    slice.sort((a, b) => a - b);
    return slice[Math.floor(slice.length / 2)] ?? null;
  });
}

async function detectPitchFromAudio(
  audioBuffer: AudioBuffer,
  bpm: number,
  maxBeats: number = MAX_TOTAL_BEATS
): Promise<SynthNote[]> {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const frameSize = 2048;
  const hopSize = 512;
  const beatsPerSecond = bpm / 60;

  // Step 1: Extract pitch + RMS for each frame
  type FrameData = { time: number; midi: number | null; rms: number };
  const frames: FrameData[] = [];

  // First pass: compute global max RMS for adaptive threshold
  let maxRMS = 0;
  const rmsValues: number[] = [];
  for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
    const frame = channelData.slice(i, i + frameSize);
    const rms = computeRMS(frame);
    rmsValues.push(rms);
    if (rms > maxRMS) maxRMS = rms;
  }
  // Adaptive silence threshold: 15% of max energy
  const silenceThreshold = maxRMS * 0.15;

  let frameIdx = 0;
  for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
    const rms = rmsValues[frameIdx++] ?? 0;
    let midi: number | null = null;
    if (rms >= silenceThreshold) {
      const frame = channelData.slice(i, i + frameSize);
      const freq = autocorrelationPitchDetect(frame, sampleRate);
      if (freq) {
        const m = frequencyToMidi(freq);
        if (m >= 48 && m <= 84 && Number.isFinite(m)) {
          midi = Math.round(m);
        }
      }
    }
    frames.push({ time: i / sampleRate, midi, rms });
  }

  if (frames.length === 0) return [];

  // Step 2: Median filter to smooth noisy pitches (window of 5 frames)
  const smoothedMidis = medianFilter(frames.map(f => f.midi), 5);

  // Step 3: Group consecutive same-pitch frames into notes
  const notes: SynthNote[] = [];
  let currentPitch: number | null = null;
  let startTime = 0;
  let lastTime = 0;
  let frameCount = 0;
  const MIN_FRAMES_PER_NOTE = 4; // ~46ms at 512 hop / 44100 sr
  const PITCH_TOLERANCE = 1; // semitones

  const flushNote = () => {
    if (currentPitch === null || frameCount < MIN_FRAMES_PER_NOTE) return;
    const startBeat = Math.round((startTime * beatsPerSecond) * 4) / 4;
    const endBeat = Math.round((lastTime * beatsPerSecond) * 4) / 4;
    const duration = Math.max(0.25, endBeat - startBeat);
    if (duration >= 0.25 && startBeat < maxBeats) {
      notes.push({
        id: `v${Date.now()}_${notes.length}`,
        pitch: currentPitch,
        start: startBeat,
        duration: Math.min(duration, maxBeats - startBeat),
        lyric: '',
      });
    }
  };

  for (let i = 0; i < smoothedMidis.length; i++) {
    const midi = smoothedMidis[i];
    const frame = frames[i];
    if (midi === null || midi === undefined || !frame) {
      // Silence: flush current note
      flushNote();
      currentPitch = null;
      frameCount = 0;
      continue;
    }
    if (currentPitch === null) {
      currentPitch = midi;
      startTime = frame.time;
      lastTime = frame.time;
      frameCount = 1;
    } else if (Math.abs(midi - currentPitch) <= PITCH_TOLERANCE) {
      lastTime = frame.time;
      frameCount++;
    } else {
      flushNote();
      currentPitch = midi;
      startTime = frame.time;
      lastTime = frame.time;
      frameCount = 1;
    }
  }
  flushNote();

  return notes;
}

// ============================================================
// Demo Data
// ============================================================

const DEMO_NOTES: SynthNote[] = [
  { id: 'n1', pitch: 60, start: 0, duration: 2, lyric: 'き' },
  { id: 'n2', pitch: 62, start: 2, duration: 1, lyric: 'ら' },
  { id: 'n3', pitch: 64, start: 3, duration: 1, lyric: 'き' },
  { id: 'n4', pitch: 65, start: 4, duration: 2, lyric: 'ら' },
  { id: 'n5', pitch: 67, start: 6, duration: 2, lyric: 'ひ' },
  { id: 'n6', pitch: 65, start: 8, duration: 1, lyric: 'か' },
  { id: 'n7', pitch: 64, start: 9, duration: 1, lyric: 'る' },
  { id: 'n8', pitch: 62, start: 10, duration: 2, lyric: 'よ' },
  { id: 'n9', pitch: 60, start: 12, duration: 2, lyric: 'る' },
  { id: 'n10', pitch: 59, start: 14, duration: 1, lyric: 'も' },
  { id: 'n11', pitch: 60, start: 15, duration: 1, lyric: '' },
];

// ============================================================
// Main Component
// ============================================================

const VOCAL_SYNTH_AUTOSAVE_KEY = 'yahooStudio_vocalsynth_autosave';

function loadVocalSynthAutoSave(): { notes: SynthNote[]; bpm: number; totalBeats: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(VOCAL_SYNTH_AUTOSAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.notes || !Array.isArray(data.notes)) return null;
    return data;
  } catch { return null; }
}

export default function VocalSynthPage() {
  const [notes, setNotes] = useState<SynthNote[]>(() => loadVocalSynthAutoSave()?.notes ?? DEMO_NOTES);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [waveform, setWaveform] = useState<WaveformType>('sine');
  const [vibratoOn, setVibratoOn] = useState(true);
  const [editingLyric, setEditingLyric] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'draw' | 'erase'>('draw');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'synth' | 'melodyne' | 'live' | 'multitrack' | 'midi'>('synth');
  const [totalBeats, setTotalBeats] = useState<number>(DEFAULT_TOTAL_BEATS);
  const [melodyneData, setMelodyneData] = useState<any>(null);
  const [melodyneLoading, setMelodyneLoading] = useState(false);
  const [selectedBlob, setSelectedBlob] = useState<string | null>(null);
  const [correctionScale, setCorrectionScale] = useState('C major');

  const synthRef = useRef<VocalSynthEngine | null>(null);
  const playIntervalRef = useRef<number | null>(null);
  const gridRef = useRef<SVGSVGElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Init synth
  useEffect(() => {
    synthRef.current = new VocalSynthEngine();
    return () => { synthRef.current?.stopAll(); };
  }, []);

  // Sync waveform/vibrato settings
  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.waveform = waveform;
      synthRef.current.vibratoEnabled = vibratoOn;
    }
  }, [waveform, vibratoOn]);

  // Playback logic
  const play = useCallback(() => {
    if (isPlaying) return;
    setIsPlaying(true);
    const beatDuration = 60 / bpm;
    const tickMs = beatDuration * 1000 / 4; // 16th note resolution
    let currentTick = playhead * 4;

    playIntervalRef.current = window.setInterval(() => {
      const currentBeat = currentTick / 4;
      setPlayhead(currentBeat);

      // Play notes that start on this tick
      notes.forEach((note) => {
        if (Math.abs(note.start - currentBeat) < 0.05) {
          const durSec = note.duration * beatDuration;
          synthRef.current?.playNote(note.id, note.pitch, durSec);
        }
      });

      currentTick++;
      if (currentTick / 4 >= totalBeats) {
        currentTick = 0;
        setPlayhead(0);
      }
    }, tickMs);
  }, [isPlaying, bpm, notes, playhead]);

  const stop = useCallback(() => {
    setIsPlaying(false);
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    synthRef.current?.stopAll();
  }, []);

  const togglePlayback = useCallback(() => {
    if (isPlaying) stop(); else play();
  }, [isPlaying, play, stop]);

  // MIDI controller note handlers
  const handleMidiNoteOn = useCallback((note: number, velocity: number) => {
    synthRef.current?.playNote(`midi_${note}`, note, 2.0); // 2 sec max, will stop on note off
  }, []);

  const handleMidiNoteOff = useCallback((note: number) => {
    synthRef.current?.stopNote(`midi_${note}`);
  }, []);

  // Backend Melodyne analysis (gracefully fails if backend offline)
  const analyzeWithMelodyne = useCallback(async (file: File) => {
    setMelodyneLoading(true);
    try {
      const formData = new FormData();
      formData.append('audio_file', file);
      const res = await fetch('/api/melodyne/analyze', { method: 'POST', body: formData });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        // Backend not available — silently skip Melodyne (frontend pitch detection still works)
        return;
      }
      const data = await res.json();
      if (data.success) {
        setMelodyneData(data.analysis);
      }
    } catch {
      // Silent: frontend pitch detection is the primary path
    } finally {
      setMelodyneLoading(false);
    }
  }, []);

  const correctPitch = useCallback(async () => {
    if (!melodyneData) return;
    setMelodyneLoading(true);
    try {
      const res = await fetch('/api/melodyne/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale: correctionScale }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        setUploadError('Pitch correction backend unavailable');
        return;
      }
      const data = await res.json();
      if (data.success) setMelodyneData(data.corrected);
    } catch (err) {
      setUploadError(String(err));
    } finally {
      setMelodyneLoading(false);
    }
  }, [melodyneData, correctionScale]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const ctx = AudioContextManager.instance.getContext();
      void AudioContextManager.instance.resume();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      // Run pitch detection in Web Worker (non-blocking UI)
      const detectedNotes = await new Promise<SynthNote[]>((resolve, reject) => {
        try {
          const worker = new Worker('/workers/pitch-detection.worker.js');
          const channelData = audioBuffer.getChannelData(0);
          // Transfer underlying buffer for zero-copy performance
          const transferable = new Float32Array(channelData).buffer;
          worker.onmessage = (ev) => {
            if (ev.data.type === 'done') {
              worker.terminate();
              resolve(ev.data.notes as SynthNote[]);
            }
          };
          worker.onerror = (err) => {
            worker.terminate();
            reject(new Error(err.message || 'Worker error'));
          };
          worker.postMessage({
            channelData: new Float32Array(transferable),
            sampleRate: audioBuffer.sampleRate,
            bpm,
            maxBeats: MAX_TOTAL_BEATS,
          }, [transferable]);
        } catch (workerErr) {
          // Fallback to main-thread implementation
          detectPitchFromAudio(audioBuffer, bpm).then(resolve).catch(reject);
        }
      });

      if (detectedNotes.length === 0) {
        setUploadError('No vocal notes detected. Try a clearer vocal recording with less background noise.');
      } else {
        setNotes(detectedNotes);
        setSelectedNote(null);
        setPlayhead(0);
        const lastBeat = Math.max(...detectedNotes.map(n => n.start + n.duration));
        const requiredBeats = Math.ceil((lastBeat + 4) / 4) * 4;
        setTotalBeats(Math.min(MAX_TOTAL_BEATS, Math.max(DEFAULT_TOTAL_BEATS, requiredBeats)));
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to process audio');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [bpm, analyzeWithMelodyne]);

  // Grid click handler — add/remove notes
  const handleGridClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = gridRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const beat = Math.floor(x / CELL_WIDTH);
    const pitch = PITCH_MAX - Math.floor(y / CELL_HEIGHT);

    if (beat < 0 || beat >= totalBeats || pitch < PITCH_MIN || pitch > PITCH_MAX) return;

    if (tool === 'draw') {
      // Check overlap
      const overlap = notes.find(n => n.pitch === pitch && beat >= n.start && beat < n.start + n.duration);
      if (overlap) {
        setSelectedNote(overlap.id);
        return;
      }
      const newNote: SynthNote = {
        id: `n${Date.now()}`,
        pitch,
        start: beat,
        duration: 1,
        lyric: '',
      };
      setNotes(prev => [...prev, newNote]);
      setSelectedNote(newNote.id);
      // Preview
      synthRef.current?.playNote(newNote.id, pitch, 0.3);
    } else if (tool === 'erase') {
      const hit = notes.find(n => n.pitch === pitch && beat >= n.start && beat < n.start + n.duration);
      if (hit) {
        setNotes(prev => prev.filter(n => n.id !== hit.id));
        if (selectedNote === hit.id) setSelectedNote(null);
      }
    } else {
      const hit = notes.find(n => n.pitch === pitch && beat >= n.start && beat < n.start + n.duration);
      setSelectedNote(hit?.id ?? null);
    }
  }, [notes, tool, selectedNote]);

  // Update lyric for selected note
  const updateLyric = useCallback((noteId: string, lyric: string) => {
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, lyric } : n));
  }, []);

  // Delete selected note
  const deleteSelected = useCallback(() => {
    if (selectedNote) {
      setNotes(prev => prev.filter(n => n.id !== selectedNote));
      setSelectedNote(null);
    }
  }, [selectedNote]);

  // Resize selected note
  const resizeSelected = useCallback((delta: number) => {
    if (!selectedNote) return;
    setNotes(prev => prev.map(n => {
      if (n.id !== selectedNote) return n;
      const newDur = Math.max(1, Math.min(8, n.duration + delta));
      return { ...n, duration: newDur };
    }));
  }, [selectedNote]);

  // Clear all notes
  const clearAll = useCallback(() => {
    stop();
    setNotes([]);
    setSelectedNote(null);
    setPlayhead(0);
  }, [stop]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingLyric) return;
      if (e.key === ' ') { e.preventDefault(); togglePlayback(); }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if (e.key === 'ArrowRight' && selectedNote) resizeSelected(1);
      if (e.key === 'ArrowLeft' && selectedNote) resizeSelected(-1);
      if (e.key === '1') setTool('select');
      if (e.key === '2') setTool('draw');
      if (e.key === '3') setTool('erase');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlayback, deleteSelected, resizeSelected, selectedNote, editingLyric]);

  const gridWidth = totalBeats * CELL_WIDTH;
  const gridHeight = PITCH_RANGE * CELL_HEIGHT;

  // Auto-save notes to localStorage (debounced 500ms)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(VOCAL_SYNTH_AUTOSAVE_KEY, JSON.stringify({ notes, bpm, totalBeats }));
      } catch { /* quota exceeded */ }
    }, 500);
    return () => clearTimeout(t);
  }, [notes, bpm, totalBeats]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">
      <Navigation />

      <main className="pt-20 pb-12 px-4 max-w-[1400px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-pink-500 animate-pulse" />
              Vocal Synth Studio
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Melodyne-grade vocal editing — AI pitch detection, correction, and synthesis
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <button onClick={() => setMode('synth')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'synth' ? 'bg-pink-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              🎹 Classic Synth
            </button>
            <button onClick={() => setMode('melodyne')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'melodyne' ? 'bg-pink-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              🎤 Melodyne Editor
            </button>
            <button onClick={() => setMode('live')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'live' ? 'bg-pink-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              🔴 Live Correction
            </button>
            <button onClick={() => setMode('multitrack')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'multitrack' ? 'bg-pink-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              🎛 Multi-Track
            </button>
            <button onClick={() => setMode('midi')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'midi' ? 'bg-pink-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              🎹 MIDI Controller
            </button>
            {melodyneData && (
              <span className="ml-auto text-xs text-gray-400 self-center">
                Key: {melodyneData.key} | Notes: {melodyneData.num_notes}
              </span>
            )}
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-white dark:bg-[#181e27] rounded-xl border border-gray-200 dark:border-gray-600/60 shadow-lg">
            {/* Transport */}
            <button
              onClick={togglePlayback}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                isPlaying
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-pink-500 text-white hover:bg-pink-600'
              }`}
            >
              {isPlaying ? '⏹ Stop' : '▶ Play'}
            </button>

            <button onClick={() => { stop(); setPlayhead(0); }}
              className="px-3 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >⏮ Reset</button>

            <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />

            {/* Upload Vocal */}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                isUploading
                  ? 'bg-pink-300 dark:bg-pink-800 text-white cursor-wait'
                  : 'bg-pink-500 text-white hover:bg-pink-600'
              }`}
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing...
                </>
              ) : (
                <>🎤 Upload Vocal</>
              )}
            </button>

            <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />

            {/* Tools */}
            {(['select', 'draw', 'erase'] as const).map(t => (
              <button key={t} onClick={() => setTool(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  tool === t
                    ? 'bg-pink-500 text-white border-pink-500'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-pink-400'
                }`}
              >
                {t === 'select' ? '⬚ Select (1)' : t === 'draw' ? '✏ Draw (2)' : '✕ Erase (3)'}
              </button>
            ))}

            <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />

            {/* BPM */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400">BPM</span>
              <input
                type="number" min={40} max={300} value={bpm}
                onChange={e => setBpm(Number(e.target.value))}
                className="w-16 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
            </div>

            {/* Waveform */}
            <select value={waveform} onChange={e => setWaveform(e.target.value as WaveformType)}
              className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            >
              <option value="sine">Sine</option>
              <option value="triangle">Triangle</option>
              <option value="sawtooth">Sawtooth</option>
              <option value="square">Square</option>
            </select>

            {/* Vibrato */}
            <button onClick={() => setVibratoOn(!vibratoOn)}
              className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                vibratoOn
                  ? 'bg-purple-100 dark:bg-purple-900/40 border-purple-400 text-purple-700 dark:text-purple-300'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500'
              }`}
            >
              Vibrato {vibratoOn ? 'ON' : 'OFF'}
            </button>

            <div className="flex-1" />

            {notes.length > 0 && (
              <button onClick={() => {
                exportMelodyToMidi(
                  notes.map(n => ({
                    pitch: n.pitch,
                    start: n.start * (60 / bpm),
                    duration: n.duration * (60 / bpm),
                    velocity: 100,
                  })),
                  { bpm, trackName: 'Vocal_Synth' }
                );
              }}
                className="px-3 py-1.5 rounded-lg text-xs bg-gray-700 text-white hover:bg-gray-600 transition-colors"
              >
                💾 Export MIDI
              </button>
            )}

            <button onClick={clearAll}
              className="px-3 py-1.5 rounded-lg text-xs text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >Clear All</button>
          </div>

          {/* Upload Error */}
          {uploadError && (
            <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
              <span>⚠️</span>
              <span>{uploadError}</span>
              <button onClick={() => setUploadError(null)} className="ml-auto text-xs underline">Dismiss</button>
            </div>
          )}

          {/* Melodyne Editor */}
          {mode === 'melodyne' && melodyneData && (
            <div className="mb-4">
              <div className="flex items-center gap-3 mb-2">
                <select value={correctionScale} onChange={e => setCorrectionScale(e.target.value)}
                  className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200">
                  <option value="C major">C Major</option>
                  <option value="A minor">A Minor</option>
                  <option value="G major">G Major</option>
                  <option value="E minor">E Minor</option>
                  <option value="F major">F Major</option>
                  <option value="D minor">D Minor</option>
                  <option value="chromatic">Chromatic</option>
                </select>
                <button onClick={correctPitch} disabled={melodyneLoading}
                  className="px-3 py-1 text-xs rounded bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50">
                  {melodyneLoading ? 'Processing...' : 'Auto-Correct Pitch'}
                </button>
                <button onClick={() => {
                  exportMelodyToMidi(
                    melodyneData.notes.map((n: any) => ({
                      pitch: n.avg_pitch_midi,
                      start: n.start_time,
                      duration: n.end_time - n.start_time,
                      velocity: Math.round((n.amplitude || 0.5) * 127),
                    })),
                    { bpm, trackName: 'Melodyne_Export' }
                  );
                }} className="px-3 py-1 text-xs rounded bg-gray-700 text-white hover:bg-gray-600">
                  💾 Export MIDI
                </button>
              </div>
              <MelodyneBlobEditor
                notes={melodyneData.notes || []}
                pitchPoints={melodyneData.pitch_points || []}
                duration={melodyneData.duration || 32}
                currentTime={playhead}
                isPlaying={isPlaying}
                scale={melodyneData.scale}
                selectedNoteId={selectedBlob}
                onNoteSelect={setSelectedBlob}
              />
            </div>
          )}

          {/* Live Pitch Correction */}
          {mode === 'live' && (
            <div className="mb-4">
              <RealtimePitchCorrection
                scale={correctionScale}
                correctionStrength={0.8}
              />
            </div>
          )}

          {/* Multi-Track Editor */}
          {mode === 'multitrack' && melodyneData && (
            <div className="mb-4">
              <MultiTrackEditor
                melodyNotes={melodyneData.notes || []}
                scale={melodyneData.scale || 'C major'}
                currentTime={playhead}
                isPlaying={isPlaying}
              />
            </div>
          )}

          {/* MIDI Controller */}
          {mode === 'midi' && (
            <div className="mb-4 space-y-4">
              <MidiControllerPanel
                onNoteOn={handleMidiNoteOn}
                onNoteOff={handleMidiNoteOff}
              />
            </div>
          )}

          {/* Piano Roll */}
          {mode === 'synth' && (
          <div className="bg-white dark:bg-[#1E252E] rounded-xl border border-gray-200 dark:border-gray-600/60 shadow-lg overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: '60vh' }}>
              <div className="flex">
                {/* Pitch Labels */}
                <div className="sticky left-0 z-20 bg-white dark:bg-[#1E252E] border-r border-gray-200 dark:border-gray-600/60" style={{ width: LABEL_WIDTH }}>
                  {Array.from({ length: PITCH_RANGE }, (_, i) => {
                    const midi = PITCH_MAX - i;
                    const black = isBlackKey(midi);
                    return (
                      <div key={midi}
                        className={`flex items-center justify-end pr-2 text-[10px] font-mono border-b ${
                          black
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 border-gray-100 dark:border-gray-800'
                            : 'text-gray-600 dark:text-gray-400 border-gray-100 dark:border-gray-800'
                        } ${midi % 12 === 0 ? 'font-bold text-blue-600 dark:text-blue-400' : ''}`}
                        style={{ height: CELL_HEIGHT }}
                      >
                        {midiToNoteName(midi)}
                      </div>
                    );
                  })}
                </div>

                {/* Grid + Notes */}
                <svg
                  ref={gridRef}
                  width={gridWidth}
                  height={gridHeight}
                  onClick={handleGridClick}
                  className="cursor-crosshair"
                >
                  {/* Grid background */}
                  {Array.from({ length: PITCH_RANGE }, (_, i) => {
                    const midi = PITCH_MAX - i;
                    return (
                      <rect key={`bg-${i}`}
                        x={0} y={i * CELL_HEIGHT} width={gridWidth} height={CELL_HEIGHT}
                        fill={isBlackKey(midi)
                          ? 'var(--grid-black, rgba(0,0,0,0.06))'
                          : 'transparent'}
                        className={isBlackKey(midi) ? 'dark:fill-[rgba(255,255,255,0.03)]' : ''}
                      />
                    );
                  })}

                  {/* Horizontal lines */}
                  {Array.from({ length: PITCH_RANGE + 1 }, (_, i) => (
                    <line key={`h-${i}`}
                      x1={0} y1={i * CELL_HEIGHT} x2={gridWidth} y2={i * CELL_HEIGHT}
                      stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth={0.5}
                    />
                  ))}

                  {/* Vertical lines */}
                  {Array.from({ length: totalBeats + 1 }, (_, i) => (
                    <line key={`v-${i}`}
                      x1={i * CELL_WIDTH} y1={0} x2={i * CELL_WIDTH} y2={gridHeight}
                      stroke="currentColor"
                      className={i % 4 === 0 ? 'text-gray-400 dark:text-gray-500' : 'text-gray-200 dark:text-gray-700'}
                      strokeWidth={i % 4 === 0 ? 1 : 0.5}
                    />
                  ))}

                  {/* Measure numbers */}
                  {Array.from({ length: Math.ceil(totalBeats / 4) }, (_, i) => (
                    <text key={`m-${i}`}
                      x={i * 4 * CELL_WIDTH + 4} y={12}
                      fontSize="9" className="fill-gray-400 dark:fill-gray-500"
                    >
                      {i + 1}
                    </text>
                  ))}

                  {/* Notes */}
                  {notes.map((note) => {
                    const row = PITCH_MAX - note.pitch;
                    const x = note.start * CELL_WIDTH;
                    const w = note.duration * CELL_WIDTH;
                    const y = row * CELL_HEIGHT;
                    const isSelected = selectedNote === note.id;
                    const isActive = isPlaying && playhead >= note.start && playhead < note.start + note.duration;

                    return (
                      <g key={note.id}>
                        <rect
                          x={x + 1} y={y + 1} width={w - 2} height={CELL_HEIGHT - 2} rx={3}
                          fill={isActive ? '#ec4899' : isSelected ? '#f472b6' : 'rgba(236,72,153,0.55)'}
                          stroke={isSelected ? '#fff' : isActive ? '#f9a8d4' : 'transparent'}
                          strokeWidth={isSelected ? 1.5 : 1}
                          className="transition-colors duration-100"
                        />
                        {note.lyric && (
                          <text x={x + 4} y={y + CELL_HEIGHT - 5} fontSize="10" fontWeight="600"
                            fill={isActive || isSelected ? '#fff' : '#fce7f3'}
                            className="pointer-events-none select-none"
                          >
                            {note.lyric}
                          </text>
                        )}
                        {/* Resize handle */}
                        {isSelected && (
                          <rect x={x + w - 6} y={y + 2} width={5} height={CELL_HEIGHT - 4} rx={1}
                            fill="rgba(255,255,255,0.5)" className="cursor-ew-resize" />
                        )}
                      </g>
                    );
                  })}

                  {/* Playhead */}
                  {isPlaying && (
                    <>
                      <line
                        x1={playhead * CELL_WIDTH} y1={0}
                        x2={playhead * CELL_WIDTH} y2={gridHeight}
                        stroke="#f43f5e" strokeWidth={2} opacity={0.8}
                      />
                      <circle cx={playhead * CELL_WIDTH} cy={0} r={4} fill="#f43f5e" />
                    </>
                  )}
                </svg>
              </div>
            </div>

            {/* Lyric Editor Bar */}
            <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-4 bg-gray-50 dark:bg-[#181e27]/50">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Lyrics</span>
              <div className="flex flex-wrap gap-1">
                {notes
                  .sort((a, b) => a.start - b.start)
                  .map((note) => (
                    <div key={note.id} className="flex items-center">
                      {editingLyric === note.id ? (
                        <input
                          autoFocus
                          value={note.lyric}
                          onChange={e => updateLyric(note.id, e.target.value)}
                          onBlur={() => setEditingLyric(null)}
                          onKeyDown={e => { if (e.key === 'Enter') setEditingLyric(null); }}
                          className="w-12 px-1.5 py-0.5 text-xs rounded border border-pink-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-pink-500"
                        />
                      ) : (
                        <button
                          onClick={() => { setSelectedNote(note.id); setEditingLyric(note.id); }}
                          className={`px-2 py-0.5 text-xs rounded transition-colors ${
                            selectedNote === note.id
                              ? 'bg-pink-500 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-pink-100 dark:hover:bg-pink-900/30'
                          }`}
                        >
                          {note.lyric || `♪`}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
              {notes.length === 0 && (
                <span className="text-xs text-gray-400 italic">Draw notes on the grid to get started</span>
              )}
            </div>
          </div>
          )}

          {/* Keyboard shortcuts help */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-400 dark:text-gray-500">
            <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">Space</kbd> Play/Stop</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">1</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px] ml-0.5">2</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px] ml-0.5">3</kbd> Select/Draw/Erase</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">←</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px] ml-0.5">→</kbd> Resize note</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">Del</kbd> Delete note</span>
          </div>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
}
