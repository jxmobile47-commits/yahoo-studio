#!/usr/bin/env python3
"""
Evaluate ChordNet-2026 vs Chordify
====================================
Compares model predictions against Chordify output on same songs.

Metrics:
  - Frame accuracy (exact chord match)
  - Chord quality accuracy (maj/min/7/etc)
  - Root note accuracy
  - Segmentation quality (chord change timing)
  - MIREX-style evaluation

Usage:
  python evaluate_vs_chordify.py \
    --audio-dir test_songs/ \
    --chordify-output chordify_results/ \
    --model models/chordnet_2026.pt
"""

import torch
import numpy as np
import librosa
from pathlib import Path
import json
import logging
from typing import List, Dict, Tuple
from dataclasses import dataclass
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from models.chordnet_2026 import ChordNet2026

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class EvaluationResult:
    """Evaluation metrics for a single song"""
    song_name: str
    frame_accuracy: float
    root_accuracy: float
    quality_accuracy: float
    chord_precision: float
    chord_recall: float
    chord_f1: float
    timing_error_ms: float
    chordnet_segments: int
    chordify_segments: int


def parse_chordify_output(filepath: Path) -> List[Dict]:
    """Parse Chordify JSON or text output"""
    suffix = filepath.suffix.lower()

    if suffix == '.json':
        with open(filepath) as f:
            data = json.load(f)
            return data.get('segments', [])

    elif suffix in ('.lab', '.txt', '.chords'):
        segments = []
        with open(filepath) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = line.split()
                if len(parts) >= 3:
                    segments.append({
                        'start': float(parts[0]),
                        'end': float(parts[1]),
                        'chord': parts[2],
                    })
        return segments

    return []


def parse_harte_chord(chord: str) -> Tuple[str, str, str]:
    """
    Parse Harte chord notation into components.
    Returns: (root, quality, bass)
    """
    chord = chord.strip()

    if chord in ('N', 'X', ''):
        return ('N', 'N', 'N')

    # Handle bass note
    bass = None
    if '/' in chord:
        chord, bass = chord.split('/')

    # Parse root
    match = re.match(r'^([A-G][#b]?)', chord)
    if not match:
        return ('N', 'N', 'N')

    root = match.group(1)
    rest = chord[len(root):]

    # Parse quality
    quality_map = {
        '': 'maj', ':maj': 'maj', ':min': 'min', ':m': 'min',
        ':7': 'dom7', ':maj7': 'maj7', ':min7': 'min7',
        ':maj9': 'maj9', ':min9': 'min9',
        ':dim': 'min', ':aug': 'maj', ':sus4': 'maj',
    }

    quality = 'maj'
    for pattern, q in quality_map.items():
        if rest.startswith(pattern) or (pattern.startswith(':') and rest == pattern[1:]):
            quality = q
            break

    return (root, quality, bass or root)


def chords_to_frames(segments: List[Dict], duration: float, sr: int = 22050, hop: int = 512) -> List[str]:
    """Convert chord segments to frame-level labels"""
    num_frames = int(duration * sr / hop)
    frames = ['N'] * num_frames

    for seg in segments:
        start_frame = int(seg['start'] * sr / hop)
        end_frame = int(seg['end'] * sr / hop)
        chord = seg.get('chord', 'N')

        for i in range(max(0, start_frame), min(num_frames, end_frame)):
            frames[i] = chord

    return frames


def compute_metrics(
    predicted_frames: List[str],
    ground_truth_frames: List[str],
    hop: int = 512,
    sr: int = 22050
) -> Dict:
    """Compute evaluation metrics"""
    assert len(predicted_frames) == len(ground_truth_frames)

    total = len(predicted_frames)
    correct = 0
    root_correct = 0
    quality_correct = 0

    # For precision/recall
    pred_chords = {}
    gt_chords = {}
    match_chords = {}

    for pred, gt in zip(predicted_frames, ground_truth_frames):
        if pred == gt:
            correct += 1

        # Parse components
        pred_root, pred_qual, _ = parse_harte_chord(pred)
        gt_root, gt_qual, _ = parse_harte_chord(gt)

        if pred_root == gt_root:
            root_correct += 1
        if pred_qual == gt_qual:
            quality_correct += 1

        # Count for precision/recall
        pred_chords[pred] = pred_chords.get(pred, 0) + 1
        gt_chords[gt] = gt_chords.get(gt, 0) + 1
        if pred == gt:
            match_chords[pred] = match_chords.get(pred, 0) + 1

    # Precision, Recall, F1
    precision_sum = 0
    recall_sum = 0

    for chord in set(list(pred_chords.keys()) + list(gt_chords.keys())):
        tp = match_chords.get(chord, 0)
        fp = pred_chords.get(chord, 0) - tp
        fn = gt_chords.get(chord, 0) - tp

        if tp + fp > 0:
            precision_sum += tp / (tp + fp)
        if tp + fn > 0:
            recall_sum += tp / (tp + fn)

    num_unique = len(set(list(pred_chords.keys()) + list(gt_chords.keys())))
    avg_precision = precision_sum / num_unique if num_unique > 0 else 0
    avg_recall = recall_sum / num_unique if num_unique > 0 else 0
    f1 = 2 * avg_precision * avg_recall / (avg_precision + avg_recall) if (avg_precision + avg_recall) > 0 else 0

    return {
        'frame_accuracy': correct / total if total > 0 else 0,
        'root_accuracy': root_correct / total if total > 0 else 0,
        'quality_accuracy': quality_correct / total if total > 0 else 0,
        'precision': avg_precision,
        'recall': avg_recall,
        'f1': f1,
        'total_frames': total,
    }


def compare_segmentation(
    pred_segments: List[Dict],
    gt_segments: List[Dict],
    tolerance_ms: float = 500.0
) -> Dict:
    """Compare chord change timing"""
    pred_times = [s['start'] for s in pred_segments]
    gt_times = [s['start'] for s in gt_segments]

    matched = 0
    total_error = 0.0

    for gt_time in gt_times:
        # Find closest prediction
        closest = min(pred_times, key=lambda t: abs(t - gt_time))
        error_ms = abs(closest - gt_time) * 1000

        if error_ms <= tolerance_ms:
            matched += 1
            total_error += error_ms

    avg_error = total_error / matched if matched > 0 else 0

    return {
        'matched_changes': matched,
        'gt_changes': len(gt_times),
        'pred_changes': len(pred_times),
        'timing_recall': matched / len(gt_times) if gt_times else 0,
        'avg_timing_error_ms': avg_error,
    }


def evaluate_song(
    audio_path: Path,
    chordify_path: Path,
    model: ChordNet2026,
    device: str = 'cpu'
) -> EvaluationResult:
    """Evaluate model vs Chordify on a single song"""

    logger.info(f"Evaluating: {audio_path.name}")

    # Load audio
    y, sr = librosa.load(str(audio_path), sr=22050)
    duration = len(y) / sr

    # Get Chordify ground truth
    chordify_segments = parse_chordify_output(chordify_path)
    gt_frames = chords_to_frames(chordify_segments, duration)

    # Get ChordNet-2026 prediction
    cqt = librosa.cqt(y, sr=sr, hop_length=512, n_bins=84)
    cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)
    features = ((cqt_db - np.mean(cqt_db)) / (np.std(cqt_db) + 1e-8)).astype(np.float32)

    features_t = torch.from_numpy(features).unsqueeze(0).unsqueeze(0).to(device)

    with torch.no_grad():
        output = model(features_t)
        chord_logits = output['chord_logits']
        probs = torch.softmax(chord_logits, dim=-1)
        _, chord_indices = torch.max(probs, dim=-1)

    chord_indices = chord_indices.cpu().numpy()[0]

    # Convert to chord names
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
    vocab = ['N']
    for n in notes:
        for q in qualities:
            vocab.append(f"{n}:{q}")
    vocab = vocab[:170]

    pred_frames = [vocab[idx] if idx < len(vocab) else 'N' for idx in chord_indices]

    # Pad to same length
    min_len = min(len(pred_frames), len(gt_frames))
    pred_frames = pred_frames[:min_len]
    gt_frames = gt_frames[:min_len]

    # Compute metrics
    metrics = compute_metrics(pred_frames, gt_frames)

    # Segmentation comparison
    # Build predicted segments from frames
    pred_segments = []
    if pred_frames:
        current = pred_frames[0]
        start_t = 0.0
        hop = 512
        for i, chord in enumerate(pred_frames):
            if chord != current:
                pred_segments.append({
                    'start': start_t,
                    'end': i * hop / sr,
                    'chord': current,
                })
                current = chord
                start_t = i * hop / sr
        pred_segments.append({
            'start': start_t,
            'end': len(pred_frames) * hop / sr,
            'chord': current,
        })

    seg_metrics = compare_segmentation(pred_segments, chordify_segments)

    return EvaluationResult(
        song_name=audio_path.stem,
        frame_accuracy=metrics['frame_accuracy'],
        root_accuracy=metrics['root_accuracy'],
        quality_accuracy=metrics['quality_accuracy'],
        chord_precision=metrics['precision'],
        chord_recall=metrics['recall'],
        chord_f1=metrics['f1'],
        timing_error_ms=seg_metrics['avg_timing_error_ms'],
        chordnet_segments=len(pred_segments),
        chordify_segments=len(chordify_segments),
    )


def evaluate_batch(
    audio_dir: Path,
    chordify_dir: Path,
    model_path: Path,
    device: str = 'cpu'
) -> List[EvaluationResult]:
    """Evaluate on batch of test songs"""

    # Load model
    model = ChordNet2026(
        num_chords=170,
        freq_bins=84,
        mamba_dim=512,
        mamba_layers=6,
        mamba_state=32,
        use_crf=True,
        use_hierarchical=True,
    )

    if model_path.exists():
        checkpoint = torch.load(model_path, map_location=device, weights_only=True)
        model.load_state_dict(checkpoint['model_state_dict'])
        model.to(device)
        model.eval()
        logger.info(f"Loaded model from {model_path}")
    else:
        logger.warning("No trained model found, using random weights")
        model.to(device)
        model.eval()

    results = []

    for audio_file in sorted(audio_dir.glob('*.mp3')) + sorted(audio_dir.glob('*.wav')):
        # Find matching Chordify output
        chordify_file = chordify_dir / f"{audio_file.stem}.json"
        if not chordify_file.exists():
            chordify_file = chordify_dir / f"{audio_file.stem}.lab"
        if not chordify_file.exists():
            chordify_file = chordify_dir / f"{audio_file.stem}.txt"

        if not chordify_file.exists():
            logger.warning(f"No Chordify output for {audio_file.name}, skipping")
            continue

        try:
            result = evaluate_song(audio_file, chordify_file, model, device)
            results.append(result)
        except Exception as e:
            logger.error(f"Error evaluating {audio_file.name}: {e}")

    return results


def print_comparison(results: List[EvaluationResult]):
    """Print formatted comparison table"""
    print("\n" + "=" * 100)
    print("CHORDNET-2026 vs CHORDIFY EVALUATION")
    print("=" * 100)
    print(f"{'Song':<30} {'Frame Acc':>10} {'Root Acc':>10} {'Qual Acc':>10} {'F1':>8} {'Timing(ms)':>12} {'Segments':>10}")
    print("-" * 100)

    for r in results:
        print(f"{r.song_name:<30} {r.frame_accuracy:>9.1%} {r.root_accuracy:>9.1%} {r.quality_accuracy:>9.1%} {r.chord_f1:>7.3f} {r.timing_error_ms:>11.0f} {r.chordnet_segments:>5}/{r.chordify_segments:<5}")

    # Averages
    avg_frame = np.mean([r.frame_accuracy for r in results])
    avg_root = np.mean([r.root_accuracy for r in results])
    avg_qual = np.mean([r.quality_accuracy for r in results])
    avg_f1 = np.mean([r.chord_f1 for r in results])
    avg_timing = np.mean([r.timing_error_ms for r in results])

    print("-" * 100)
    print(f"{'AVERAGE':<30} {avg_frame:>9.1%} {avg_root:>9.1%} {avg_qual:>9.1%} {avg_f1:>7.3f} {avg_timing:>11.0f}")
    print("=" * 100)

    # Verdict
    if avg_frame > 0.80:
        print("🎉 EXCELLENT: Competitive with Chordify (80%+ accuracy)")
    elif avg_frame > 0.70:
        print("✅ GOOD: Approaching Chordify level (70-80%)")
    elif avg_frame > 0.60:
        print("⚠️ FAIR: Needs more training data (60-70%)")
    else:
        print("❌ NEEDS WORK: Significant improvement needed (<60%)")

    print("=" * 100)

    return {
        'avg_frame_accuracy': avg_frame,
        'avg_root_accuracy': avg_root,
        'avg_quality_accuracy': avg_qual,
        'avg_f1': avg_f1,
        'avg_timing_error_ms': avg_timing,
        'num_songs': len(results),
    }


if __name__ == "__main__":
    import argparse
    import re

    parser = argparse.ArgumentParser(description='Evaluate vs Chordify')
    parser.add_argument('--audio-dir', type=Path, required=True, help='Directory with test audio files')
    parser.add_argument('--chordify-dir', type=Path, required=True, help='Directory with Chordify output files')
    parser.add_argument('--model', type=Path, default=Path('models/chordnet_2026.pt'), help='Model checkpoint')
    parser.add_argument('--device', default='cpu', help='cpu or cuda')
    parser.add_argument('--output', type=Path, help='Save results to JSON')

    args = parser.parse_args()

    results = evaluate_batch(args.audio_dir, args.chordify_dir, args.model, args.device)
    summary = print_comparison(results)

    if args.output:
        with open(args.output, 'w') as f:
            json.dump({
                'summary': summary,
                'per_song': [{
                    'song': r.song_name,
                    'frame_accuracy': r.frame_accuracy,
                    'root_accuracy': r.root_accuracy,
                    'quality_accuracy': r.quality_accuracy,
                    'f1': r.chord_f1,
                    'timing_error_ms': r.timing_error_ms,
                } for r in results]
            }, f, indent=2)
        print(f"\nResults saved to: {args.output}")
