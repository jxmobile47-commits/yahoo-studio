'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import { downloadAudioBufferAsWav } from '@/utils/audioBufferUtils';
import { AudioContextManager } from '@/services/audio/audioContextManager';

// ============================================================
// Types
// ============================================================

interface StemConfig {
  key: string;
  label: string;
  color: string;
  bgColor: string;
  darkBgColor: string;
  filterType: BiquadFilterType;
  freqLow: number;
  freqHigh: number;
  gain: number;
}

interface StemState {
  volume: number; // 0-1
  muted: boolean;
  solo: boolean;
  monitor: boolean;
}

// ============================================================
// Stem Configurations (pseudo-separation via Web Audio filters)
// ============================================================

const STEMS: StemConfig[] = [
  {
    key: 'vocals',
    label: 'Vocals',
    color: '#f43f5e',
    bgColor: 'bg-rose-50',
    darkBgColor: 'dark:bg-rose-950/20',
    filterType: 'bandpass',
    freqLow: 200,
    freqHigh: 4000,
    gain: 1.0,
  },
  {
    key: 'drums',
    label: 'Drums',
    color: '#f59e0b',
    bgColor: 'bg-amber-50',
    darkBgColor: 'dark:bg-amber-950/20',
    filterType: 'bandpass',
    freqLow: 60,
    freqHigh: 8000,
    gain: 1.1,
  },
  {
    key: 'bass',
    label: 'Bass',
    color: '#10b981',
    bgColor: 'bg-emerald-50',
    darkBgColor: 'dark:bg-emerald-950/20',
    filterType: 'lowpass',
    freqLow: 20,
    freqHigh: 250,
    gain: 1.0,
  },
  {
    key: 'piano',
    label: 'Piano',
    color: '#3b82f6',
    bgColor: 'bg-blue-50',
    darkBgColor: 'dark:bg-blue-950/20',
    filterType: 'bandpass',
    freqLow: 250,
    freqHigh: 5000,
    gain: 1.0,
  },
  {
    key: 'guitar',
    label: 'Guitar',
    color: '#a855f7',
    bgColor: 'bg-purple-50',
    darkBgColor: 'dark:bg-purple-950/20',
    filterType: 'bandpass',
    freqLow: 150,
    freqHigh: 3500,
    gain: 1.0,
  },
  {
    key: 'other',
    label: 'Other',
    color: '#6b7280',
    bgColor: 'bg-gray-50',
    darkBgColor: 'dark:bg-gray-950/20',
    filterType: 'highpass',
    freqLow: 4000,
    freqHigh: 20000,
    gain: 0.8,
  },
];

// ============================================================
// Waveform Drawing Helpers
// ============================================================

function drawWaveform(
  canvas: HTMLCanvasElement,
  audioBuffer: AudioBuffer,
  color: string,
  scaleY = 1,
  offsetSamples = 0,
  sampleWidth = 1,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(channelData.length / width / sampleWidth));
  const startSample = Math.floor(offsetSamples);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;

  const halfH = height / 2;

  for (let x = 0; x < width; x++) {
    const sampleIdx = startSample + x * samplesPerPixel;
    if (sampleIdx >= channelData.length) break;

    let min = Infinity;
    let max = -Infinity;
    for (let s = 0; s < samplesPerPixel && sampleIdx + s < channelData.length; s++) {
      const v = channelData[sampleIdx + s] * scaleY;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Infinity) { min = 0; max = 0; }

    const yMin = halfH + min * halfH;
    const yMax = halfH + max * halfH;
    const h = Math.max(1, yMax - yMin);
    ctx.fillRect(x, yMin, 1, h);
  }
}

function drawFilteredWaveform(
  canvas: HTMLCanvasElement,
  audioBuffer: AudioBuffer,
  stem: StemConfig,
  color: string,
  scaleY = 1,
) {
  // Apply filter offline for visualization
  const offlineCtx = new OfflineAudioContext(
    1, audioBuffer.length, audioBuffer.sampleRate
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  let lastNode: AudioNode = source;

  if (stem.filterType === 'bandpass') {
    const freq = (stem.freqLow + stem.freqHigh) / 2;
    const q = freq / (stem.freqHigh - stem.freqLow);
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    lastNode.connect(filter);
    lastNode = filter;
  } else if (stem.filterType === 'lowpass') {
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = stem.freqHigh;
    filter.Q.value = 0.7;
    lastNode.connect(filter);
    lastNode = filter;
  } else if (stem.filterType === 'highpass') {
    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = stem.freqLow;
    filter.Q.value = 0.7;
    lastNode.connect(filter);
    lastNode = filter;
  }

  const gain = offlineCtx.createGain();
  gain.gain.value = stem.gain;
  lastNode.connect(gain);
  gain.connect(offlineCtx.destination);

  source.start(0);

  offlineCtx.startRendering().then((filteredBuffer) => {
    drawWaveform(canvas, filteredBuffer, color, scaleY);
  }).catch(() => {
    // Fallback to raw waveform
    drawWaveform(canvas, audioBuffer, color, scaleY);
  });
}

// ============================================================
// Main Component
// ============================================================

export default function StemSeparationPage() {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [masterVolume, setMasterVolume] = useState(1);
  const [selectedStems, setSelectedStems] = useState<Set<string>>(new Set(STEMS.map(s => s.key)));
  const [stemStates, setStemStates] = useState<Record<string, StemState>>(() => {
    const initial: Record<string, StemState> = {};
    STEMS.forEach(s => {
      initial[s.key] = { volume: 0.75, muted: false, solo: false, monitor: false };
    });
    return initial;
  });
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, _setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<'filter' | 'ai'>('filter');
  const [aiStems, setAiStems] = useState<Record<string, { url: string; filename: string }>>({});
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiModel, setAiModel] = useState<'2stems' | '4stems' | '5stems'>('2stems');
  const [spleeterStatus, setSpleeterStatus] = useState<{ available: boolean; message: string } | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const stopRef = useRef<() => void>(() => {});
  const stemChainsRef = useRef<{
    filter: BiquadFilterNode;
    gain: GainNode;
    analyser: AnalyserNode;
    muteGain: GainNode;
    soloGain: GainNode;
  }[]>([]);
  const masterGainRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const animationRef = useRef<number>(0);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const stemCanvasesRef = useRef<Record<string, HTMLCanvasElement>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);

  // Check Spleeter status on mount
  useEffect(() => {
    fetch('/api/stem/status')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setSpleeterStatus({ available: data.available, message: data.message });
        }
      })
      .catch(() => setSpleeterStatus({ available: false, message: 'Backend unreachable' }));
  }, []);

  // AI Separation function
  const handleAiSeparate = useCallback(async () => {
    if (!fileInputRef.current?.files?.[0]) return;
    setIsAiProcessing(true);

    try {
      const formData = new FormData();
      formData.append('audio_file', fileInputRef.current.files[0]);
      formData.append('model', aiModel);

      const res = await fetch('/api/stem/separate', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success && data.stems) {
        setAiStems(data.stems);
        setMode('ai');
      } else {
        alert(data.error || 'Separation failed');
      }
    } catch (e) {
      console.error('AI separation failed:', e);
      alert('AI separation failed. Is the backend running?');
    } finally {
      setIsAiProcessing(false);
    }
  }, [aiModel]);

  // ============================================================
  // Audio Context Setup
  // ============================================================

  const getAudioContext = useCallback(() => {
    const ctx = AudioContextManager.instance.getContext();
    audioCtxRef.current = ctx;
    void AudioContextManager.instance.resume();
    return ctx;
  }, []);

  // ============================================================
  // File Upload
  // ============================================================

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setFileName(file.name);

    try {
      const ctx = getAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      setAudioBuffer(decoded);
      setDuration(decoded.duration);
      setCurrentTime(0);
      setLoopEnd(decoded.duration);

      // Draw main waveform
      if (mainCanvasRef.current) {
        drawWaveform(mainCanvasRef.current, decoded, '#3b82f6', 0.85);
      }

      // Draw stem waveforms
      STEMS.forEach((stem) => {
        const canvas = stemCanvasesRef.current[stem.key];
        if (canvas) {
          drawFilteredWaveform(canvas, decoded, stem, stem.color, 0.7);
        }
      });
    } catch (err) {
      console.error('Failed to decode audio:', err);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [getAudioContext]);

  // ============================================================
  // Build Stem Audio Chains
  // ============================================================

  const buildStemChains = useCallback((ctx: AudioContext, buffer: AudioBuffer) => {
    // Cleanup old
    stemChainsRef.current.forEach((c) => {
      c.filter.disconnect();
      c.gain.disconnect();
      c.analyser.disconnect();
      c.muteGain.disconnect();
      c.soloGain.disconnect();
    });
    stemChainsRef.current = [];

    const anySolo = Object.values(stemStates).some(s => s.solo);

    STEMS.forEach((stem) => {
      const state = stemStates[stem.key];

      // Source
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      sourceNodesRef.current.push(source);

      // Filter
      const filter = ctx.createBiquadFilter();
      if (stem.filterType === 'bandpass') {
        const freq = (stem.freqLow + stem.freqHigh) / 2;
        const q = freq / (stem.freqHigh - stem.freqLow);
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        filter.Q.value = q;
      } else if (stem.filterType === 'lowpass') {
        filter.type = 'lowpass';
        filter.frequency.value = stem.freqHigh;
        filter.Q.value = 0.7;
      } else {
        filter.type = 'highpass';
        filter.frequency.value = stem.freqLow;
        filter.Q.value = 0.7;
      }

      // Stem volume gain
      const gain = ctx.createGain();
      gain.gain.value = state.volume * stem.gain;

      // Analyser for VU meter
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;

      // Mute/Solo gains
      const muteGain = ctx.createGain();
      muteGain.gain.value = state.muted ? 0 : 1;

      const soloGain = ctx.createGain();
      soloGain.gain.value = (anySolo && !state.solo) ? 0 : 1;

      // Chain: source -> filter -> gain -> analyser -> muteGain -> soloGain -> master
      source.connect(filter);
      filter.connect(gain);
      gain.connect(analyser);
      analyser.connect(muteGain);
      muteGain.connect(soloGain);

      if (!masterGainRef.current) {
        masterGainRef.current = ctx.createGain();
        masterGainRef.current.gain.value = masterVolume;
        masterGainRef.current.connect(ctx.destination);
      }
      soloGain.connect(masterGainRef.current);

      stemChainsRef.current.push({ filter, gain, analyser, muteGain, soloGain });

      source.start(0, pauseTimeRef.current);
    });

    startTimeRef.current = ctx.currentTime - pauseTimeRef.current;
  }, [stemStates, masterVolume]);

  // ============================================================
  // Playback Controls
  // ============================================================

  const play = useCallback(() => {
    if (!audioBuffer || isPlaying) return;

    stop();
    const ctx = getAudioContext();
    sourceNodesRef.current = [];
    buildStemChains(ctx, audioBuffer);

    setIsPlaying(true);

    const update = () => {
      const elapsed = ctx.currentTime - startTimeRef.current;
      let t = elapsed;

      if (loopEnabled && loopEnd > loopStart) {
        const loopLen = loopEnd - loopStart;
        if (t >= loopEnd) {
          t = loopStart + ((t - loopStart) % loopLen);
          // Restart sources at loop point
          stopRef.current();
          pauseTimeRef.current = t;
          sourceNodesRef.current = [];
          buildStemChains(ctx, audioBuffer);
          startTimeRef.current = ctx.currentTime - t;
        }
      }

      if (t >= duration) {
        t = duration;
        setIsPlaying(false);
        pauseTimeRef.current = 0;
        return;
      }

      setCurrentTime(t);
      pauseTimeRef.current = t;
      animationRef.current = requestAnimationFrame(update);
    };

    animationRef.current = requestAnimationFrame(update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBuffer, isPlaying, getAudioContext, buildStemChains, loopEnabled, loopEnd, loopStart, duration]);

  const stop = useCallback(() => {
    stopRef.current = stop;
    sourceNodesRef.current.forEach((s) => {
      try { s.stop(); } catch { /* already stopped */ }
      try { s.disconnect(); } catch { }
    });
    sourceNodesRef.current = [];
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }
    setIsPlaying(false);
  }, []);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stopRef.current();
    } else {
      play();
    }
  }, [isPlaying, play]);

  const seek = useCallback((time: number) => {
    pauseTimeRef.current = Math.max(0, Math.min(time, duration));
    setCurrentTime(pauseTimeRef.current);
    if (isPlaying) {
      stopRef.current();
      setTimeout(() => play(), 50);
    }
  }, [duration, isPlaying, play]);

  // ============================================================
  // Stem State Updates
  // ============================================================

  const updateStemState = useCallback((key: string, patch: Partial<StemState>) => {
    setStemStates((prev) => {
      const next = { ...prev, [key]: { ...prev[key], ...patch } };

      // Handle solo logic: if any stem is soloed, non-soloed stems should be muted
      const anySolo = Object.values(next).some(s => s.solo);
      if (anySolo) {
        // Update soloGain nodes
        const ctx = audioCtxRef.current;
        if (ctx && stemChainsRef.current.length > 0) {
          STEMS.forEach((stem, i) => {
            const chain = stemChainsRef.current[i];
            if (chain) {
              chain.soloGain.gain.setTargetAtTime(
                next[stem.key].solo ? 1 : 0,
                ctx.currentTime,
                0.05
              );
            }
          });
        }
      } else {
        // No solo active, restore all
        const ctx = audioCtxRef.current;
        if (ctx && stemChainsRef.current.length > 0) {
          stemChainsRef.current.forEach((chain) => {
            chain.soloGain.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
          });
        }
      }

      return next;
    });
  }, []);

  // Sync volume/mute changes to active audio nodes
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || stemChainsRef.current.length === 0) return;

    STEMS.forEach((stem, i) => {
      const chain = stemChainsRef.current[i];
      const state = stemStates[stem.key];
      if (chain && state) {
        chain.gain.gain.setTargetAtTime(state.volume * stem.gain, ctx.currentTime, 0.05);
        chain.muteGain.gain.setTargetAtTime(state.muted ? 0 : 1, ctx.currentTime, 0.05);
      }
    });
  }, [stemStates]);

  // Sync master volume
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (ctx && masterGainRef.current) {
      masterGainRef.current.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.05);
    }
  }, [masterVolume]);

  // ============================================================
  // Keyboard Shortcuts
  // ============================================================

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
      if (e.key === 'l' || e.key === 'L') setLoopEnabled(v => !v);
      if (e.key === 'm' || e.key === 'M') {
        // Toggle mute on first selected stem
        const first = STEMS[0];
        if (first) updateStemState(first.key, { muted: !stemStates[first.key].muted });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlayback, stemStates, updateStemState]);

  // ============================================================
  // Cleanup
  // ============================================================

  useEffect(() => {
    return () => {
      stop();
      if (audioCtxRef.current?.state !== 'closed') {
        audioCtxRef.current?.close().catch(() => {});
      }
    };
  }, [stop]);

  // ============================================================
  // VU Meter Component
  // ============================================================

  function VUMeter({ analyser, color }: { analyser: AnalyserNode | undefined; color: string }) {
    const _canvasRef = useRef<HTMLCanvasElement>(null);
    const [level, setLevel] = useState(0);

    useEffect(() => {
      if (!analyser) return;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let animId = 0;

      const draw = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length / 255;
        setLevel(avg);
        animId = requestAnimationFrame(draw);
      };

      draw();
      return () => cancelAnimationFrame(animId);
    }, [analyser]);

    return (
      <div className="flex items-center gap-1 w-16">
        <div className="flex-1 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${level * 100}%`,
              backgroundColor: color,
              opacity: 0.7 + level * 0.3,
            }}
          />
        </div>
        <span className="text-[9px] text-gray-400 w-6 text-right">{Math.round(level * 100)}</span>
      </div>
    );
  }

  // ============================================================
  // Download Mix (combine selected stems into one WAV)
  // ============================================================

  const downloadMix = useCallback(async () => {
    if (!audioBuffer) return;

    const activeStems = STEMS.filter(s => selectedStems.has(s.key));
    if (activeStems.length === 0) return;

    const ctx = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );

    activeStems.forEach((stem) => {
      const state = stemStates[stem.key];
      if (state.muted) return;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      let lastNode: AudioNode = source;

      if (stem.filterType === 'bandpass') {
        const freq = (stem.freqLow + stem.freqHigh) / 2;
        const q = freq / (stem.freqHigh - stem.freqLow);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        filter.Q.value = q;
        lastNode.connect(filter);
        lastNode = filter;
      } else if (stem.filterType === 'lowpass') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = stem.freqHigh;
        filter.Q.value = 0.7;
        lastNode.connect(filter);
        lastNode = filter;
      } else {
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = stem.freqLow;
        filter.Q.value = 0.7;
        lastNode.connect(filter);
        lastNode = filter;
      }

      const gain = ctx.createGain();
      gain.gain.value = state.volume * stem.gain;
      lastNode.connect(gain);
      gain.connect(ctx.destination);

      source.start(0);
    });

    const rendered = await ctx.startRendering();
    const baseName = fileName.replace(/\.[^.]+$/, '') || 'mix';
    await downloadAudioBufferAsWav(rendered, `stem-mix-${baseName}.wav`);
  }, [audioBuffer, selectedStems, stemStates, fileName]);

  // ============================================================
  // Format time
  // ============================================================

  const fmtTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 100);
    return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // ============================================================
  // UI Helpers
  // ============================================================

  const hasAudio = !!audioBuffer;
  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ============================================================
  // Render
  // ============================================================

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
              <span className="w-3 h-3 rounded-full bg-cyan-500 animate-pulse" />
              Stem Separation Studio
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              StemDeck-inspired audio splitting — isolate vocals, drums, bass, piano, guitar & more with Web Audio filters
            </p>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-white dark:bg-[#181e27] rounded-xl border border-gray-200 dark:border-gray-600/60 shadow-lg">
            {/* Transport */}
            <button
              onClick={togglePlayback}
              disabled={!hasAudio}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                isPlaying
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : hasAudio
                    ? 'bg-cyan-500 text-white hover:bg-cyan-600'
                    : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isPlaying ? '⏹ Stop' : '▶ Play'}
            </button>

            <button
              onClick={() => { stop(); pauseTimeRef.current = 0; setCurrentTime(0); }}
              disabled={!hasAudio}
              className="px-3 py-2 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >⏮ Reset</button>

            <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />

            {/* Upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing || isAiProcessing}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                isProcessing || isAiProcessing
                  ? 'bg-cyan-300 dark:bg-cyan-800 text-white cursor-wait'
                  : 'bg-cyan-500 text-white hover:bg-cyan-600'
              }`}
            >
              {isProcessing ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing...
                </>
              ) : (
                <>🎵 Upload Audio</>
              )}
            </button>

            {/* AI Separation */}
            {spleeterStatus?.available && hasAudio && (
              <>
                <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value as '2stems' | '4stems' | '5stems')}
                  className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                >
                  <option value="2stems">2 Stems (Vocals/Inst)</option>
                  <option value="4stems">4 Stems (Vocals/Drums/Bass/Other)</option>
                  <option value="5stems">5 Stems (+ Piano)</option>
                </select>
                <button
                  onClick={handleAiSeparate}
                  disabled={isAiProcessing}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    isAiProcessing
                      ? 'bg-purple-300 dark:bg-purple-800 text-white cursor-wait'
                      : 'bg-purple-600 text-white hover:bg-purple-500'
                  }`}
                >
                  {isAiProcessing ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      AI Separating...
                    </>
                  ) : (
                    <>🤖 AI Separate</>
                  )}
                </button>
              </>
            )}

            {fileName && (
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]">
                {fileName}
              </span>
            )}
            {mode === 'ai' && (
              <span className="px-2 py-0.5 text-[10px] rounded bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300">
                🤖 AI Mode
              </span>
            )}

            <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />

            {/* Loop */}
            <button
              onClick={() => setLoopEnabled(v => !v)}
              disabled={!hasAudio}
              className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                loopEnabled
                  ? 'bg-green-100 dark:bg-green-900/40 border-green-400 text-green-700 dark:text-green-300'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500'
              } disabled:opacity-50`}
            >
              ↻ Loop {loopEnabled ? 'ON' : 'OFF'}
            </button>

            {/* Zoom */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                disabled={!hasAudio}
                className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
              >−</button>
              <span className="text-xs text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom(z => Math.min(4, z + 0.25))}
                disabled={!hasAudio}
                className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
              >+</button>
              <button
                onClick={() => setZoom(1)}
                disabled={!hasAudio}
                className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
              >Fit</button>
            </div>

            <div className="flex-1" />

            {/* Master Volume */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">Master</span>
              <input
                type="range" min={0} max={1} step={0.01}
                value={masterVolume}
                onChange={e => setMasterVolume(Number(e.target.value))}
                className="w-20 accent-cyan-500"
              />
            </div>

            {/* Download */}
            <button
              onClick={downloadMix}
              disabled={!hasAudio}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-700 hover:bg-cyan-200 dark:hover:bg-cyan-900/50 transition-colors disabled:opacity-50"
            >
              ⬇ Download Mix
            </button>
          </div>

          {/* Time display */}
          {hasAudio && (
            <div className="mb-2 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span className="font-mono">{fmtTime(currentTime)}</span>
              <span>/</span>
              <span className="font-mono">{fmtTime(duration)}</span>
              <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden relative cursor-pointer"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - rect.left) / rect.width;
                  seek(pct * duration);
                }}
              >
                <div className="absolute left-0 top-0 h-full bg-cyan-500 rounded-full" style={{ width: `${playheadPercent}%` }} />
              </div>
            </div>
          )}

          {/* Main Waveform */}
          <div className="bg-white dark:bg-[#1E252E] rounded-xl border border-gray-200 dark:border-gray-600/60 shadow-lg overflow-hidden mb-4">
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Original</span>
              {!hasAudio && (
                <span className="text-xs text-gray-400 italic">Upload an audio file to begin</span>
              )}
            </div>
            <div ref={waveformContainerRef} className="relative h-24 bg-gray-50 dark:bg-gray-950 overflow-hidden">
              <canvas
                ref={mainCanvasRef}
                className="w-full h-full"
                style={{ width: '100%', height: '100%' }}
              />
              {hasAudio && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-cyan-500 z-10 pointer-events-none"
                  style={{ left: `${playheadPercent}%` }}
                >
                  <div className="w-2 h-2 rounded-full bg-cyan-500 -translate-x-1/2 -translate-y-1/2" />
                </div>
              )}
            </div>
          </div>

          {/* Stem Lanes */}
          {hasAudio && (
            <div className="space-y-2 mb-4">
              {STEMS.map((stem, idx) => {
                const state = stemStates[stem.key];
                const chain = stemChainsRef.current[idx];
                const isSelected = selectedStems.has(stem.key);

                return (
                  <div
                    key={stem.key}
                    className={`bg-white dark:bg-[#1E252E] rounded-xl border shadow-lg overflow-hidden transition-all ${
                      isSelected
                        ? 'border-gray-200 dark:border-gray-600/60'
                        : 'border-gray-100 dark:border-gray-700/40 opacity-60'
                    }`}
                  >
                    {/* Stem Header */}
                    <div className={`px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3 ${stem.bgColor} ${stem.darkBgColor}`}>
                      {/* Stem chip toggle */}
                      <button
                        onClick={() => {
                          setSelectedStems(prev => {
                            const next = new Set(prev);
                            if (next.has(stem.key)) next.delete(stem.key);
                            else next.add(stem.key);
                            return next;
                          });
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: stem.color, opacity: isSelected ? 1 : 0.3 }}
                        />
                        <span className="text-xs font-semibold" style={{ color: stem.color }}>
                          {stem.label}
                        </span>
                      </button>

                      {/* Volume */}
                      <input
                        type="range" min={0} max={1} step={0.01}
                        value={state.volume}
                        onChange={e => updateStemState(stem.key, { volume: Number(e.target.value) })}
                        className="w-16 accent-cyan-500"
                      />

                      {/* Mute */}
                      <button
                        onClick={() => updateStemState(stem.key, { muted: !state.muted })}
                        className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                          state.muted
                            ? 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-600'
                            : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500'
                        }`}
                      >
                        M
                      </button>

                      {/* Solo */}
                      <button
                        onClick={() => updateStemState(stem.key, { solo: !state.solo })}
                        className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                          state.solo
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700 text-yellow-600'
                            : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500'
                        }`}
                      >
                        S
                      </button>

                      {/* Monitor */}
                      <button
                        onClick={() => {
                          // Monitor = solo only this, clear others
                          const newState: Record<string, StemState> = {};
                          STEMS.forEach(s => {
                            newState[s.key] = {
                              ...stemStates[s.key],
                              solo: s.key === stem.key,
                              monitor: s.key === stem.key,
                            };
                          });
                          setStemStates(newState);
                          // Apply solo gains
                          const ctx = audioCtxRef.current;
                          if (ctx && stemChainsRef.current.length > 0) {
                            STEMS.forEach((s, i) => {
                              const c = stemChainsRef.current[i];
                              if (c) {
                                c.soloGain.gain.setTargetAtTime(s.key === stem.key ? 1 : 0, ctx.currentTime, 0.05);
                              }
                            });
                          }
                        }}
                        className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                          state.monitor
                            ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-600'
                            : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500'
                        }`}
                      >
                        👁
                      </button>

                      <div className="flex-1" />

                      {/* AI Stem Download */}
                      {mode === 'ai' && (() => {
                        const aiStem = aiStems[stem.key];
                        if (!aiStem?.url) return null;
                        return (
                          <a
                            href={aiStem.url}
                            download={aiStem.filename}
                            className="px-2 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                            title="Download stem"
                          >
                            ⬇
                          </a>
                        );
                      })()}

                      {/* VU Meter */}
                      <VUMeter analyser={chain?.analyser} color={stem.color} />
                    </div>

                    {/* Stem Waveform */}
                    <div className="relative h-16 bg-gray-50 dark:bg-gray-950 overflow-hidden">
                      <canvas
                        ref={(el) => { if (el) stemCanvasesRef.current[stem.key] = el; }}
                        className="w-full h-full"
                        style={{ width: '100%', height: '100%' }}
                      />
                      {hasAudio && (
                        <div
                          className="absolute top-0 bottom-0 w-px z-10 pointer-events-none"
                          style={{ left: `${playheadPercent}%`, backgroundColor: stem.color }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {!hasAudio && !isProcessing && (
            <div className="bg-white dark:bg-[#1E252E] rounded-xl border border-gray-200 dark:border-gray-600/60 shadow-lg p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center text-2xl">
                🎵
              </div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
                Upload an Audio File
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 max-w-md mx-auto">
                Drop an MP3 or WAV file to separate it into 6 stems: Vocals, Drums, Bass, Piano, Guitar, and Other.
                Uses Web Audio filters for browser-based pseudo-separation.
              </p>
              {spleeterStatus?.available && (
                <p className="text-xs text-purple-500 dark:text-purple-400 mb-4 max-w-md mx-auto">
                  🤖 AI mode available! Upload then click "AI Separate" for real Spleeter-powered separation.
                </p>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-5 py-2.5 rounded-lg text-sm font-medium bg-cyan-500 text-white hover:bg-cyan-600 transition-colors"
              >
                Choose File
              </button>
            </div>
          )}

          {/* Keyboard shortcuts help */}
          {hasAudio && (
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-400 dark:text-gray-500">
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">Space</kbd> Play/Stop</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">L</kbd> Toggle Loop</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">M</kbd> Toggle Mute (first stem)</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">+</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px] ml-0.5">−</kbd> Zoom</span>
            </div>
          )}
        </motion.div>
      </main>

      <Footer />
    </div>
  );
}
