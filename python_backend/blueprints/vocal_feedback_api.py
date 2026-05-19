#!/usr/bin/env python3
"""
Vocal Feedback API
=================
Endpoints for user feedback, preferences, and auto-retrain status.

POST /api/vocal/feedback/correction    - Log user pitch correction
POST /api/vocal/feedback/rating        - Rate auto-correction quality
GET  /api/vocal/preferences            - Get user preferences
POST /api/vocal/preferences            - Update user preferences
GET  /api/vocal/stats                  - Get feedback stats
GET  /api/vocal/retrain-status         - Check auto-retrain status
POST /api/vocal/trigger-retrain      - Manually trigger retrain
GET  /api/vocal/dashboard              - Full dashboard data
"""

from flask import Blueprint, request, jsonify
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.audio.vocal_feedback_system import VocalFeedbackDatabase
from services.audio.vocal_auto_retrain import VocalAutoRetrainer

logger = logging.getLogger(__name__)

vocal_feedback_bp = Blueprint('vocal_feedback', __name__, url_prefix='/api/vocal')

# Global instances
_feedback_db = None
_retrainer = None

def get_db():
    global _feedback_db
    if _feedback_db is None:
        _feedback_db = VocalFeedbackDatabase()
    return _feedback_db

def get_retrainer():
    global _retrainer
    if _retrainer is None:
        _retrainer = VocalAutoRetrainer(get_db())
    return _retrainer


def _get_user_id():
    """Get user ID from request (auth token or session)"""
    # In production, extract from JWT or session
    return request.headers.get('X-User-Id', 'anonymous')


@vocal_feedback_bp.route('/feedback/correction', methods=['POST'])
def log_correction():
    """
    Log user manual correction to auto-tuned note.

    JSON body:
      {
        "session_id": "sess_123",
        "original_midi": 60.3,
        "corrected_midi": 60.0,
        "user_target_midi": 61.0,
        "scale": "C major",
        "note_name": "C#4",
        "confidence": 0.8,
        "audio_hash": "abc123"
      }
    """
    try:
        data = request.get_json() or {}
        user_id = _get_user_id()

        correction_id = get_db().log_pitch_correction(
            user_id=user_id,
            session_id=data.get('session_id', 'default'),
            original_midi=data.get('original_midi', 0),
            corrected_midi=data.get('corrected_midi', 0),
            user_target_midi=data.get('user_target_midi', 0),
            scale=data.get('scale', 'C major'),
            note_name=data.get('note_name', ''),
            confidence=data.get('confidence', 0),
            audio_hash=data.get('audio_hash'),
        )

        return jsonify({
            'success': True,
            'correction_id': correction_id,
            'message': 'Correction logged for learning',
        }), 200

    except Exception as e:
        logger.error(f"Correction logging error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@vocal_feedback_bp.route('/feedback/rating', methods=['POST'])
def rate_correction():
    """
    Rate the quality of auto-correction.

    JSON body:
      {
        "session_id": "sess_123",
        "rating": 2,  // -1=too aggressive, 0=ok, 1=too subtle, 2=perfect
        "original_midi": 60.3,
        "corrected_midi": 60.0,
        "target_scale": "C major",
        "comment": "Too much correction"
      }
    """
    try:
        data = request.get_json() or {}
        user_id = _get_user_id()

        rating_id = get_db().rate_correction(
            user_id=user_id,
            session_id=data.get('session_id', 'default'),
            rating=data.get('rating', 0),
            original_midi=data.get('original_midi'),
            corrected_midi=data.get('corrected_midi'),
            target_scale=data.get('target_scale', ''),
            comment=data.get('comment', ''),
        )

        # Get updated preferences (auto-adjusted)
        prefs = get_db().get_user_preferences(user_id)

        return jsonify({
            'success': True,
            'rating_id': rating_id,
            'auto_adjusted_strength': prefs.correction_strength,
            'message': 'Rating logged. Correction strength auto-adjusted.',
        }), 200

    except Exception as e:
        logger.error(f"Rating error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@vocal_feedback_bp.route('/preferences', methods=['GET'])
def get_preferences():
    """Get user preferences"""
    try:
        user_id = _get_user_id()
        prefs = get_db().get_user_preferences(user_id)

        return jsonify({
            'success': True,
            'preferences': {
                'correction_strength': prefs.correction_strength,
                'preferred_scale': prefs.preferred_scale,
                'vocal_character': prefs.vocal_character,
                'vibrato_amount': prefs.vibrato_amount,
                'formant_shift': prefs.formant_shift,
                'auto_harmony': prefs.auto_harmony,
                'harmony_type': prefs.harmony_type,
            },
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@vocal_feedback_bp.route('/preferences', methods=['POST'])
def update_preferences():
    """Update user preferences"""
    try:
        data = request.get_json() or {}
        user_id = _get_user_id()

        prefs = get_db().update_preferences(user_id, **data)

        return jsonify({
            'success': True,
            'preferences': {
                'correction_strength': prefs.correction_strength,
                'preferred_scale': prefs.preferred_scale,
                'vocal_character': prefs.vocal_character,
                'vibrato_amount': prefs.vibrato_amount,
                'formant_shift': prefs.formant_shift,
                'auto_harmony': prefs.auto_harmony,
                'harmony_type': prefs.harmony_type,
            },
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@vocal_feedback_bp.route('/stats', methods=['GET'])
def get_stats():
    """Get feedback statistics"""
    try:
        user_id = _get_user_id()

        return jsonify({
            'success': True,
            'corrections': get_db().get_correction_stats(user_id),
            'ratings': get_db().get_rating_stats(user_id),
            'popular_scales': get_db().get_popular_scales(),
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@vocal_feedback_bp.route('/retrain-status', methods=['GET'])
def retrain_status():
    """Check if auto-retrain should trigger"""
    try:
        should, stats = get_db().should_retrain()

        return jsonify({
            'success': True,
            'should_retrain': should,
            'stats': stats,
            'current_version': get_retrainer().current_version,
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@vocal_feedback_bp.route('/trigger-retrain', methods=['POST'])
def trigger_retrain():
    """Manually trigger retraining"""
    try:
        result = get_retrainer().check_and_retrain(force=True)

        return jsonify({
            'success': result.get('success', False),
            'report': result,
        }), 200

    except Exception as e:
        logger.error(f"Retrain error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@vocal_feedback_bp.route('/dashboard', methods=['GET'])
def dashboard():
    """Full feedback dashboard"""
    try:
        summary = get_db().get_all_feedback_summary()
        history = get_retrainer().get_model_history()

        return jsonify({
            'success': True,
            'summary': summary,
            'model_history': history,
            'current_version': get_retrainer().current_version,
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@vocal_feedback_bp.route('/health', methods=['GET'])
def health():
    """Health check"""
    return jsonify({
        'status': 'healthy',
        'feedback_system': 'VocalFeedbackDatabase',
        'auto_retrain': 'VocalAutoRetrainer',
        'features': [
            'pitch_correction_logging',
            'correction_rating',
            'user_preference_learning',
            'active_learning_queue',
            'auto_retrain_pipeline',
            'ab_testing',
            'scale_analytics',
        ],
    }), 200
