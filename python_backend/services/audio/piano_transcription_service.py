"""
Piano Transcription Service (Polyphonic)
========================================
Converts piano audio (loops, samples, recordings) into MIDI note events.

Primary engine: Bytedance High-resolution Piano Transcription (if installed)
Fallback: Spotify Basic Pitch with piano-optimized thresholds

Endpoints expose:
- /api/transcribe-piano  (file upload or audio_path)
- /api/piano-model-info
"""

import os
import time
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from utils.logging import log_info, log_error, log_debug
from services.audio.audio_utils import validate_audio_file, get_audio_duration


class PianoTranscriptionService:
    """
    Polyphonic piano transcription service.

    Tries dedicated piano transcription models first; falls back to
    Basic Pitch with piano-optimized parameters.
    """

    def __init__(self):
        self._available: Optional[bool] = None
        self._engine: Optional[str] = None  # 'piano_inference' | 'basic_pitch' | None
        self._model = None

    # ------------------------------------------------------------------
    # Availability checks
    # ------------------------------------------------------------------
    def is_available(self) -> bool:
        if self._available is not None:
            return self._available

        # 1. Try dedicated piano transcription
        if self._check_piano_inference():
            self._engine = "piano_inference"
            self._available = True
            return True

        # 2. Fallback to Basic Pitch
        if self._check_basic_pitch():
            self._engine = "basic_pitch"
            self._available = True
            return True

        self._available = False
        return False

    def _check_piano_inference(self) -> bool:
        try:
            import piano_transcription_inference
            log_debug("piano_transcription_inference found")
            return True
        except ImportError:
            return False

    def _check_basic_pitch(self) -> bool:
        try:
            import basic_pitch
            log_debug("basic_pitch found (piano fallback)")
            return True
        except ImportError:
            return False

    def get_engine(self) -> Optional[str]:
        """Return active engine name or None."""
        if self._engine is None:
            self.is_available()
        return self._engine

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def transcribe(
        self,
        file_path: str,
        output_midi_path: Optional[str] = None,
        onset_threshold: float = 0.3,
        frame_threshold: float = 0.2,
        min_note_length_ms: float = 40.0,
    ) -> Dict[str, Any]:
        """
        Transcribe piano audio to polyphonic MIDI.

        Args:
            file_path: Path to input audio (wav/mp3/flac/ogg)
            output_midi_path: Optional path to write MIDI file
            onset_threshold: Note-on confidence threshold (lower = more sensitive)
            frame_threshold: Note-frame confidence threshold
            min_note_length_ms: Minimum note length in ms

        Returns:
            {
                "success": bool,
                "notes": [
                    {"start": float, "end": float, "pitch": int,
                     "velocity": int, "confidence": float},
                    ...
                ],
                "note_count": int,
                "midi_path": str | None,
                "pitch_range": {"min": int, "max": int},
                "duration": float,
                "engine": str,
                "processing_time": float,
                "error": str | None,
            }
        """
        start_time = time.time()

        if not os.path.exists(file_path):
            return self._error_response(start_time, f"File not found: {file_path}")

        if not validate_audio_file(file_path):
            return self._error_response(start_time, "Invalid or corrupted audio file")

        # Ensure engine selected
        if not self.is_available():
            return self._error_response(start_time, "No piano transcription engine available")

        try:
            if self._engine == "piano_inference":
                return self._transcribe_with_piano_inference(
                    file_path, output_midi_path, start_time
                )
            else:
                return self._transcribe_with_basic_pitch(
                    file_path, output_midi_path,
                    onset_threshold, frame_threshold, min_note_length_ms,
                    start_time,
                )
        except Exception as e:
            log_error(f"Piano transcription failed: {e}")
            import traceback
            log_error(traceback.format_exc())
            return self._error_response(start_time, str(e))

    # ------------------------------------------------------------------
    # Engine: piano_transcription_inference (Bytedance)
    # ------------------------------------------------------------------
    def _transcribe_with_piano_inference(
        self,
        file_path: str,
        output_midi_path: Optional[str],
        start_time: float,
    ) -> Dict[str, Any]:
        from piano_transcription_inference import PianoTranscription
        from piano_transcription_inference.utilities import load_audio

        log_info(f"Running High-resolution Piano Transcription on: {file_path}")

        # Load audio
        audio, sr = load_audio(file_path, sr=16000, mono=True)

        # Initialize model (cached on first call)
        if self._model is None:
            self._model = PianoTranscription(
                checkpoint_path=None,  # Uses default pretrained model
                device="cuda" if self._cuda_available() else "cpu",
            )
            log_info("Piano transcription model loaded")

        # Transcribe
        est_note_events = self._model.transcribe(audio, sr)

        # Convert to uniform format
        notes = []
        min_pitch, max_pitch = 127, 0
        for event in est_note_events:
            onset = float(event["onset"])
            offset = float(event["offset"])
            pitch = int(event["midi_note"])
            velocity = int(event.get("velocity", 80))

            notes.append({
                "start": round(onset, 3),
                "end": round(offset, 3),
                "pitch": pitch,
                "velocity": velocity,
                "confidence": 1.0,
            })

            if pitch < min_pitch:
                min_pitch = pitch
            if pitch > max_pitch:
                max_pitch = pitch

        notes.sort(key=lambda n: n["start"])

        # Save MIDI
        saved_path = None
        if output_midi_path:
            self._model.save_midi(est_note_events, output_midi_path)
            saved_path = output_midi_path
            log_debug(f"MIDI saved to: {saved_path}")

        duration = get_audio_duration(file_path)
        proc_time = time.time() - start_time

        log_info(
            f"Piano transcription complete: {len(notes)} notes, "
            f"range {min_pitch}-{max_pitch}, time={proc_time:.2f}s"
        )

        return {
            "success": True,
            "notes": notes,
            "note_count": len(notes),
            "midi_path": saved_path,
            "pitch_range": {
                "min": min_pitch if max_pitch > 0 else 0,
                "max": max_pitch if max_pitch > 0 else 0,
            },
            "duration": duration,
            "engine": "piano_inference",
            "processing_time": proc_time,
            "error": None,
        }

    # ------------------------------------------------------------------
    # Engine: Basic Pitch (fallback)
    # ------------------------------------------------------------------
    def _transcribe_with_basic_pitch(
        self,
        file_path: str,
        output_midi_path: Optional[str],
        onset_threshold: float,
        frame_threshold: float,
        min_note_length_ms: float,
        start_time: float,
    ) -> Dict[str, Any]:
        from basic_pitch.inference import predict

        log_info(f"Running Basic Pitch (piano fallback) on: {file_path}")

        model_output, midi_data, note_events = predict(
            file_path,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            minimum_note_length=min_note_length_ms / 1000.0,
        )

        notes = []
        min_pitch, max_pitch = 127, 0
        for event in note_events:
            if isinstance(event, (list, tuple)) and len(event) >= 4:
                start_t = float(event[0])
                end_t = float(event[1])
                pitch = int(event[2])
                confidence = float(event[3])
            else:
                continue

            # Estimate velocity from confidence (Basic Pitch doesn't output velocity)
            velocity = int(60 + confidence * 60)  # Map 60-120 range

            notes.append({
                "start": round(start_t, 3),
                "end": round(end_t, 3),
                "pitch": pitch,
                "velocity": min(velocity, 127),
                "confidence": round(confidence, 3),
            })

            if pitch < min_pitch:
                min_pitch = pitch
            if pitch > max_pitch:
                max_pitch = pitch

        notes.sort(key=lambda n: n["start"])

        saved_path = None
        if output_midi_path:
            midi_data.write(output_midi_path)
            saved_path = output_midi_path
            log_debug(f"MIDI saved to: {saved_path}")

        duration = get_audio_duration(file_path)
        proc_time = time.time() - start_time

        log_info(
            f"Basic Pitch piano complete: {len(notes)} notes, "
            f"range {min_pitch}-{max_pitch}, time={proc_time:.2f}s"
        )

        return {
            "success": True,
            "notes": notes,
            "note_count": len(notes),
            "midi_path": saved_path,
            "pitch_range": {
                "min": min_pitch if max_pitch > 0 else 0,
                "max": max_pitch if max_pitch > 0 else 0,
            },
            "duration": duration,
            "engine": "basic_pitch",
            "processing_time": proc_time,
            "error": None,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _cuda_available(self) -> bool:
        try:
            import torch
            return torch.cuda.is_available()
        except Exception:
            return False

    def _error_response(self, start_time: float, error_msg: str) -> Dict[str, Any]:
        return {
            "success": False,
            "error": error_msg,
            "notes": [],
            "note_count": 0,
            "midi_path": None,
            "pitch_range": {"min": 0, "max": 0},
            "duration": 0.0,
            "engine": self._engine or "none",
            "processing_time": time.time() - start_time,
        }

    # ------------------------------------------------------------------
    # Model info
    # ------------------------------------------------------------------
    def get_model_info(self) -> Dict[str, Any]:
        return {
            "name": "Piano Transcription",
            "description": (
                "Polyphonic piano audio-to-MIDI transcription. "
                "Primary: Bytedance High-resolution Piano Transcription. "
                "Fallback: Spotify Basic Pitch with piano-optimized thresholds."
            ),
            "available": self.is_available(),
            "engine": self.get_engine(),
            "capabilities": [
                "polyphonic_piano_transcription",
                "midi_transcription",
                "note_event_extraction",
                "velocity_estimation",
            ],
        }
