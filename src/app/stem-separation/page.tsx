'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import { downloadAudioBufferAsWav } from '@/utils/audioBufferUtils';
import { separateWithDemucs } from '@/services/audio/demucsService';
import { renderStemAudioDSP } from './dspRenderer';

const STEMS = [
  { key: 'vocals', label: 'Vocals', color: '#ef4444' },
  { key: 'drums', label: 'Drums', color: '#f59e0b' },
  { key: 'bass', label: 'Bass', color: '#3b82f6' },
  { key: 'guitar', label: 'Guitar', color: '#10b981' },
  { key: 'piano', label: 'Piano', color: '#8b5cf6' },
  { key: 'other', label: 'Other', color: '#6b7280' },
];

function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer, color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / w);
  const amp = h / 2;

  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  for (let x = 0; x < w; x++) {
    let min = 0, max = 0;
    for (let s = 0; s < step; s++) {
      const v = data[x * step + s] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx.lineTo(x, h / 2 - max * amp * 0.8);
  }
  for (let x = w - 1; x >= 0; x--) {
    let min = 0;
    for (let s = 0; s < step; s++) {
      const v = data[x * step + s] ?? 0;
      if (v < min) min = v;
    }
    ctx.lineTo(x, h / 2 - min * amp * 0.8);
  }
  ctx.closePath();
  ctx.fillStyle = color + '22';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export default function StemSeparationPage() {
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isSplitting, setIsSplitting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stemBuffers, setStemBuffers] = useState<Record<string, AudioBuffer>>({});
  const [splitDone, setSplitDone] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [quality, setQuality] = useState<'local' | 'dsp' | null>(null);
  const selectedModel = 'htdemucs_6s';

  const stems = STEMS;

  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef(0);
  const rafRef = useRef(0);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const ctx = getAudioContext();
    const arr = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arr);
    setAudioBuffer(decoded);
    setFileName(file.name);
    setUploadedFile(file);
    setSplitDone(false);
    setStemBuffers({});
    setProgress('');
    setError(null);
    setQuality(null);
  }, [getAudioContext]);

  const handleSplit = useCallback(async () => {
    if (!audioBuffer || !uploadedFile) return;
    setIsSplitting(true);
    setProgress('Initializing…');
    setError(null);

    const buffers: Record<string, AudioBuffer> = {};
    const ctx = getAudioContext();

    // 1. Try local HTDemucs first (best quality, requires Python backend)
    try {
      setQuality('local');
      const urls = await separateWithDemucs(uploadedFile, 'htdemucs_6s', ({ message }) => setProgress(message));

      setProgress('Downloading stems…');
      const entries = Object.entries(urls);
      for (let i = 0; i < entries.length; i++) {
        const [name, url] = entries[i]!;
        setProgress(`Loading ${name}… (${i + 1}/${entries.length})`);
        try {
          const res = await fetch(url);
          const arr = await res.arrayBuffer();
          buffers[name] = await ctx.decodeAudioData(arr);
        } catch (e) { console.error(`Failed to load ${name}:`, e); }
      }

      setStemBuffers(buffers);
      setSplitDone(true);
      setIsSplitting(false);
      setProgress('');
      requestAnimationFrame(() => drawStems(buffers));
      return;
    } catch (e) {
      console.warn('Local HTDemucs failed:', e);
      setError(e instanceof Error ? e.message : 'Local HTDemucs failed');
      setProgress('Local AI offline — using browser DSP…');
    }

    // 2. Browser DSP fallback (always works, no server needed)
    setQuality('dsp');
    for (let i = 0; i < stems.length; i++) {
      const stem = stems[i]!;
      setProgress(`Separating ${stem.label} with DSP… (${i + 1}/${stems.length})`);
      try {
        const buf = await renderStemAudioDSP(audioBuffer, {
          key: stem.key,
          label: stem.label,
          color: stem.color,
          freqLow: stem.key === 'vocals' ? 200 : stem.key === 'drums' ? 40 : stem.key === 'bass' ? 20 : stem.key === 'guitar' ? 80 : stem.key === 'piano' ? 150 : 80,
          freqHigh: stem.key === 'bass' ? 250 : stem.key === 'drums' ? 12000 : stem.key === 'guitar' ? 6000 : stem.key === 'piano' ? 8000 : 8000,
          gain: 1.0,
        });
        buffers[stem.key] = buf;
      } catch (e) { console.error(`DSP failed for ${stem.label}:`, e); }
    }

    setStemBuffers(buffers);
    setSplitDone(true);
    setIsSplitting(false);
    setProgress('');
    requestAnimationFrame(() => drawStems(buffers));
  }, [audioBuffer, uploadedFile, getAudioContext]);

  const drawStems = useCallback((buffers: Record<string, AudioBuffer>) => {
    Object.entries(buffers).forEach(([key, buf]) => {
      const canvas = canvasRefs.current[key];
      const stem = STEMS.find(s => s.key === key);
      if (canvas && stem) drawWaveform(canvas, buf, stem.color);
    });
  }, []);

  const playAll = useCallback(() => {
    if (!audioBuffer) return;
    const ctx = getAudioContext();
    if (isPlaying) {
      sourceRef.current?.stop();
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start(0);
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime;
    setIsPlaying(true);

    const tick = () => {
      const t = ctx.currentTime - startTimeRef.current;
      setCurrentTime(Math.min(t, audioBuffer.duration));
      if (t < audioBuffer.duration) rafRef.current = requestAnimationFrame(tick);
      else setIsPlaying(false);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [audioBuffer, isPlaying, getAudioContext]);

  useEffect(() => () => { sourceRef.current?.stop(); cancelAnimationFrame(rafRef.current); audioCtxRef.current?.close().catch(() => {}); }, []);

  const downloadStem = useCallback(async (key: string, label: string) => {
    const buf = stemBuffers[key];
    if (!buf) return;
    const base = fileName.replace(/\.[^.]+$/, '') || 'track';
    await downloadAudioBufferAsWav(buf, `${base}_${label.toLowerCase()}.wav`);
  }, [stemBuffers, fileName]);

  const fmt = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0d1117]">
      <Navigation />
      <main className="pt-20 pb-24 px-4 max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Stem Separation Studio</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Powered by HTDemucs (Meta AI) — 4 or 6 stems with Transformer-based separation</p>

        {!audioBuffer && (
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('audio/')) handleFile(f); }}
            onClick={() => document.getElementById('file-input')?.click()}
            className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-12 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
          >
            <div className="text-4xl mb-3">🎵</div>
            <p className="text-gray-600 dark:text-gray-300 font-medium">Drop audio file or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">MP3, WAV, FLAC, M4A</p>
          </div>
        )}
        <input id="file-input" type="file" accept="audio/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        {audioBuffer && (
          <div className="bg-white dark:bg-[#161b22] rounded-xl p-4 mb-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-800 dark:text-gray-200 text-sm">{fileName}</span>
              <span className="text-xs text-gray-400">{fmt(currentTime)} / {fmt(audioBuffer.duration)}</span>
            </div>
            <canvas ref={el => { if (el) { el.width = el.offsetWidth * 2; el.height = el.offsetHeight * 2; drawWaveform(el, audioBuffer, '#3b82f6'); } }} className="w-full h-24 rounded-lg bg-gray-50 dark:bg-[#0d1117]" />
          </div>
        )}

        {audioBuffer && (
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <button onClick={handleSplit} disabled={isSplitting} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium text-sm transition-colors flex items-center gap-2">
              {isSplitting ? (
                <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>{progress || 'Processing…'}</>
              ) : '✨ Split Stems'}
            </button>
            <button onClick={playAll} className="px-4 py-2.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-lg font-medium text-sm transition-colors">{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
          </div>
        )}

        {error && (
          <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
            ⚠️ {error}
            <p className="text-xs mt-1 text-red-600 dark:text-red-400">
              💡 Start the Python backend: <code className="bg-white dark:bg-[#0d1117] px-1 rounded">cd python_backend && python app.py</code> (requires <code className="bg-white dark:bg-[#0d1117] px-1 rounded">pip install demucs</code>)
            </p>
          </div>
        )}

        {splitDone && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Quality:</span>
            {quality === 'local' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                HTDemucs Local / ~99%
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-semibold">
                🔧 Browser DSP / ~40%
              </span>
            )}
          </div>
        )}

        {splitDone && (
          <div className="space-y-2">
            {stems.map(stem => {
              const has = !!stemBuffers[stem.key];
              return (
                <div key={stem.key} className="bg-white dark:bg-[#161b22] rounded-xl p-3 border border-gray-200 dark:border-gray-700 flex items-center gap-3">
                  <div className="w-16 flex-shrink-0 flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stem.color }} />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{stem.label}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <canvas ref={el => { canvasRefs.current[stem.key] = el; if (el && stemBuffers[stem.key]) { el.width = el.offsetWidth * 2; el.height = el.offsetHeight * 2; drawWaveform(el, stemBuffers[stem.key]!, stem.color); } }} className="w-full h-14 rounded-lg bg-gray-50 dark:bg-[#0d1117]" />
                  </div>
                  <button onClick={() => downloadStem(stem.key, stem.label)} disabled={!has} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 text-white rounded-lg text-xs font-medium transition-colors">⬇ WAV</button>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
