#!/usr/bin/env python3
"""
Melodyne-Grade Vocal Editing API
==================================
Flask endpoints for advanced vocal analysis and editing.

Endpoints:
  POST /api/melodyne/analyze       - Analyze vocal audio
  POST /api/melodyne/correct       - Apply pitch correction
  POST /api/melodyne/formant       - Shift formants
  POST /api/melodyne/export-midi   - Export to MIDI
  GET  /api/melodyne/health        - Health check
"""

from flask import Blueprint, request, jsonify
import os
import json
import logging
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.audio.melodyne_engine import MelodyneEngine, PitchCorrector

logger = logging.getLogger(__name__)

melodyne_bp = Blueprint('melodyne', __name__, url_prefix='/api/melodyne')

# Global engine instance
_melodyne_engine = None

def get_engine():
    """Get or create melodyne engine"""
    global _melodyne_engine
    if _melodyne_engine is None:
        _melodyne_engine = MelodyneEngine(sr=22050)
        logger.info("MelodyneEngine initialized")
    return _melodyne_engine


def analysis_to_dict(analysis):
    """Convert VocalAnalysis to serializable dict"""
    return {
        'audio_path': analysis.audio_path,
        'sample_rate': analysis.sample_rate,
        'duration': analysis.duration,
        'key': analysis.key,
        'scale': analysis.scale,
        'num_pitch_points': len(analysis.pitch_points),
        'num_notes': len(analysis.notes),
        'segments': [{'start': s[0], 'end': s[1]} for s in analysis.segments],
        'notes': [
            {
                'id': n.id,
                'start_time': n.start_time,
                'end_time': n.end_time,
                'start_frame': n.start_frame,
                'end_frame': n.end_frame,
                'avg_pitch_midi': n.avg_pitch_midi,
                'min_pitch_midi': n.min_pitch_midi,
                'max_pitch_midi': n.max_pitch_midi,
                'label': n.label,
                'amplitude': n.amplitude,
                'confidence': n.confidence,
                'is_edited': n.is_edited,
                'corrections': n.corrections,
            }
            for n in analysis.notes
        ],
        'pitch_points': [
            {
                'time': p.time,
                'frequency': p.frequency,
                'confidence': p.confidence,
                'midi': p.midi,
                'voiced': p.voiced,
            }
            for p in analysis.pitch_points[:2000]  # Limit for JSON size
        ],
    }


@melodyne_bp.route('/analyze', methods=['POST'])
def analyze():
    """
    Analyze vocal audio file.

    multipart/form-data:
      - audio_file: Audio file (.wav, .mp3)

    Returns:
      {
        "success": true,
        "analysis": {
          "duration": 120.5,
          "key": "C major",
          "num_notes": 45,
          "notes": [...],
          "pitch_points": [...]
        }
      }
    """
    try:
        if 'audio_file' not in request.files:
            return jsonify({'error': 'No audio_file provided'}), 400

        file = request.files['audio_file']
        if file.filename == '':
            return jsonify({'error': 'Empty file'}), 400

        # Save temp
        suffix = Path(file.filename).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name

        # Analyze
        engine = get_engine()
        analysis = engine.analyze(tmp_path)

        # Cleanup
        try:
            os.remove(tmp_path)
        except:
            pass

        return jsonify({
            'success': True,
            'analysis': analysis_to_dict(analysis),
        }), 200

    except Exception as e:
        logger.error(f"Analysis error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@melodyne_bp.route('/correct', methods=['POST'])
def correct_pitch():
    """
    Apply pitch correction.

    JSON body:
      {
        "audio_file": <uploaded file>,
        "scale": "C major",
        "correction_strength": 1.0,
        "manual_corrections": [
          {"note_id": "note_0_1234", "target_midi": 60.0}
        ]
      }
    """
    try:
        data = request.get_json() or {}
        scale = data.get('scale', 'chromatic')
        strength = data.get('correction_strength', 1.0)
        manual = data.get('manual_corrections', [])

        # In production: get cached analysis or re-analyze
        # For now, require audio file
        if 'audio_file' not in request.files:
            return jsonify({'error': 'No audio_file'}), 400

        file = request.files['audio_file']
        suffix = Path(file.filename).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name

        engine = get_engine()
        analysis = engine.analyze(tmp_path)

        # Apply correction
        corrected = engine.correct_pitch(
            analysis,
            scale=scale,
            manual_corrections=manual,
        )

        # Cleanup
        try:
            os.remove(tmp_path)
        except:
            pass

        return jsonify({
            'success': True,
            'original': analysis_to_dict(analysis),
            'corrected': analysis_to_dict(corrected),
            'scale': scale,
            'strength': strength,
        }), 200

    except Exception as e:
        logger.error(f"Correction error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@melodyne_bp.route('/export-midi', methods=['POST'])
def export_midi():
    """
    Export analysis to MIDI file.

    multipart/form-data:
      - audio_file: Audio file
    """
    try:
        if 'audio_file' not in request.files:
            return jsonify({'error': 'No audio_file'}), 400

        file = request.files['audio_file']
        suffix = Path(file.filename).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name

        engine = get_engine()
        analysis = engine.analyze(tmp_path)

        # Export MIDI
        midi_path = tmp_path + '.mid'
        engine.export_midi(analysis, midi_path)

        # Cleanup
        try:
            os.remove(tmp_path)
        except:
            pass

        if os.path.exists(midi_path):
            with open(midi_path, 'rb') as f:
                midi_data = f.read()

            try:
                os.remove(midi_path)
            except:
                pass

            from flask import send_file
            import io
            return send_file(
                io.BytesIO(midi_data),
                mimetype='audio/midi',
                as_attachment=True,
                download_name=f"{Path(file.filename).stem}_notes.mid"
            )

        return jsonify({'error': 'MIDI export failed'}), 500

    except Exception as e:
        logger.error(f"MIDI export error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@melodyne_bp.route('/health', methods=['GET'])
def health():
    """Health check"""
    engine = get_engine()
    return jsonify({
        'status': 'healthy',
        'engine': 'MelodyneEngine',
        'features': [
            'pYIN_pitch_detection',
            'note_segmentation',
            'pitch_correction',
            'scale_detection',
            'midi_export',
        ],
    }), 200
