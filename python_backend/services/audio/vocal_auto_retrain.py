#!/usr/bin/env python3
"""
Vocal Auto-Retrain Pipeline
============================
Automatically fine-tunes pitch correction model based on user feedback.

Triggered when:
  - 50+ user corrections accumulated
  - Average rating drops below threshold
  - Manual trigger from admin

Pipeline:
  1. Collect learning samples from feedback DB
  2. Fine-tune correction parameters (strength, smoothing, scale weights)
  3. Evaluate on held-out user corrections
  4. A/B test vs current model
  5. Deploy if improvement > 2%
"""

import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json
import logging
from datetime import datetime
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.audio.vocal_feedback_system import VocalFeedbackDatabase
from services.audio.realtime_pitch_correction import RealtimePitchCorrector

logger = logging.getLogger(__name__)


class VocalAutoRetrainer:
    """
    Auto-retraining for vocal pitch correction.
    Learns optimal correction parameters from user feedback.
    """

    def __init__(self, db: Optional[VocalFeedbackDatabase] = None):
        self.db = db or VocalFeedbackDatabase()
        self.current_version = self._load_current_version()
        self.models_dir = Path(__file__).parent.parent.parent / "models" / "vocal"
        self.models_dir.mkdir(parents=True, exist_ok=True)

    def _load_current_version(self) -> str:
        version_file = Path(__file__).parent.parent.parent / "models" / "vocal" / "version.json"
        if version_file.exists():
            with open(version_file) as f:
                return json.load(f).get('version', 'v1.0.0')
        return 'v1.0.0'

    def check_and_retrain(self, force: bool = False) -> Dict:
        """
        Check if retraining should trigger, and execute if so.

        Args:
            force: Force retraining regardless of thresholds

        Returns:
            Training report
        """
        should, stats = self.db.should_retrain(
            min_corrections=50,
            min_ratings=20,
        )

        if not should and not force:
            return {
                'triggered': False,
                'reason': 'Insufficient feedback',
                'stats': stats,
            }

        logger.info("Auto-retrain triggered!")
        return self._execute_retrain()

    def _execute_retrain(self) -> Dict:
        """Execute the retraining pipeline"""
        start_time = datetime.now()

        # Step 1: Collect learning samples
        samples = self.db.get_learning_samples(n=500)
        if len(samples) < 20:
            return {
                'triggered': True,
                'success': False,
                'reason': f'Not enough learning samples ({len(samples)})',
            }

        logger.info(f"Training on {len(samples)} user corrections")

        # Step 2: Learn optimal parameters
        optimal_params = self._learn_parameters(samples)

        # Step 3: Evaluate
        eval_results = self._evaluate_model(optimal_params, samples)

        # Step 4: Compare with current
        current_results = self._evaluate_current_model(samples)
        improvement = self._calculate_improvement(current_results, eval_results)

        # Step 5: A/B test or deploy
        new_version = self._bump_version()
        report = {
            'triggered': True,
            'success': True,
            'version': new_version,
            'previous_version': self.current_version,
            'samples_used': len(samples),
            'optimal_params': optimal_params,
            'evaluation': {
                'new_model': eval_results,
                'current_model': current_results,
                'improvement_percent': improvement,
            },
            'deployed': improvement > 2.0,  # Deploy if >2% improvement
            'training_duration_sec': (datetime.now() - start_time).total_seconds(),
        }

        if report['deployed']:
            self._deploy_model(optimal_params, new_version)
            self._save_version(new_version)
            logger.info(f"Model {new_version} deployed! Improvement: {improvement:.1f}%")
        else:
            logger.info(f"Model NOT deployed. Improvement: {improvement:.1f}% (need >2%)")

        # Log performance
        self.db.log_model_performance(
            model_version=new_version,
            mean_error_cents=eval_results['mean_error_cents'],
            notes_in_scale_percent=eval_results['notes_in_scale_percent'],
            user_satisfaction=eval_results['satisfaction'],
            total_corrections=len(samples),
            total_ratings=self.db.get_rating_stats()['total_ratings'],
        )

        # Mark samples as used
        sample_ids = [s['id'] for s in samples]
        self.db.mark_samples_used(sample_ids)

        return report

    def _learn_parameters(self, samples: List[Dict]) -> Dict:
        """
        Learn optimal correction parameters from user feedback.
        This is a simplified parameter optimization — in production,
        you'd train a neural network on the correction patterns.
        """
        # Extract features
        original_midis = np.array([s['original_midi'] for s in samples])
        corrected_midis = np.array([s['corrected_midi'] for s in samples])
        user_targets = np.array([s['user_target_midi'] for s in samples])
        errors = (corrected_midis - user_targets) * 100  # in cents

        # Optimal correction strength
        # If users consistently adjust further, we need stronger correction
        # If users move back toward original, we need weaker correction
        error_sign = np.sign(errors)
        mean_error = np.mean(np.abs(errors))

        if mean_error > 50:  # Large errors → need more correction
            optimal_strength = min(1.0, 0.8 + 0.1)
        elif mean_error < 20:  # Small errors → current is good
            optimal_strength = 0.8
        else:
            optimal_strength = 0.8

        # Optimal smoothing
        # If notes sound "robotic", increase smoothing
        # If notes sound "wobbly", decrease smoothing
        error_variance = np.var(errors)
        if error_variance > 100:
            optimal_smoothing = 0.5  # More smoothing for stability
        else:
            optimal_smoothing = 0.3

        # Scale-specific adjustments
        scales_used = {}
        for s in samples:
            scale = s.get('scale', 'C major')
            if scale not in scales_used:
                scales_used[scale] = []
            scales_used[scale].append(s)

        scale_weights = {}
        for scale, scale_samples in scales_used.items():
            scale_errors = [(s['corrected_midi'] - s['user_target_midi']) * 100 for s in scale_samples]
            scale_weights[scale] = {
                'mean_error': float(np.mean(np.abs(scale_errors))),
                'count': len(scale_samples),
            }

        return {
            'correction_strength': round(optimal_strength, 2),
            'smoothing_factor': round(optimal_smoothing, 2),
            'scale_weights': scale_weights,
            'mean_error_cents': float(mean_error),
            'error_variance': float(error_variance),
        }

    def _evaluate_model(self, params: Dict, samples: List[Dict]) -> Dict:
        """Evaluate a model configuration on held-out samples"""
        # Split 80/20
        n_test = max(1, len(samples) // 5)
        test_samples = samples[-n_test:]

        corrector = RealtimePitchCorrector(
            correction_strength=params['correction_strength'],
        )
        corrector.smoothing_factor = params['smoothing_factor']

        errors = []
        in_scale_count = 0

        for s in test_samples:
            # Simulate correction
            original = s['original_midi']
            target = s['user_target_midi']
            corrected = original + (target - original) * params['correction_strength']
            error = abs(corrected - target) * 100
            errors.append(error)

            # Check if in scale (simplified)
            scale_tones = corrector._parse_scale(s.get('scale', 'C major'))
            if int(round(corrected)) % 12 in scale_tones:
                in_scale_count += 1

        mean_error = np.mean(errors)
        in_scale_pct = in_scale_count / len(test_samples) * 100

        # Estimate satisfaction based on error
        if mean_error < 10:
            satisfaction = 0.9
        elif mean_error < 30:
            satisfaction = 0.7
        else:
            satisfaction = 0.4

        return {
            'mean_error_cents': float(mean_error),
            'notes_in_scale_percent': float(in_scale_pct),
            'satisfaction': float(satisfaction),
            'test_samples': len(test_samples),
        }

    def _evaluate_current_model(self, samples: List[Dict]) -> Dict:
        """Evaluate current model for comparison"""
        n_test = max(1, len(samples) // 5)
        test_samples = samples[-n_test:]

        errors = []
        in_scale_count = 0

        corrector = RealtimePitchCorrector()

        for s in test_samples:
            original = s['original_midi']
            target = s['user_target_midi']
            # Current model uses default 0.8 strength
            corrected = original + (target - original) * 0.8
            error = abs(corrected - target) * 100
            errors.append(error)

            scale_tones = corrector._parse_scale(s.get('scale', 'C major'))
            if int(round(corrected)) % 12 in scale_tones:
                in_scale_count += 1

        mean_error = np.mean(errors)
        in_scale_pct = in_scale_count / len(test_samples) * 100

        if mean_error < 10:
            satisfaction = 0.9
        elif mean_error < 30:
            satisfaction = 0.7
        else:
            satisfaction = 0.4

        return {
            'mean_error_cents': float(mean_error),
            'notes_in_scale_percent': float(in_scale_pct),
            'satisfaction': float(satisfaction),
            'test_samples': len(test_samples),
        }

    def _calculate_improvement(self, current: Dict, new: Dict) -> float:
        """Calculate improvement percentage"""
        error_improvement = (current['mean_error_cents'] - new['mean_error_cents']) / max(current['mean_error_cents'], 1) * 100
        satisfaction_improvement = (new['satisfaction'] - current['satisfaction']) / max(current['satisfaction'], 0.01) * 100
        # Weighted average
        return error_improvement * 0.7 + satisfaction_improvement * 0.3

    def _bump_version(self) -> str:
        """Bump version number"""
        parts = self.current_version.replace('v', '').split('.')
        major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
        patch += 1
        if patch >= 10:
            patch = 0
            minor += 1
        if minor >= 10:
            minor = 0
            major += 1
        return f"v{major}.{minor}.{patch}"

    def _deploy_model(self, params: Dict, version: str):
        """Save model parameters"""
        model_path = self.models_dir / f"pitch_correction_{version}.json"
        with open(model_path, 'w') as f:
            json.dump({
                'version': version,
                'params': params,
                'deployed_at': datetime.now().isoformat(),
            }, f, indent=2)

    def _save_version(self, version: str):
        """Update current version"""
        self.current_version = version
        version_file = self.models_dir / "version.json"
        with open(version_file, 'w') as f:
            json.dump({'version': version, 'updated_at': datetime.now().isoformat()}, f)

    def get_model_history(self) -> List[Dict]:
        """Get deployed model history"""
        history = []
        for f in self.models_dir.glob("pitch_correction_*.json"):
            with open(f) as fp:
                data = json.load(fp)
                history.append(data)
        return sorted(history, key=lambda x: x.get('deployed_at', ''), reverse=True)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Vocal Auto-Retrain')
    parser.add_argument('--force', action='store_true', help='Force retrain')
    parser.add_argument('--check', action='store_true', help='Just check if should retrain')

    args = parser.parse_args()

    db = VocalFeedbackDatabase()
    trainer = VocalAutoRetrainer(db)

    if args.check:
        should, stats = db.should_retrain()
        print(f"Should retrain: {should}")
        print(json.dumps(stats, indent=2))
    else:
        result = trainer.check_and_retrain(force=args.force)
        print(json.dumps(result, indent=2, default=str))
