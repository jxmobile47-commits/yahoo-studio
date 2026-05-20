"""
Beat detection routes for ChordMini Flask application.

This module provides all beat detection related endpoints including
main detection, Firebase integration, testing, and model information.
"""

import os
import tempfile
import traceback
import requests
from flask import Blueprint, request, jsonify, current_app
from extensions import limiter
from config import get_config
from .validators import (
    validate_beat_detection_request,
    validate_firebase_beat_detection_request,
    validate_file_size
)
from services.audio.tempfiles import temporary_file
from utils.logging import log_info, log_error, log_debug

# Create blueprint
beats_bp = Blueprint('beats', __name__)

# Get configuration for rate limits
config = get_config()


def _download_remote_audio_to_temp_path(file_url: str, temp_path: str, timeout_seconds: int = 300) -> None:
    """Stream a remote audio file into a temporary path."""
    with requests.get(file_url, stream=True, timeout=(30, timeout_seconds)) as response:
        response.raise_for_status()
        with open(temp_path, 'wb') as file_handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    file_handle.write(chunk)


@beats_bp.route('/api/detect-beats', methods=['POST'])
@limiter.limit(config.get_rate_limit('heavy_processing'))
def detect_beats():
    """
    Detect beats in an audio file

    Parameters:
    - file: The audio file to analyze (multipart/form-data)
    - audio_path: Alternative to file, path to an existing audio file on the server
    - detector: 'allin1', 'librosa', or 'auto' (default)
    - force: Set to 'true' to force using requested detector even for large files

    Returns:
    - JSON with beat and downbeat information
    """
    try:
        # Validate request
        is_valid, error_msg, file, params = validate_beat_detection_request()
        if not is_valid:
            return jsonify({"error": error_msg}), 400

        # Get beat detection service
        beat_service = current_app.extensions['services']['beat_detection']

        file_path = None
        temp_file_path = None

        try:
            if file:
                # Validate file size
                size_valid, size_error = validate_file_size(file, params['detector'], params['force'])
                if not size_valid:
                    return jsonify({"error": size_error}), 413

                # Create temporary file
                with temporary_file(suffix='.mp3') as temp_path:
                    file.save(temp_path)
                    file_path = temp_path
                    temp_file_path = temp_path

                    # Run beat detection
                    result = beat_service.detect_beats(
                        file_path=file_path,
                        detector=params['detector'],
                        force=params['force']
                    )
            else:
                # Use provided audio path
                file_path = params['audio_path']
                if not os.path.exists(file_path):
                    return jsonify({"error": f"Audio file not found: {file_path}"}), 404

                # Run beat detection
                result = beat_service.detect_beats(
                    file_path=file_path,
                    detector=params['detector'],
                    force=params['force']
                )

            # Return result
            if result.get('success'):
                return jsonify(result)
            else:
                return jsonify(result), 500

        except Exception as e:
            log_error(f"Error in beat detection: {e}")
            log_error(traceback.format_exc())
            return jsonify({
                "success": False,
                "error": f"Beat detection failed: {str(e)}"
            }), 500

    except Exception as e:
        log_error(f"Unexpected error in detect_beats: {e}")
        log_error(traceback.format_exc())
        return jsonify({
            "success": False,
            "error": "Internal server error"
        }), 500


@beats_bp.route('/api/detect-beats-firebase', methods=['POST'])
@limiter.limit(config.get_rate_limit('heavy_processing'))
def detect_beats_firebase():
    """
    Detect beats in an audio file from Firebase Storage URL

    Parameters:
    - firebase_url: Firebase Storage URL of the audio file
    - detector: 'beat-transformer', 'madmom', 'librosa', or 'auto' (default)

    Returns:
    - JSON with beat and downbeat information
    """
    try:
        # Validate request
        is_valid, error_msg, params = validate_firebase_beat_detection_request()
        if not is_valid:
            return jsonify({"error": error_msg}), 400

        # Get beat detection service
        beat_service = current_app.extensions['services']['beat_detection']

        # Download file from Firebase
        try:
            # Create temporary file
            with temporary_file(suffix='.mp3') as temp_path:
                _download_remote_audio_to_temp_path(params['firebase_url'], temp_path)

                log_info(f"Downloaded Firebase file to: {temp_path}")
                log_info(f"File size: {os.path.getsize(temp_path) / (1024 * 1024):.1f}MB")

                # Run beat detection
                result = beat_service.detect_beats(
                    file_path=temp_path,
                    detector=params['detector'],
                    force=False  # Firebase files use auto size handling
                )

                # Return result
                if result.get('success'):
                    return jsonify(result)
                else:
                    return jsonify(result), 500

        except requests.RequestException as e:
            log_error(f"Failed to download Firebase file: {e}")
            return jsonify({
                "success": False,
                "error": f"Failed to download file from Firebase: {str(e)}"
            }), 400

    except Exception as e:
        log_error(f"Unexpected error in detect_beats_firebase: {e}")
        log_error(traceback.format_exc())
        return jsonify({
            "success": False,
            "error": "Internal server error"
        }), 500


@beats_bp.route('/api/model-info', methods=['GET'])
@limiter.limit(config.get_rate_limit('light_processing'))
def model_info():
    """Return information about the available beat detection models"""
    try:
        # Get beat detection service
        beat_service = current_app.extensions['services']['beat_detection']

        # Get detector information
        detector_info = beat_service.get_detector_info()

        # Format response to match existing API
        available_models = detector_info['available_detectors']

        # Set default model: prefer ALLIN1, then Librosa fallback
        if 'allin1' in available_models:
            default_model = 'allin1'
        elif 'librosa' in available_models:
            default_model = 'librosa'
        else:
            default_model = 'none'

        response = {
            "success": True,
            "default_beat_model": default_model,
            "available_beat_models": available_models,
            "allin1_available": 'allin1' in available_models,
            "librosa_available": 'librosa' in available_models,
            # Legacy fields for backwards compatibility
            "beat_transformer_available": False,
            "madmom_available": False,
            "file_size_limits": {
                "upload_limit_mb": 50,
                "local_file_limit_mb": 150,
                "allin1_limit_mb": 150,
                "force_parameter_available": True
            },
            "beat_model_info": {
                "allin1": {
                    "name": "ALLIN1",
                    "description": "Unified music structure analysis: beats, downbeats, BPM, time signature, and song sections in one pass",
                    "performance": "High accuracy, medium speed",
                    "uses_spleeter": False
                },
                "librosa": {
                    "name": "Librosa",
                    "description": "Classical signal processing approach",
                    "performance": "Fast processing, basic accuracy",
                    "uses_spleeter": False
                }
            },
            "detector_details": detector_info['detectors']
        }

        return jsonify(response)

    except Exception as e:
        log_error(f"Error getting model info: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@beats_bp.route('/api/test-allin1', methods=['GET'])
@limiter.limit(config.get_rate_limit('test'))
def test_allin1():
    """Test ALLIN1 beat detection model availability"""
    try:
        beat_service = current_app.extensions['services']['beat_detection']
        detector = beat_service.detectors['allin1']

        if detector.is_available():
            try:
                model_info = detector.get_model_info()
                return jsonify({
                    "success": True,
                    "model": "ALLIN1",
                    "status": "available",
                    "device": model_info.get("device", "unknown"),
                    "capabilities": model_info.get("capabilities", []),
                    "message": "ALLIN1 model is ready for use"
                })
            except Exception as e:
                return jsonify({
                    "success": True,
                    "model": "ALLIN1",
                    "status": "available",
                    "device_error": str(e),
                    "message": "ALLIN1 model is available but info query failed"
                })
        else:
            return jsonify({
                "success": False,
                "model": "ALLIN1",
                "status": "unavailable",
                "error": "ALLIN1 model not available"
            }), 404

    except Exception as e:
        return jsonify({
            "success": False,
            "model": "ALLIN1",
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@beats_bp.route('/api/test-librosa', methods=['GET'])
@limiter.limit(config.get_rate_limit('test'))
def test_librosa():
    """Test Librosa beat detection availability"""
    try:
        # Get beat detection service
        beat_service = current_app.extensions['services']['beat_detection']
        detector = beat_service.detectors['librosa']

        if detector.is_available():
            # Try to import librosa to get version
            try:
                import librosa
                version = getattr(librosa, '__version__', 'unknown')
            except ImportError:
                version = 'unknown'

            return jsonify({
                "success": True,
                "model": "Librosa",
                "status": "available",
                "version": version,
                "message": "Librosa beat detection is ready for use"
            })
        else:
            return jsonify({
                "success": False,
                "model": "Librosa",
                "status": "unavailable",
                "error": "Librosa not installed or not available"
            }), 404

    except Exception as e:
        return jsonify({
            "success": False,
            "model": "Librosa",
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@beats_bp.route('/api/test-all-models', methods=['GET'])
@limiter.limit(config.get_rate_limit('test'))
def test_all_models():
    """Test all available beat detection models"""
    try:
        # Get beat detection service
        beat_service = current_app.extensions['services']['beat_detection']

        results = {
            "success": True,
            "models_tested": {},
            "available_models": beat_service.get_available_detectors(),
            "summary": {
                "total_models": len(beat_service.detectors),
                "available_count": 0,
                "unavailable_count": 0
            }
        }

        # Test each detector
        for name, detector in beat_service.detectors.items():
            try:
                is_available = detector.is_available()

                model_result = {
                    "available": is_available,
                    "name": name,
                    "status": "available" if is_available else "unavailable"
                }

                if is_available:
                    results["summary"]["available_count"] += 1

                    # Add version / device info if possible
                    if name == 'allin1':
                        try:
                            model_info = detector.get_model_info()
                            model_result["device"] = model_info.get("device", "unknown")
                            model_result["capabilities"] = model_info.get("capabilities", [])
                        except Exception as e:
                            model_result["device_error"] = str(e)
                    elif name == 'librosa':
                        try:
                            import librosa
                            model_result["version"] = getattr(librosa, '__version__', 'unknown')
                        except ImportError:
                            pass
                else:
                    results["summary"]["unavailable_count"] += 1
                    model_result["error"] = f"{name} not available"

                results["models_tested"][name] = model_result

            except Exception as e:
                results["models_tested"][name] = {
                    "available": False,
                    "status": "error",
                    "error": str(e)
                }
                results["summary"]["unavailable_count"] += 1

        return jsonify(results)

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


# Duplicate test_dbn_isolation function removed


# Duplicate test_all_models function removed


@beats_bp.route('/api/test-allin1-sections', methods=['GET'])
@limiter.limit(config.get_rate_limit('test'))
def test_allin1_sections():
    """Test ALLIN1 section segmentation capability"""
    try:
        beat_service = current_app.extensions['services']['beat_detection']
        detector = beat_service.detectors['allin1']

        if not detector.is_available():
            return jsonify({
                "success": False,
                "error": "ALLIN1 not available for section testing"
            }), 404

        return jsonify({
            "success": True,
            "message": "ALLIN1 section segmentation is available",
            "capabilities": [
                "beat_detection",
                "downbeat_detection",
                "bpm_estimation",
                "time_signature_inference",
                "song_section_segmentation"
            ]
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500