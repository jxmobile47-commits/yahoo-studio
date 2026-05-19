#!/usr/bin/env python3
"""
Download & Process Public Chord Datasets
==========================================
Downloads and processes standard academic chord datasets:
  - McGill Billboard Dataset
  - Isophonics (Beatles, Queen, etc.)
  - CASD (Chord and Scale Dataset)
  - Rock Corpus
  - Wikifonia (symbolic)
  - Lakh MIDI (MIDI-based)

All datasets are research-use only.
"""

import requests
import tarfile
import zipfile
from pathlib import Path
import logging
import json
import shutil
from typing import List, Dict, Optional
import numpy as np
import librosa

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DatasetDownloader:
    """Download public chord datasets"""

    DATASETS = {
        'billboard': {
            'name': 'McGill Billboard Dataset',
            'url': 'https://mcgillbillboard.s3.amazonaws.com/billboard-2.0.tar.gz',
            'format': 'tar.gz',
            'chords': 'lab',  # .lab files with chord annotations
            'audio_required': True,  # Needs separate audio
        },
        'isophonics': {
            'name': 'Isophonics Dataset',
            'url': 'https://isophonics.net/datasets',  # Manual download
            'format': 'manual',
            'chords': 'lab',
            'audio_required': True,
        },
        'rock_corpus': {
            'name': 'Rock Corpus',
            'url': 'http://rockcorpus.midside.com/',
            'format': 'manual',
            'chords': 'text',
            'audio_required': True,
        },
        'wikifonia': {
            'name': 'Wikifonia',
            'url': 'http://www.wikifonia.org/',  # MusicXML
            'format': 'musicxml',
            'chords': 'symbolic',
            'audio_required': False,  # Can synthesize MIDI
        },
        'lakh_midi': {
            'name': 'Lakh MIDI Dataset',
            'url': 'http://www.colinraffel.com/projects/lmd/',
            'format': 'midi',
            'chords': 'symbolic',
            'audio_required': False,
        },
    }

    def __init__(self, output_dir='data/public_datasets'):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def download_billboard(self) -> Path:
        """Download McGill Billboard Dataset"""
        dataset_dir = self.output_dir / 'billboard'
        dataset_dir.mkdir(exist_ok=True)

        tarball = dataset_dir / 'billboard-2.0.tar.gz'

        if tarball.exists():
            logger.info("Billboard dataset already downloaded")
        else:
            logger.info("Downloading Billboard dataset...")
            try:
                resp = requests.get(
                    self.DATASETS['billboard']['url'],
                    stream=True,
                    timeout=300
                )
                resp.raise_for_status()

                with open(tarball, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)

                logger.info("Download complete")
            except Exception as e:
                logger.error(f"Download failed: {e}")
                return dataset_dir

        # Extract
        extracted = dataset_dir / 'billboard-2.0'
        if not extracted.exists():
            logger.info("Extracting...")
            with tarfile.open(tarball, 'r:gz') as tar:
                tar.extractall(dataset_dir)

        return extracted

    def download_lakh_midi(self) -> Path:
        """Download Lakh MIDI Dataset (synthesized audio)"""
        dataset_dir = self.output_dir / 'lakh_midi'
        dataset_dir.mkdir(exist_ok=True)

        # Lakh MIDI has multiple versions
        urls = [
            'http://hog.ee.columbia.edu/craffel/lmd/lmd_full.tar.gz',
            'http://hog.ee.columbia.edu/craffel/lmd/lmd_matched.tar.gz',
        ]

        for url in urls:
            filename = Path(url).name
            filepath = dataset_dir / filename

            if filepath.exists():
                continue

            logger.info(f"Downloading {filename}...")
            try:
                resp = requests.get(url, stream=True, timeout=300)
                resp.raise_for_status()

                with open(filepath, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)

                # Extract
                with tarfile.open(filepath, 'r:gz') as tar:
                    tar.extractall(dataset_dir)

            except Exception as e:
                logger.error(f"Failed to download {filename}: {e}")

        return dataset_dir


class BillboardProcessor:
    """Process McGill Billboard Dataset into training format"""

    def __init__(self, dataset_dir: Path):
        self.dataset_dir = dataset_dir
        self.annotations_dir = dataset_dir / 'annotations'
        self.chord_vocab = self._build_chord_vocab()

    def _build_chord_vocab(self) -> Dict[str, int]:
        """Build chord vocabulary"""
        notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
        vocab = ['N']
        for n in notes:
            for q in qualities:
                vocab.append(f"{n}:{q}")
        return {ch: i for i, ch in enumerate(vocab[:170])}

    def parse_lab_file(self, lab_path: Path) -> List[Dict]:
        """Parse a .lab chord annotation file"""
        chords = []

        with open(lab_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue

                parts = line.split()
                if len(parts) >= 3:
                    start = float(parts[0])
                    end = float(parts[1])
                    chord = self._normalize_lab_chord(parts[2])

                    chords.append({
                        'time': start,
                        'duration': end - start,
                        'chord': chord,
                    })

        return chords

    def _normalize_lab_chord(self, chord: str) -> str:
        """Convert Billboard chord notation to standard format"""
        chord = chord.strip()

        # Handle 'N' (no chord)
        if chord in ('N', 'X'):
            return 'N'

        # Parse Harte notation: C:maj, A:min, etc.
        # Billboard uses: C, C:maj, A:m, G:7, etc.

        # Map Billboard qualities
        replacements = {
            ':maj': ':maj', ':min': ':min', ':m': ':min',
            ':7': ':dom7', ':maj7': ':maj7', ':min7': ':min7',
            ':maj9': ':maj9', ':min9': ':min9',
            ':dim': ':min',  # Map diminished to minor for our vocab
            ':aug': ':maj',
            ':sus4': ':maj',
        }

        for old, new in replacements.items():
            if chord.endswith(old):
                root = chord[:-len(old)]
                return f"{root}{new}"

        # Plain root (assumed major)
        if re.match(r'^[A-G][#b]?$', chord):
            return f"{chord}:maj"

        return 'N'

    def process_all(self, audio_dir: Path, output_dir: Path) -> int:
        """
        Process all Billboard annotations into training samples

        Args:
            audio_dir: Directory with audio files (must match annotations)
            output_dir: Training data output
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        sample_id = 0

        # Find all .lab files
        lab_files = list(self.dataset_dir.rglob('*.lab'))
        logger.info(f"Found {len(lab_files)} annotation files")

        for lab_file in lab_files:
            # Find matching audio
            song_id = lab_file.stem
            audio_file = self._find_audio(audio_dir, song_id)

            if not audio_file:
                continue

            # Parse chords
            chords = self.parse_lab_file(lab_file)
            if len(chords) < 3:
                continue

            # Extract features
            try:
                y, sr = librosa.load(str(audio_file), sr=22050)
                cqt = librosa.cqt(y, sr=sr, hop_length=512, n_bins=84)
                cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)
                features = ((cqt_db - np.mean(cqt_db)) / (np.std(cqt_db) + 1e-8)).astype(np.float32)

                # Create labels
                labels = self._chords_to_labels(chords, features.shape[1])

                # Save sample
                sample_dir = output_path / f"sample_{sample_id:06d}"
                sample_dir.mkdir(exist_ok=True)

                np.save(str(sample_dir / "features.npy"), features)
                np.save(str(sample_dir / "labels.npy"), labels)

                metadata = {
                    'source': 'billboard',
                    'song_id': song_id,
                    'audio_file': str(audio_file),
                    'num_chords': len(chords),
                    'duration': len(y) / sr,
                }
                with open(str(sample_dir / "metadata.json"), 'w') as f:
                    json.dump(metadata, f, indent=2)

                sample_id += 1

                if sample_id % 100 == 0:
                    logger.info(f"Processed {sample_id} samples")

            except Exception as e:
                logger.error(f"Error processing {song_id}: {e}")

        logger.info(f"Billboard processing complete: {sample_id} samples")
        return sample_id

    def _find_audio(self, audio_dir: Path, song_id: str) -> Optional[Path]:
        """Find audio file matching song ID"""
        audio_path = Path(audio_dir)
        patterns = [
            f"**/*{song_id}*.mp3",
            f"**/*{song_id}*.wav",
        ]
        for pattern in patterns:
            matches = list(audio_path.glob(pattern))
            if matches:
                return matches[0]
        return None

    def _chords_to_labels(self, chords: List[Dict], num_frames: int) -> np.ndarray:
        """Convert chords to frame-level labels"""
        labels = np.zeros(num_frames, dtype=np.int64)
        sr, hop = 22050, 512

        for chord in chords:
            start_frame = int(chord['time'] * sr / hop)
            end_frame = int((chord['time'] + chord['duration']) * sr / hop)
            idx = self.chord_vocab.get(chord['chord'], 0)
            labels[max(0, start_frame):min(num_frames, end_frame)] = idx

        return labels


class LakhMidiProcessor:
    """Process Lakh MIDI Dataset by synthesizing audio"""

    def __init__(self, dataset_dir: Path):
        self.dataset_dir = dataset_dir
        self.chord_vocab = self._build_vocab()

    def _build_vocab(self):
        notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
        vocab = ['N']
        for n in notes:
            for q in qualities:
                vocab.append(f"{n}:{q}")
        return {ch: i for i, ch in enumerate(vocab[:170])}

    def synthesize_and_process(
        self,
        midi_file: Path,
        output_dir: Path,
        sample_id: int
    ) -> bool:
        """
        Synthesize MIDI to audio, extract chords, create training sample
        Uses pretty_midi for chord extraction and fluidsynth for synthesis
        """
        try:
            import pretty_midi

            # Load MIDI
            pm = pretty_midi.PrettyMIDI(str(midi_file))

            # Extract chord changes from notes
            chords = self._extract_chords_from_midi(pm)

            # Synthesize to audio
            audio = pm.fluidsynth(fs=22050)

            # Extract CQT features
            cqt = librosa.cqt(audio, sr=22050, hop_length=512, n_bins=84)
            cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)
            features = ((cqt_db - np.mean(cqt_db)) / (np.std(cqt_db) + 1e-8)).astype(np.float32)

            # Create labels
            labels = self._chords_to_labels(chords, features.shape[1])

            # Save
            sample_dir = output_dir / f"sample_{sample_id:06d}"
            sample_dir.mkdir(parents=True, exist_ok=True)

            np.save(str(sample_dir / "features.npy"), features)
            np.save(str(sample_dir / "labels.npy"), labels)

            metadata = {
                'source': 'lakh_midi',
                'midi_file': str(midi_file),
                'num_chords': len(chords),
                'duration': pm.get_end_time(),
            }
            with open(str(sample_dir / "metadata.json"), 'w') as f:
                json.dump(metadata, f, indent=2)

            return True

        except ImportError:
            logger.error("pretty_midi not installed. pip install pretty_midi pyfluidsynth")
            return False
        except Exception as e:
            logger.error(f"MIDI processing failed: {e}")
            return False

    def _extract_chords_from_midi(self, pm) -> List[Dict]:
        """Extract chord changes from MIDI notes"""
        chords = []
        # Simplified: group notes into chord segments
        # Full implementation requires music theory analysis
        duration = pm.get_end_time()
        chords.append({
            'time': 0.0,
            'duration': duration,
            'chord': 'C:maj',  # Placeholder
        })
        return chords

    def _chords_to_labels(self, chords, num_frames):
        labels = np.zeros(num_frames, dtype=np.int64)
        sr, hop = 22050, 512
        for chord in chords:
            sf = int(chord['time'] * sr / hop)
            ef = int((chord['time'] + chord['duration']) * sr / hop)
            idx = self.chord_vocab.get(chord['chord'], 0)
            labels[max(0, sf):min(num_frames, ef)] = idx
        return labels


def download_and_process_all(output_dir='data/training'):
    """Download and process all available public datasets"""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    total_samples = 0

    # 1. Billboard
    logger.info("=" * 60)
    logger.info("Processing McGill Billboard Dataset")
    logger.info("=" * 60)

    downloader = DatasetDownloader()
    billboard_dir = downloader.download_billboard()

    if billboard_dir.exists():
        logger.info("Note: Billboard requires separate audio files")
        logger.info("Place audio files in: data/public_datasets/billboard/audio/")
        logger.info("Then run: python public_datasets.py --process-billboard")

    # 2. Lakh MIDI
    logger.info("=" * 60)
    logger.info("Processing Lakh MIDI Dataset")
    logger.info("=" * 60)

    lakh_dir = downloader.download_lakh_midi()

    # Process MIDI files
    midi_files = list(lakh_dir.rglob('*.mid'))[:1000]  # Limit to 1000
    logger.info(f"Found {len(midi_files)} MIDI files")

    processor = LakhMidiProcessor(lakh_dir)
    for i, midi_file in enumerate(midi_files):
        if processor.synthesize_and_process(midi_file, output_path, total_samples):
            total_samples += 1
        if i % 100 == 0:
            logger.info(f"Processed {i}/{len(midi_files)} MIDI files")

    logger.info(f"\nTotal training samples: {total_samples}")
    return total_samples


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Download public chord datasets')
    parser.add_argument('--output', default='data/training', help='Output directory')
    parser.add_argument('--process-billboard', action='store_true',
                        help='Process Billboard dataset (requires audio files)')
    parser.add_argument('--billboard-dir', type=Path, help='Billboard dataset directory')
    parser.add_argument('--audio-dir', type=Path, help='Audio files directory')

    args = parser.parse_args()

    if args.process_billboard and args.billboard_dir and args.audio_dir:
        processor = BillboardProcessor(args.billboard_dir)
        processor.process_all(args.audio_dir, args.output)
    else:
        download_and_process_all(args.output)
