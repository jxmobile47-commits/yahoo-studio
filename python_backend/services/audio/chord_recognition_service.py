"""
Chord recognition service.

This module provides the main orchestration service for chord recognition,
handling model selection, chord dictionary selection, and fallback strategies.
"""

import os
import time
from typing import Dict, Any, List, Optional
from utils.logging import log_info, log_error, log_debug
from services.detectors.btc_sl_detector import BTCSLDetectorService
from services.detectors.btc_pl_detector import BTCPLDetectorService
from services.audio.audio_utils import validate_audio_file, get_audio_duration
from services.audio.demucs_stem_service import DemucsStemService
from services.audio.chord_gemini_service import ChordGeminiService
from utils.chord_mappings import (
    get_supported_chord_dicts,
    get_default_chord_dict,
    validate_chord_dict_for_model
)
from utils.paths import CHORDMINI_DIR


class ChordRecognitionService:
    """
    Main service for chord recognition with model selection and orchestration.
    """
    
    def __init__(self):
        """Initialize the chord recognition service with available detectors."""
        self.detectors = {
            'btc-sl': BTCSLDetectorService(str(CHORDMINI_DIR)),
            'btc-pl': BTCPLDetectorService(str(CHORDMINI_DIR))
        }

        # File size limits (in MB)
        self.size_limits = {
            'btc-sl': 150,
            'btc-pl': 150
        }

        # Stem separation for vocal isolation before chord detection
        self.demucs_service = DemucsStemService()

        # Gemini post-processing for enharmonic correction & extended chords
        self.gemini_service = ChordGeminiService()
    
    def get_available_detectors(self) -> List[str]:
        """
        Get list of available detectors.
        
        Returns:
            List[str]: Names of available detectors
        """
        available = []
        for name, detector in self.detectors.items():
            if detector.is_available():
                available.append(name)
        return available
    
    def select_detector(self, requested_detector: str, file_size_mb: float,
                       force: bool = False) -> str:
        """
        Select the best detector based on request, availability, and file size.

        Args:
            requested_detector: Requested detector ('btc-sl', 'btc-pl', 'auto')
            file_size_mb: File size in megabytes
            force: Force use of requested detector even if file is large

        Returns:
            str: Selected detector name

        Raises:
            ValueError: If no suitable detector is available
        """
        available_detectors = self.get_available_detectors()

        if not available_detectors:
            raise ValueError("No chord recognition models available")

        log_debug(f"Available detectors: {available_detectors}")
        log_debug(f"Requested: {requested_detector}, File size: {file_size_mb:.1f}MB, Force: {force}")

        # Handle specific detector requests
        if requested_detector in ['btc-sl', 'btc-pl']:
            if requested_detector not in available_detectors:
                log_error(f"{requested_detector} requested but not available")
                return self._select_fallback_detector(available_detectors, file_size_mb)

            if not force and file_size_mb > self.size_limits[requested_detector]:
                log_info(f"File too large for {requested_detector} ({file_size_mb:.1f}MB > {self.size_limits[requested_detector]}MB)")
                return self._select_fallback_detector(available_detectors, file_size_mb)

            return requested_detector

        # Handle 'auto' selection
        elif requested_detector == 'auto':
            return self._auto_select_detector(available_detectors, file_size_mb)

        else:
            log_error(f"Unknown detector '{requested_detector}', using auto selection")
            return self._auto_select_detector(available_detectors, file_size_mb)

    def _auto_select_detector(self, available_detectors: List[str], file_size_mb: float) -> str:
        """
        Automatically select the best detector based on availability and file size.

        Args:
            available_detectors: List of available detector names
            file_size_mb: File size in megabytes

        Returns:
            str: Selected detector name
        """
        # Preference order: btc-sl > btc-pl
        if 'btc-sl' in available_detectors and file_size_mb <= self.size_limits['btc-sl']:
            return 'btc-sl'
        if 'btc-pl' in available_detectors and file_size_mb <= self.size_limits['btc-pl']:
            return 'btc-pl'

        # Fallback to any available detector
        return available_detectors[0]

    def _select_fallback_detector(self, available_detectors: List[str], file_size_mb: float) -> str:
        """
        Select a fallback detector when the requested one is not suitable.

        Args:
            available_detectors: List of available detector names
            file_size_mb: File size in megabytes

        Returns:
            str: Selected fallback detector name
        """
        suitable_detectors = [
            detector for detector in available_detectors
            if file_size_mb <= self.size_limits[detector]
        ]

        if suitable_detectors:
            if 'btc-sl' in suitable_detectors:
                return 'btc-sl'
            elif 'btc-pl' in suitable_detectors:
                return 'btc-pl'
            else:
                return suitable_detectors[0]

        return max(available_detectors, key=lambda d: self.size_limits[d])
    
    def recognize_chords(self, file_path: str, detector: str = 'auto',
                        chord_dict: str = None, force: bool = False,
                        use_vocal_isolation: bool = False,
                        use_gemini_postprocess: bool = True) -> Dict[str, Any]:
        """
        Recognize chords in an audio file.

        Args:
            file_path: Path to the audio file
            detector: Detector to use ('btc-sl', 'btc-pl', 'auto')
            chord_dict: Chord dictionary to use (if None, uses model default)
            force: Force use of requested detector even if file is large
            use_vocal_isolation: Whether to use Demucs vocal isolation before chord detection
            use_gemini_postprocess: Whether to apply Gemini enharmonic correction

        Returns:
            Dict containing chord recognition results with normalized format
        """
        start_time = time.time()

        try:
            if not os.path.exists(file_path):
                return {
                    "success": False,
                    "error": f"Audio file not found: {file_path}",
                    "processing_time": time.time() - start_time
                }

            if not validate_audio_file(file_path):
                return {
                    "success": False,
                    "error": "Invalid or corrupted audio file",
                    "processing_time": time.time() - start_time
                }

            file_size_bytes = os.path.getsize(file_path)
            file_size_mb = file_size_bytes / (1024 * 1024)

            log_info(f"Processing audio file: {file_path} ({file_size_mb:.1f}MB)")

            selected_detector = self.select_detector(detector, file_size_mb, force)
            log_info(f"Selected detector: {selected_detector}")

            detector_service = self.detectors[selected_detector]

            if chord_dict is None:
                chord_dict = get_default_chord_dict(selected_detector)

            if not validate_chord_dict_for_model(chord_dict, selected_detector):
                supported_dicts = get_supported_chord_dicts(selected_detector)
                log_error(f"Chord dictionary '{chord_dict}' not supported by {selected_detector}")
                chord_dict = supported_dicts[0] if supported_dicts else 'submission'
                log_info(f"Using fallback chord dictionary: {chord_dict}")

            # Vocal isolation with Demucs if requested
            audio_file_to_process = file_path
            demucs_info = None

            if use_vocal_isolation and self.demucs_service.is_available():
                log_info("Using Demucs for vocal isolation before chord recognition")
                demucs_result = self.demucs_service.separate_audio(file_path)
                if demucs_result.get("success"):
                    vocals_path = demucs_result.get("stems", {}).get("vocals")
                    if vocals_path and os.path.exists(vocals_path):
                        audio_file_to_process = vocals_path
                        demucs_info = {
                            "used": True,
                            "model": demucs_result.get("model_used", "htdemucs"),
                            "processing_time": demucs_result.get("processing_time", 0.0)
                        }
                        log_info(f"Using isolated vocals for chord detection: {audio_file_to_process}")
                else:
                    log_error(f"Demucs vocal isolation failed: {demucs_result.get('error')}")
                    demucs_info = {"used": False, "error": demucs_result.get("error")}

            # Run chord recognition (BTC-SL or BTC-PL)
            result = detector_service.recognize_chords(audio_file_to_process, chord_dict)

            # Gemini post-processing for enharmonic correction & extended chords
            gemini_info = None
            if use_gemini_postprocess and result.get("success") and self.gemini_service.is_available():
                try:
                    raw_chords = result.get("chords", [])
                    bpm = result.get("bpm", 120.0)
                    key = result.get("key", None)

                    log_info(f"Sending {len(raw_chords)} chords to Gemini for post-processing")
                    gemini_result = self.gemini_service.post_process_chords(
                        raw_chords=raw_chords,
                        bpm=bpm,
                        key=key,
                    )

                    gemini_info = {
                        "used": True,
                        "success": gemini_result.get("success", False),
                        "model_used": gemini_result.get("model_used", "gemini"),
                        "processing_time": gemini_result.get("processing_time", 0.0),
                        "enhancements_applied": gemini_result.get("enhancements_applied", []),
                    }

                    if gemini_result.get("success"):
                        # Replace chords with Gemini-corrected version
                        result["chords"] = gemini_result.get("chords", raw_chords)
                        result["chords_gemini_corrected"] = True
                        result["roman_numerals"] = gemini_result.get("roman_numerals")
                        result["key_inferred"] = gemini_result.get("key", key)
                        log_info(f"Gemini post-processing applied: {gemini_info['enhancements_applied']}")
                    else:
                        log_error(f"Gemini post-processing failed: {gemini_result.get('error')}")
                        gemini_info["error"] = gemini_result.get("error")

                except Exception as e:
                    log_error(f"Gemini post-processing exception: {e}")
                    gemini_info = {"used": True, "success": False, "error": str(e)}
            else:
                gemini_info = {"used": False, "reason": "disabled or unavailable"}

            # Add metadata
            result['file_size_mb'] = file_size_mb
            result['detector_selected'] = selected_detector
            result['detector_requested'] = detector
            result['force_used'] = force
            result['demucs_info'] = demucs_info
            result['gemini_info'] = gemini_info

            if 'duration' not in result or result['duration'] == 0:
                try:
                    result['duration'] = get_audio_duration(file_path)
                except Exception as e:
                    log_error(f"Failed to get audio duration: {e}")
                    result['duration'] = 0.0

            total_time = time.time() - start_time
            result['total_processing_time'] = total_time

            # Cleanup Demucs files if used
            if demucs_info and demucs_info.get("used"):
                try:
                    self.demucs_service.cleanup_stems(demucs_result)
                except Exception as e:
                    log_error(f"Failed to cleanup Demucs files: {e}")

            if result.get('success'):
                log_info(f"Chord recognition successful: {result['total_chords']} chords, "
                        f"Model: {result['model_used']}, "
                        f"Dict: {result['chord_dict']}, "
                        f"Gemini: {gemini_info.get('used', False)}, "
                        f"Time: {total_time:.2f}s")
            else:
                log_error(f"Chord recognition failed: {result.get('error', 'Unknown error')}")

            return result

        except Exception as e:
            error_msg = f"Chord recognition service error: {str(e)}"
            log_error(error_msg)
            import traceback
            log_error(traceback.format_exc())
            return {
                "success": False,
                "error": error_msg,
                "processing_time": time.time() - start_time
            }

    def get_detector_info(self) -> Dict[str, Any]:
        """
        Get information about available detectors.

        Returns:
            Dict containing detector availability and capabilities
        """
        info = {
            "available_detectors": self.get_available_detectors(),
            "detectors": {},
            "demucs_available": self.demucs_service.is_available(),
            "gemini_available": self.gemini_service.is_available(),
        }

        for name, detector in self.detectors.items():
            detector_info = detector.get_model_info()
            detector_info["size_limit_mb"] = self.size_limits[name]
            detector_info["supported_chord_dicts"] = get_supported_chord_dicts(name)
            detector_info["default_chord_dict"] = get_default_chord_dict(name)
            info["detectors"][name] = detector_info

        if self.demucs_service.is_available():
            info["demucs_info"] = self.demucs_service.get_model_info()

        if self.gemini_service.is_available():
            info["gemini_info"] = {"available": True, "model": "gemini-1.5-flash"}

        return info