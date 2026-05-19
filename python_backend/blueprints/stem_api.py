"""
Stem Separation API Blueprint
==============================
Provides AI-powered audio source separation using Spleeter.
Supports 2-stem (vocals/accompaniment) and 4-stem separation.
"""

import os
import io
import base64
import tempfile
import time
from pathlib import Path
from typing import Dict, Any

from flask import Blueprint, request, jsonify, send_file
from werkzeug.utils import secure_filename

from utils.logging import log_info, log_error
from services.audio.spleeter_service import SpleeterService

stem_bp = Blueprint('stem', __name__, url_prefix='/api/stem')

# Allowed audio file extensions
ALLOWED_EXTENSIONS = {'.wav', '.mp3', '.flac', '.ogg', '.m4a'}

# Spleeter service instance
_spleeter_service = None

def get_spleeter_service():
    global _spleeter_service
    if _spleeter_service is None:
        _spleeter_service = SpleeterService()
    return _spleeter_service


def _allowed_file(filename: str) -> bool:
    return '.' in filename and Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


@stem_bp.route('/status', methods=['GET'])
def stem_status():
    """Check if Spleeter is available."""
    service = get_spleeter_service()
    available = service.is_available()
    return jsonify({
        "success": True,
        "available": available,
        "models": ["2stems", "4stems", "5stems"] if available else [],
        "message": "Spleeter ready" if available else "Spleeter not installed. Install with: pip install spleeter"
    })


@stem_bp.route('/separate', methods=['POST'])
def separate_stems():
    """
    Separate uploaded audio into stems.
    
    Request:
        - audio_file: Audio file (multipart/form-data)
        - model: '2stems' | '4stems' | '5stems' (default: '2stems')
    
    Response:
        {
            "success": bool,
            "stems": {
                "vocals": { "url": str, "format": "wav" },
                "accompaniment": { "url": str, "format": "wav" },
                ...
            },
            "processing_time": float,
            "model_used": str
        }
    """
    service = get_spleeter_service()
    
    if not service.is_available():
        return jsonify({
            "success": False,
            "error": "Spleeter is not available on this server"
        }), 503
    
    # Validate request
    if 'audio_file' not in request.files:
        return jsonify({
            "success": False,
            "error": "No audio file provided"
        }), 400
    
    file = request.files['audio_file']
    if not file or not file.filename:
        return jsonify({
            "success": False,
            "error": "Empty file"
        }), 400
    
    if not _allowed_file(file.filename):
        return jsonify({
            "success": False,
            "error": f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        }), 400
    
    # Get model selection
    model = request.form.get('model', '2stems')
    valid_models = {'2stems', '4stems', '5stems'}
    if model not in valid_models:
        model = '2stems'
    
    # Save uploaded file to temp
    temp_dir = tempfile.mkdtemp(prefix='stem_upload_')
    try:
        filename = secure_filename(file.filename)
        input_path = os.path.join(temp_dir, filename)
        file.save(input_path)
        log_info(f"Stem separation request: {filename} with model {model}")
        
        # Run separation
        model_name = f'{model}-16kHz'
        result = service.separate_audio(input_path, model_name=model_name)
        
        if not result.get('success'):
            return jsonify({
                "success": False,
                "error": result.get('error', 'Separation failed')
            }), 500
        
        # Build response with download URLs
        stems = {}
        for stem_name, stem_path in result.get('stems', {}).items():
            if os.path.exists(stem_path):
                # Store stem path for download endpoint
                stems[stem_name] = {
                    "download_url": f"/api/stem/download?path={os.path.abspath(stem_path)}&name={stem_name}",
                    "format": "wav",
                    "filename": os.path.basename(stem_path)
                }
        
        return jsonify({
            "success": True,
            "stems": stems,
            "processing_time": result.get('processing_time', 0),
            "model_used": result.get('model_used', model_name),
            "message": f"Successfully separated into {len(stems)} stems"
        })
        
    except Exception as e:
        log_error(f"Stem separation failed: {e}")
        return jsonify({
            "success": False,
            "error": f"Separation failed: {str(e)}"
        }), 500
    finally:
        # Cleanup temp files (keep output stems for download)
        try:
            if os.path.exists(input_path):
                os.remove(input_path)
        except:
            pass


@stem_bp.route('/download', methods=['GET'])
def download_stem():
    """
    Download a separated stem file.
    
    Query params:
        - path: Absolute path to the stem file
        - name: Stem name for the download filename
    """
    file_path = request.args.get('path', '')
    stem_name = request.args.get('name', 'stem')
    
    if not file_path or not os.path.exists(file_path):
        return jsonify({
            "success": False,
            "error": "File not found"
        }), 404
    
    # Security: ensure file is within temp directories
    abs_path = os.path.abspath(file_path)
    temp_prefix = os.path.abspath(tempfile.gettempdir())
    if not abs_path.startswith(temp_prefix):
        return jsonify({
            "success": False,
            "error": "Access denied"
        }), 403
    
    try:
        return send_file(
            abs_path,
            mimetype='audio/wav',
            as_attachment=True,
            download_name=f"{stem_name}.wav"
        )
    except Exception as e:
        log_error(f"Stem download failed: {e}")
        return jsonify({
            "success": False,
            "error": "Download failed"
        }), 500
