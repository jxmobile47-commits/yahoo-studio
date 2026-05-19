#!/usr/bin/env python3
"""
Synthetic Training Data Generator
=================================
Generates synthetic audio-chord pairs for data augmentation.

Techniques:
  1. MIDI synthesis with realistic instruments
  2. Chord progression templates (ii-V-I, circle of fifths, etc.)
  3. Key transposition augmentation
  4. Audio effects (reverb, EQ variation)
  5. Background noise mixing
  6. Tempo variation

Dependencies:
  pip install pretty_midi pyfluidsynth soundfile
"""

import numpy as np
import pretty_midi
from pathlib import Path
import json
import logging
from typing import List, Dict, Tuple, Optional
import random

import librosa
import soundfile as sf

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ChordSynthesizer:
    """Synthesize audio from chord progressions using MIDI"""

    # MIDI note numbers for each chord
    CHORD_NOTES = {
        'C:maj': [60, 64, 67],      # C E G
        'C:min': [60, 63, 67],      # C Eb G
        'C:maj7': [60, 64, 67, 71], # C E G B
        'C:min7': [60, 63, 67, 70], # C Eb G Bb
        'C:dom7': [60, 64, 67, 70], # C E G Bb
        'C:maj9': [60, 64, 67, 71, 74],  # C E G B D
        'C:min9': [60, 63, 67, 70, 74],  # C Eb G Bb D
    }

    # Transpose to all 12 keys
    NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    QUALITIES = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']

    def __init__(self, soundfont_path: Optional[str] = None):
        self.soundfont = soundfont_path
        self.chord_vocab = self._build_vocab()
        self.chord_notes = self._build_all_chord_notes()

    def _build_vocab(self):
        vocab = ['N']
        for note in self.NOTES:
            for quality in self.QUALITIES:
                vocab.append(f"{note}:{quality}")
        return vocab[:170]

    def _build_all_chord_notes(self):
        """Build MIDI notes for all 170 chord classes"""
        all_notes = {}

        for semitone, root in enumerate(self.NOTES):
            for quality in self.QUALITIES:
                chord_name = f"{root}:{quality}"
                base_notes = self.CHORD_NOTES.get(f"C:{quality}", [60, 64, 67])
                transposed = [n + semitone for n in base_notes]
                all_notes[chord_name] = transposed

        return all_notes

    def create_midi(self, chord_progression: List[Tuple[str, float]], bpm: float = 120) -> pretty_midi.PrettyMIDI:
        """
        Create MIDI from chord progression

        Args:
            chord_progression: [(chord_name, duration_in_beats), ...]
            bpm: Tempo
        """
        pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
        instrument = pretty_midi.Instrument(program=0)  # Piano

        current_time = 0.0
        beat_duration = 60.0 / bpm

        for chord_name, beats in chord_progression:
            if chord_name == 'N':
                current_time += beats * beat_duration
                continue

            notes = self.chord_notes.get(chord_name, [60, 64, 67])
            duration = beats * beat_duration

            for note_num in notes:
                note = pretty_midi.Note(
                    velocity=80 + random.randint(-10, 10),
                    pitch=note_num,
                    start=current_time,
                    end=current_time + duration * 0.9
                )
                instrument.notes.append(note)

            # Add bass note (root, one octave lower)
            root_note = notes[0] - 12
            bass = pretty_midi.Note(
                velocity=90,
                pitch=root_note,
                start=current_time,
                end=current_time + duration
            )
            instrument.notes.append(bass)

            current_time += duration

        pm.instruments.append(instrument)
        return pm

    def synthesize(self, chord_progression: List[Tuple[str, float]], bpm: float = 120, sr: int = 22050) -> np.ndarray:
        """
        Synthesize audio from chord progression

        Returns:
            Audio array (mono, sr=22050)
        """
        pm = self.create_midi(chord_progression, bpm)

        if self.soundfont and Path(self.soundfont).exists():
            audio = pm.fluidsynth(fs=sr, sf2_path=self.soundfont)
        else:
            # Fallback: simple synthesis
            audio = pm.fluidsynth(fs=sr)

        return audio


class ProgressionTemplates:
    """Common chord progression templates for realistic training data"""

    PROGRESSIONS = {
        'pop_1': [
            ('C:maj', 4), ('G:maj', 4), ('A:min', 4), ('F:maj', 4),  # I-V-vi-IV
        ],
        'pop_2': [
            ('C:maj', 4), ('A:min', 4), ('F:maj', 4), ('G:maj', 4),  # I-vi-IV-V
        ],
        'jazz_ii_v_i': [
            ('D:min7', 2), ('G:dom7', 2), ('C:maj7', 4),  # ii-V-I
        ],
        'blues': [
            ('C:dom7', 4), ('F:dom7', 4), ('C:dom7', 4), ('G:dom7', 2), ('F:dom7', 2), ('C:dom7', 4),
        ],
        'fifties': [
            ('C:maj', 4), ('A:min', 4), ('D:min', 4), ('G:maj', 4),  # I-vi-ii-V
        ],
        'circle': [
            ('C:maj', 2), ('A:min', 2), ('F:maj', 2), ('D:min', 2),
            ('B:min', 2), ('G:maj', 2), ('E:min', 2), ('C:maj', 2),
        ],
        'emotional': [
            ('A:min', 4), ('F:maj', 4), ('C:maj', 4), ('G:maj', 4),  # vi-IV-I-V
        ],
        'rock': [
            ('E:min', 4), ('C:maj', 4), ('G:maj', 4), ('D:maj', 4),  # Em-C-G-D
        ],
        'soul': [
            ('C:min7', 4), ('A:min7', 4), ('F:maj7', 4), ('G:dom7', 4),
        ],
        'bossa': [
            ('C:maj7', 2), ('A:min7', 2), ('D:min7', 2), ('G:dom7', 2),
            ('C:maj7', 2), ('A:min7', 2), ('D:min7', 2), ('G:dom7', 2),
        ],
    }

    @classmethod
    def get_random_progression(cls, min_length: int = 16, max_length: int = 64) -> List[Tuple[str, float]]:
        """Generate a random-length progression by repeating templates"""
        template_name = random.choice(list(cls.PROGRESSIONS.keys()))
        template = cls.PROGRESSIONS[template_name]

        # Repeat and vary
        progression = []
        total_beats = 0
        target_beats = random.randint(min_length, max_length)

        while total_beats < target_beats:
            for chord, beats in template:
                if total_beats >= target_beats:
                    break
                # Vary duration slightly
                varied_beats = beats + random.choice([-1, 0, 0, 0, 1])
                varied_beats = max(1, varied_beats)
                progression.append((chord, varied_beats))
                total_beats += varied_beats

        return progression

    @classmethod
    def transpose_progression(cls, progression: List[Tuple[str, float]], semitones: int) -> List[Tuple[str, float]]:
        """Transpose a progression by N semitones"""
        notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        transposed = []

        for chord_name, beats in progression:
            if chord_name == 'N':
                transposed.append((chord_name, beats))
                continue

            # Parse root
            match = chord_name.split(':')
            if len(match) != 2:
                transposed.append((chord_name, beats))
                continue

            root, quality = match
            if root in notes:
                idx = notes.index(root)
                new_idx = (idx + semitones) % 12
                new_chord = f"{notes[new_idx]}:{quality}"
                transposed.append((new_chord, beats))
            else:
                transposed.append((chord_name, beats))

        return transposed


class AudioAugmenter:
    """Apply audio augmentations to synthesized audio"""

    def __init__(self, noise_dir: Optional[str] = None):
        self.noise_dir = Path(noise_dir) if noise_dir else None
        self.noise_files = []

        if self.noise_dir and self.noise_dir.exists():
            self.noise_files = list(self.noise_dir.glob('*.wav')) + list(self.noise_dir.glob('*.mp3'))

    def apply(self, audio: np.ndarray, sr: int = 22050) -> np.ndarray:
        """Apply random augmentations"""
        augmented = audio.copy()

        # 1. Tempo variation
        if random.random() < 0.5:
            rate = random.uniform(0.9, 1.1)
            augmented = librosa.effects.time_stretch(augmented, rate=rate)

        # 2. Pitch shift
        if random.random() < 0.5:
            n_steps = random.randint(-2, 2)
            augmented = librosa.effects.pitch_shift(augmented, sr=sr, n_steps=n_steps)

        # 3. Add background noise
        if random.random() < 0.3 and self.noise_files:
            augmented = self._add_noise(augmented, sr)

        # 4. Volume variation
        if random.random() < 0.5:
            gain = random.uniform(0.8, 1.2)
            augmented = augmented * gain

        # 5. Clipping (simulating loud recording)
        if random.random() < 0.1:
            threshold = random.uniform(0.7, 0.95)
            augmented = np.clip(augmented, -threshold, threshold)

        return augmented

    def _add_noise(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """Add random background noise"""
        if not self.noise_files:
            return audio

        noise_file = random.choice(self.noise_files)
        try:
            noise, _ = librosa.load(str(noise_file), sr=sr, duration=len(audio) / sr)
            if len(noise) < len(audio):
                # Tile noise to match length
                repeats = int(np.ceil(len(audio) / len(noise)))
                noise = np.tile(noise, repeats)[:len(audio)]
            else:
                noise = noise[:len(audio)]

            # Mix with random SNR
            snr_db = random.uniform(10, 30)
            audio_power = np.mean(audio ** 2)
            noise_power = np.mean(noise ** 2)
            snr_linear = 10 ** (snr_db / 10)
            noise_scale = np.sqrt(audio_power / (noise_power * snr_linear))
            mixed = audio + noise * noise_scale

            return mixed
        except Exception as e:
            logger.warning(f"Noise addition failed: {e}")
            return audio


class SyntheticDatasetGenerator:
    """Generate complete synthetic training dataset"""

    def __init__(self, output_dir='data/synthetic', soundfont: Optional[str] = None):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.synthesizer = ChordSynthesizer(soundfont)
        self.augmenter = AudioAugmenter()
        self.chord_vocab = self.synthesizer.chord_vocab
        self.chord_to_idx = {ch: i for i, ch in enumerate(self.chord_vocab)}

    def generate_sample(self, sample_id: int) -> bool:
        """Generate a single synthetic training sample"""
        try:
            # 1. Get random progression
            progression = ProgressionTemplates.get_random_progression()

            # 2. Transpose to random key
            transpose = random.randint(0, 11)
            progression = ProgressionTemplates.transpose_progression(progression, transpose)

            # 3. Random BPM
            bpm = random.randint(80, 160)

            # 4. Synthesize audio
            audio = self.synthesizer.synthesize(progression, bpm=bpm)

            # 5. Augment
            audio = self.augmenter.apply(audio)

            # 6. Extract CQT features
            cqt = librosa.cqt(audio, sr=22050, hop_length=512, n_bins=84)
            cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)
            features = ((cqt_db - np.mean(cqt_db)) / (np.std(cqt_db) + 1e-8)).astype(np.float32)

            # 7. Create frame-level labels
            labels = self._progression_to_labels(progression, bpm, features.shape[1])

            # 8. Save
            sample_dir = self.output_dir / f"sample_{sample_id:06d}"
            sample_dir.mkdir(exist_ok=True)

            np.save(str(sample_dir / "features.npy"), features)
            np.save(str(sample_dir / "labels.npy"), labels)

            metadata = {
                'source': 'synthetic',
                'template': 'random',
                'bpm': bpm,
                'transpose': transpose,
                'progression': [f"{c}:{b}" for c, b in progression],
                'duration': len(audio) / 22050,
                'num_chords': len(progression),
            }
            with open(str(sample_dir / "metadata.json"), 'w') as f:
                json.dump(metadata, f, indent=2)

            return True

        except Exception as e:
            logger.error(f"Failed to generate sample {sample_id}: {e}")
            return False

    def _progression_to_labels(self, progression: List[Tuple[str, float]], bpm: int, num_frames: int) -> np.ndarray:
        """Convert chord progression to frame labels"""
        labels = np.zeros(num_frames, dtype=np.int64)
        sr, hop = 22050, 512
        beat_duration = 60.0 / bpm

        current_time = 0.0
        for chord_name, beats in progression:
            duration = beats * beat_duration
            start_frame = int(current_time * sr / hop)
            end_frame = int((current_time + duration) * sr / hop)

            idx = self.chord_to_idx.get(chord_name, 0)
            labels[max(0, start_frame):min(num_frames, end_frame)] = idx

            current_time += duration

        return labels

    def generate_dataset(self, n_samples: int = 10000):
        """Generate full synthetic dataset"""
        logger.info(f"Generating {n_samples} synthetic samples...")

        success = 0
        for i in range(n_samples):
            if self.generate_sample(i):
                success += 1
            if (i + 1) % 100 == 0:
                logger.info(f"Generated {i + 1}/{n_samples} samples ({success} successful)")

        logger.info(f"Synthetic dataset complete: {success}/{n_samples} samples")
        return success


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Generate synthetic training data')
    parser.add_argument('--output', default='data/synthetic', help='Output directory')
    parser.add_argument('--n-samples', type=int, default=1000, help='Number of samples')
    parser.add_argument('--soundfont', help='Path to SoundFont file (.sf2)')

    args = parser.parse_args()

    generator = SyntheticDatasetGenerator(args.output, args.soundfont)
    generator.generate_dataset(args.n_samples)
