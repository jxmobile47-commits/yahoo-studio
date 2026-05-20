"""
ALLIN1 Beat Detection Service
==============================
Replaces Beat-Transformer + madmom with a single modern model.
Detects beats, downbeats, BPM, time signature, and song sections in one pass.

Package: pip install allin1
GitHub: https://github.com/CPJKU/allin1
"""

import os
import time
from typing import Dict, Any, List, Optional
from pathlib import Path

from utils.logging import log_info, log_error, log_debug
from services.audio.audio_utils import validate_audio_file, get_audio_duration


class Allin1BeatService:
    """
    Service wrapper around the ALLIN1 model for unified music structure analysis.
    Loads the model once at startup and reuses it across requests.
    """

    def __init__(self):
        self._available: Optional[bool] = None
        self._model = None
        self._device = None

    def is_available(self) -> bool:
        """Check if allin1 is installed and the model can be loaded."""
        if self._available is not None:
            return self._available

        try:
            import allin1
            log_debug(f"allin1 package found: {getattr(allin1, '__version__', 'unknown')}")
            self._available = True
            return True
        except ImportError as e:
            log_error(f"allin1 not available: {e}")
            self._available = False
            return False

    def _get_model(self):
        """Lazy-load the ALLIN1 model once."""
        if self._model is not None:
            return self._model

        import allin1
        import torch

        # Auto-detect device: CUDA > MPS (Apple Silicon) > CPU
        if torch.cuda.is_available():
            self._device = "cuda"
        elif torch.backends.mps.is_available():
            self._device = "mps"
        else:
            self._device = "cpu"

        log_info(f"Loading ALLIN1 model on device: {self._device}")
        start_load = time.time()

        # ALLIN1 loads its model internally on first analyze() call,
        # but we can warm it up here by creating the config.
        self._model = {"device": self._device, "module": allin1}

        log_info(f"ALLIN1 model ready in {time.time() - start_load:.2f}s")
        return self._model

    def detect_beats(self, file_path: str) -> Dict[str, Any]:
        """
        Detect beats, downbeats, BPM, time signature, and sections.

        Returns normalized dict matching legacy beat detection format:
        {
            "success": bool,
            "beats": [float, ...],
            "downbeats": [float, ...],
            "bpm": float,
            "time_signature": str,
            "sections": [ {start, end, label}, ... ],
            "duration": float,
            "model_used": "allin1",
            "processing_time": float,
        }
        """
        start_time = time.time()

        if not os.path.exists(file_path):
            return {
                "success": False,
                "error": f"Audio file not found: {file_path}",
                "beats": [],
                "downbeats": [],
                "bpm": 120.0,
                "time_signature": "4/4",
                "sections": [],
                "duration": 0.0,
                "model_used": "allin1",
                "processing_time": time.time() - start_time,
            }

        if not validate_audio_file(file_path):
            return {
                "success": False,
                "error": "Invalid or corrupted audio file",
                "beats": [],
                "downbeats": [],
                "bpm": 120.0,
                "time_signature": "4/4",
                "sections": [],
                "duration": 0.0,
                "model_used": "allin1",
                "processing_time": time.time() - start_time,
            }

        try:
            model_info = self._get_model()
            allin1 = model_info["module"]
            device = model_info["device"]

            log_info(f"Running ALLIN1 analysis on: {file_path}")

            # ALLIN1 analyze() returns a rich result object
            result = allin1.analyze(
                file_path,
                device=device,
                # Keep model in memory between calls (demucs caching handled internally)
            )

            # Normalize to legacy format
            beats = [float(b) for b in getattr(result, "beats", []) or []]
            downbeats = [float(db) for db in getattr(result, "downbeats", []) or []]
            bpm = float(getattr(result, "bpm", 0) or 0)
            duration = float(getattr(result, "duration", 0) or 0)

            # Time signature inference from downbeat spacing
            time_signature = self._infer_time_signature(beats, downbeats, bpm)

            # Sections (intro, verse, chorus, bridge, outro, etc.)
            sections = []
            raw_sections = getattr(result, "sections", None) or []
            for sec in raw_sections:
                sections.append({
                    "start": float(getattr(sec, "start", 0)),
                    "end": float(getattr(sec, "end", 0)),
                    "label": str(getattr(sec, "label", "unknown")),
                })

            processing_time = time.time() - start_time

            log_info(
                f"ALLIN1 complete: {len(beats)} beats, {len(downbeats)} downbeats, "
                f"BPM={bpm:.1f}, sections={len(sections)}, time={processing_time:.2f}s"
            )

            return {
                "success": True,
                "beats": beats,
                "downbeats": downbeats,
                "bpm": bpm if bpm > 0 else 120.0,
                "time_signature": time_signature,
                "sections": sections,
                "duration": duration if duration > 0 else get_audio_duration(file_path),
                "model_used": "allin1",
                "device": device,
                "processing_time": processing_time,
                "total_beats": len(beats),
                "total_downbeats": len(downbeats),
            }

        except Exception as e:
            log_error(f"ALLIN1 analysis failed: {e}")
            import traceback
            log_error(traceback.format_exc())
            return {
                "success": False,
                "error": f"ALLIN1 analysis failed: {str(e)}",
                "beats": [],
                "downbeats": [],
                "bpm": 120.0,
                "time_signature": "4/4",
                "sections": [],
                "duration": 0.0,
                "model_used": "allin1",
                "processing_time": time.time() - start_time,
            }

    def _infer_time_signature(self, beats: List[float], downbeats: List[float], bpm: float) -> str:
        """
        Infer time signature from downbeat spacing.
        Falls back to 4/4 if uncertain.
        """
        if len(downbeats) < 2 or len(beats) < 4:
            return "4/4"

        try:
            measure_counts = []
            bi = 0
            n_beats = len(beats)
            for i in range(len(downbeats) - 1):
                start, end = float(downbeats[i]), float(downbeats[i + 1])
                while bi < n_beats and beats[bi] < start:
                    bi += 1
                count = 0
                while bi < n_beats and beats[bi] < end:
                    count += 1
                    bi += 1
                if 2 <= count <= 12:
                    measure_counts.append(count)

            if not measure_counts:
                return "4/4"

            from collections import Counter
            dist = Counter(measure_counts)
            dominant = max(dist.items(), key=lambda kv: kv[1])[0]

            # Common signatures
            if dominant == 3:
                return "3/4"
            elif dominant == 4:
                return "4/4"
            elif dominant == 6:
                return "6/8"
            elif dominant == 2:
                return "2/4"
            elif dominant == 5:
                return "5/4"
            else:
                return f"{dominant}/4"
        except Exception:
            return "4/4"

    def get_model_info(self) -> Dict[str, Any]:
        """Return metadata about the ALLIN1 model."""
        return {
            "name": "ALLIN1",
            "description": (
                "Unified music structure analysis by CPJKU. "
                "Detects beats, downbeats, BPM, time signature, and song sections in one pass."
            ),
            "available": self.is_available(),
            "device": self._device or "unknown",
            "capabilities": [
                "beat_detection",
                "downbeat_detection",
                "bpm_estimation",
                "time_signature_inference",
                "song_section_segmentation",
            ],
        }
