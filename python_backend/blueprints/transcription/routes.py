"""
Piano transcription routes for Yahoo Studio.

Provides endpoints to convert piano audio (loops, samples, recordings)
into MIDI note events.
"""

import os
import tempfile
import traceback
from flask import Blueprint, request, jsonify, current_app
from config import get_config
from extensions import limiter
from utils.logging import log_info, log_error, log_debug

# Create blueprint
transcription_bp = Blueprint("transcription", __name__)
config = get_config()


@transcription_bp.route("/api/transcribe-piano", methods=["POST"])
@limiter.limit(config.get_rate_limit("heavy_processing"))
def transcribe_piano():
    """
    Transcribe piano audio to MIDI note events.

    Accepts:
    - file: Audio file upload (multipart/form-data)
    - audio_path: Existing file path on server
    - onset_threshold: float (0.0-1.0, default 0.3)
    - frame_threshold: float (0.0-1.0, default 0.2)
    - min_note_length_ms: int (default 40)
    - output_midi: bool (default False) — if True, returns download URL

    Returns JSON:
    {
        "success": bool,
        "notes": [{"start", "end", "pitch", "velocity", "confidence"}, ...],
        "note_count": int,
        "pitch_range": {"min": int, "max": int},
        "duration": float,
        "engine": str,
        "midi_url": str | null,
        "processing_time": float,
        "error": str | null,
    }
    """
    temp_file_path = None
    midi_temp_path = None

    try:
        # --- Get parameters ------------------------------------------------
        file = request.files.get("file")
        audio_path = request.form.get("audio_path") or request.json.get("audio_path") if request.is_json else None
        onset_threshold = float(request.form.get("onset_threshold", 0.3))
        frame_threshold = float(request.form.get("frame_threshold", 0.2))
        min_note_length_ms = float(request.form.get("min_note_length_ms", 40.0))
        output_midi = str(request.form.get("output_midi", "false")).lower() == "true"

        # --- Resolve input file --------------------------------------------
        if file:
            suffix = os.path.splitext(file.filename)[1] or ".mp3"
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            file.save(temp_file.name)
            temp_file_path = temp_file.name
            input_path = temp_file_path
        elif audio_path:
            if not os.path.exists(audio_path):
                return jsonify({"success": False, "error": f"Audio file not found: {audio_path}"}), 404
            input_path = audio_path
        else:
            return jsonify({"success": False, "error": "No audio file or audio_path provided"}), 400

        log_info(f"Piano transcription request: onset={onset_threshold}, frame={frame_threshold}")

        # --- Get service ---------------------------------------------------
        service = current_app.extensions["services"].get("piano_transcription")
        if service is None:
            return jsonify({"success": False, "error": "Piano transcription service unavailable"}), 503

        # --- Run transcription ---------------------------------------------
        midi_output = None
        if output_midi:
            midi_temp = tempfile.NamedTemporaryFile(delete=False, suffix=".mid")
            midi_output = midi_temp.name
            midi_temp_path = midi_temp.name

        result = service.transcribe(
            file_path=input_path,
            output_midi_path=midi_output,
            onset_threshold=onset_threshold,
            frame_threshold=frame_threshold,
            min_note_length_ms=min_note_length_ms,
        )

        # Build MIDI download URL if generated
        midi_url = None
        if output_midi and result.get("midi_path") and os.path.exists(result["midi_path"]):
            from flask import url_for
            midi_url = url_for(
                "transcription.download_midi",
                filename=os.path.basename(result["midi_path"]),
                _external=True,
            )

        response = {
            "success": result.get("success", False),
            "notes": result.get("notes", []),
            "note_count": result.get("note_count", 0),
            "pitch_range": result.get("pitch_range", {"min": 0, "max": 0}),
            "duration": result.get("duration", 0.0),
            "engine": result.get("engine", "unknown"),
            "midi_url": midi_url,
            "processing_time": result.get("processing_time", 0.0),
            "error": result.get("error"),
        }

        if result.get("success"):
            log_info(f"Piano transcription successful: {response['note_count']} notes via {response['engine']}")
        else:
            log_error(f"Piano transcription failed: {response.get('error')}")

        return jsonify(response)

    except Exception as e:
        log_error(f"Piano transcription route error: {e}")
        log_error(traceback.format_exc())
        return jsonify({
            "success": False,
            "error": str(e),
            "notes": [],
            "note_count": 0,
        }), 500

    finally:
        # Cleanup uploaded temp file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
                log_debug(f"Cleaned up uploaded temp file: {temp_file_path}")
            except Exception as e:
                log_error(f"Failed to clean up temp file: {e}")


@transcription_bp.route("/api/piano-model-info", methods=["GET"])
@limiter.limit(config.get_rate_limit("light_processing"))
def piano_model_info():
    """Return piano transcription model availability and metadata."""
    service = current_app.extensions["services"].get("piano_transcription")
    if service is None:
        return jsonify({
            "available": False,
            "engine": None,
            "message": "Piano transcription service not initialized",
        })

    info = service.get_model_info()
    return jsonify(info)


@transcription_bp.route("/api/download-midi/<filename>", methods=["GET"])
def download_midi(filename):
    """Serve generated MIDI file for download."""
    # Security: only allow .mid files
    if not filename.lower().endswith(".mid"):
        return jsonify({"error": "Invalid file type"}), 400

    # Look in temp directory (simplified; production should use secure storage)
    import tempfile
    temp_dir = tempfile.gettempdir()
    file_path = os.path.join(temp_dir, filename)

    if not os.path.exists(file_path):
        return jsonify({"error": "MIDI file not found or expired"}), 404

    from flask import send_file
    return send_file(
        file_path,
        mimetype="audio/midi",
        as_attachment=True,
        download_name=filename,
    )
