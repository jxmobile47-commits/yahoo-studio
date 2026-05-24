"""
Demucs Stem Separation Service
==============================
StemDeck-style subprocess-based Demucs separation.

Uses `python -m demucs` as a subprocess with:
  - FFmpeg audio normalization before separation
  - stderr progress parsing (e.g. "85%")
  - Watchdog thread to kill stalled demucs
  - 6-stem support via htdemucs_6s (vocals, drums, bass, guitar, piano, other)

Package: pip install demucs
GitHub: https://github.com/facebookresearch/demucs
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch

from utils.logging import log_debug, log_error, log_info

# Progress regex: demucs prints "42%" on a single \r line
_PCT_RE = re.compile(r"(\d{1,3})%")

# Kill demucs if stderr goes silent for this many seconds.
# GPU processing can be legitimately quiet for minutes;
# 30 min (1800 s) catches genuine hangs (OOM, deadlock).
DEFAULT_STALL_TIMEOUT = 1800

# 6 stems from htdemucs_6s
SIX_STEM_NAMES = ("vocals", "drums", "bass", "guitar", "piano", "other")
# 4 stems from htdemucs
FOUR_STEM_NAMES = ("vocals", "drums", "bass", "other")

STEM_NAMES = SIX_STEM_NAMES


def _detect_device() -> str:
    """Pick best available Torch device: cuda > mps > cpu."""
    forced = os.environ.get("STEMDECK_DEMUCS_DEVICE", "").strip().lower()
    if forced in ("cuda", "mps", "cpu"):
        return forced
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _ffmpeg_executable() -> str:
    """Return the preferred FFmpeg executable."""
    # Bundled FFmpeg (portable)
    stemdeck_ffmpeg = os.environ.get("STEMDECK_FFMPEG", "").strip()
    if stemdeck_ffmpeg and Path(stemdeck_ffmpeg).is_file():
        return stemdeck_ffmpeg
    # Portable data dir layout
    data_dir = os.environ.get("STEMDECK_DATA_DIR", "").strip()
    if data_dir:
        ffmpeg_bin = Path(data_dir) / "ffmpeg" / (
            "ffmpeg.exe" if sys.platform.startswith("win") else "ffmpeg"
        )
        if ffmpeg_bin.is_file():
            return str(ffmpeg_bin)
    return "ffmpeg"


def _transcode_to_wav(source: Path, dest: Path) -> Path:
    """Normalize any audio to 16-bit 44.1 kHz stereo WAV via FFmpeg.

    This fixes silent outputs from Demucs when the input is
    24-bit, 32-bit float, high sample rate, or non-stereo.
    """
    cmd = [
        _ffmpeg_executable(),
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-ar",
        "44100",
        "-ac",
        "2",
        "-sample_fmt",
        "s16",
        "-y",
        str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(
            "ffmpeg transcode failed: "
            + result.stderr.decode("utf-8", errors="replace").strip()
        )
    return dest


class DemucsStemService:
    """
    Service wrapper around Demucs v4 using the StemDeck subprocess pattern.
    Separates audio via `python -m demucs` subprocess with FFmpeg pre-processing.
    """

    def __init__(
        self,
        model_name: str = "htdemucs_6s",
        stall_timeout: int = DEFAULT_STALL_TIMEOUT,
    ):
        self.model_name = model_name
        self.stall_timeout = stall_timeout
        self._device: Optional[str] = None
        self._available: Optional[bool] = None

    def is_available(self) -> bool:
        """Check if demucs is importable."""
        if self._available is not None:
            return self._available
        try:
            import demucs  # noqa: F401
            self._available = True
        except ImportError as e:
            log_error(f"demucs not available: {e}")
            self._available = False
        return self._available

    @property
    def device(self) -> str:
        if self._device is None:
            self._device = _detect_device()
        return self._device

    def _run_demucs_subprocess(
        self,
        source_wav: Path,
        output_dir: Path,
        progress_callback: Optional[callable] = None,
    ) -> Path:
        """Run demucs as a subprocess, parse stderr for progress, and return stems root.

        Args:
            source_wav: Path to a 16-bit 44.1 kHz stereo WAV file.
            output_dir: Directory where Demucs will write its output.
            progress_callback: Optional callable(pct: float) called on progress updates.

        Returns:
            Path to the Demucs output directory containing the stem WAV files.
        """
        cmd = [
            sys.executable,
            "-m",
            "demucs",
            "-n",
            self.model_name,
            "-d",
            self.device,
            "-o",
            str(output_dir),
            str(source_wav),
        ]
        env = os.environ.copy()
        # Certificate fixes for environments without system certs
        try:
            import certifi
            env.setdefault("SSL_CERT_FILE", certifi.where())
            env.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
        except ImportError:
            pass

        log_info(f"Running demucs: {' '.join(cmd)}")
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0,
            env=env,
        )
        if proc.stderr is None:
            raise RuntimeError("demucs subprocess has no stderr pipe")

        # --- Watchdog thread ---
        last_output = [time.monotonic()]

        def watchdog() -> None:
            while proc.poll() is None:
                time.sleep(30)
                if time.monotonic() - last_output[0] > self.stall_timeout:
                    log_error(
                        f"demucs stalled >{self.stall_timeout}s with no output, terminating"
                    )
                    proc.terminate()
                    break

        wt = threading.Thread(target=watchdog, daemon=True)
        wt.start()

        # --- Parse stderr for progress ---
        buf = ""
        tail: list[str] = []

        try:
            while True:
                ch = proc.stderr.read(1)
                if not ch:
                    break
                last_output[0] = time.monotonic()
                if ch in ("\r", "\n"):
                    line = buf.strip()
                    buf = ""
                    if not line:
                        continue
                    m = _PCT_RE.search(line)
                    if m:
                        pct = max(0, min(100, int(m.group(1))))
                        if progress_callback:
                            progress_callback(pct / 100.0)
                    else:
                        tail.append(line)
                        if len(tail) > 40:
                            tail.pop(0)
                else:
                    buf += ch
        finally:
            proc.wait()
            wt.join(timeout=5)

        if proc.returncode != 0:
            detail = "\n".join(tail[-15:]) if tail else "(no stderr captured)"
            raise RuntimeError(f"demucs exited {proc.returncode}: {detail}")

        # Demucs writes output to: output_dir/model_name/source_stem/
        stems_root = output_dir / self.model_name / source_wav.stem
        if not stems_root.is_dir():
            raise RuntimeError(f"demucs output not found at {stems_root}")
        return stems_root

    def separate_audio(
        self,
        audio_path: str,
        output_dir: Optional[str] = None,
        model_name: Optional[str] = None,
        progress_callback: Optional[callable] = None,
    ) -> Dict[str, Any]:
        """
        Separate audio into stems using Demucs via subprocess.

        Args:
            audio_path: Path to input audio file (any format FFmpeg supports).
            output_dir: Output directory (created as temp if None).
            model_name: Demucs model name (default: htdemucs_6s for 6 stems).
            progress_callback: Optional callable(pct: float) for progress updates.

        Returns:
            {
                "success": bool,
                "stems": {stem_name: file_path, ...},
                "output_dir": str,
                "model_used": str,
                "processing_time": float,
                "error": str (if success=False),
            }
        """
        start_time = time.time()
        temp_dir_created = False

        if not self.is_available():
            return {
                "success": False,
                "error": "Demucs is not available",
                "model_used": model_name or self.model_name,
                "processing_time": time.time() - start_time,
            }

        active_model = model_name or self.model_name
        # Remap legacy 4-stem model to 6-stem if user didn't specify
        if active_model not in ("htdemucs_6s", "htdemucs"):
            active_model = "htdemucs_6s"

        try:
            audio_path = Path(audio_path)
            if not audio_path.is_file():
                raise FileNotFoundError(f"Input audio not found: {audio_path}")

            if output_dir is None:
                output_dir = tempfile.mkdtemp(prefix="demucs_")
                temp_dir_created = True
            else:
                output_dir = Path(output_dir)
                output_dir.mkdir(parents=True, exist_ok=True)

            # --- Step 1: FFmpeg normalize to 16-bit 44.1 kHz stereo WAV ---
            normalized_wav = output_dir / "source.wav"
            log_info(f"Normalizing audio: {audio_path} -> {normalized_wav}")
            _transcode_to_wav(audio_path, normalized_wav)

            # --- Step 2: Run Demucs subprocess ---
            log_info(f"Running Demucs separation on: {normalized_wav}")
            stems_root = self._run_demucs_subprocess(
                normalized_wav, output_dir, progress_callback
            )

            # --- Step 3: Collect stem paths ---
            stems: Dict[str, str] = {}
            for wav_file in sorted(stems_root.glob("*.wav")):
                # Demucs stem names: e.g. "drums.wav", "vocals.wav"
                stem_name = wav_file.stem  # e.g. "vocals"
                stems[stem_name] = str(wav_file)
                log_debug(f"Found stem '{stem_name}': {wav_file}")

            # --- Step 4: Cleanup temp source WAV (keep stems) ---
            try:
                normalized_wav.unlink(missing_ok=True)
            except OSError:
                pass

            processing_time = time.time() - start_time
            log_info(
                f"Demucs separation done: {len(stems)} stems in {processing_time:.1f}s"
            )

            return {
                "success": True,
                "stems": stems,
                "output_dir": str(output_dir),
                "model_used": active_model,
                "processing_time": processing_time,
                "temp_dir_created": temp_dir_created,
            }

        except Exception as e:
            error_msg = f"Demucs separation error: {e}"
            log_error(error_msg, exc_info=True)

            if temp_dir_created and output_dir:
                try:
                    shutil.rmtree(output_dir)
                except Exception:
                    pass

            return {
                "success": False,
                "error": error_msg,
                "model_used": model_name or self.model_name,
                "processing_time": time.time() - start_time,
            }

    def extract_vocals(self, audio_path: str, output_dir: Optional[str] = None) -> Dict[str, Any]:
        """Extract vocals stem (and accompaniment as the inverse)."""
        result = self.separate_audio(audio_path, output_dir)
        if result.get("success"):
            stems = result.get("stems", {})
            result["vocals_path"] = stems.get("vocals")
            result["accompaniment_path"] = None
        return result

    def extract_instruments(self, audio_path: str, output_dir: Optional[str] = None) -> Dict[str, Any]:
        """Extract individual instrument stems."""
        return self.separate_audio(audio_path, output_dir)

    def cleanup_stems(self, stems_info: Dict[str, Any]) -> bool:
        """Clean up separated stem files and output directory."""
        try:
            if stems_info.get("temp_dir_created") and stems_info.get("output_dir"):
                shutil.rmtree(stems_info["output_dir"])
                log_debug(f"Cleaned up Demucs output directory: {stems_info['output_dir']}")
                return True
            elif stems_info.get("stems"):
                for stem_path in stems_info["stems"].values():
                    if os.path.exists(stem_path):
                        os.unlink(stem_path)
                return True
            return True
        except Exception as e:
            log_error(f"Failed to cleanup Demucs stems: {e}")
            return False

    def get_available_models(self) -> List[str]:
        """List available Demucs model names."""
        if not self.is_available():
            return []
        return ["htdemucs_6s", "htdemucs", "htdemucs_ft", "hdemucs_mmi"]

    def get_model_info(self) -> Dict[str, Any]:
        """Return metadata about the Demucs models."""
        return {
            "available": self.is_available(),
            "device": self.device,
            "default_model": self.model_name,
            "models": {
                "htdemucs_6s": {
                    "description": "6-stem variant (vocals, drums, bass, guitar, piano, other)",
                    "stems": list(SIX_STEM_NAMES),
                },
                "htdemucs": {
                    "description": "Best quality, 4 stems (vocals, drums, bass, other)",
                    "stems": list(FOUR_STEM_NAMES),
                },
                "htdemucs_ft": {
                    "description": "Fine-tuned variant, 4 stems",
                    "stems": list(FOUR_STEM_NAMES),
                },
                "hdemucs_mmi": {
                    "description": "MMI-trained variant, 4 stems",
                    "stems": list(FOUR_STEM_NAMES),
                },
            },
        }
