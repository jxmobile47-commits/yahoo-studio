#!/usr/bin/env python3
"""
Quick-start inference demo for ProprietaryChordNet
No training required - test the architecture instantly
"""

import torch
import librosa
import numpy as np
from pathlib import Path
import argparse
import sys

sys.path.insert(0, str(Path(__file__).parent))

from models.proprietary_chord_model import ProprietaryChordNet


def extract_cqt_features(audio_path, sr=22050, hop_length=512, n_bins=84):
    """Extract CQT features from audio file"""
    print(f"Loading audio: {audio_path}")
    y, sr = librosa.load(audio_path, sr=sr)

    print("Computing CQT...")
    cqt = librosa.cqt(y, sr=sr, hop_length=hop_length, n_bins=n_bins)
    cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)

    # Normalize
    mean = np.mean(cqt_db)
    std = np.std(cqt_db)
    features = (cqt_db - mean) / (std + 1e-8)

    return features.astype(np.float32), sr, hop_length


def predict_chords(model, features, device='cpu'):
    """Run inference and return chord predictions"""
    # Add batch and channel dims: (1, 1, 84, T)
    features_tensor = torch.from_numpy(features).unsqueeze(0).unsqueeze(0).to(device)

    print(f"Input shape: {features_tensor.shape}")

    with torch.no_grad():
        logits = model(features_tensor)  # (1, T, 170)
        probs = torch.softmax(logits, dim=-1)
        confidence, chord_indices = torch.max(probs, dim=-1)

    chord_indices = chord_indices.cpu().numpy()[0]
    confidence = confidence.cpu().numpy()[0]

    return chord_indices, confidence


def chords_to_segments(chord_indices, confidence, hop_length=512, sr=22050):
    """Convert frame-level predictions to chord segments"""
    # Chord vocabulary
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
    chord_vocab = ['N']
    for note in notes:
        for quality in qualities:
            chord_vocab.append(f"{note}:{quality}")
    chord_vocab = chord_vocab[:170]

    # Convert to chord names
    chords = [chord_vocab[idx] for idx in chord_indices]
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
                    'start': round(start_time, 2),
                    'end': round(float(times[i]), 2),
                    'confidence': round(float(np.mean(confidence[start_idx:i])), 3),
                    'duration': round(float(times[i] - start_time), 2)
                })
                current_chord = chords[i]
                start_time = float(times[i])
                start_idx = i

        # Last segment
        segments.append({
            'chord': current_chord,
            'start': round(start_time, 2),
            'end': round(float(times[-1] + hop_length / sr), 2),
            'confidence': round(float(np.mean(confidence[start_idx:])), 3),
            'duration': round(float(times[-1] + hop_length / sr - start_time), 2)
        })

    return segments


def main():
    parser = argparse.ArgumentParser(description='Quick chord recognition demo')
    parser.add_argument('audio_file', help='Path to audio file (.mp3, .wav)')
    parser.add_argument('--model', default=None, help='Path to trained model (optional)')
    parser.add_argument('--device', default='cpu', help='Device: cpu or cuda')
    parser.add_argument('--top', type=int, default=20, help='Show top N segments')

    args = parser.parse_args()

    if not Path(args.audio_file).exists():
        print(f"Error: File not found: {args.audio_file}")
        sys.exit(1)

    print("=" * 60)
    print("Yahoo Studio - Proprietary Chord Recognition Demo")
    print("=" * 60)

    # Initialize model
    print("\n[1/4] Initializing ProprietaryChordNet...")
    model = ProprietaryChordNet(
        num_chords=170,
        input_channels=1,
        freq_bins=84,
        lstm_hidden=256,
        lstm_layers=2,
        dropout=0.3,
        use_attention=True
    )

    param_count = sum(p.numel() for p in model.parameters())
    print(f"Model parameters: {param_count:,}")

    # Load weights if provided
    if args.model and Path(args.model).exists():
        print(f"Loading weights from: {args.model}")
        model.load_state_dict(torch.load(args.model, map_location=args.device, weights_only=True))
    else:
        print("No trained weights loaded - using random initialization (for demo only)")

    model = model.to(args.device)
    model.eval()

    # Extract features
    print("\n[2/4] Extracting audio features...")
    features, sr, hop_length = extract_cqt_features(args.audio_file)
    print(f"Feature shape: {features.shape}")

    # Predict
    print("\n[3/4] Running inference...")
    chord_indices, confidence = predict_chords(model, features, args.device)
    print(f"Predicted {len(chord_indices)} frames")
    print(f"Average confidence: {np.mean(confidence):.4f}")

    # Convert to segments
    print("\n[4/4] Generating chord segments...")
    segments = chords_to_segments(chord_indices, confidence, hop_length, sr)

    # Filter out 'N' (no chord) for cleaner output
    segments = [s for s in segments if s['chord'] != 'N']

    print(f"\n{'=' * 60}")
    print(f"CHORD RECOGNITION RESULTS")
    print(f"{'=' * 60}")
    print(f"\n{'Time':<12} {'Chord':<10} {'Duration':<10} {'Confidence'}")
    print("-" * 50)

    for seg in segments[:args.top]:
        time_str = f"{seg['start']:.2f}s"
        print(f"{time_str:<12} {seg['chord']:<10} {seg['duration']:<10.2f}s {seg['confidence']:.3f}")

    if len(segments) > args.top:
        print(f"\n... and {len(segments) - args.top} more segments")

    print(f"\n{'=' * 60}")
    print(f"Summary:")
    print(f"  Total segments: {len(segments)}")
    print(f"  Unique chords: {len(set(s['chord'] for s in segments))}")
    print(f"  Avg confidence: {np.mean([s['confidence'] for s in segments]):.3f}")
    print(f"{'=' * 60}")

    # Save results
    output_file = Path(args.audio_file).stem + "_chords.json"
    import json
    with open(output_file, 'w') as f:
        json.dump({
            'source_file': args.audio_file,
            'model': 'ProprietaryChordNet',
            'parameters': param_count,
            'trained': args.model is not None,
            'segments': segments
        }, f, indent=2)
    print(f"\nResults saved to: {output_file}")


if __name__ == "__main__":
    main()
