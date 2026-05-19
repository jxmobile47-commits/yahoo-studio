#!/usr/bin/env python3
"""
Collect and prepare training data for proprietary chord recognition model
"""

import os
import json
import librosa
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class TrainingDataCollector:
    """Collects and prepares chord training data"""

    def __init__(self, output_dir='data/training'):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 170 chord classes (same as Chord-CNN-LSTM)
        self.chord_classes = self._load_chord_vocabulary()
        self.chord_to_idx = {chord: idx for idx, chord in enumerate(self.chord_classes)}

    def _load_chord_vocabulary(self):
        """Load 170 chord vocabulary"""
        notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']

        chords = ['N']  # No chord
        for note in notes:
            for quality in qualities:
                chords.append(f"{note}:{quality}")

        return chords[:170]  # Keep only 170 classes

    def extract_features(self, audio_path, sr=22050, hop_length=512):
        """
        Extract chromagram features from audio

        Args:
            audio_path: Path to audio file
            sr: Sample rate
            hop_length: Hop length for STFT

        Returns:
            features: (freq_bins, time_steps) shaped chromagram
        """
        try:
            # Load audio
            y, sr = librosa.load(audio_path, sr=sr)

            # Compute constant-Q transform (better for music)
            cqt = librosa.cqt(y, sr=sr, hop_length=hop_length, n_bins=84)

            # Convert to dB scale
            cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)

            # Normalize
            cqt_normalized = (cqt_db - np.mean(cqt_db)) / (np.std(cqt_db) + 1e-8)

            return cqt_normalized.astype(np.float32)

        except Exception as e:
            logger.error(f"Error processing {audio_path}: {str(e)}")
            return None

    def prepare_sample(self, audio_path, annotation_path):
        """
        Prepare a single training sample

        Args:
            audio_path: Path to audio file
            annotation_path: Path to chord annotations (JSON)

        Returns:
            dict: Training sample with features and labels
        """
        # Extract features
        features = self.extract_features(audio_path)
        if features is None:
            return None

        # Load annotations
        try:
            with open(annotation_path, 'r') as f:
                annotations = json.load(f)
        except Exception as e:
            logger.error(f"Error loading annotations from {annotation_path}: {str(e)}")
            return None

        # Create aligned labels
        time_steps = features.shape[1]
        labels = np.zeros(time_steps, dtype=np.int64)

        for chord in annotations.get('chords', []):
            start_frame = chord.get('start_frame', 0)
            end_frame = chord.get('end_frame', time_steps)
            chord_name = chord.get('chord', 'N')

            if chord_name in self.chord_to_idx:
                label_idx = self.chord_to_idx[chord_name]
                labels[max(0, start_frame):min(time_steps, end_frame)] = label_idx

        return {
            'features': features,
            'labels': labels,
            'audio_path': str(audio_path),
            'chord_count': len(annotations.get('chords', []))
        }

    def save_sample(self, sample, sample_id):
        """Save prepared sample to disk"""
        sample_dir = self.output_dir / f"sample_{sample_id:06d}"
        sample_dir.mkdir(parents=True, exist_ok=True)

        np.save(str(sample_dir / "features.npy"), sample['features'])
        np.save(str(sample_dir / "labels.npy"), sample['labels'])

        metadata = {
            'audio_path': sample['audio_path'],
            'chord_count': sample['chord_count'],
            'feature_shape': list(sample['features'].shape)
        }
        with open(str(sample_dir / "metadata.json"), 'w') as f:
            json.dump(metadata, f, indent=2)

    def process_dataset(self, audio_dir, annotation_dir, num_workers=4):
        """Process entire dataset"""
        audio_dir = Path(audio_dir)
        annotation_dir = Path(annotation_dir)

        audio_files = list(audio_dir.glob("*.mp3")) + list(audio_dir.glob("*.wav"))
        logger.info(f"Found {len(audio_files)} audio files")

        sample_id = 0
        for audio_file in audio_files:
            annotation_file = annotation_dir / f"{audio_file.stem}.json"

            if not annotation_file.exists():
                logger.warning(f"No annotation for {audio_file}")
                continue

            sample = self.prepare_sample(audio_file, annotation_file)
            if sample is not None:
                self.save_sample(sample, sample_id)
                sample_id += 1

                if sample_id % 100 == 0:
                    logger.info(f"Processed {sample_id} samples")

        logger.info(f"Total samples processed: {sample_id}")
        return sample_id


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Collect training data for chord recognition')
    parser.add_argument('--audio-dir', default='data/raw_audio', help='Directory containing audio files')
    parser.add_argument('--annotation-dir', default='data/annotations', help='Directory containing chord annotations')
    parser.add_argument('--output-dir', default='data/training', help='Output directory for processed samples')
    parser.add_argument('--workers', type=int, default=4, help='Number of worker threads')

    args = parser.parse_args()

    collector = TrainingDataCollector(output_dir=args.output_dir)
    collector.process_dataset(
        audio_dir=args.audio_dir,
        annotation_dir=args.annotation_dir,
        num_workers=args.workers
    )
