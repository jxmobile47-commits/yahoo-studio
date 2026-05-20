/**
 * Browser Analysis Adapter
 *
 * Wraps the pure-JS browser FFT chord detector and produces a full
 * `AnalysisResult` (compatible with the ML backend output) so the existing
 * ChordGrid + downstream UI can render it without changes.
 *
 * Beats are generated from a simple energy-based tempo estimator (autocorrelation
 * of the onset envelope) plus a uniform grid. If tempo detection fails we fall
 * back to 120 BPM, 4/4. This is intentionally lightweight — the goal is to give
 * the user *instant* feedback without waiting on the slow Python ML backend.
 */

import { detectChordsInBrowser, type DetectOptions } from './browserChordDetector';
import type {
  AnalysisResult,
  BeatInfo,
  ChordDetectionResult,
} from '@/types/audioAnalysis';

export interface BrowserAnalyzeOptions extends DetectOptions {
  /** Hint BPM if you have one (e.g. from a previous run). */
  bpmHint?: number;
  /** Beats per measure (defaults to 4). */
  timeSignature?: number;
}

/* -------------------------------------------------------------------------- */
/*  Tempo estimation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Estimate BPM via autocorrelation of an onset envelope.
 * Cheap, runs in well under a second on a 6-minute song.
 */
function estimateBpm(audioBuffer: AudioBuffer): number {
  const sr = audioBuffer.sampleRate;
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;

  // Frame the signal and compute per-frame energy
  const frameSize = 1024;
  const hop = 512;
  const framesPerSec = sr / hop;
  const numFrames = Math.max(1, Math.floor((ch0.length - frameSize) / hop));
  const env = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    let energy = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = ((ch0[start + i] || 0) + (ch1[start + i] || 0)) * 0.5;
      energy += s * s;
    }
    env[f] = Math.sqrt(energy / frameSize);
  }

  // High-pass the envelope (positive spectral flux-ish)
  const flux = new Float32Array(numFrames);
  for (let i = 1; i < numFrames; i++) {
    const d = (env[i] || 0) - (env[i - 1] || 0);
    flux[i] = d > 0 ? d : 0;
  }

  // Autocorrelation across plausible BPM lags (60–200 BPM)
  const minBpm = 60;
  const maxBpm = 200;
  const minLag = Math.floor((framesPerSec * 60) / maxBpm);
  const maxLag = Math.ceil((framesPerSec * 60) / minBpm);

  let bestLag = minLag;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = lag; i < numFrames; i++) {
      score += (flux[i] || 0) * (flux[i - lag] || 0);
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const bpm = (framesPerSec * 60) / bestLag;
  if (!isFinite(bpm) || bpm < minBpm || bpm > maxBpm) return 120;
  return Math.round(bpm * 10) / 10;
}

/* -------------------------------------------------------------------------- */
/*  Main entry                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Decode a File/Blob, run browser FFT chord detection, and emit an
 * `AnalysisResult` compatible with the rest of the UI.
 */
export async function analyzeAudioInBrowser(
  file: Blob | File,
  options: BrowserAnalyzeOptions = {},
): Promise<AnalysisResult> {
  const ctx = new AudioContext();
  const arrayBuf = await file.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuf);

  // 1) chord detection (slowest step — ~2-5s for 6 min)
  options.onProgress?.(0.05);
  const chordResult = await detectChordsInBrowser(audioBuffer, {
    fftSize: options.fftSize ?? 4096,
    hopSize: options.hopSize ?? 2048,
    smoothWindow: options.smoothWindow ?? 9,
    onProgress: (p) => options.onProgress?.(0.05 + p * 0.85),
  });

  // 2) tempo estimation
  options.onProgress?.(0.92);
  const bpm = options.bpmHint ?? estimateBpm(audioBuffer);
  const timeSignature = options.timeSignature ?? 4;
  const beatPeriod = 60 / bpm;
  const duration = audioBuffer.duration;

  // 3) synthetic uniform beat grid
  const numBeats = Math.max(1, Math.floor(duration / beatPeriod));
  const beats: BeatInfo[] = [];
  const downbeats: number[] = [];
  for (let i = 0; i < numBeats; i++) {
    const time = i * beatPeriod;
    const beatNum = (i % timeSignature) + 1;
    beats.push({ time, strength: 0.8, beatNum });
    if (beatNum === 1) downbeats.push(time);
  }

  // 4) snap chord segment starts to nearest beat → synchronizedChords
  // Use a sliding pointer (chords + beats are both time-sorted).
  const segments = chordResult.chords;
  const synchronizedChords: AnalysisResult['synchronizedChords'] = [];
  if (segments.length > 0 && beats.length > 0) {
    let segIdx = 0;
    let activeChord = segments[0]!.chord;
    for (let b = 0; b < beats.length; b++) {
      const beatTime = beats[b]!.time;
      // Advance segment pointer while the next segment has already started
      while (segIdx + 1 < segments.length && segments[segIdx + 1]!.time <= beatTime) {
        segIdx++;
      }
      activeChord = segments[segIdx]!.chord;
      synchronizedChords.push({
        chord: activeChord,
        beatIndex: b,
        beatNum: beats[b]!.beatNum,
      });
    }
  }

  // 5) expand segments into the per-beat `chords` field expected by UI
  const chordsExpanded: ChordDetectionResult[] = segments.map((seg, i) => {
    const start = seg.time;
    const end = i + 1 < segments.length ? segments[i + 1]!.time : duration;
    return {
      chord: seg.chord,
      start,
      end,
      time: start,
      confidence: seg.confidence,
    };
  });

  options.onProgress?.(1);

  // Best-effort cleanup
  try { await ctx.close(); } catch {}

  return {
    chords: chordsExpanded,
    beats,
    downbeats,
    synchronizedChords,
    beatModel: 'browser-energy-autocorr',
    chordModel: 'browser-fft-template',
    audioDuration: duration,
    beatDetectionResult: {
      time_signature: timeSignature,
      bpm,
      beatShift: 0,
      beat_time_range_start: 0,
      beat_time_range_end: duration,
      paddingCount: 0,
      shiftCount: 0,
      beats,
      animationRangeStart: 0,
    },
  };
}
