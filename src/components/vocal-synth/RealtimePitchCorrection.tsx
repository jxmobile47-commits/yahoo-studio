'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import VocalFeedbackPanel from './VocalFeedbackPanel';

interface PitchData {
  original_pitch: number | null;
  corrected_pitch: number | null;
  correction_cents: number;
  confidence: number;
  in_scale: boolean;
  note_name: string | null;
}

interface RealtimePitchCorrectionProps {
  scale?: string;
  correctionStrength?: number;
}

const SCALE_OPTIONS = [
  'C major', 'G major', 'D major', 'A major', 'E major', 'B major', 'F# major',
  'F major', 'Bb major', 'Eb major',
  'A minor', 'E minor', 'D minor', 'G minor', 'C minor',
  'chromatic',
];

export default function RealtimePitchCorrection({
  scale = 'C major',
  correctionStrength = 0.8,
}: RealtimePitchCorrectionProps) {
  const [isActive, setIsActive] = useState(false);
  const [currentPitch, setCurrentPitch] = useState<PitchData | null>(null);
  const [pitchHistory, setPitchHistory] = useState<PitchData[]>([]);
  const [selectedScale, setSelectedScale] = useState(scale);
  const [strength, setStrength] = useState(correctionStrength);
  const [latency, setLatency] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'monitor' | 'correct'>('correct');

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // WebSocket connection
  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/realtime-pitch`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'config',
        scale: selectedScale,
        correction_strength: strength,
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'pitch') {
        const pitchData: PitchData = {
          original_pitch: data.original_pitch,
          corrected_pitch: data.corrected_pitch,
          correction_cents: data.correction_cents,
          confidence: data.confidence,
          in_scale: data.in_scale,
          note_name: data.note_name,
        };
        setCurrentPitch(pitchData);
        setPitchHistory(prev => [...prev.slice(-99), pitchData]);
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection failed');
    };

    ws.onclose = () => {
      if (isActive) {
        setError('Connection closed');
        setIsActive(false);
      }
    };

    wsRef.current = ws;
    return ws;
  }, [selectedScale, strength, isActive]);

  // Browser-native real-time pitch correction (no server needed for low latency)
  const startBrowserCorrection = useCallback(async () => {
    try {
      setError(null);

      // Get mic input
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000,
        },
      });
      micStreamRef.current = stream;

      // Create AudioContext
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);

      // Create analyser for pitch detection
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      // Connect source to analyser
      source.connect(analyser);

      // Start pitch detection loop
      const buffer = new Float32Array(analyser.fftSize);
      let lastNote: string | null = null;

      const detectLoop = () => {
        if (!isActive) return;

        analyser.getFloatTimeDomainData(buffer);

        // Simple autocorrelation pitch detection
        const pitch = detectPitchAutocorrelation(buffer, ctx.sampleRate);

        if (pitch) {
          const midi = 69 + 12 * Math.log2(pitch / 440);
          const corrected = snapToScale(midi, selectedScale, strength);

          const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          const noteIdx = Math.round(corrected) % 12;
          const octave = Math.floor(Math.round(corrected) / 12) - 1;
          const noteName = `${noteNames[noteIdx]}${octave}`;

          const pitchData: PitchData = {
            original_pitch: midi,
            corrected_pitch: corrected,
            correction_cents: (corrected - midi) * 100,
            confidence: 0.8,
            in_scale: true,
            note_name: noteName,
          };

          setCurrentPitch(pitchData);
          setPitchHistory(prev => [...prev.slice(-99), pitchData]);

          // Note on/off for visual feedback
          if (noteName !== lastNote) {
            lastNote = noteName;
          }
        } else {
          setCurrentPitch(null);
        }

        rafRef.current = requestAnimationFrame(detectLoop);
      };

      rafRef.current = requestAnimationFrame(detectLoop);
      setIsActive(true);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access microphone');
    }
  }, [selectedScale, strength, isActive]);

  const stop = useCallback(() => {
    setIsActive(false);

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Draw pitch visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Draw pitch history
      if (pitchHistory.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(236, 72, 153, 0.6)';
        ctx.lineWidth = 2;

        const pointsToShow = Math.min(pitchHistory.length, 200);
        const startIdx = pitchHistory.length - pointsToShow;

        for (let i = 0; i < pointsToShow; i++) {
          const p = pitchHistory[startIdx + i];
          if (!p || !p.corrected_pitch) continue;

          const x = (i / pointsToShow) * w;
          const y = h - ((p.corrected_pitch - 40) / 50) * h;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // Draw current pitch indicator
      if (currentPitch?.corrected_pitch) {
        const y = h - ((currentPitch.corrected_pitch - 40) / 50) * h;
        ctx.beginPath();
        ctx.arc(w - 20, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = currentPitch.in_scale ? '#4ade80' : '#fbbf24';
        ctx.fill();
      }

      // Draw scale lines
      const scaleTones = parseScaleTones(selectedScale);
      for (let midi = 40; midi <= 90; midi++) {
        if (scaleTones.has(midi % 12)) {
          const y = h - ((midi - 40) / 50) * h;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.strokeStyle = 'rgba(100, 200, 100, 0.15)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      requestAnimationFrame(draw);
    };

    const animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [pitchHistory, currentPitch, selectedScale]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-800 rounded-xl border border-gray-700">
        <button
          onClick={isActive ? stop : startBrowserCorrection}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            isActive
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-pink-500 text-white hover:bg-pink-600'
          }`}
        >
          {isActive ? '⏹ Stop' : '🎤 Start Live Correction'}
        </button>

        <div className="h-6 w-px bg-gray-600" />

        <select
          value={selectedScale}
          onChange={(e) => setSelectedScale(e.target.value)}
          disabled={isActive}
          className="px-2 py-1 text-xs rounded border border-gray-600 bg-gray-700 text-gray-200 disabled:opacity-50"
        >
          {SCALE_OPTIONS.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Strength</span>
          <input
            type="range"
            min={0}
            max={100}
            value={strength * 100}
            onChange={(e) => setStrength(Number(e.target.value) / 100)}
            disabled={isActive}
            className="w-24 accent-pink-500"
          />
          <span className="text-xs text-gray-400 w-8">{Math.round(strength * 100)}%</span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setMode('monitor')}
            className={`px-2 py-1 text-xs rounded ${mode === 'monitor' ? 'bg-gray-600 text-white' : 'text-gray-400'}`}
          >
            Monitor
          </button>
          <button
            onClick={() => setMode('correct')}
            className={`px-2 py-1 text-xs rounded ${mode === 'correct' ? 'bg-pink-600 text-white' : 'text-gray-400'}`}
          >
            Correct
          </button>
        </div>
      </div>

      {error && (
        <div className="p-2 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300">
          ⚠️ {error}
        </div>
      )}

      {/* Pitch display */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Current Note */}
        <motion.div
          className="p-4 bg-gray-800 rounded-xl border border-gray-700 text-center"
          animate={currentPitch ? { scale: [1, 1.02, 1] } : {}}
          transition={{ duration: 0.2 }}
        >
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Current Note</div>
          <div className="text-4xl font-bold text-white">
            {currentPitch?.note_name || '—'}
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {currentPitch?.corrected_pitch?.toFixed(1)} MIDI
          </div>
        </motion.div>

        {/* Correction */}
        <div className="p-4 bg-gray-800 rounded-xl border border-gray-700 text-center">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Correction</div>
          <div className={`text-3xl font-bold ${
            currentPitch && Math.abs(currentPitch.correction_cents) > 10
              ? 'text-yellow-400'
              : 'text-green-400'
          }`}>
            {currentPitch ? `${currentPitch.correction_cents > 0 ? '+' : ''}${currentPitch.correction_cents.toFixed(0)} cents` : '—'}
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {currentPitch?.in_scale ? '✓ In scale' : '⚠ Off key'}
          </div>
        </div>

        {/* Confidence */}
        <div className="p-4 bg-gray-800 rounded-xl border border-gray-700 text-center">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Confidence</div>
          <div className="text-3xl font-bold text-blue-400">
            {currentPitch ? `${(currentPitch.confidence * 100).toFixed(0)}%` : '—'}
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full mt-2 overflow-hidden">
            <motion.div
              className="h-full bg-blue-500"
              animate={{ width: `${(currentPitch?.confidence || 0) * 100}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>
        </div>
      </div>

      {/* Pitch visualization canvas */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <canvas
          ref={canvasRef}
          width={800}
          height={200}
          className="w-full"
        />
      </div>

      {/* Scale indicator */}
      <div className="flex flex-wrap gap-1 justify-center">
        {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((note, i) => {
          const inScale = parseScaleTones(selectedScale).has(i);
          const isCurrent = currentPitch?.note_name?.startsWith(note);
          return (
            <div
              key={note}
              className={`w-8 h-8 rounded flex items-center justify-center text-xs font-mono transition-colors ${
                isCurrent
                  ? 'bg-pink-500 text-white'
                  : inScale
                    ? 'bg-green-900/50 text-green-300'
                    : 'bg-gray-800 text-gray-500'
              }`}
            >
              {note}
            </div>
          );
        })}
      </div>

      {/* Feedback Panel */}
      <VocalFeedbackPanel
        currentNote={currentPitch?.note_name}
        originalMidi={currentPitch?.original_pitch || undefined}
        correctedMidi={currentPitch?.corrected_pitch || undefined}
        scale={selectedScale}
      />
    </div>
  );
}

// Helper functions
function detectPitchAutocorrelation(buffer: Float32Array, sampleRate: number): number | null {
  const n = buffer.length;
  const rms = Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / n);
  if (rms < 0.01) return null;

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

  let maxVal = -Infinity;
  let maxPos = -1;
  const minPeriod = Math.floor(sampleRate / 2000);
  const maxPeriod = Math.floor(sampleRate / 50);

  for (let i = minPeriod; i < maxPeriod && i < n; i++) {
    const val = ac[i] ?? 0;
    if (val > maxVal) {
      maxVal = val;
      maxPos = i;
    }
  }

  if (maxPos <= 0 || maxPos >= n - 1) return null;

  const y1 = ac[maxPos - 1] ?? 0;
  const y2 = ac[maxPos] ?? 0;
  const y3 = ac[maxPos + 1] ?? 0;
  const denom = 2 * (2 * y2 - y1 - y3);
  const shift = denom !== 0 ? (y3 - y1) / denom : 0;

  return sampleRate / (maxPos + shift);
}

function snapToScale(midi: number, scale: string, strength: number): number {
  const scaleTones = parseScaleTones(scale);
  const rounded = Math.round(midi);
  const semitone = ((rounded % 12) + 12) % 12;

  if (scaleTones.has(semitone)) {
    const deviation = midi - rounded;
    return rounded + deviation * (1 - strength);
  }

  let nearest = rounded;
  let minDist = 12;
  for (const st of scaleTones) {
    const candidate = rounded - semitone + st;
    const dist = Math.abs(candidate - midi);
    if (dist < minDist) {
      minDist = dist;
      nearest = candidate;
    }
  }

  return midi + (nearest - midi) * strength;
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
