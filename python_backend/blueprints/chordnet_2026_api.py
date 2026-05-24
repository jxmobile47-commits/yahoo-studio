#!/usr/bin/env python3
"""
ChordNet-2026 API Endpoints
============================
Production-ready endpoints for the 2026 SOTA chord recognition model.
"""

from flask import Blueprint, request, jsonify
import torch
import numpy as np
import librosa
from pathlib import Path
import logging
import sys
import os
import json

sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from models.chordnet_2026 import ChordNet2026
    _CHORDNET_MODEL_AVAILABLE = True
except ImportError:
    ChordNet2026 = None
    _CHORDNET_MODEL_AVAILABLE = False

logger = logging.getLogger(__name__)

chordnet_2026_bp = Blueprint('chordnet2026', __name__, url_prefix='/api/v2/chords')

# === ChordNet-2026 Engine ===
class ChordNet2026Engine:
    """Inference engine for ChordNet-2026"""

    def __init__(self, model_path='models/chordnet_2026.pt', device='cpu'):
        self.device = device
        self.model_path = model_path
        self.loaded = False

        # Build chord vocabulary
        notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
        self.chord_vocab = ['N']
        for note in notes:
            for quality in qualities:
                self.chord_vocab.append(f"{note}:{quality}")
        self.chord_vocab = self.chord_vocab[:170]

        # Key names
        self.key_names = [f"{n} maj" for n in notes] + [f"{n} min" for n in notes]

        self.model = self._load_model()

    def _load_model(self):
        """Load ChordNet-2026"""
        if not _CHORDNET_MODEL_AVAILABLE or ChordNet2026 is None:
            logger.warning("ChordNet2026 class not available — running in dummy mode")
            return None

        model = ChordNet2026(
            num_chords=170,
            freq_bins=84,
            mamba_dim=512,
            mamba_layers=6,
            mamba_state=32,
            use_crf=True,
            use_hierarchical=True,
            use_key_aux=True,
            use_beat_aux=True,
        )

        if Path(self.model_path).exists():
            try:
                checkpoint = torch.load(self.model_path, map_location=self.device, weights_only=True)
                model.load_state_dict(checkpoint['model_state_dict'])
                model.to(self.device)
                model.eval()
                self.loaded = True
                logger.info(f"Loaded ChordNet-2026 from {self.model_path}")
            except Exception as e:
                logger.error(f"Failed to load model: {e}")
                self.loaded = False
        else:
            logger.warning(f"Model not found at {self.model_path}")

        return model

    def extract_features(self, audio_path, sr=22050, hop_length=512, n_bins=84):
        """Extract CQT features"""
        y, sr = librosa.load(audio_path, sr=sr)
        cqt = librosa.cqt(y, sr=sr, hop_length=hop_length, n_bins=n_bins)
        cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)
        mean = np.mean(cqt_db)
        std = np.std(cqt_db)
        features = (cqt_db - mean) / (std + 1e-8)
        return features.astype(np.float32), sr, hop_length, y

    def predict(self, audio_path, include_beats=False):
        """Full prediction pipeline"""
        features, sr, hop_length, audio = self.extract_features(audio_path)

        if self.model is None:
            return {
                'segments': [],
                'key': None,
                'duration': len(audio) / sr,
                'num_frames': 0,
                'model_version': 'ChordNet-2026',
                'model_loaded': False,
                'error': 'Model not loaded',
            }

        # Add dims: (1, 1, 84, T)
        features_t = torch.from_numpy(features).unsqueeze(0).unsqueeze(0).to(self.device)

        with torch.no_grad():
            output = self.model(features_t)

        # Chord predictions
        chord_logits = output['chord_logits']
        probs = torch.softmax(chord_logits, dim=-1)
        confidence, chord_indices = torch.max(probs, dim=-1)

        chord_indices = chord_indices.cpu().numpy()[0]
        confidence = confidence.cpu().numpy()[0]
        times = np.arange(len(chord_indices)) * hop_length / sr

        # Merge to segments
        segments = self._merge_segments(chord_indices, confidence, times, hop_length, sr)

        # Key
        key = None
        if 'key_logits' in output:
            key_probs = torch.softmax(output['key_logits'], dim=-1)
            key_idx = key_probs.argmax(dim=-1).item()
            key = self.key_names[key_idx] if key_idx < 24 else None

        result = {
            'segments': segments,
            'key': key,
            'duration': len(audio) / sr,
            'num_frames': len(chord_indices),
            'model_version': 'ChordNet-2026',
            'architecture': 'BiMamba + Hierarchical + CRF',
            'model_loaded': self.loaded,
        }

        if include_beats and 'beat_logits' in output:
            beat_probs = torch.sigmoid(output['beat_logits']).cpu().numpy()[0, :, 0]
            beat_frames = np.where(beat_probs > 0.5)[0]
            result['beats'] = [float(times[i]) for i in beat_frames[:100]]

        return result

    def _merge_segments(self, chord_indices, confidence, times, hop_length, sr):
        """Merge consecutive identical chords"""
        chords = [self.chord_vocab[idx] for idx in chord_indices]
        segments = []

        if len(chords) == 0:
            return segments

        current = chords[0]
        start_t = float(times[0])
        start_i = 0

        for i in range(1, len(chords)):
            if chords[i] != current:
                segments.append({
                    'chord': current,
                    'start': round(start_t, 3),
                    'end': round(float(times[i]), 3),
                    'confidence': round(float(np.mean(confidence[start_i:i])), 4),
                })
                current = chords[i]
                start_t = float(times[i])
                start_i = i

        segments.append({
            'chord': current,
            'start': round(start_t, 3),
            'end': round(float(times[-1] + hop_length / sr), 3),
            'confidence': round(float(np.mean(confidence[start_i:])), 4),
        })

        # Filter out 'N' and very short segments
        segments = [s for s in segments if s['chord'] != 'N' and (s['end'] - s['start']) > 0.1]

        return segments


# === Global Engine ===
engine_2026 = None


def init_chordnet_2026(model_path=None, device=None):
    """Initialize ChordNet-2026 engine"""
    global engine_2026

    if model_path is None:
        model_path = os.getenv('CHORDNET2026_PATH', 'models/chordnet_2026.pt')
    if device is None:
        device = os.getenv('DEVICE', 'cpu')

    engine_2026 = ChordNet2026Engine(model_path, device)
    return engine_2026


# === API Endpoints ===

@chordnet_2026_bp.route('/recognize', methods=['POST'])
def recognize_2026():
    """
    Recognize chords with ChordNet-2026

    multipart/form-data:
      - audio_file: Audio file (.mp3, .wav)

    JSON response with chord segments
    """
    try:
        if engine_2026 is None:
            return jsonify({'error': 'Engine not initialized'}), 500

        if 'audio_file' not in request.files:
            return jsonify({'error': 'No audio_file provided'}), 400

        file = request.files['audio_file']
        if file.filename == '':
            return jsonify({'error': 'Empty file'}), 400

        # Save temp
        temp_path = f"/tmp/chordnet2026_{file.filename}"
        file.save(temp_path)

        # Predict
        include_beats = request.args.get('beats', 'false').lower() == 'true'
        result = engine_2026.predict(temp_path, include_beats=include_beats)

        # Cleanup
        try:
            os.remove(temp_path)
        except:
            pass

        return jsonify({
            'success': True,
            'model': 'ChordNet-2026',
            'result': result
        }), 200

    except Exception as e:
        logger.error(f"ChordNet-2026 error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@chordnet_2026_bp.route('/compare', methods=['POST'])
def compare_models():
    """
    Compare ChordNet-2026 vs legacy model on same audio

    Returns both predictions for A/B comparison
    """
    try:
        if 'audio_file' not in request.files:
            return jsonify({'error': 'No audio_file'}), 400

        file = request.files['audio_file']
        temp_path = f"/tmp/chordnet_compare_{file.filename}"
        file.save(temp_path)

        # ChordNet-2026 prediction
        result_2026 = engine_2026.predict(temp_path) if engine_2026 else None

        # Legacy prediction (if available)
        result_legacy = None
        try:
            from services.audio.chord_recognition_service import ChordRecognitionService
            legacy = ChordRecognitionService()
            result_legacy = legacy.recognize(temp_path)
        except:
            pass

        try:
            os.remove(temp_path)
        except:
            pass

        return jsonify({
            'success': True,
            'chordnet_2026': result_2026,
            'legacy': result_legacy,
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@chordnet_2026_bp.route('/health', methods=['GET'])
def health_2026():
    """Health check for ChordNet-2026"""
    model_info = {}
    if engine_2026 and engine_2026.loaded:
        info = engine_2026.model.get_model_info()
        model_info = {
            'loaded': True,
            'name': info['name'],
            'parameters': info['total_parameters'],
            'complexity': info['complexity'],
            'features': info['features'],
        }
    else:
        model_info = {'loaded': False}

    return jsonify({
        'status': 'healthy',
        'model': model_info,
        'endpoints': [
            '/api/v2/chords/recognize',
            '/api/v2/chords/compare',
            '/api/v2/chords/health',
        ]
    }), 200


@chordnet_2026_bp.route('/info', methods=['GET'])
def info_2026():
    """Model architecture info"""
    if engine_2026 and engine_2026.loaded:
        info = engine_2026.model.get_model_info()
        return jsonify({
            'success': True,
            'model': info
        }), 200
    return jsonify({'error': 'Model not loaded'}), 503
