"""
Demucs Stem Separation Service
==============================
Replaces Spleeter with Demucs v4 by Meta AI.
Separates: vocals, drums, bass, other (htdemucs model).

Package: pip install demucs
GitHub: https://github.com/facebookresearch/demucs
"""

import os
import time
import tempfile
import shutil
from pathlib import Path
from typing import Dict, Any, List, Optional

from utils.logging import log_info, log_error, log_debug


class DemucsStemService:
    """
    Service wrapper around Demucs v4 for audio source separation.
    Loads the model once at startup and reuses it across requests.
    """

    def __init__(self, model_name: str = "htdemucs"):
        self.model_name = model_name
        self._available: Optional[bool] = None
        self._separator = None
        self._device = None

    def is_available(self) -> bool:
        """Check if demucs is installed and models can be loaded."""
        if self._available is not None:
            return self._available

        try:
            import demucs
            import torch
            log_debug(f"demucs found: {getattr(demucs, '__version__', 'unknown')}")
            self._available = True
            return True
        except ImportError as e:
            log_error(f"demucs not available: {e}")
            self._available = False
            return False

    def _get_separator(self):
        """Lazy-load the Demucs separator once."""
        if self._separator is not None:
            return self._separator

        import torch
        from demucs.pretrained import get_model
        from demucs.audio import AudioFile
        from demucs.apply import apply_model

        # Auto-detect device
        if torch.cuda.is_available():
            self._device = "cuda"
        elif torch.backends.mps.is_available():
            self._device = "mps"
        else:
            self._device = "cpu"

        log_info(f"Loading Demucs model '{self.model_name}' on device: {self._device}")
        start_load = time.time()

        model = get_model(self.model_name)
        model.to(self._device)
        model.eval()

        self._separator = model
        log_info(f"Demucs model loaded in {time.time() - start_load:.2f}s")
        return self._separator

    def separate_audio(
        self,
        audio_path: str,
        output_dir: Optional[str] = None,
        model_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Separate audio into stems using Demucs.

        Args:
            audio_path: Path to input audio file
            output_dir: Output directory (created as temp if None)
            model_name: Demucs model name (overrides default; e.g. 'htdemucs', 'htdemucs_ft')

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

        try:
            import torch
            import torchaudio
            from demucs.apply import apply_model
            from demucs.audio import convert_audio

            model = self._get_separator()
            active_model_name = model_name or self.model_name

            if output_dir is None:
                output_dir = tempfile.mkdtemp(prefix="demucs_")
                temp_dir_created = True
            else:
                os.makedirs(output_dir, exist_ok=True)

            log_info(f"Running Demucs separation on: {audio_path} with model {active_model_name}")

            # Load audio (supports various formats via torchaudio)
            wav, sr = torchaudio.load(audio_path)

            # Ensure stereo if mono
            if wav.shape[0] == 1:
                wav = wav.repeat(2, 1)

            # Convert to model's expected sample rate and device
            wav = convert_audio(wav, sr, model.samplerate, model.audio_channels)
            wav = wav.to(self._device)

            # Apply model
            with torch.no_grad():
                # wav shape: (channels, time) -> add batch dim
                sources = apply_model(model, wav.unsqueeze(0), device=self._device)
                # sources shape: (batch, stems, channels, time)
                sources = sources[0]  # remove batch dim

            # sources is tensor of shape (stems, channels, time)
            stem_names = model.sources  # e.g. ["drums", "bass", "other", "vocals"]

            stems = {}
            base_name = Path(audio_path).stem

            for i, stem_name in enumerate(stem_names):
                stem_audio = sources[i]  # (channels, time)
                # Clamp to valid range
                stem_audio = stem_audio.cpu().clamp(-1, 1)

                stem_filename = f"{base_name}_{stem_name}.wav"
                stem_path = os.path.join(output_dir, stem_filename)

                torchaudio.save(stem_path, stem_audio, model.samplerate)
                stems[stem_name] = stem_path
                log_debug(f"Saved stem '{stem_name}' to: {stem_path}")

            processing_time = time.time() - start_time
            log_info(f"Demucs separation successful: {len(stems)} stems in {processing_time:.2f}s")

            return {
                "success": True,
                "stems": stems,
                "output_dir": output_dir,
                "model_used": active_model_name,
                "processing_time": processing_time,
                "temp_dir_created": temp_dir_created,
            }

        except Exception as e:
            error_msg = f"Demucs separation error: {str(e)}"
            log_error(error_msg)
            import traceback
            log_error(traceback.format_exc())

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
        """Extract vocals (and accompaniment as the inverse)."""
        result = self.separate_audio(audio_path, output_dir)
        if result.get("success"):
            stems = result.get("stems", {})
            result["vocals_path"] = stems.get("vocals")
            # Accompaniment = all stems except vocals mixed together
            result["accompaniment_path"] = None
        return result

    def extract_instruments(self, audio_path: str, output_dir: Optional[str] = None) -> Dict[str, Any]:
        """Extract individual instruments (drums, bass, other, vocals)."""
        return self.separate_audio(audio_path, output_dir)

    def cleanup_stems(self, stems_info: Dict[str, Any]) -> bool:
        """Clean up separated stem files."""
        try:
            if stems_info.get("temp_dir_created") and stems_info.get("output_dir"):
                shutil.rmtree(stems_info["output_dir"])
                log_debug(f"Cleaned up Demucs output directory: {stems_info['output_dir']}")
                return True
            elif stems_info.get("stems"):
                for stem_path in stems_info["stems"].values():
                    if os.path.exists(stem_path):
                        os.unlink(stem_path)
                        log_debug(f"Cleaned up stem file: {stem_path}")
                return True
            return True
        except Exception as e:
            log_error(f"Failed to cleanup Demucs stems: {e}")
            return False

    def get_available_models(self) -> List[str]:
        """List available Demucs model names."""
        if not self.is_available():
            return []
        return ["htdemucs", "htdemucs_ft", "htdemucs_6s", "hdemucs_mmi"]

    def get_model_info(self) -> Dict[str, Any]:
        """Return metadata about the Demucs model."""
        return {
            "available": self.is_available(),
            "default_model": self.model_name,
            "models": {
                "htdemucs": {
                    "description": "Best quality, 4 stems (vocals, drums, bass, other)",
                    "stems": ["vocals", "drums", "bass", "other"],
                },
                "htdemucs_ft": {
                    "description": "Fine-tuned variant, 4 stems",
                    "stems": ["vocals", "drums", "bass", "other"],
                },
                "htdemucs_6s": {
                    "description": "6-stem variant (+ guitar, piano)",
                    "stems": ["vocals", "drums", "bass", "guitar", "piano", "other"],
                },
                "hdemucs_mmi": {
                    "description": "MMI-trained variant, 4 stems",
                    "stems": ["vocals", "drums", "bass", "other"],
                },
            },
        }
