#!/usr/bin/env python3
"""
API endpoint for proprietary chord recognition
"""

from flask import Blueprint, request, jsonify
import torch
import numpy as np
import librosa
from pathlib import Path
import logging
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from models.proprietary_chord_model import ProprietaryChordNet

logger = logging.getLogger(__name__)

proprietary_bp = Blueprint('proprietary', __name__, url_prefix='/api/proprietary')


class ChordInferenceEngine:
    """Inference engine for chord recognition"""

    CHORD_VOCAB = None

    def __init__(self, model_path='models/proprietary_model.pt', device='cpu'):
        self.device = device
        self.model_path = model_path

        # Load model
        self.model = ProprietaryChordNet(num_chords=170)
        if Path(model_path).exists():
            self.model.load_state_dict(torch.load(model_path, map_location=device, weights_only=True))
            self.model.to(device)
            self.model.eval()
            logger.info(f"Loaded proprietary model from {model_path}")
        else:
            logger.warning(f"Model not found at {model_path}, using uninitialized model")

        # Load chord vocabulary
        if ChordInferenceEngine.CHORD_VOCAB is None:
            ChordInferenceEngine.CHORD_VOCAB = self._load_chord_vocab()
        self.chord_vocab = ChordInferenceEngine.CHORD_VOCAB

    def _load_chord_vocab(self):
        """Load chord vocabulary"""
        notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']

        chords = ['N']
        for note in notes:
            for quality in qualities:
                chords.append(f"{note}:{quality}")

        return chords[:170]

    def extract_features(self, audio_path, sr=22050, hop_length=512):
        """Extract CQT features from audio"""
        y, sr = librosa.load(audio_path, sr=sr)
        cqt = librosa.cqt(y, sr=sr, hop_length=hop_length, n_bins=84)
        cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)

        # Normalize per sample
        mean = np.mean(cqt_db)
        std = np.std(cqt_db)
        cqt_normalized = (cqt_db - mean) / (std + 1e-8)

        return cqt_normalized.astype(np.float32)

    def predict(self, audio_path, segment_duration=5.0):
        """
        Predict chords from audio file

        Args:
            audio_path: Path to audio file
            segment_duration: Process audio in segments (seconds)

        Returns:
            dict: Chord recognition results
        """
        # Extract features
        features = self.extract_features(audio_path)  # (84, T)

        # Add batch and channel dimensions: (1, 1, 84, T)
        features_tensor = torch.from_numpy(features).unsqueeze(0).unsqueeze(0).to(self.device)

        # Inference
        with torch.no_grad():
            logits = self.model(features_tensor)  # (1, T, 170)
            probs = torch.softmax(logits, dim=-1)
            confidence, chord_indices = torch.max(probs, dim=-1)

        chord_indices = chord_indices.cpu().numpy()[0]
        confidence = confidence.cpu().numpy()[0]

        # Convert indices to chord names
        chords = [self.chord_vocab[idx] for idx in chord_indices]

        # Compute times
        hop_length = 512
        sr = 22050
        times = np.arange(len(chords)) * hop_length / sr

        # Merge consecutive identical chords
        segments = []
        if len(chords) > 0:
            current_chord = chords[0]
            start_time = float(times[0])
            start_idx = 0

            for i in range(1, len(chords)):
                if chords[i] != current_chord:
                    segments.append({
                        'chord': current_chord,
                        'start': round(start_time, 3),
                        'end': round(float(times[i]), 3),
                        'confidence': round(float(np.mean(confidence[start_idx:i])), 4)
                    })
                    current_chord = chords[i]
                    start_time = float(times[i])
                    start_idx = i

            # Add last segment
            segments.append({
                'chord': current_chord,
                'start': round(start_time, 3),
                'end': round(float(times[-1] + hop_length / sr), 3),
                'confidence': round(float(np.mean(confidence[start_idx:])), 4)
            })

        return {
            'segments': segments,
            'chords': chords,
            'confidence': confidence.tolist(),
            'duration': len(chords) * hop_length / sr,
            'model_type': 'proprietary',
            'hop_length': hop_length,
            'sample_rate': sr
        }

    def predict_from_array(self, audio_array, sr=22050):
        """Predict chords from audio array (for real-time processing)"""
        # Compute CQT
        cqt = librosa.cqt(audio_array, sr=sr, hop_length=512, n_bins=84)
        cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)
        cqt_normalized = (cqt_db - np.mean(cqt_db)) / (np.std(cqt_db) + 1e-8)
        features = cqt_normalized.astype(np.float32)

        # Inference
        features_tensor = torch.from_numpy(features).unsqueeze(0).unsqueeze(0).to(self.device)

        with torch.no_grad():
            logits = self.model(features_tensor)
            probs = torch.softmax(logits, dim=-1)
            confidence, chord_indices = torch.max(probs, dim=-1)

        chord_indices = chord_indices.cpu().numpy()[0]
        confidence = confidence.cpu().numpy()[0]

        chords = [self.chord_vocab[idx] for idx in chord_indices]

        return chords, confidence.tolist()


# Global inference engine instance
inference_engine = None


def init_inference_engine(model_path=None, device=None):
    """Initialize inference engine (call at startup)"""
    global inference_engine

    if model_path is None:
        model_path = os.getenv('PROPRIETARY_MODEL_PATH', 'models/proprietary_model.pt')
    if device is None:
        device = os.getenv('DEVICE', 'cpu')

    inference_engine = ChordInferenceEngine(model_path, device)
    return inference_engine


@proprietary_bp.route('/recognize', methods=['POST'])
def recognize_chords():
    """
    Recognize chords from audio file upload

    Expected input:
    - multipart/form-data with 'audio_file' field
    """
    try:
        if inference_engine is None:
            return jsonify({'error': 'Model not initialized'}), 500

        # Handle file upload
        if 'audio_file' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400

        file = request.files['audio_file']
        if file.filename == '':
            return jsonify({'error': 'Empty file'}), 400

        # Save to temp
        temp_path = f"/tmp/{file.filename}"
        file.save(temp_path)

        # Recognize chords
        result = inference_engine.predict(temp_path)

        # Cleanup
        try:
            os.remove(temp_path)
        except OSError:
            pass

        return jsonify({
            'success': True,
            'result': result
        }), 200

    except Exception as e:
        logger.error(f"Error in chord recognition: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@proprietary_bp.route('/recognize-url', methods=['POST'])
def recognize_from_url():
    """
    Recognize chords from audio URL

    Expected JSON:
    {
        "audio_url": "http://..."
    }
    """
    try:
        if inference_engine is None:
            return jsonify({'error': 'Model not initialized'}), 500

        data = request.get_json()
        if not data or 'audio_url' not in data:
            return jsonify({'error': 'No audio_url provided'}), 400

        # Download audio
        import requests
        audio_url = data['audio_url']

        response = requests.get(audio_url, timeout=30)
        response.raise_for_status()

        temp_path = "/tmp/temp_audio.mp3"
        with open(temp_path, 'wb') as f:
            f.write(response.content)

        # Recognize
        result = inference_engine.predict(temp_path)

        # Cleanup
        try:
            os.remove(temp_path)
        except OSError:
            pass

        return jsonify({
            'success': True,
            'result': result
        }), 200

    except Exception as e:
        logger.error(f"Error in URL recognition: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@proprietary_bp.route('/health', methods=['GET'])
def health():
    """Health check for proprietary model"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': inference_engine is not None and Path(inference_engine.model_path).exists(),
        'model_path': inference_engine.model_path if inference_engine else None,
        'device': inference_engine.device if inference_engine else None
    }), 200


@proprietary_bp.route('/info', methods=['GET'])
def model_info():
    """Get model information"""
    if inference_engine is None:
        return jsonify({'error': 'Model not initialized'}), 500

    model = inference_engine.model
    param_count = sum(p.numel() for p in model.parameters())

    return jsonify({
        'model_type': 'ProprietaryChordNet',
        'num_chords': model.num_chords,
        'use_attention': model.use_attention,
        'lstm_hidden': model.lstm_hidden,
        'parameters': f"{param_count:,}",
        'chord_classes': inference_engine.chord_vocab[:10]  # Show first 10
    }), 200
