/**
 * Drum Pattern MIDI Export
 * =========================
 * Export drum machine patterns to standard MIDI files.
 * Uses General MIDI drum channel (channel 10, notes 35-81).
 */

import { generateMidiFile, downloadMidiFile, MidiExportOptions } from '@/utils/vocal-synth/midiExport';

// General MIDI drum mapping
export const DRUM_GM_MAP: Record<string, number> = {
  kick: 36,      // C2 - Bass Drum 1
  snare: 38,     // D2 - Acoustic Snare
  hihat: 42,     // F#2 - Closed Hi-Hat
  openhat: 46,   // A#2 - Open Hi-Hat
  clap: 39,      // D#2 - Hand Clap
  tom: 45,       // A2 - Low Tom
  crash: 49,     // C#3 - Crash Cymbal 1
  ride: 51,      // D#3 - Ride Cymbal 1
  shaker: 82,    // B3 - Shaker
  percussion: 60, // C4 - High Bongo (fallback)
};

export interface DrumExportNote {
  channelId: string;
  stepIndex: number;
  velocity: number;
}

export interface DrumChannel {
  id: string;
  steps: { active: boolean; velocity: number }[];
}

/**
 * Convert drum pattern to MIDI notes for export
 */
export function drumPatternToMidiNotes(
  channels: DrumChannel[],
  bpm: number,
  stepsPerPattern: number = 32
): Array<{ pitch: number; start: number; duration: number; velocity: number }> {
  const notes: Array<{ pitch: number; start: number; duration: number; velocity: number }> = [];
  const secondsPerStep = (60 / bpm) * (4 / stepsPerPattern); // Assuming 1 bar = 32 steps at 16th notes

  for (const channel of channels) {
    const gmNote = DRUM_GM_MAP[channel.id] ?? 35;

    for (let i = 0; i < channel.steps.length; i++) {
      const step = channel.steps[i];
      if (!step || !step.active) continue;

      notes.push({
        pitch: gmNote,
        start: i * secondsPerStep,
        duration: secondsPerStep * 0.5, // Short duration for drums
        velocity: Math.round(step.velocity * 127),
      });
    }
  }

  return notes.sort((a, b) => a.start - b.start);
}

/**
 * Export drum pattern to MIDI file
 */
export function exportDrumPatternToMidi(
  channels: DrumChannel[],
  bpm: number,
  name: string = 'Drum_Pattern',
  stepsPerPattern: number = 32
): void {
  const notes = drumPatternToMidiNotes(channels, bpm, stepsPerPattern);

  const bytes = generateMidiFile(notes, {
    bpm,
    trackName: name,
    timeSignature: [4, 4],
  });

  downloadMidiFile(bytes, `${name}.mid`);
}

/**
 * Export multiple patterns as a song (multi-track MIDI)
 */
export function exportDrumSongToMidi(
  patterns: Array<{
    name: string;
    channels: DrumChannel[];
    bpm: number;
    repeat?: number;
  }>,
  songName: string = 'Drum_Song'
): void {
  const allNotes: Array<{ pitch: number; start: number; duration: number; velocity: number }> = [];
  let currentTime = 0;

  for (const pattern of patterns) {
    const repeats = pattern.repeat ?? 1;
    const notes = drumPatternToMidiNotes(pattern.channels, pattern.bpm);
    const patternDuration = (60 / pattern.bpm) * 4; // 1 bar

    for (let r = 0; r < repeats; r++) {
      for (const note of notes) {
        allNotes.push({
          ...note,
          start: note.start + currentTime,
        });
      }
      currentTime += patternDuration;
    }
  }

  const bytes = generateMidiFile(allNotes, {
    bpm: patterns[0]?.bpm ?? 120,
    trackName: songName,
    timeSignature: [4, 4],
  });

  downloadMidiFile(bytes, `${songName}.mid`);
}

/**
 * Get drum kit info for display
 */
export function getDrumKitInfo(): Array<{ id: string; name: string; gmNote: number; description: string }> {
  return [
    { id: 'kick', name: 'Kick', gmNote: 36, description: 'Bass Drum 1' },
    { id: 'snare', name: 'Snare', gmNote: 38, description: 'Acoustic Snare' },
    { id: 'hihat', name: 'Hi-Hat', gmNote: 42, description: 'Closed Hi-Hat' },
    { id: 'openhat', name: 'Open Hat', gmNote: 46, description: 'Open Hi-Hat' },
    { id: 'clap', name: 'Clap', gmNote: 39, description: 'Hand Clap' },
    { id: 'tom', name: 'Tom', gmNote: 45, description: 'Low Tom' },
    { id: 'crash', name: 'Crash', gmNote: 49, description: 'Crash Cymbal' },
    { id: 'ride', name: 'Ride', gmNote: 51, description: 'Ride Cymbal' },
    { id: 'shaker', name: 'Shaker', gmNote: 82, description: 'Shaker' },
    { id: 'percussion', name: 'Perc', gmNote: 60, description: 'Percussion' },
  ];
}
