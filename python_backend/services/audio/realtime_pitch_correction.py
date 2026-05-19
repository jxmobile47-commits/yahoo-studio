#!/usr/bin/env python3
"""
Real-Time Pitch Correction Service
===================================
WebSocket-based live pitch correction for vocal performance.

Architecture:
  Browser (Web Audio API) → WebSocket → Python Server
  → Pitch detect → Scale snap → Send pitch data back → Browser renders

Latency target: <50ms (matching Auto-Tune Live)
"""

import asyncio
import numpy as np
import librosa
from typing import Optional, Dict, Any
import json
import logging

logger = logging.getLogger(__name__)


class RealtimePitchCorrector:
    """
    Real-time pitch correction engine.
    Processes audio chunks as they arrive.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        frame_size: int = 1024,
        hop_size: int = 256,
        correction_strength: float = 0.8,
        scale: str = 'C major',
    ):
        self.sr = sample_rate
        self.frame_size = frame_size
        self.hop_size = hop_size
        self.correction_strength = correction_strength
        self.scale = scale

        # Circular buffer for continuous processing
        self.buffer = np.zeros(frame_size * 2)
        self.buffer_pos = 0

        # Smooth pitch transitions
        self.prev_corrected_midi = None
        self.smoothing_factor = 0.3

        # Scale tones
        self.scale_tones = self._parse_scale(scale)

    def _parse_scale(self, scale: str) -> set:
        """Parse scale string to semitone set"""
        scale = scale.lower().strip()
        scales = {
            'c major': {0, 2, 4, 5, 7, 9, 11},
            'g major': {0, 2, 4, 5, 7, 9, 11},
            'd major': {0, 2, 4, 5, 7, 9, 11},
            'a major': {0, 2, 4, 5, 7, 9, 11},
            'e major': {0, 2, 4, 5, 7, 9, 11},
            'b major': {0, 2, 4, 5, 7, 9, 11},
            'f# major': {0, 2, 4, 5, 7, 9, 11},
            'f major': {0, 2, 4, 5, 7, 9, 10},
            'bb major': {0, 2, 4, 5, 7, 9, 10},
            'eb major': {0, 2, 4, 5, 7, 9, 10},
            'a minor': {0, 2, 3, 5, 7, 8, 10},
            'e minor': {0, 2, 3, 5, 7, 8, 10},
            'd minor': {0, 2, 3, 5, 7, 8, 10},
            'g minor': {0, 2, 3, 5, 7, 8, 10},
            'c minor': {0, 2, 3, 5, 7, 8, 10},
            'chromatic': set(range(12)),
        }
        return scales.get(scale, set(range(12)))

    def set_scale(self, scale: str):
        """Update scale on the fly"""
        self.scale = scale
        self.scale_tones = self._parse_scale(scale)

    def set_correction_strength(self, strength: float):
        """Update correction strength (0.0-1.0)"""
        self.correction_strength = max(0.0, min(1.0, strength))

    def process_chunk(self, audio_chunk: np.ndarray) -> Dict[str, Any]:
        """
        Process a chunk of audio and return pitch correction data.

        Args:
            audio_chunk: Mono audio samples (float32)

        Returns:
            {
                'timestamp': float,
                'original_pitch': float | null,
                'corrected_pitch': float | null,
                'correction_cents': float,
                'confidence': float,
                'in_scale': bool,
                'note_name': str,
            }
        """
        # Add to circular buffer
        n = len(audio_chunk)
        if n > len(self.buffer):
            audio_chunk = audio_chunk[-len(self.buffer):]
            n = len(audio_chunk)

        # Shift buffer
        self.buffer = np.roll(self.buffer, -n)
        self.buffer[-n:] = audio_chunk

        # Pitch detection on latest frame
        frame = self.buffer[-self.frame_size:]
        rms = np.sqrt(np.mean(frame ** 2))

        if rms < 0.005:
            # Silence
            self.prev_corrected_midi = None
            return {
                'timestamp': 0.0,
                'original_pitch': None,
                'corrected_pitch': None,
                'correction_cents': 0.0,
                'confidence': 0.0,
                'in_scale': False,
                'note_name': None,
                'rms': float(rms),
            }

        # YIN pitch detection (fast, suitable for real-time)
        try:
            freq = librosa.yin(
                frame,
                fmin=librosa.note_to_hz('C2'),
                fmax=librosa.note_to_hz('C7'),
                sr=self.sr,
                frame_length=self.frame_size,
            )
            freq = float(freq[0]) if len(freq) > 0 else 0.0
        except Exception:
            freq = 0.0

        if freq <= 0 or np.isnan(freq):
            return {
                'timestamp': 0.0,
                'original_pitch': None,
                'corrected_pitch': None,
                'correction_cents': 0.0,
                'confidence': 0.0,
                'in_scale': False,
                'note_name': None,
                'rms': float(rms),
            }

        # Convert to MIDI
        original_midi = 69 + 12 * np.log2(freq / 440.0)

        # Snap to scale
        rounded = round(original_midi)
        semitone = int(rounded) % 12

        if semitone in self.scale_tones:
            # Already in scale - gentle correction
            target = rounded
            # Keep expression (vibrato) but center on note
            deviation = original_midi - rounded
            target = rounded + deviation * (1 - self.correction_strength)
        else:
            # Not in scale - snap to nearest scale tone
            distances = [(abs(semitone - st), st) for st in self.scale_tones]
            distances.sort()
            target_semitone = distances[0][1]
            octave = int(rounded) // 12
            target = octave * 12 + target_semitone

        # Smooth transitions
        if self.prev_corrected_midi is not None:
            target = self.prev_corrected_midi * self.smoothing_factor + target * (1 - self.smoothing_factor)

        corrected_midi = original_midi + (target - original_midi) * self.correction_strength
        self.prev_corrected_midi = corrected_midi

        # Convert back to frequency
        corrected_freq = 440.0 * (2 ** ((corrected_midi - 69) / 12))

        # Note name
        note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        note_idx = int(round(corrected_midi)) % 12
        octave = (int(round(corrected_midi)) // 12) - 1
        note_name = f"{note_names[note_idx]}{octave}"

        # Correction in cents
        correction_cents = (corrected_midi - original_midi) * 100

        return {
            'timestamp': 0.0,
            'original_pitch': float(original_midi),
            'corrected_pitch': float(corrected_midi),
            'correction_cents': float(correction_cents),
            'confidence': min(1.0, rms * 10),
            'in_scale': semitone in self.scale_tones,
            'note_name': note_name,
            'rms': float(rms),
        }


class HarmonyGenerator:
    """
    Generate harmony layers from melody.
    Supports: 3rd, 5th, octave, and custom intervals.
    """

    INTERVALS = {
        'unison': 0,
        'minor_2nd': 1,
        'major_2nd': 2,
        'minor_3rd': 3,
        'major_3rd': 4,
        'perfect_4th': 5,
        'tritone': 6,
        'perfect_5th': 7,
        'minor_6th': 8,
        'major_6th': 9,
        'minor_7th': 10,
        'major_7th': 11,
        'octave': 12,
    }

    def __init__(self, scale: str = 'C major'):
        self.scale_tones = self._parse_scale(scale)

    def _parse_scale(self, scale: str) -> set:
        """Parse scale to semitone set"""
        scale = scale.lower().strip()
        scales = {
            'c major': {0, 2, 4, 5, 7, 9, 11},
            'g major': {0, 2, 4, 5, 7, 9, 11},
            'd major': {0, 2, 4, 5, 7, 9, 11},
            'a major': {0, 2, 4, 5, 7, 9, 11},
            'f major': {0, 2, 4, 5, 7, 9, 10},
            'a minor': {0, 2, 3, 5, 7, 8, 10},
            'e minor': {0, 2, 3, 5, 7, 8, 10},
            'd minor': {0, 2, 3, 5, 7, 8, 10},
            'chromatic': set(range(12)),
        }
        return scales.get(scale, set(range(12)))

    def generate_harmony(
        self,
        melody_notes: list,  # List of NoteBlob-like dicts
        harmony_type: str = '3rd',
        voicing: str = 'close',  # close, open, drop2
    ) -> list:
        """
        Generate harmony notes from melody.

        Args:
            melody_notes: List of note dicts with pitch_midi, start_time, end_time
            harmony_type: '3rd', '5th', 'octave', 'power_chord', 'full_triad'
            voicing: 'close', 'open', 'drop2'

        Returns:
            List of harmony note dicts
        """
        harmony_notes = []

        for note in melody_notes:
            melody_midi = note['avg_pitch_midi']
            semitone = int(round(melody_midi)) % 12

            intervals = self._get_harmony_intervals(harmony_type, semitone)

            for interval in intervals:
                harmony_midi = melody_midi + interval

                # Ensure in scale (diatonic)
                harmony_semitone = int(round(harmony_midi)) % 12
                if harmony_semitone not in self.scale_tones and harmony_type != 'chromatic':
                    # Adjust to nearest scale tone
                    candidates = [harmony_midi - 1, harmony_midi + 1]
                    best = min(candidates, key=lambda x: abs(x - harmony_midi))
                    harmony_midi = best

                harmony_notes.append({
                    'id': f"{note['id']}_h{interval}",
                    'start_time': note['start_time'],
                    'end_time': note['end_time'],
                    'avg_pitch_midi': float(harmony_midi),
                    'label': self._midi_to_note(harmony_midi),
                    'interval': interval,
                    'type': 'harmony',
                })

        return harmony_notes

    def _get_harmony_intervals(self, harmony_type: str, root_semitone: int) -> list:
        """Get intervals for harmony type"""
        if harmony_type == '3rd':
            # Diatonic 3rd (major or minor depending on scale)
            if root_semitone in {0, 5, 7}:  # C, F, G → major 3rd
                return [4]
            elif root_semitone in {2, 4, 9, 11}:  # D, E, A, B → minor 3rd
                return [3]
            else:
                return [3]  # Default minor
        elif harmony_type == '5th':
            return [7]
        elif harmony_type == 'octave':
            return [12]
        elif harmony_type == 'power_chord':
            return [7, 12]
        elif harmony_type == 'full_triad':
            # Root + 3rd + 5th
            if root_semitone in {0, 5, 7}:
                return [4, 7]
            elif root_semitone in {2, 4, 9, 11}:
                return [3, 7]
            else:
                return [3, 7]
        elif harmony_type == '6th':
            return [9]
        elif harmony_type == '4th':
            return [5]
        else:
            return [3]

    def _midi_to_note(self, midi: float) -> str:
        """Convert MIDI to note name"""
        note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        idx = int(round(midi)) % 12
        octave = (int(round(midi)) // 12) - 1
        return f"{note_names[idx]}{octave}"

    def generate_backing_vocals(
        self,
        melody_notes: list,
        style: str = 'parallel',  # parallel, contrary, oblique
        num_voices: int = 2,
    ) -> list:
        """
        Generate backing vocal arrangement.

        Args:
            melody_notes: Melody notes
            style: 'parallel' (same intervals), 'contrary' (opposite motion), 'oblique' (static)
            num_voices: Number of backing voices

        Returns:
            List of backing vocal tracks
        """
        tracks = []

        for voice_idx in range(num_voices):
            intervals = []
            if voice_idx == 0:
                intervals = [-3]  # Below melody, minor 3rd
            elif voice_idx == 1:
                intervals = [3]   # Above melody, minor 3rd
            else:
                intervals = [-5]  # Below, perfect 5th

            voice_notes = []
            for note in melody_notes:
                for interval in intervals:
                    voice_midi = note['avg_pitch_midi'] + interval

                    # Keep in reasonable vocal range
                    if voice_midi < 48:  # Below C3
                        voice_midi += 12
                    elif voice_midi > 84:  # Above C6
                        voice_midi -= 12

                    voice_notes.append({
                        'id': f"{note['id']}_bv{voice_idx}_{interval}",
                        'start_time': note['start_time'],
                        'end_time': note['end_time'],
                        'avg_pitch_midi': float(voice_midi),
                        'label': self._midi_to_note(voice_midi),
                        'type': 'backing',
                        'voice': voice_idx,
                    })

            tracks.append({
                'name': f'Backing Vocal {voice_idx + 1}',
                'notes': voice_notes,
            })

        return tracks
