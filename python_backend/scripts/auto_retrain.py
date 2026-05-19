#!/usr/bin/env python3
"""
Auto-Retraining Pipeline
========================
Automatically retrains ChordNet-2026 when enough user corrections accumulate.

Trigger conditions:
  - >500 new verified corrections
  - >10% accuracy drop detected
  - Manual trigger via API

Pipeline:
  1. Check trigger conditions
  2. Collect new data (corrections + uncertain predictions)
  3. Merge with existing training data
  4. Fine-tune model (not from scratch)
  5. Evaluate vs previous version
  6. A/B test on production traffic
  7. Deploy if improvement > threshold
"""

import torch
import json
from pathlib import Path
from datetime import datetime, timedelta
import logging
import sys
import shutil
import subprocess

sys.path.insert(0, str(Path(__file__).parent.parent))

from models.chordnet_2026 import ChordNet2026
from scripts.data_collection.user_feedback_system import FeedbackDatabase

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AutoRetrainManager:
    """Manages automatic model retraining lifecycle"""

    def __init__(
        self,
        model_dir='models',
        data_dir='data/training',
        feedback_db='data/feedback.db',
        min_corrections=500,
        improvement_threshold=0.02,  # 2% accuracy improvement required
    ):
        self.model_dir = Path(model_dir)
        self.data_dir = Path(data_dir)
        self.feedback_db = FeedbackDatabase(feedback_db)
        self.min_corrections = min_corrections
        self.improvement_threshold = improvement_threshold

        self.current_model_path = self.model_dir / 'chordnet_2026.pt'
        self.previous_model_path = self.model_dir / 'chordnet_2026_previous.pt'
        self.training_log = self.model_dir / 'training_log.json'

    def check_trigger(self) -> Dict:
        """
        Check if retraining should be triggered.

        Returns:
            {'should_retrain': bool, 'reason': str, 'stats': dict}
        """
        stats = self.feedback_db.get_stats()
        corrections_since_last = stats.get('verified', 0) - self._get_last_training_stats().get('verified_count', 0)

        reasons = []

        # Trigger 1: Enough new corrections
        if corrections_since_last >= self.min_corrections:
            reasons.append(f"{corrections_since_last} new corrections (threshold: {self.min_corrections})")

        # Trigger 2: Accuracy drop
        current_acc = self._get_current_accuracy()
        baseline_acc = self._get_baseline_accuracy()
        if current_acc and baseline_acc and (baseline_acc - current_acc) > 0.05:
            reasons.append(f"Accuracy dropped {baseline_acc - current_acc:.1%}")

        # Trigger 3: Scheduled (weekly)
        last_train = self._get_last_training_time()
        if last_train and (datetime.now() - last_train) > timedelta(days=7):
            reasons.append("Weekly scheduled retraining")

        return {
            'should_retrain': len(reasons) > 0,
            'reason': '; '.join(reasons) if reasons else 'No trigger conditions met',
            'stats': {
                'corrections_since_last': corrections_since_last,
                'current_accuracy': current_acc,
                'baseline_accuracy': baseline_acc,
            }
        }

    def prepare_training_data(self) -> int:
        """
        Prepare training data incorporating user corrections.

        Returns number of new training samples created.
        """
        logger.info("Preparing training data with corrections...")

        # 1. Get high-priority corrections
        corrections = self.feedback_db.get_high_priority_corrections(min_agreements=2)
        logger.info(f"Found {len(corrections)} verified corrections")

        # 2. Get uncertain predictions (active learning)
        uncertain = self.feedback_db.get_uncertain_predictions(threshold=0.6, limit=200)
        logger.info(f"Found {len(uncertain)} uncertain predictions")

        # 3. Create/update training samples
        # For each correction, we need the audio file to create a labeled sample
        # This requires the original audio to be stored
        new_samples = 0

        for corr in corrections:
            # In production: load audio from storage, create labeled sample
            # For now, we just count them
            new_samples += 1

        logger.info(f"Prepared {new_samples} new training samples")
        return new_samples

    def fine_tune(self, epochs: int = 20, batch_size: int = 8) -> Dict:
        """
        Fine-tune existing model on new data.
        Uses lower learning rate for fine-tuning vs training from scratch.

        Returns:
            {'success': bool, 'val_accuracy': float, 'model_path': str}
        """
        logger.info(f"Starting fine-tuning for {epochs} epochs...")

        # Backup current model
        if self.current_model_path.exists():
            shutil.copy(self.current_model_path, self.previous_model_path)
            logger.info(f"Backed up previous model to {self.previous_model_path}")

        # Run training script
        train_script = Path(__file__).parent.parent / 'models' / 'chordnet_2026_train.py'

        try:
            result = subprocess.run([
                sys.executable, str(train_script),
                '--data-dir', str(self.data_dir / 'unified'),
                '--epochs', str(epochs),
                '--batch-size', str(batch_size),
                '--lr', '1e-4',  # Lower LR for fine-tuning
                '--device', 'cuda' if torch.cuda.is_available() else 'cpu',
                '--save-path', str(self.current_model_path),
            ], capture_output=True, text=True, timeout=7200)

            logger.info(result.stdout)
            if result.returncode != 0:
                logger.error(f"Training failed: {result.stderr}")
                return {'success': False, 'error': result.stderr}

            # Parse validation accuracy from output
            val_accuracy = self._parse_accuracy(result.stdout)

            return {
                'success': True,
                'val_accuracy': val_accuracy,
                'model_path': str(self.current_model_path),
            }

        except Exception as e:
            logger.error(f"Fine-tuning error: {e}")
            return {'success': False, 'error': str(e)}

    def evaluate_comparison(self) -> Dict:
        """
        Compare new model vs previous model.
        Returns detailed metrics.
        """
        logger.info("Evaluating model comparison...")

        # This would run the evaluation script on a held-out test set
        # For now, return placeholder
        return {
            'new_accuracy': 0.0,
            'previous_accuracy': 0.0,
            'improvement': 0.0,
            'per_chord_improvements': [],
        }

    def deploy_if_better(self, comparison: Dict) -> bool:
        """
        Deploy new model only if it improves accuracy.

        Returns:
            True if deployed, False if rolled back
        """
        improvement = comparison.get('improvement', 0)

        if improvement >= self.improvement_threshold:
            logger.info(f"Deploying new model (+{improvement:.1%} improvement)")
            self._update_training_log(success=True, accuracy=comparison['new_accuracy'])
            return True
        else:
            logger.warning(f"Rolling back (improvement: {improvement:.1%} < threshold: {self.improvement_threshold:.1%})")
            # Restore previous model
            if self.previous_model_path.exists():
                shutil.copy(self.previous_model_path, self.current_model_path)
                logger.info("Restored previous model")
            self._update_training_log(success=False, accuracy=comparison['previous_accuracy'])
            return False

    def run_pipeline(self) -> Dict:
        """
        Run complete auto-retrain pipeline.

        Returns:
            Pipeline result summary
        """
        start_time = datetime.now()

        # 1. Check trigger
        trigger = self.check_trigger()
        if not trigger['should_retrain']:
            return {
                'status': 'skipped',
                'reason': trigger['reason'],
                'stats': trigger['stats'],
            }

        logger.info(f"Retraining triggered: {trigger['reason']}")

        # 2. Prepare data
        new_samples = self.prepare_training_data()

        # 3. Fine-tune
        train_result = self.fine_tune(epochs=20)
        if not train_result['success']:
            return {
                'status': 'failed',
                'stage': 'training',
                'error': train_result.get('error'),
            }

        # 4. Evaluate
        comparison = self.evaluate_comparison()

        # 5. Deploy or rollback
        deployed = self.deploy_if_better(comparison)

        duration = (datetime.now() - start_time).total_seconds()

        return {
            'status': 'deployed' if deployed else 'rolled_back',
            'trigger': trigger['reason'],
            'new_samples': new_samples,
            'val_accuracy': train_result['val_accuracy'],
            'improvement': comparison.get('improvement', 0),
            'duration_seconds': duration,
        }

    # Helper methods
    def _get_last_training_stats(self) -> Dict:
        """Get stats from last training run"""
        if self.training_log.exists():
            with open(self.training_log) as f:
                log = json.load(f)
                return log.get('last_run', {})
        return {}

    def _get_last_training_time(self) -> Optional[datetime]:
        """Get timestamp of last training"""
        stats = self._get_last_training_stats()
        ts = stats.get('timestamp')
        if ts:
            return datetime.fromisoformat(ts)
        return None

    def _get_current_accuracy(self) -> Optional[float]:
        """Get current production model accuracy"""
        stats = self._get_last_training_stats()
        return stats.get('accuracy')

    def _get_baseline_accuracy(self) -> Optional[float]:
        """Get baseline accuracy"""
        # Could load from metrics DB
        return 0.80  # Placeholder

    def _parse_accuracy(self, stdout: str) -> float:
        """Parse validation accuracy from training output"""
        import re
        match = re.search(r'Val.*Acc(?:uracy)?[:\s]+([0-9.]+)', stdout)
        if match:
            return float(match.group(1))
        return 0.0

    def _update_training_log(self, success: bool, accuracy: float):
        """Update training log with latest run"""
        log = {'history': []}
        if self.training_log.exists():
            with open(self.training_log) as f:
                log = json.load(f)

        run_info = {
            'timestamp': datetime.now().isoformat(),
            'success': success,
            'accuracy': accuracy,
            'model_path': str(self.current_model_path),
        }

        log['last_run'] = run_info
        log['history'].append(run_info)

        with open(self.training_log, 'w') as f:
            json.dump(log, f, indent=2)


class ContinuousLearningDaemon:
    """
    Background daemon that periodically checks and triggers retraining.
    """

    def __init__(self, check_interval_hours=24):
        self.manager = AutoRetrainManager()
        self.check_interval = timedelta(hours=check_interval_hours)
        self.running = False

    def start(self):
        """Start the continuous learning loop"""
        logger.info("Starting continuous learning daemon...")
        self.running = True

        while self.running:
            try:
                result = self.manager.run_pipeline()
                logger.info(f"Retrain result: {result}")

                # Sleep until next check
                logger.info(f"Sleeping for {self.check_interval}")
                # In production, use proper scheduler (APScheduler/Celery)
                import time
                time.sleep(self.check_interval.total_seconds())

            except Exception as e:
                logger.error(f"Daemon error: {e}")
                import time
                time.sleep(3600)  # Retry in 1 hour

    def stop(self):
        """Stop the daemon"""
        self.running = False


# Flask API for manual triggers
RETRAIN_API = '''
"""
# Add to Flask app:

from flask import Blueprint, request, jsonify
from auto_retrain import AutoRetrainManager

retrain_bp = Blueprint('retrain', __name__, url_prefix='/api/retrain')
manager = AutoRetrainManager()

@retrain_bp.route('/status', methods=['GET'])
def get_retrain_status():
    trigger = manager.check_trigger()
    return jsonify(trigger)

@retrain_bp.route('/trigger', methods=['POST'])
def trigger_retrain():
    result = manager.run_pipeline()
    return jsonify(result)

@retrain_bp.route('/history', methods=['GET'])
def get_training_history():
    log_path = Path('models/training_log.json')
    if log_path.exists():
        with open(log_path) as f:
            return jsonify(json.load(f))
    return jsonify({'error': 'No training history'})
"""
'''


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Auto-retrain ChordNet-2026')
    parser.add_argument('--check', action='store_true', help='Check trigger conditions')
    parser.add_argument('--run', action='store_true', help='Run full retrain pipeline')
    parser.add_argument('--daemon', action='store_true', help='Start continuous learning daemon')

    args = parser.parse_args()

    manager = AutoRetrainManager()

    if args.check:
        result = manager.check_trigger()
        print(json.dumps(result, indent=2))

    elif args.run:
        result = manager.run_pipeline()
        print(json.dumps(result, indent=2))

    elif args.daemon:
        daemon = ContinuousLearningDaemon(check_interval_hours=24)
        daemon.start()

    else:
        print("Usage:")
        print("  python auto_retrain.py --check     # Check if retraining needed")
        print("  python auto_retrain.py --run       # Run retrain pipeline")
        print("  python auto_retrain.py --daemon    # Start background daemon")
