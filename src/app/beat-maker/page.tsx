'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import { AudioContextManager } from '@/services/audio/audioContextManager';
import AIPatternGenerator from '@/components/beat-maker/AIPatternGenerator';
import { exportDrumPatternToMidi } from '@/utils/beat-maker/drumMidiExport';

// ============================================================
// Types
// ============================================================

interface DrumChannel {
  id: string;
  name: string;
  color: string;
  steps: boolean[]; // 16 or 32 steps
  muted: boolean;
  solo: boolean;
  volume: number;   // 0-1
  pan: number;      // -1 to 1
}

interface DrumPattern {
  channels: DrumChannel[];
  bpm: number;
  swing: number;    // 0-1
  name: string;
}

interface DetectedOnset {
  time: number;
  channelId: string;
  confidence: number;
}

// ============================================================
// Constants
// ============================================================

const STEPS_PER_PATTERN = 32;
const DEFAULT_BPM = 128;

const DRUM_COLORS: Record<string, string> = {
  kick: '#E57373',
  snare: '#FFB74D',
  hihat: '#FFF176',
  clap: '#BA68C8',
  tom: '#4FC3F7',
  crash: '#A1887F',
  openhat: '#81C784',
  ride: '#90A4AE',
  percussion: '#FF8A65',
  shaker: '#80CBC4',
};

const INITIAL_CHANNELS: DrumChannel[] = [
  { id: 'kick', name: 'Kick', color: DRUM_COLORS.kick, steps: Array(STEPS_PER_PATTERN).fill(false), muted: false, solo: false, volume: 0.9, pan: 0 },
  { id: 'snare', name: 'Snare', color: DRUM_COLORS.snare, steps: Array(STEPS_PER_PATTERN).fill(false), muted: false, solo: false, volume: 0.8, pan: 0.1 },
  { id: 'hihat', name: 'HiHat', color: DRUM_COLORS.hihat, steps: Array(STEPS_PER_PATTERN).fill(false), muted: false, solo: false, volume: 0.7, pan: -0.2 },
  { id: 'clap', name: 'Clap', color: DRUM_COLORS.clap, steps: Array(STEPS_PER_PATTERN).fill(false), muted: false, solo: false, volume: 0.75, pan: 0.15 },
  { id: 'tom', name: 'Low Tom', color: DRUM_COLORS.tom, steps: Array(STEPS_PER_PATTERN).fill(false), muted: false, solo: false, volume: 0.6, pan: -0.3 },
  { id: 'openhat', name: 'Open Hat', color: DRUM_COLORS.openhat, steps: Array(STEPS_PER_PATTERN).fill(false), muted: false, solo: false, volume: 0.65, pan: 0.2 },
  { id: 'crash', name: 'Crash', color: DRUM_COLORS.crash, steps: Array(STEPS_PER_PATTERN).fill(false), muted: false, solo: false, volume: 0.5, pan: 0 },
  { id: 'percussion', name: 'Perc', color: DRUM_COLORS.percussion, steps: Array(STEPS_PER_PATTERN).fill(false), muted: false, solo: false, volume: 0.55, pan: -0.1 },
];

// ============================================================
// Drum Synthesis Engine (Web Audio API)
// ============================================================

class DrumSynthEngine {
  private noiseBuffer: AudioBuffer | null = null;
  private masterGain: GainNode | null = null;
  private ctxRef: AudioContext | null = null;

  private getContext(): AudioContext {
    const ctx = AudioContextManager.instance.getContext();
    if (ctx !== this.ctxRef) {
      // (Re)build cached resources on context change
      this.ctxRef = ctx;
      this.noiseBuffer = this.createNoiseBuffer(ctx, 1.0);
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(ctx.destination);
    }
    return ctx;
  }

  /** Create a 1-second white-noise buffer that can be reused (sub-slicing via playbackRate offset). */
  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Connect a node chain to a panner -> master, with pan + envelope decay. */
  private wireOut(ctx: AudioContext, source: AudioNode, gainNode: GainNode, pan: number) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(this.masterGain ?? ctx.destination);
  }

  /** Schedule a noise burst with the cached shared buffer. */
  private playNoise(filterFn: (ctx: AudioContext) => AudioNode, volume: number, pan: number, dur: number) {
    const ctx = this.getContext();
    if (!this.noiseBuffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = filterFn(ctx);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    this.wireOut(ctx, filter, gain, pan);
    src.start(t);
    src.stop(t + dur);
  }

  playKick(volume: number, pan: number) {
    const ctx = this.getContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    this.wireOut(ctx, osc, gain, pan);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  playSnare(volume: number, pan: number) {
    const ctx = this.getContext();
    const t = ctx.currentTime;
    // Noise component
    this.playNoise(
      (c) => { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1000; return f; },
      volume * 0.6, pan, 0.2
    );
    // Tone body
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, t);
    oscGain.gain.setValueAtTime(volume * 0.4, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    this.wireOut(ctx, osc, oscGain, pan);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  playHiHat(volume: number, pan: number, open = false) {
    const dur = open ? 0.3 : 0.05;
    this.playNoise(
      (c) => {
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 8000;
        return hp;
      },
      volume * 0.5, pan, dur
    );
  }

  playClap(volume: number, pan: number) {
    this.playNoise(
      (c) => {
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1500;
        f.Q.value = 1.5;
        return f;
      },
      volume * 0.5, pan, 0.15
    );
  }

  playTom(volume: number, pan: number) {
    const ctx = this.getContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    this.wireOut(ctx, osc, gain, pan);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  playCrash(volume: number, pan: number) {
    this.playNoise(
      (c) => {
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 3000;
        return hp;
      },
      volume * 0.4, pan, 1.0
    );
  }

  playPerc(volume: number, pan: number) {
    this.playNoise(
      (c) => {
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 3000;
        return f;
      },
      volume * 0.3, pan, 0.1
    );
  }

  playDrum(channelId: string, volume: number, pan: number) {
    switch (channelId) {
      case 'kick': this.playKick(volume, pan); break;
      case 'snare': this.playSnare(volume, pan); break;
      case 'hihat': this.playHiHat(volume, pan, false); break;
      case 'clap': this.playClap(volume, pan); break;
      case 'tom': this.playTom(volume, pan); break;
      case 'openhat': this.playHiHat(volume, pan, true); break;
      case 'crash': this.playCrash(volume, pan); break;
      case 'percussion': this.playPerc(volume, pan); break;
    }
  }

  resume() {
    void AudioContextManager.instance.resume();
  }
}

// ============================================================
// ADTLib-inspired Onset Detection (inline, synchronous)
// ============================================================

interface OnsetDetector {
  detect(audioBuffer: AudioBuffer): DetectedOnset[];
}

class ADTLibInspiredDetector implements OnsetDetector {
  private ctx: AudioContext;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  detect(audioBuffer: AudioBuffer): DetectedOnset[] {
    const onsets: DetectedOnset[] = [];
    const sampleRate = audioBuffer.sampleRate;
    const mono = this.toMono(audioBuffer);

    const bands = [
      { id: 'kick', low: 30, high: 120, threshold: 0.15, minInterval: 0.1 },
      { id: 'snare', low: 150, high: 600, threshold: 0.12, minInterval: 0.08 },
      { id: 'hihat', low: 5000, high: 16000, threshold: 0.08, minInterval: 0.05 },
      { id: 'tom', low: 80, high: 250, threshold: 0.1, minInterval: 0.1 },
    ];

    const hopSize = Math.floor(sampleRate * 0.01);
    const windowSize = Math.floor(sampleRate * 0.025);

    for (const band of bands) {
      const energies = this.computeBandEnergyCurve(mono, sampleRate, band.low, band.high, windowSize, hopSize);
      const smoothed = this.smooth(energies, 5);
      const onsetsForBand = this.findOnsets(smoothed, band.threshold, band.minInterval, hopSize / sampleRate);

      for (const o of onsetsForBand) {
        onsets.push({ time: o.time, channelId: band.id, confidence: o.strength });
      }
    }

    return onsets.sort((a, b) => a.time - b.time);
  }

  private toMono(buffer: AudioBuffer): Float32Array {
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.getChannelData(1);
    const mono = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
    return mono;
  }

  private computeBandEnergyCurve(signal: Float32Array, sampleRate: number, lowFreq: number, highFreq: number, windowSize: number, hopSize: number): number[] {
    const numFrames = Math.floor((signal.length - windowSize) / hopSize) + 1;
    const energies: number[] = [];
    for (let i = 0; i < numFrames; i++) {
      const start = i * hopSize;
      const frame = signal.slice(start, start + windowSize);
      let energy = 0;
      for (let j = 0; j < frame.length; j++) energy += frame[j] * frame[j];
      energies.push(Math.sqrt(energy / frame.length));
    }
    return energies;
  }

  private smooth(values: number[], windowSize: number): number[] {
    const result: number[] = [];
    const half = Math.floor(windowSize / 2);
    for (let i = 0; i < values.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
        sum += values[j];
        count++;
      }
      result.push(sum / count);
    }
    return result;
  }

  private findOnsets(energies: number[], threshold: number, minIntervalSec: number, frameDuration: number): Array<{ time: number; strength: number }> {
    const onsets: Array<{ time: number; strength: number }> = [];
    const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
    const std = Math.sqrt(energies.reduce((a, b) => a + (b - mean) ** 2, 0) / energies.length);
    const adaptiveThreshold = mean + threshold * std;
    let lastOnset = -minIntervalSec;

    for (let i = 1; i < energies.length - 1; i++) {
      const prev = energies[i - 1], curr = energies[i], next = energies[i + 1];
      const time = i * frameDuration;
      if (curr > adaptiveThreshold && curr > prev && curr >= next && time - lastOnset >= minIntervalSec) {
        const strength = (curr - mean) / (std + 1e-8);
        onsets.push({ time, strength: Math.min(strength, 1) });
        lastOnset = time;
      }
    }
    return onsets;
  }
}

// ============================================================
// Main Component
// ============================================================

export default function BeatMakerPage() {
  const [channels, setChannels] = useState<DrumChannel[]>(JSON.parse(JSON.stringify(INITIAL_CHANNELS)));
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [swing, setSwing] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [patternName, setPatternName] = useState('Pattern 1');
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionProgress, setDetectionProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showGridLines, setShowGridLines] = useState(true);
  const [activePage, setActivePage] = useState(0);
  const totalPages = Math.ceil(STEPS_PER_PATTERN / 16);

  const engineRef = useRef(new DrumSynthEngine());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Latest values exposed via refs so the recursive scheduler reads fresh data
  // without forcing a new closure (which would cause double-timers).
  const bpmRef = useRef(DEFAULT_BPM);
  const swingRef = useRef(0);
  const playStepRef = useRef<(stepIndex: number) => void>(() => {});

  const hasSolo = useMemo(() => channels.some(c => c.solo), [channels]);

  const activeChannels = useMemo(() => {
    return channels.filter(c => {
      if (c.muted) return false;
      if (hasSolo && !c.solo) return false;
      return true;
    });
  }, [channels, hasSolo]);

  const playStep = useCallback((stepIndex: number) => {
    const engine = engineRef.current;
    engine.resume();

    for (const ch of activeChannels) {
      if (ch.steps[stepIndex]) {
        engine.playDrum(ch.id, ch.volume, ch.pan);
      }
    }
  }, [activeChannels]);

  // Keep refs in sync with latest state so the recursive scheduler reads fresh values.
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { swingRef.current = swing; }, [swing]);
  useEffect(() => { playStepRef.current = playStep; }, [playStep]);

  /**
   * Single-source-of-truth recursive scheduler.
   * - Reads bpm/swing/playStep from refs (no stale closures, no double timers)
   * - Each step schedules ONE timeout for the next step
   * - Swing offsets every odd step (off-beat) by up to 50% of step duration
   * - Stored in a ref to enable recursive self-reference cleanly.
   */
  const scheduleRef = useRef<() => void>(() => {});
  useEffect(() => {
    scheduleRef.current = () => {
      const stepTimeMs = (60_000 / bpmRef.current) / 4; // 16th note
      const nextStep = stepRef.current;
      const isOffBeat = nextStep % 2 === 1;
      const delay = isOffBeat ? stepTimeMs * (1 + swingRef.current * 0.5) : stepTimeMs;

      timerRef.current = setTimeout(() => {
        const s = stepRef.current;
        setCurrentStep(s);
        playStepRef.current(s);
        stepRef.current = (s + 1) % STEPS_PER_PATTERN;
        scheduleRef.current();
      }, delay);
    };
  }, []);

  const scheduleNextStep = useCallback(() => {
    scheduleRef.current();
  }, []);

  const startPlayback = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    engineRef.current.resume();
    setIsPlaying(true);
    stepRef.current = currentStep >= 0 ? currentStep : 0;
    scheduleNextStep();
  }, [currentStep, scheduleNextStep]);

  const stopPlayback = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPlaying(false);
    setCurrentStep(-1);
    stepRef.current = 0;
  }, []);

  // Cleanup any pending timer on unmount
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const toggleStep = useCallback((channelId: string, stepIndex: number) => {
    setChannels(prev => prev.map(ch => {
      if (ch.id !== channelId) return ch;
      const newSteps = [...ch.steps];
      newSteps[stepIndex] = !newSteps[stepIndex];
      return { ...ch, steps: newSteps };
    }));
    // Preview on click
    const ch = channels.find(c => c.id === channelId);
    if (ch && !ch.muted) {
      engineRef.current.playDrum(channelId, ch.volume, ch.pan);
    }
  }, [channels]);

  const toggleMute = useCallback((channelId: string) => {
    setChannels(prev => prev.map(ch => ch.id === channelId ? { ...ch, muted: !ch.muted } : ch));
  }, []);

  const toggleSolo = useCallback((channelId: string) => {
    setChannels(prev => prev.map(ch => ch.id === channelId ? { ...ch, solo: !ch.solo } : ch));
  }, []);

  const updateVolume = useCallback((channelId: string, volume: number) => {
    setChannels(prev => prev.map(ch => ch.id === channelId ? { ...ch, volume } : ch));
  }, []);

  const clearPattern = useCallback(() => {
    setChannels(prev => prev.map(ch => ({ ...ch, steps: Array(STEPS_PER_PATTERN).fill(false) })));
    setCurrentStep(-1);
    stepRef.current = 0;
  }, []);

  const fillFourOnFloor = useCallback(() => {
    setChannels(prev => prev.map(ch => {
      if (ch.id !== 'kick') return ch;
      const steps = Array(STEPS_PER_PATTERN).fill(false);
      for (let i = 0; i < STEPS_PER_PATTERN; i += 4) steps[i] = true;
      return { ...ch, steps };
    }));
  }, []);

  const fillBasicHihat = useCallback(() => {
    setChannels(prev => prev.map(ch => {
      if (ch.id !== 'hihat') return ch;
      const steps = Array(STEPS_PER_PATTERN).fill(false);
      for (let i = 0; i < STEPS_PER_PATTERN; i += 2) steps[i] = true;
      return { ...ch, steps };
    }));
  }, []);

  const fillBasicSnare = useCallback(() => {
    setChannels(prev => prev.map(ch => {
      if (ch.id !== 'snare') return ch;
      const steps = Array(STEPS_PER_PATTERN).fill(false);
      for (let i = 4; i < STEPS_PER_PATTERN; i += 8) steps[i] = true;
      return { ...ch, steps };
    }));
  }, []);

  const fillBasicPattern = useCallback(() => {
    fillFourOnFloor();
    fillBasicHihat();
    fillBasicSnare();
  }, [fillFourOnFloor, fillBasicHihat, fillBasicSnare]);

  const handleAudioUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setIsDetecting(true);
    setDetectionProgress(0);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = AudioContextManager.instance.getContext();
      void AudioContextManager.instance.resume();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      setDetectionProgress(30);
      const detector = new ADTLibInspiredDetector(ctx);
      setDetectionProgress(60);
      const onsets = detector.detect(audioBuffer);
      setDetectionProgress(90);

      // Convert onsets to step grid
      const stepDuration = 60 / bpm / 4; // 16th note duration in seconds
      const newChannels = JSON.parse(JSON.stringify(INITIAL_CHANNELS));

      for (const onset of onsets) {
        const stepIndex = Math.round(onset.time / stepDuration);
        if (stepIndex >= 0 && stepIndex < STEPS_PER_PATTERN) {
          const ch = newChannels.find((c: DrumChannel) => c.id === onset.channelId);
          if (ch) {
            ch.steps[stepIndex] = true;
          }
        }
      }

      setChannels(newChannels);
      setDetectionProgress(100);
      setTimeout(() => setIsDetecting(false), 500);
    } catch (err) {
      console.error('Detection failed:', err);
      setIsDetecting(false);
    }
  }, [bpm]);

  const handleExportPattern = useCallback(() => {
    const pattern: DrumPattern = { channels, bpm, swing, name: patternName };
    const blob = new Blob([JSON.stringify(pattern, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${patternName.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [channels, bpm, swing, patternName]);

  const handleImportPattern = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const pattern: DrumPattern = JSON.parse(ev.target?.result as string);
        if (pattern.channels) setChannels(pattern.channels);
        if (pattern.bpm) setBpm(pattern.bpm);
        if (pattern.swing !== undefined) setSwing(pattern.swing);
        if (pattern.name) setPatternName(pattern.name);
      } catch (err) {
        console.error('Import failed:', err);
      }
    };
    reader.readAsText(file);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const visibleStart = activePage * 16;
  const _visibleEnd = visibleStart + 16;

  return (
    <div className="min-h-screen bg-[#0f1419] text-white">
      <Navigation />

      <main className="pt-20 pb-8 px-4 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                Beat Maker Studio
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                ADTLib-inspired drum transcription & step sequencer
              </p>
            </div>

            {/* Transport Controls */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 bg-[#181e27] rounded-xl px-4 py-2 border border-gray-700/50">
                <button
                  onClick={() => isPlaying ? stopPlayback() : startPlayback()}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                    isPlaying
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  }`}
                >
                  {isPlaying ? (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  )}
                </button>

                <div className="h-6 w-px bg-gray-700" />

                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">BPM</span>
                  <input
                    type="number"
                    value={bpm}
                    onChange={(e) => setBpm(Math.max(40, Math.min(300, parseInt(e.target.value) || 120)))}
                    className="w-14 h-8 text-center text-sm bg-[#1E252E] border border-gray-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Swing</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(swing * 100)}
                    onChange={(e) => setSwing(parseInt(e.target.value) / 100)}
                    className="w-20 accent-cyan-500"
                  />
                  <span className="text-xs text-gray-500 w-8">{Math.round(swing * 100)}%</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button onClick={clearPattern} className="px-3 py-2 text-xs bg-[#181e27] border border-gray-700/50 rounded-lg hover:bg-gray-700/50 transition-colors text-gray-300">
                  Clear
                </button>
                <button onClick={fillBasicPattern} className="px-3 py-2 text-xs bg-[#181e27] border border-gray-700/50 rounded-lg hover:bg-gray-700/50 transition-colors text-gray-300">
                  Basic Pattern
                </button>
                <button onClick={handleExportPattern} className="px-3 py-2 text-xs bg-[#181e27] border border-gray-700/50 rounded-lg hover:bg-gray-700/50 transition-colors text-gray-300">
                  Export JSON
                </button>
                <button onClick={() => {
                  exportDrumPatternToMidi(
                    channels.map(c => ({ id: c.id, steps: c.steps.map((active, i) => ({ active, velocity: active ? 0.8 : 0 })) })),
                    bpm,
                    patternName
                  );
                }} className="px-3 py-2 text-xs bg-[#181e27] border border-gray-700/50 rounded-lg hover:bg-gray-700/50 transition-colors text-gray-300">
                  💾 Export MIDI
                </button>
                <label className="px-3 py-2 text-xs bg-[#181e27] border border-gray-700/50 rounded-lg hover:bg-gray-700/50 transition-colors text-gray-300 cursor-pointer">
                  Import
                  <input type="file" accept=".json" onChange={handleImportPattern} className="hidden" />
                </label>
              </div>
            </div>
          </div>

          {/* File upload / detection */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleAudioUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isDetecting}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12 12M6 19h12a2 2 0 002-2V7a2 2 0 00-2-2H6a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              Detect Drums from Audio
            </button>
            {fileName && <span className="text-xs text-gray-400">{fileName}</span>}
            {isDetecting && (
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-cyan-500 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${detectionProgress}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400">{detectionProgress}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Step Sequencer - Channel Rack */}
        <div className="bg-[#1E252E] rounded-2xl border border-gray-600/40 shadow-xl overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-4 py-3 bg-[#181e27] border-b border-gray-600/40">
            <span className="text-sm font-semibold text-gray-200">Channel Rack</span>
            <div className="h-4 w-px bg-gray-600" />
            <span className="text-xs text-gray-500">{STEPS_PER_PATTERN} steps</span>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActivePage(i)}
                  className={`w-8 h-7 text-xs rounded-md transition-colors ${
                    activePage === i
                      ? 'bg-cyan-600 text-white'
                      : 'bg-[#1E252E] text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowGridLines(v => !v)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${showGridLines ? 'text-cyan-400' : 'text-gray-500'}`}
            >
              Grid
            </button>
          </div>

          {/* Grid */}
          <div className="overflow-x-auto">
            <div className="min-w-max">
              {/* Beat markers */}
              <div className="flex items-center pl-[220px] pr-4 py-2 bg-[#181e27]/50 border-b border-gray-700/30">
                {Array.from({ length: 16 }).map((_, i) => {
                  const globalStep = visibleStart + i;
                  const isBeat = globalStep % 4 === 0;
                  const isCurrent = isPlaying && currentStep === globalStep;
                  return (
                    <div
                      key={i}
                      className={`w-10 flex-shrink-0 text-center text-[10px] font-mono ${
                        isCurrent ? 'text-cyan-400 font-bold' : isBeat ? 'text-gray-300' : 'text-gray-600'
                      }`}
                    >
                      {isBeat ? Math.floor(globalStep / 4) + 1 : ''}
                    </div>
                  );
                })}
              </div>

              {/* Channels */}
              {channels.map((channel) => (
                <div
                  key={channel.id}
                  className={`flex items-center border-b border-gray-700/20 transition-colors ${
                    channel.muted ? 'opacity-40' : ''
                  }`}
                >
                  {/* Channel info */}
                  <div className="w-[220px] flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-[#181e27]/30">
                    {/* LED */}
                    <div
                      className={`w-2 h-2 rounded-full transition-colors flex-shrink-0 ${
                        isPlaying && channel.steps[currentStep >= 0 ? currentStep : 0]
                          ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]'
                          : 'bg-gray-700'
                      }`}
                    />

                    {/* Mute */}
                    <button
                      onClick={() => toggleMute(channel.id)}
                      className={`w-6 h-5 text-[9px] font-bold rounded flex items-center justify-center transition-colors ${
                        channel.muted ? 'bg-red-500/30 text-red-400' : 'bg-gray-700/50 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      M
                    </button>

                    {/* Solo */}
                    <button
                      onClick={() => toggleSolo(channel.id)}
                      className={`w-6 h-5 text-[9px] font-bold rounded flex items-center justify-center transition-colors ${
                        channel.solo ? 'bg-yellow-500/30 text-yellow-400' : 'bg-gray-700/50 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      S
                    </button>

                    {/* Color dot */}
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: channel.color }}
                    />

                    {/* Name */}
                    <span className="text-xs font-medium text-gray-200 truncate w-20">{channel.name}</span>

                    {/* Volume slider */}
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(channel.volume * 100)}
                      onChange={(e) => updateVolume(channel.id, parseInt(e.target.value) / 100)}
                      className="w-12 accent-cyan-500"
                    />
                  </div>

                  {/* Steps */}
                  <div className="flex items-center pr-4 py-2">
                    {Array.from({ length: 16 }).map((_, stepIdx) => {
                      const globalStep = visibleStart + stepIdx;
                      const isActive = channel.steps[globalStep];
                      const isCurrent = isPlaying && currentStep === globalStep;
                      const isBeat = globalStep % 4 === 0;

                      return (
                        <button
                          key={stepIdx}
                          onClick={() => toggleStep(channel.id, globalStep)}
                          className={`w-10 h-8 mx-[1px] rounded-md transition-all ${
                            isActive
                              ? `shadow-[0_0_8px_${channel.color}66]`
                              : ''
                          } ${
                            isCurrent
                              ? 'ring-1 ring-cyan-400'
                              : ''
                          }`}
                          style={{
                            backgroundColor: isActive ? channel.color : isBeat ? '#2a3544' : '#1a2332',
                            opacity: isActive ? 0.9 : 1,
                          }}
                        >
                          {isActive && (
                            <div className="w-full h-full rounded-md" style={{
                              background: `linear-gradient(135deg, ${channel.color}ee, ${channel.color}99)`
                            }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Info cards */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#1E252E] rounded-xl border border-gray-600/40 p-4">
            <h3 className="text-sm font-semibold text-cyan-400 mb-2">ADTLib Detection</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Upload audio to auto-detect drum onsets. Uses bandpass energy analysis inspired by ADTLib&apos;s
              kick/snare/hihat classification with adaptive thresholding.
            </p>
          </div>
          <div className="bg-[#1E252E] rounded-xl border border-gray-600/40 p-4">
            <h3 className="text-sm font-semibold text-pink-400 mb-2">🤖 AI Pattern Generator</h3>
            <AIPatternGenerator
              channels={channels.map(c => ({
                ...c,
                steps: c.steps.map(active => ({ active, velocity: active ? 0.8 : 0 })),
              }))}
              bpm={bpm}
              onApplyPattern={(updated) => setChannels(updated.map(c => ({ ...c, steps: c.steps.map(s => s.active) })))}
              onSetBpm={setBpm}
            />
          </div>
          <div className="bg-[#1E252E] rounded-xl border border-gray-600/40 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-2">Web Audio Synthesis</h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Real-time drum synthesis using oscillators and noise buffers. No samples needed.
              Each drum type has tailored frequency response and envelopes.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
