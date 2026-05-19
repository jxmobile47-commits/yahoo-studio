/**
 * Web Worker hook for ADTLib-inspired drum onset detection.
 * Offloads heavy FFT-energy computation from the main thread to prevent UI jank.
 */
import { useCallback, useRef, useEffect } from 'react';

export interface DetectedOnset {
  time: number;
  channelId: string;
  confidence: number;
}

export interface WorkerMessage {
  type: 'result' | 'error' | 'progress';
  onsets?: DetectedOnset[];
  progress?: number;
  error?: string;
}

export interface WorkerInput {
  mono: Float32Array;
  sampleRate: number;
  bpm: number;
  bands: Array<{ id: string; low: number; high: number; threshold: number; minInterval: number }>;
}

// Worker code as a string (inline blob approach for Next.js compatibility)
const WORKER_SCRIPT = `
self.onmessage = function(e) {
  const { mono, sampleRate, bpm, bands } = e.data;

  function toMono(buffer) {
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.getChannelData(1);
    const mono = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
    return mono;
  }

  function computeBandEnergyCurve(signal, sampleRate, lowFreq, highFreq, windowSize, hopSize) {
    const numFrames = Math.floor((signal.length - windowSize) / hopSize) + 1;
    const energies = [];
    for (let i = 0; i < numFrames; i++) {
      const start = i * hopSize;
      let energy = 0;
      for (let j = start; j < start + windowSize && j < signal.length; j++) {
        energy += signal[j] * signal[j];
      }
      energies.push(Math.sqrt(energy / windowSize));
    }
    return energies;
  }

  function smooth(values, windowSize) {
    const result = [];
    const half = Math.floor(windowSize / 2);
    for (let i = 0; i < values.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
        sum += values[j];
        count++;
      }
      result.push(sum / count);
    }
    return result;
  }

  function findOnsets(energies, threshold, minIntervalSec, frameDuration) {
    const onsets = [];
    const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
    const std = Math.sqrt(energies.reduce((a, b) => a + (b - mean) ** 2, 0) / energies.length);
    const adaptiveThreshold = mean + threshold * std;
    let lastOnset = -minIntervalSec;

    for (let i = 1; i < energies.length - 1; i++) {
      const prev = energies[i - 1];
      const curr = energies[i];
      const next = energies[i + 1];
      const time = i * frameDuration;
      if (curr > adaptiveThreshold && curr > prev && curr >= next && time - lastOnset >= minIntervalSec) {
        const strength = (curr - mean) / (std + 1e-8);
        onsets.push({ time, strength: Math.min(strength, 1) });
        lastOnset = time;
      }
    }
    return onsets;
  }

  try {
    self.postMessage({ type: 'progress', progress: 30 });

    const hopSize = Math.floor(sampleRate * 0.01);
    const windowSize = Math.floor(sampleRate * 0.025);
    const allOnsets = [];

    for (let b = 0; b < bands.length; b++) {
      const band = bands[b];
      const energies = computeBandEnergyCurve(mono, sampleRate, band.low, band.high, windowSize, hopSize);
      const smoothed = smooth(energies, 5);
      const frameDuration = hopSize / sampleRate;
      const onsetsForBand = findOnsets(smoothed, band.threshold, band.minInterval, frameDuration);

      for (const o of onsetsForBand) {
        allOnsets.push({ time: o.time, channelId: band.id, confidence: o.strength });
      }
      self.postMessage({ type: 'progress', progress: 30 + Math.round((b + 1) / bands.length * 60) });
    }

    allOnsets.sort((a, b) => a.time - b.time);
    self.postMessage({ type: 'result', onsets: allOnsets });
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message || 'Worker detection failed' });
  }
};
`;

let globalWorker: Worker | null = null;
let globalRefCount = 0;

function getOrCreateWorker(): Worker {
  if (!globalWorker) {
    const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    globalWorker = new Worker(url);
    globalWorker.onerror = (e) => {
      console.error('[ADTLibWorker] error:', e);
    };
  }
  globalRefCount++;
  return globalWorker;
}

function releaseWorker() {
  globalRefCount--;
  if (globalRefCount <= 0 && globalWorker) {
    globalWorker.terminate();
    globalWorker = null;
    globalRefCount = 0;
  }
}

export interface UseADTLibWorkerOptions {
  onProgress?: (progress: number) => void;
}

export function useADTLibWorker(options: UseADTLibWorkerOptions = {}) {
  const { onProgress } = options;
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, { resolve: (v: DetectedOnset[]) => void; reject: (e: Error) => void }>>(new Map());
  const idRef = useRef(0);

  useEffect(() => {
    const worker = getOrCreateWorker();
    workerRef.current = worker;

    const handleMessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.progress ?? 0);
        return;
      }
      // Find pending promise by message id (not strictly needed for single worker,
      // but keeps the API robust if we ever parallelize)
      const pending = pendingRef.current.get(idRef.current);
      if (!pending) return;

      if (msg.type === 'result') {
        pending.resolve(msg.onsets ?? []);
      } else if (msg.type === 'error') {
        pending.reject(new Error(msg.error || 'Detection failed'));
      }
      pendingRef.current.delete(idRef.current);
    };

    worker.addEventListener('message', handleMessage);
    return () => {
      worker.removeEventListener('message', handleMessage);
      releaseWorker();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const detect = useCallback(
    async (audioBuffer: AudioBuffer, bpm: number): Promise<DetectedOnset[]> => {
      if (!workerRef.current) throw new Error('Worker not initialized');

      const mono = audioBuffer.numberOfChannels === 1
        ? audioBuffer.getChannelData(0)
        : (() => {
            const ch0 = audioBuffer.getChannelData(0);
            const ch1 = audioBuffer.getChannelData(1);
            const m = new Float32Array(audioBuffer.length);
            for (let i = 0; i < audioBuffer.length; i++) m[i] = (ch0[i] + ch1[i]) * 0.5;
            return m;
          })();

      const bands = [
        { id: 'kick', low: 30, high: 120, threshold: 0.15, minInterval: 0.1 },
        { id: 'snare', low: 150, high: 600, threshold: 0.12, minInterval: 0.08 },
        { id: 'hihat', low: 5000, high: 16000, threshold: 0.08, minInterval: 0.05 },
        { id: 'tom', low: 80, high: 250, threshold: 0.1, minInterval: 0.1 },
      ];

      return new Promise((resolve, reject) => {
        idRef.current++;
        pendingRef.current.set(idRef.current, { resolve, reject });
        workerRef.current!.postMessage({ mono, sampleRate: audioBuffer.sampleRate, bpm, bands }, [mono.buffer]);
      });
    },
    []
  );

  return { detect };
}
