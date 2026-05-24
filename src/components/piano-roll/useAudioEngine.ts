'use client';

import { useCallback, useRef } from 'react';

export function useAudioEngine() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback((noteName: string, duration = 0.4, type: OscillatorType = 'sine') => {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(noteNameToFreq(noteName), ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Audio context not available
    }
  }, [getAudioCtx]);

  const playChordSound = useCallback((chordName: string) => {
    const chordMap: Record<string, string[]> = {
      Gm: ['G3','Bb3','D4'],
      Bb: ['Bb3','D4','F4'],
      Eb: ['Eb3','G3','Bb3'],
      F: ['F3','A3','C4'],
      Dm: ['D3','F3','A3'],
      Cm: ['C3','Eb3','G3'],
      D: ['D3','F#3','A3'],
      C: ['C3','E3','G3'],
    };
    const notes = chordMap[chordName] || [chordName.replace('m','') + '3'];
    notes.forEach((n, i) => {
      setTimeout(() => playTone(n, 0.6, 'triangle'), i * 40);
    });
  }, [playTone]);

  return { playTone, playChordSound };
}

function noteNameToFreq(noteName: string): number {
  const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const name = noteName.replace(/\d/, '');
  const octave = parseInt(noteName.match(/\d/)?.[0] || '4');
  const idx = notes.indexOf(name);
  const midi = (octave + 1) * 12 + idx;
  return 440 * Math.pow(2, (midi - 69) / 12);
}
