"""
Basic Pitch Melody Transcription Service
========================================
Replaces SheetSage with Spotify's Basic Pitch.
No Docker required. Runs fast on CPU. Outputs MIDI + note events.

Package: pip install basic-pitch
GitHub: https://github.com/spotify/basic-pitch
"""

import os
import time
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional

from utils.logging import log_info, log_error, log_debug
from services.audio.audio_utils import validate_audio_file, get_audio_duration


class BasicPitchMelodyService:
    """
    Service wrapper around Spotify's Basic Pitch for polyphonic pitch detection
    and melody transcription.
    """

    def __init__(self):
        self._available: Optional[bool] = None
        self._model = None

    def is_available(self) -> bool:
        """Check if basic-pitch is installed."""
        if self._available is not None:
            return self._available

        try:
            import basic_pitch
            log_debug(f"basic-pitch found: {getattr(basic_pitch, '__version__', 'unknown')}")
            self._available = True
            return True
        except ImportError as e:
            log_error(f"basic-pitch not available: {e}")
            self._available = False
            return False

    def _get_model(self):
        """No explicit model object to cache; basic_pitch loads it on first predict()."""
        return True

    def transcribe(
        self,
        file_path: str,
        output_midi_path: Optional[str] = None,
        min_note_length_ms: float = 50.0,
        onset_threshold: float = 0.5,
        frame_threshold: float = 0.3,
    ) -> Dict[str, Any]:
        """
        Transcribe audio to MIDI note events.

        Args:
            file_path: Path to input audio file
            output_midi_path: Optional path to save output MIDI file
            min_note_length_ms: Minimum note length in milliseconds
            onset_threshold: Confidence threshold for note onsets
            frame_threshold: Confidence threshold for note frames

        Returns:
            {
                "success": bool,
                "notes": [
                    {"start": float, "end": float, "pitch": int, "confidence": float},
                    ...
                ],
                "midi_path": str or None,
                "pitch_range": {"min": int, "max": int},
                "duration": float,
                "model_used": "basic-pitch",
                "processing_time": float,
                "error": str (if success=False),
            }
        """
        start_time = time.time()

        if not os.path.exists(file_path):
            return {
                "success": False,
                "error": f"Audio file not found: {file_path}",
                "notes": [],
                "midi_path": None,
                "pitch_range": {"min": 0, "max": 0},
                "duration": 0.0,
                "model_used": "basic-pitch",
                "processing_time": time.time() - start_time,
            }

        if not validate_audio_file(file_path):
            return {
                "success": False,
                "error": "Invalid or corrupted audio file",
                "notes": [],
                "midi_path": None,
                "pitch_range": {"min": 0, "max": 0},
                "duration": 0.0,
                "model_used": "basic-pitch",
                "processing_time": time.time() - start_time,
            }

        try:
            from basic_pitch import ICASSP_2022_MODEL_PATH
            from basic_pitch.inference import predict
            from basic_pitch import inference

            log_info(f"Running Basic Pitch transcription on: {file_path}")

            # Basic Pitch predict returns: (model_output, midi_data, note_events)
            model_output, midi_data, note_events = predict(file_path)

            # note_events is a list of tuples: (start_time, end_time, pitch, confidence, ...)
            notes = []
            min_pitch = 127
            max_pitch = 0

            for event in note_events:
                # Event format varies slightly by version; handle flexibly
                if isinstance(event, (list, tuple)) and len(event) >= 4:
                    start_t = float(event[0])
                    end_t = float(event[1])
                    pitch = int(event[2])
                    confidence = float(event[3])
                else:
                    continue

                notes.append({
                    "start": round(start_t, 3),
                    "end": round(end_t, 3),
                    "pitch": pitch,
                    "confidence": round(confidence, 3),
                })

                if pitch < min_pitch:
                    min_pitch = pitch
                if pitch > max_pitch:
                    max_pitch = pitch

            # Sort by start time
            notes.sort(key=lambda n: n["start"])

            # Save MIDI if requested
            saved_midi_path = None
            if output_midi_path:
                midi_data.write(output_midi_path)
                saved_midi_path = output_midi_path
                log_debug(f"MIDI saved to: {output_midi_path}")

            duration = get_audio_duration(file_path)
            processing_time = time.time() - start_time

            log_info(
                f"Basic Pitch complete: {len(notes)} notes, "
                f"pitch range {min_pitch}-{max_pitch}, time={processing_time:.2f}s"
            )

            return {
                "success": True,
                "notes": notes,
                "note_count": len(notes),
                "midi_path": saved_midi_path,
                "pitch_range": {
                    "min": min_pitch if max_pitch > 0 else 0,
                    "max": max_pitch if max_pitch > 0 else 0,
                },
                "duration": duration,
                "model_used": "basic-pitch",
                "processing_time": processing_time,
            }

        except Exception as e:
            log_error(f"Basic Pitch transcription failed: {e}")
            import traceback
            log_error(traceback.format_exc())
            return {
                "success": False,
                "error": f"Basic Pitch transcription failed: {str(e)}",
                "notes": [],
                "midi_path": None,
                "pitch_range": {"min": 0, "max": 0},
                "duration": 0.0,
                "model_used": "basic-pitch",
                "processing_time": time.time() - start_time,
            }

    def get_model_info(self) -> Dict[str, Any]:
        """Return metadata about the Basic Pitch model."""
        return {
            "name": "Basic Pitch",
            "description": (
                "Polyphonic pitch detection by Spotify. "
                "Outputs MIDI and note events with onset/offset/pitch/confidence."
            ),
            "available": self.is_available(),
            "capabilities": [
                "polyphonic_pitch_detection",
                "midi_transcription",
                "note_event_extraction",
            ],
        }
