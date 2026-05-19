#!/usr/bin/env python3
"""
Real-Time Chord Streaming Service
=================================
Processes audio in chunks for live chord display.
Chordify doesn't have this - major competitive advantage.

Features:
  - Chunk-based processing (low latency)
  - Ring buffer for continuous audio
  - Adaptive confidence thresholding
  - Chord smoothing (reduce flickering)
  - WebSocket streaming to frontend

Latency target: <500ms from audio input to chord display
"""

import torch
import numpy as np
import librosa
from collections import deque
from typing import Optional, Dict, List, Callable
import threading
import time
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RingBuffer:
    """Fixed-size ring buffer for continuous audio chunks"""

    def __init__(self, capacity: int, channels: int = 1):
        self.capacity = capacity
        self.channels = channels
        self.buffer = np.zeros((channels, capacity), dtype=np.float32)
        self.write_pos = 0
        self.lock = threading.Lock()

    def write(self, data: np.ndarray):
        """Write audio data to ring buffer"""
        with self.lock:
            data_len = data.shape[-1]
            if data_len > self.capacity:
                data = data[..., -self.capacity:]
                data_len = self.capacity

            # Handle wrap-around
            end_pos = (self.write_pos + data_len) % self.capacity
            if end_pos > self.write_pos or data_len >= self.capacity:
                # No wrap or full overwrite
                self.buffer[..., self.write_pos:end_pos] = data
            else:
                # Wrap around
                first_part = self.capacity - self.write_pos
                self.buffer[..., self.write_pos:] = data[..., :first_part]
                self.buffer[..., :end_pos] = data[..., first_part:]

            self.write_pos = end_pos

    def read_latest(self, n_samples: int) -> np.ndarray:
        """Read the latest N samples"""
        with self.lock:
            if n_samples > self.capacity:
                n_samples = self.capacity

            start = (self.write_pos - n_samples) % self.capacity
            end = self.write_pos

            if start < end:
                return self.buffer[..., start:end].copy()
            else:
                # Wrap around
                part1 = self.buffer[..., start:].copy()
                part2 = self.buffer[..., :end].copy()
                return np.concatenate([part1, part2], axis=-1)


class ChordSmoother:
    """
    Temporal smoothing to reduce chord flickering.
    Uses voting window + transition rules.
    """

    def __init__(self, window_size: int = 7, min_duration: float = 0.3):
        self.window_size = window_size
        self.min_duration = min_duration  # seconds
        self.history = deque(maxlen=window_size)
        self.current_chord = "N"
        self.current_start = 0.0
        self.chord_vocab = self._build_vocab()

    def _build_vocab(self):
        notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
        vocab = ['N']
        for n in notes:
            for q in qualities:
                vocab.append(f"{n}:{q}")
        return vocab[:170]

    def update(self, chord_idx: int, confidence: float, timestamp: float) -> Optional[Dict]:
        """
        Update with new prediction, return chord segment if changed.

        Returns:
            {'chord': str, 'start': float, 'end': float, 'confidence': float}
            or None if no change
        """
        chord = self.chord_vocab[chord_idx] if chord_idx < len(self.chord_vocab) else "N"

        self.history.append({
            'chord': chord,
            'confidence': confidence,
            'time': timestamp,
        })

        # Majority vote in window
        if len(self.history) < 3:
            return None

        # Count chord occurrences
        chord_counts = {}
        chord_conf = {}
        for h in self.history:
            c = h['chord']
            chord_counts[c] = chord_counts.get(c, 0) + 1
            chord_conf[c] = chord_conf.get(c, 0) + h['confidence']

        # Get most common chord
        best_chord = max(chord_counts, key=chord_counts.get)
        best_count = chord_counts[best_chord]
        best_conf = chord_conf[best_chord] / best_count

        # Require majority
        if best_count < len(self.history) * 0.5:
            return None

        # Check if chord changed
        if best_chord != self.current_chord:
            # End previous segment
            result = None
            if self.current_chord != "N":
                duration = timestamp - self.current_start
                if duration >= self.min_duration:
                    result = {
                        'chord': self.current_chord,
                        'start': round(self.current_start, 2),
                        'end': round(timestamp, 2),
                        'confidence': round(best_conf, 3),
                    }

            # Start new segment
            self.current_chord = best_chord
            self.current_start = timestamp
            return result

        return None

    def get_current(self) -> Dict:
        """Get currently active chord"""
        return {
            'chord': self.current_chord,
            'start': round(self.current_start, 2),
            'confidence': 0.0,
        }


class RealtimeChordStream:
    """
    Main real-time chord recognition engine.
    Processes audio chunks with low latency.
    """

    def __init__(
        self,
        model,
        chunk_duration: float = 2.0,  # Process 2-second chunks
        hop_duration: float = 0.5,     # Update every 0.5 seconds
        sr: int = 22050,
        device: str = 'cpu'
    ):
        self.model = model
        self.model.eval()
        self.sr = sr
        self.device = device

        self.chunk_samples = int(chunk_duration * sr)
        self.hop_samples = int(hop_duration * sr)

        # Ring buffer holds 2 chunks of audio
        self.buffer = RingBuffer(capacity=self.chunk_samples * 2)
        self.smoother = ChordSmoother()

        self.is_running = False
        self.callbacks: List[Callable] = []
        self.segments: List[Dict] = []

        # For CQT computation
        self.hop_length = 512
        self.n_bins = 84

    def add_callback(self, callback: Callable):
        """Add callback for chord change events"""
        self.callbacks.append(callback)

    def _extract_cqt(self, audio: np.ndarray) -> torch.Tensor:
        """Extract CQT features from audio chunk"""
        # Compute CQT
        cqt = librosa.cqt(audio, sr=self.sr, hop_length=self.hop_length, n_bins=self.n_bins)
        cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)

        # Normalize
        mean = np.mean(cqt_db)
        std = np.std(cqt_db)
        features = (cqt_db - mean) / (std + 1e-8)

        # Add batch and channel dims: (1, 1, 84, T)
        features_t = torch.from_numpy(features.astype(np.float32)).unsqueeze(0).unsqueeze(0)
        return features_t.to(self.device)

    def process_chunk(self, audio_chunk: np.ndarray) -> Optional[Dict]:
        """
        Process a single audio chunk and return chord segment if changed.

        Args:
            audio_chunk: Audio samples (1D array)

        Returns:
            Chord segment dict or None
        """
        # Write to buffer
        self.buffer.write(audio_chunk.reshape(1, -1))

        # Get latest 2 seconds
        latest_audio = self.buffer.read_latest(self.chunk_samples)
        latest_audio = latest_audio.squeeze()  # (samples,)

        # Pad if needed
        if len(latest_audio) < self.chunk_samples:
            pad = self.chunk_samples - len(latest_audio)
            latest_audio = np.pad(latest_audio, (0, pad))

        # Extract features
        features = self._extract_cqt(latest_audio)

        # Predict
        with torch.no_grad():
            output = self.model(features)
            chord_logits = output['chord_logits']  # (1, T, 170)
            probs = torch.softmax(chord_logits, dim=-1)
            confidence, chord_idx = torch.max(probs[:, -1, :], dim=-1)  # Latest frame

        chord_idx = chord_idx.item()
        confidence = confidence.item()

        # Get timestamp
        timestamp = time.time()

        # Update smoother
        segment = self.smoother.update(chord_idx, confidence, timestamp)

        if segment:
            self.segments.append(segment)
            # Notify callbacks
            for cb in self.callbacks:
                try:
                    cb(segment)
                except Exception as e:
                    logger.error(f"Callback error: {e}")

        return segment

    def process_file(self, audio_path: str, callback: Optional[Callable] = None) -> List[Dict]:
        """
        Process entire audio file in real-time simulation.

        Args:
            audio_path: Path to audio file
            callback: Optional callback for each chord change

        Returns:
            List of chord segments
        """
        logger.info(f"Processing: {audio_path}")

        # Load audio
        y, sr = librosa.load(audio_path, sr=self.sr)

        # Reset state
        self.buffer = RingBuffer(capacity=self.chunk_samples * 2)
        self.smoother = ChordSmoother()
        self.segments = []

        if callback:
            self.add_callback(callback)

        # Process in chunks
        start = 0
        chunk_count = 0

        while start < len(y):
            end = min(start + self.hop_samples, len(y))
            chunk = y[start:end]

            # Pad last chunk
            if len(chunk) < self.hop_samples:
                chunk = np.pad(chunk, (0, self.hop_samples - len(chunk)))

            segment = self.process_chunk(chunk)

            if segment:
                logger.info(f"  {segment['start']:.2f}s - {segment['chord']} ({segment['confidence']:.3f})")

            start = end
            chunk_count += 1

            # Simulate real-time delay (for testing)
            # time.sleep(self.hop_samples / self.sr)

        logger.info(f"Processed {chunk_count} chunks, found {len(self.segments)} chord segments")
        return self.segments

    def start_microphone_stream(self):
        """
        Start real-time microphone stream.
        Requires sounddevice library.
        """
        try:
            import sounddevice as sd

            def audio_callback(indata, frames, time_info, status):
                if status:
                    logger.warning(f"Audio status: {status}")

                # Convert to mono float32
                audio = indata[:, 0].astype(np.float32)
                self.process_chunk(audio)

            logger.info("Starting microphone stream...")
            self.is_running = True

            with sd.InputStream(
                channels=1,
                samplerate=self.sr,
                blocksize=self.hop_samples,
                callback=audio_callback
            ):
                while self.is_running:
                    time.sleep(0.1)

        except ImportError:
            logger.error("sounddevice not installed. pip install sounddevice")
        except Exception as e:
            logger.error(f"Microphone stream error: {e}")

    def stop(self):
        """Stop microphone stream"""
        self.is_running = False


# WebSocket integration for frontend
WEBSOCKET_HANDLER = '''
"""
WebSocket handler for real-time chord streaming.
Add to your Flask/SocketIO app.

Usage:
    from flask_socketio import SocketIO, emit
    from realtime_chord_stream import RealtimeChordStream

    socketio = SocketIO(app)
    stream_engine = None

    @socketio.on('start_stream')
    def handle_start_stream():
        global stream_engine
        # Initialize with loaded model
        stream_engine = RealtimeChordStream(model)

        def on_chord_change(segment):
            emit('chord_update', segment, broadcast=True)

        stream_engine.add_callback(on_chord_change)
        stream_engine.start_microphone_stream()

    @socketio.on('stop_stream')
    def handle_stop_stream():
        if stream_engine:
            stream_engine.stop()
"""
'''


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))

    from models.chordnet_2026 import ChordNet2026

    print("=" * 70)
    print("Real-Time Chord Streaming Demo")
    print("=" * 70)

    # Initialize model
    model = ChordNet2026(
        num_chords=170,
        freq_bins=84,
        mamba_dim=512,
        mamba_layers=6,
        mamba_state=32,
        use_crf=True,
        use_hierarchical=True,
        use_key_aux=True,
        use_beat_aux=True,
    )

    # Note: In production, load trained weights here
    # model.load_state_dict(torch.load('models/chordnet_2026.pt')['model_state_dict'])

    model.eval()

    # Create stream engine
    stream = RealtimeChordStream(
        model=model,
        chunk_duration=2.0,
        hop_duration=0.5,
        device='cpu'
    )

    # Test with file
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('audio_file', nargs='?', help='Audio file to process')
    args = parser.parse_args()

    if args.audio_file:
        segments = stream.process_file(args.audio_file)
        print(f"\n{'=' * 70}")
        print("FINAL CHORD CHART")
        print(f"{'=' * 70}")
        for seg in segments:
            print(f"{seg['start']:>6.2f}s - {seg['end']:>6.2f}s  {seg['chord']:<10}  ({seg['confidence']:.3f})")
    else:
        print("\nUsage: python realtime_chord_stream.py <audio_file>")
        print("Or call start_microphone_stream() for live input")
