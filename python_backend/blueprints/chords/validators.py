"""
Request validation utilities for chord recognition endpoints.

This module provides validation functions for chord recognition requests
including file validation, parameter validation, and error handling.
"""

from typing import Tuple, Optional, Dict, Any
from flask import request
from werkzeug.datastructures import FileStorage
from utils.chord_mappings import get_supported_chord_dicts, get_default_chord_dict


def validate_chord_recognition_request() -> Tuple[bool, Optional[str], Optional[FileStorage], Dict[str, Any]]:
    """
    Validate a chord recognition request.

    Returns:
        Tuple containing:
        - bool: Whether validation passed
        - Optional[str]: Error message if validation failed
        - Optional[FileStorage]: Uploaded file if present
        - Dict[str, Any]: Validated parameters
    """
    # Check if we have either a file upload, audio_path, or JSON data
    file = request.files.get('file')
    audio_path = request.form.get('audio_path')
    json_data = None

    # Check for JSON data (for URL-based requests)
    if request.is_json:
        json_data = request.get_json()
        audio_url = json_data.get('audioUrl') if json_data else None
        if audio_url:
            # Convert relative URL to file path logic will be handled in the route
            pass

    if not file and not audio_path and not json_data:
        return False, "No audio file provided. Please upload a file, provide audio_path, or send JSON with audioUrl.", None, {}

    # Validate detector parameter
    if json_data:
        detector = json_data.get('detector', 'auto').lower()
        chord_dict = json_data.get('chordDict', None)
    else:
        detector = request.form.get('detector', 'auto').lower()
        chord_dict = request.form.get('chord_dict', None)

    valid_detectors = ['btc-sl', 'btc-pl', 'auto']
    if detector not in valid_detectors:
        return False, f"Invalid detector '{detector}'. Must be one of: {', '.join(valid_detectors)}", file, {}

    # Validate force parameter
    if json_data:
        force = json_data.get('force', False)
    else:
        force_param = request.args.get('force', request.form.get('force', '')).lower()
        force = force_param == 'true'

    # Validate vocal isolation (Demucs) parameter
    if json_data:
        use_vocal_isolation = json_data.get('useVocalIsolation', False)
    else:
        vocal_param = request.form.get('use_vocal_isolation', 'false').lower()
        use_vocal_isolation = vocal_param == 'true'

    # Validate Gemini post-processing parameter
    if json_data:
        use_gemini_postprocess = json_data.get('useGeminiPostprocess', True)
    else:
        gemini_param = request.form.get('use_gemini_postprocess', 'true').lower()
        use_gemini_postprocess = gemini_param == 'true'

    # Validate file if provided
    if file and file.filename == '':
        return False, "No file selected", None, {}

    params = {
        'detector': detector,
        'chord_dict': chord_dict,
        'force': force,
        'use_vocal_isolation': use_vocal_isolation,
        'use_gemini_postprocess': use_gemini_postprocess,
        'audio_path': audio_path,
        'json_data': json_data
    }

    return True, None, file, params


def validate_firebase_chord_recognition_request() -> Tuple[bool, Optional[str], Dict[str, Any]]:
    """
    Validate a Firebase chord recognition request.

    Returns:
        Tuple containing:
        - bool: Whether validation passed
        - Optional[str]: Error message if validation failed
        - Dict[str, Any]: Validated parameters
    """
    # Check for Firebase URL
    firebase_url = request.form.get('firebase_url')
    if not firebase_url:
        return False, "No Firebase URL provided", {}

    # Validate Firebase URL
    if 'firebasestorage.googleapis.com' not in firebase_url and 'storage.googleapis.com' not in firebase_url:
        return False, "Invalid Firebase Storage URL", {}

    # Validate detector parameter
    detector = request.form.get('detector', 'auto').lower()
    valid_detectors = ['btc-sl', 'btc-pl', 'auto']
    if detector not in valid_detectors:
        return False, f"Invalid detector '{detector}'. Must be one of: {', '.join(valid_detectors)}", {}

    # Validate chord_dict parameter
    chord_dict = request.form.get('chord_dict', None)

    params = {
        'firebase_url': firebase_url,
        'detector': detector,
        'chord_dict': chord_dict
    }

    return True, None, params


def validate_chord_dict_for_detector(chord_dict: str, detector: str) -> Tuple[bool, Optional[str]]:
    """
    Validate that a chord dictionary is supported by a detector.

    Args:
        chord_dict: Chord dictionary name
        detector: Detector name

    Returns:
        Tuple containing:
        - bool: Whether validation passed
        - Optional[str]: Error message if validation failed
    """
    if not chord_dict:
        return True, None  # Will use default

    supported_dicts = get_supported_chord_dicts(detector)
    if chord_dict not in supported_dicts:
        return False, f"Chord dictionary '{chord_dict}' not supported by {detector}. Supported: {', '.join(supported_dicts)}"

    return True, None


def get_file_size_mb(file: FileStorage) -> float:
    """
    Get file size in megabytes.

    Args:
        file: Uploaded file

    Returns:
        float: File size in MB
    """
    # Save current position
    current_pos = file.tell()

    # Seek to end to get size
    file.seek(0, 2)  # Seek to end
    size_bytes = file.tell()

    # Restore original position
    file.seek(current_pos)

    return size_bytes / (1024 * 1024)


def validate_file_size(file: FileStorage, detector: str, force: bool) -> Tuple[bool, Optional[str]]:
    """
    Validate file size based on detector and force parameter.

    Args:
        file: Uploaded file
        detector: Selected detector
        force: Whether force parameter is enabled

    Returns:
        Tuple containing:
        - bool: Whether validation passed
        - Optional[str]: Error message if validation failed
    """
    file_size_mb = get_file_size_mb(file)

    # Size limits based on detector
    size_limits = {
        'btc-sl': 150,
        'btc-pl': 150,
        'auto': 150
    }

    # Check size limits unless force is enabled
    if not force:
        limit = size_limits.get(detector, 150)
        if file_size_mb > limit:
            return False, f"File too large ({file_size_mb:.1f}MB > {limit}MB). Add 'force=true' to override size limits."

    return True, None


def normalize_audio_url_to_path(audio_url: str, audio_dir: str) -> str:
    """
    Convert a relative audio URL to an absolute file path.

    Args:
        audio_url: Relative audio URL (e.g., '/audio/song.mp3')
        audio_dir: Audio directory path

    Returns:
        str: Absolute file path
    """
    import os

    if audio_url.startswith('/audio/'):
        # Convert to absolute path
        relative_path = audio_url[7:]  # Remove '/audio/' prefix
        file_path = os.path.join(audio_dir, relative_path)
        return file_path

    return audio_url  # Return as-is if not a relative URL


def validate_model_name(model_name: str) -> bool:
    """
    Validate a model name.

    Args:
        model_name: Model name to validate

    Returns:
        bool: True if the model name is valid
    """
    valid_models = ['btc-sl', 'btc-pl']
    return model_name in valid_models


def get_detector_display_name(detector: str) -> str:
    """
    Get a human-readable display name for a detector.

    Args:
        detector: Detector name

    Returns:
        str: Display name
    """
    display_names = {
        'btc-sl': 'BTC SL (Self-Label)',
        'btc-pl': 'BTC PL (Pseudo-Label)',
        'auto': 'Auto Selection'
    }
    return display_names.get(detector, detector)