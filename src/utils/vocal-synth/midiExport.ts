/**
 * Browser-side MIDI File Export Utility
 * =====================================
 * Generates standard MIDI files (.mid) from note data.
 * No server required — pure client-side binary generation.
 *
 * Usage:
 *   const notes = [{ start: 0, duration: 1, pitch: 60, velocity: 100 }];
 *   const bytes = generateMidiFile(notes, { bpm: 120 });
 *   downloadMidiFile(bytes, 'my_song.mid');
 */

export interface MidiExportNote {
  start: number;      // Start time in seconds
  duration: number;   // Duration in seconds
  pitch: number;      // MIDI note (0-127)
  velocity?: number;  // 0-127, default 100
}

export interface MidiExportOptions {
  bpm?: number;
  trackName?: string;
  timeSignature?: [number, number]; // [numerator, denominator]
}

// Write a variable-length quantity (MIDI standard)
function writeVLQ(value: number): number[] {
  const bytes: number[] = [];
  let val = value;
  do {
    bytes.unshift((val & 0x7f) | (bytes.length > 0 ? 0x80 : 0));
    val >>= 7;
  } while (val > 0);
  return bytes.length > 0 ? bytes : [0];
}

function toBytes(value: number, length: number): number[] {
  const bytes: number[] = [];
  for (let i = length - 1; i >= 0; i--) {
    bytes.push((value >> (i * 8)) & 0xff);
  }
  return bytes;
}

/**
 * Generate a complete MIDI file from note data
 */
export function generateMidiFile(
  notes: MidiExportNote[],
  options: MidiExportOptions = {}
): Uint8Array {
  const {
    bpm = 120,
    trackName = 'Vocal Synth',
    timeSignature = [4, 4],
  } = options;

  const ticksPerBeat = 480; // Standard PPQN
  const microsecondsPerBeat = Math.round(60_000_000 / bpm);

  // Convert seconds to MIDI ticks
  const ticksPerSecond = (ticksPerBeat * bpm) / 60;

  // Build track events
  const trackEvents: { delta: number; data: number[] }[] = [];

  // Track name meta event (0x03)
  const nameBytes = new TextEncoder().encode(trackName);
  trackEvents.push({
    delta: 0,
    data: [
      0xff, 0x03, nameBytes.length,
      ...Array.from(nameBytes),
    ],
  });

  // Time signature meta event (0x58)
  trackEvents.push({
    delta: 0,
    data: [
      0xff, 0x58, 0x04,
      timeSignature[0],
      Math.log2(timeSignature[1]),
      0x18, 0x08, // clocks per click, 32nd notes per quarter
    ],
  });

  // Set tempo meta event (0x51)
  trackEvents.push({
    delta: 0,
    data: [
      0xff, 0x51, 0x03,
      ...toBytes(microsecondsPerBeat, 3),
    ],
  });

  // Sort all note events by time
  interface TimedEvent {
    tick: number;
    type: 'on' | 'off';
    pitch: number;
    velocity: number;
  }

  const events: TimedEvent[] = [];
  for (const note of notes) {
    const startTick = Math.round(note.start * ticksPerSecond);
    const endTick = Math.round((note.start + note.duration) * ticksPerSecond);
    events.push({
      tick: startTick,
      type: 'on',
      pitch: note.pitch,
      velocity: note.velocity ?? 100,
    });
    events.push({
      tick: endTick,
      type: 'off',
      pitch: note.pitch,
      velocity: 0,
    });
  }

  // Sort by tick, then off before on at same tick for clean sound
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.type === 'off' ? -1 : 1;
  });

  // Convert to track events with delta times
  let lastTick = 0;
  for (const evt of events) {
    const delta = evt.tick - lastTick;
    lastTick = evt.tick;

    if (evt.type === 'on') {
      trackEvents.push({
        delta,
        data: [0x90, evt.pitch & 0x7f, evt.velocity & 0x7f],
      });
    } else {
      trackEvents.push({
        delta,
        data: [0x80, evt.pitch & 0x7f, 0],
      });
    }
  }

  // End of track meta event (0x2f)
  trackEvents.push({
    delta: 0,
    data: [0xff, 0x2f, 0x00],
  });

  // Build track chunk
  const trackData: number[] = [];
  for (const evt of trackEvents) {
    trackData.push(...writeVLQ(evt.delta));
    trackData.push(...evt.data);
  }

  const trackLength = trackData.length;

  // Build MIDI file
  const file: number[] = [
    // MThd header
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // Header length = 6
    0x00, 0x00,             // Format 0 (single track)
    0x00, 0x01,             // 1 track
    ...toBytes(ticksPerBeat, 2), // Ticks per quarter note
    // MTrk chunk
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    ...toBytes(trackLength, 4),
    ...trackData,
  ];

  return new Uint8Array(file);
}

/**
 * Trigger browser download of a MIDI file
 */
export function downloadMidiFile(
  data: Uint8Array,
  filename: string = 'song.mid'
): void {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export melody notes from Vocal Synth format
 */
export function exportMelodyToMidi(
  notes: Array<{ pitch: number; start: number; duration: number; velocity?: number }>,
  options?: MidiExportOptions
): void {
  const midiNotes: MidiExportNote[] = notes.map((n) => ({
    start: n.start,
    duration: n.duration,
    pitch: Math.max(0, Math.min(127, Math.round(n.pitch))),
    velocity: n.velocity ?? 100,
  }));

  const bytes = generateMidiFile(midiNotes, options);
  downloadMidiFile(bytes, options?.trackName ? `${options.trackName}.mid` : 'vocal_synth.mid');
}

/**
 * Export multi-track data to MIDI (Format 1)
 */
export function exportMultiTrackMidi(
  tracks: Array<{
    name: string;
    notes: Array<{ pitch: number; start: number; duration: number; velocity?: number }>;
  }>,
  options?: MidiExportOptions
): void {
  const { bpm = 120, timeSignature = [4, 4] } = options ?? {};
  const ticksPerBeat = 480;
  const microsecondsPerBeat = Math.round(60_000_000 / bpm);
  const ticksPerSecond = (ticksPerBeat * bpm) / 60;

  // Build header
  const file: number[] = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // Header length
    0x00, 0x01,             // Format 1 (multi-track)
    ...toBytes(tracks.length + 1, 2), // Number of tracks (+1 for tempo track)
    ...toBytes(ticksPerBeat, 2),
  ];

  // Tempo/conductor track
  const tempoTrack: number[] = [
    0xff, 0x03, 0x06, 0x43, 0x6f, 0x6e, 0x64, 0x75, 0x63, 0x74, // "Conduct"
    0x00, // delta
    0xff, 0x58, 0x04, timeSignature[0], Math.log2(timeSignature[1]), 0x18, 0x08,
    0x00, // delta
    0xff, 0x51, 0x03, ...toBytes(microsecondsPerBeat, 3),
    0x00, // delta
    0xff, 0x2f, 0x00, // End of track
  ];

  file.push(
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    ...toBytes(tempoTrack.length, 4),
    ...tempoTrack
  );

  // Each track
  for (const track of tracks) {
    const trackEvents: { delta: number; data: number[] }[] = [];

    // Track name
    const nameBytes = new TextEncoder().encode(track.name.slice(0, 30));
    trackEvents.push({
      delta: 0,
      data: [0xff, 0x03, nameBytes.length, ...Array.from(nameBytes)],
    });

    // Sort note events
    interface Evt { tick: number; type: 'on' | 'off'; pitch: number; velocity: number; }
    const events: Evt[] = [];
    for (const n of track.notes) {
      const st = Math.round(n.start * ticksPerSecond);
      const end = Math.round((n.start + n.duration) * ticksPerSecond);
      events.push({ tick: st, type: 'on', pitch: Math.round(n.pitch), velocity: n.velocity ?? 100 });
      events.push({ tick: end, type: 'off', pitch: Math.round(n.pitch), velocity: 0 });
    }
    events.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));

    let lastTick = 0;
    for (const e of events) {
      const delta = e.tick - lastTick;
      lastTick = e.tick;
      const cmd = e.type === 'on' ? 0x90 : 0x80;
      trackEvents.push({ delta, data: [cmd, e.pitch & 0x7f, e.velocity & 0x7f] });
    }

    trackEvents.push({ delta: 0, data: [0xff, 0x2f, 0x00] });

    const trackData: number[] = [];
    for (const evt of trackEvents) {
      trackData.push(...writeVLQ(evt.delta));
      trackData.push(...evt.data);
    }

    file.push(
      0x4d, 0x54, 0x72, 0x6b,
      ...toBytes(trackData.length, 4),
      ...trackData
    );
  }

  downloadMidiFile(new Uint8Array(file), options?.trackName ? `${options.trackName}.mid` : 'multi_track.mid');
}
