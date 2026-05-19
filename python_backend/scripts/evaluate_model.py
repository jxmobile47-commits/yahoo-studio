#!/usr/bin/env python3
"""
Evaluate proprietary model against baseline models
"""

import torch
import numpy as np
from pathlib import Path
import logging
import argparse
import json
from collections import Counter
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from models.proprietary_chord_model import ProprietaryChordNet

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def load_test_samples(test_data_dir):
    """Load test samples from directory"""
    sample_dirs = sorted([d for d in Path(test_data_dir).glob('sample_*') if d.is_dir()])
    samples = []

    for sample_dir in sample_dirs:
        features_path = sample_dir / "features.npy"
        labels_path = sample_dir / "labels.npy"
        if features_path.exists() and labels_path.exists():
            samples.append({
                'features': np.load(str(features_path)).astype(np.float32),
                'labels': np.load(str(labels_path)).astype(np.int64)
            })

    logger.info(f"Loaded {len(samples)} test samples")
    return samples


def evaluate_model(model_path, test_data_dir, device='cpu'):
    """Evaluate model performance"""

    # Load model
    model = ProprietaryChordNet(num_chords=170)
    if Path(model_path).exists():
        model.load_state_dict(torch.load(model_path, map_location=device, weights_only=True))
        model.to(device)
        model.eval()
        logger.info(f"Loaded model from {model_path}")
    else:
        logger.error(f"Model not found: {model_path}")
        return None

    # Load test samples
    samples = load_test_samples(test_data_dir)
    if not samples:
        logger.error("No test samples found")
        return None

    all_predictions = []
    all_ground_truth = []
    all_confidences = []

    with torch.no_grad():
        for i, sample in enumerate(samples):
            features = sample['features']  # (84, T)
            labels = sample['labels']       # (T,)

            # Add batch and channel: (1, 1, 84, T)
            features_tensor = torch.from_numpy(features).unsqueeze(0).unsqueeze(0).to(device)

            # Inference
            logits = model(features_tensor)  # (1, T, 170)
            probs = torch.softmax(logits, dim=-1)
            confidence, predictions = torch.max(probs, dim=-1)

            pred = predictions.cpu().numpy()[0]
            conf = confidence.cpu().numpy()[0]

            # Filter out 'N' chord (index 0) for accuracy calculation
            mask = labels != 0

            all_predictions.extend(pred[mask])
            all_ground_truth.extend(labels[mask])
            all_confidences.extend(conf[mask])

            if (i + 1) % 100 == 0:
                logger.info(f"Evaluated {i + 1}/{len(samples)} samples")

    # Compute metrics
    all_predictions = np.array(all_predictions)
    all_ground_truth = np.array(all_ground_truth)
    all_confidences = np.array(all_confidences)

    # Frame-level accuracy
    correct = np.sum(all_predictions == all_ground_truth)
    total = len(all_ground_truth)
    frame_accuracy = correct / total if total > 0 else 0

    # Per-chord accuracy
    chord_correct = Counter()
    chord_total = Counter()

    for pred, gt in zip(all_predictions, all_ground_truth):
        chord_total[gt] += 1
        if pred == gt:
            chord_correct[gt] += 1

    # Average confidence
    avg_confidence = np.mean(all_confidences)

    # Confidence-weighted accuracy
    conf_correct = np.sum((all_predictions == all_ground_truth) * all_confidences)
    conf_weighted_acc = conf_correct / np.sum(all_confidences) if np.sum(all_confidences) > 0 else 0

    # Chord vocabulary
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
    chord_vocab = ['N']
    for note in notes:
        for quality in qualities:
            chord_vocab.append(f"{note}:{quality}")
    chord_vocab = chord_vocab[:170]

    # Top confused chords
    confusion = Counter()
    for pred, gt in zip(all_predictions, all_ground_truth):
        if pred != gt:
            confusion[(chord_vocab[gt], chord_vocab[pred])] += 1

    results = {
        'total_frames': int(total),
        'correct_frames': int(correct),
        'frame_accuracy': round(frame_accuracy, 4),
        'average_confidence': round(float(avg_confidence), 4),
        'confidence_weighted_accuracy': round(float(conf_weighted_acc), 4),
        'num_test_samples': len(samples),
        'top_confusions': [
            {'actual': gt, 'predicted': pred, 'count': count}
            for (gt, pred), count in confusion.most_common(10)
        ],
        'chord_distribution': {
            chord_vocab[chord]: count
            for chord, count in chord_total.most_common(20)
        }
    }

    logger.info(f"Frame Accuracy: {frame_accuracy:.4f}")
    logger.info(f"Average Confidence: {avg_confidence:.4f}")

    return results


def main():
    parser = argparse.ArgumentParser(description='Evaluate proprietary chord recognition model')
    parser.add_argument('--model', default='models/proprietary_model.pt', help='Model path')
    parser.add_argument('--test-data', default='data/training', help='Test data directory')
    parser.add_argument('--device', default='cpu', help='Device (cpu/cuda)')
    parser.add_argument('--output', default='evaluation_results.json', help='Output file for results')

    args = parser.parse_args()

    results = evaluate_model(args.model, args.test_data, args.device)

    if results:
        # Print results
        print("\n" + "=" * 50)
        print("EVALUATION RESULTS")
        print("=" * 50)
        print(json.dumps(results, indent=2))

        # Save results
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2)
        logger.info(f"Results saved to {args.output}")


if __name__ == "__main__":
    main()
