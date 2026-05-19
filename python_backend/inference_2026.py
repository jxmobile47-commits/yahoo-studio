#!/usr/bin/env python3
"""
ChordNet-2026 Inference & LLM Chain-of-Thought Refinement
===========================================================
Runs the cutting-edge model with optional LLM post-processing
for maximum accuracy.
"""

import torch
import librosa
import numpy as np
from pathlib import Path
import argparse
import sys
import json

sys.path.insert(0, str(Path(__file__).parent))

from models.chordnet_2026 import ChordNet2026


def extract_cqt_2026(audio_path, sr=22050, hop_length=512, n_bins=84):
    """Extract multi-resolution CQT features"""
    print(f"Loading: {audio_path}")
    y, sr = librosa.load(audio_path, sr=sr)

    # Standard CQT
    cqt = librosa.cqt(y, sr=sr, hop_length=hop_length, n_bins=n_bins)
    cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)

    # Normalize
    mean = np.mean(cqt_db)
    std = np.std(cqt_db)
    features = (cqt_db - mean) / (std + 1e-8)

    return features.astype(np.float32), sr, hop_length, y


def chords_to_harte(chord_name):
    """Convert internal chord name to Harte notation"""
    if chord_name == 'N':
        return 'N'
    parts = chord_name.split(':')
    if len(parts) != 2:
        return chord_name
    root, quality = parts
    harte_map = {
        'maj': '', 'min': 'min',
        'maj7': 'maj7', 'min7': 'min7',
        'dom7': '7', 'maj9': 'maj9',
        'min9': 'min9'
    }
    return f"{root}:{harte_map.get(quality, quality)}"


def segments_to_chord_labels(segments, hop_length=512, sr=22050):
    """Convert segments to time-aligned chord labels (MIREX format)"""
    labels = []
    for seg in segments:
        labels.append({
            'start': seg['start'],
            'end': seg['end'],
            'chord': chords_to_harte(seg['chord']),
            'confidence': seg['confidence']
        })
    return labels


def llm_refinement(segments, key_hint=None, audio_duration=None):
    """
    LLM Chain-of-Thought refinement (calls Gemini API if available).
    Uses musical reasoning to correct obvious chord errors.
    """
    # Check if Gemini API key is available
    gemini_key = None
    try:
        import os
        gemini_key = os.getenv('GEMINI_API_KEY')
    except:
        pass

    if not gemini_key:
        print("[LLM Refinement] Gemini API key not found, skipping LLM post-processing")
        return segments

    try:
        from google import genai
        client = genai.Client(api_key=gemini_key)

        # Build prompt
        chord_text = "\n".join([
            f"{s['start']:.2f}s - {s['end']:.2f}s: {s['chord']}"
            for s in segments[:30]  # Limit to first 30 segments
        ])

        prompt = f"""You are a music theory expert reviewing automatic chord recognition output.

Given these detected chords:
{chord_text}

Key hint: {key_hint or 'Unknown'}
Duration: {audio_duration or 'Unknown'}s

Task: Identify and correct any obvious chord errors using music theory rules:
1. Check if chord progressions make harmonic sense
2. Look for common mistakes (e.g., misidentified dominant 7ths)
3. Ensure consistent key center
4. Fix single-frame errors where a chord is clearly wrong

Return ONLY the corrected chord list in this exact format:
start_time|end_time|corrected_chord

Example:
0.00|1.16|C:maj
1.16|2.32|G:maj
"""

        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt
        )

        # Parse response
        refined = []
        for line in response.text.strip().split('\n'):
            if '|' in line:
                parts = line.split('|')
                if len(parts) == 3:
                    refined.append({
                        'start': float(parts[0]),
                        'end': float(parts[1]),
                        'chord': parts[2].strip(),
                        'confidence': 0.95,  # LLM confident
                        'source': 'llm_refined'
                    })

        if refined:
            print(f"[LLM Refinement] Applied {len(refined)} corrections")
            return refined

    except Exception as e:
        print(f"[LLM Refinement] Error: {e}")

    return segments


def predict_with_2026(model, audio_path, device='cpu', use_llm=False):
    """Full inference pipeline for ChordNet-2026"""

    # Extract features
    features, sr, hop_length, audio = extract_cqt_2026(audio_path)

    # Add dimensions: (1, 1, 84, T)
    features_tensor = torch.from_numpy(features).unsqueeze(0).unsqueeze(0).to(device)

    print(f"Feature shape: {features_tensor.shape}")

    # Forward pass
    with torch.no_grad():
        output = model(features_tensor)

    # Chord predictions
    chord_logits = output['chord_logits']
    probs = torch.softmax(chord_logits, dim=-1)
    confidence, chord_indices = torch.max(probs, dim=-1)

    chord_indices = chord_indices.cpu().numpy()[0]
    confidence = confidence.cpu().numpy()[0]

    # Build vocabulary
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
    chord_vocab = ['N']
    for note in notes:
        for quality in qualities:
            chord_vocab.append(f"{note}:{quality}")
    chord_vocab = chord_vocab[:170]

    chords = [chord_vocab[idx] for idx in chord_indices]
    times = np.arange(len(chords)) * hop_length / sr

    # Merge segments
    segments = []
    if len(chords) > 0:
        current = chords[0]
        start_t = float(times[0])
        start_i = 0

        for i in range(1, len(chords)):
            if chords[i] != current:
                segments.append({
                    'chord': current,
                    'start': round(start_t, 2),
                    'end': round(float(times[i]), 2),
                    'confidence': round(float(np.mean(confidence[start_i:i])), 3),
                })
                current = chords[i]
                start_t = float(times[i])
                start_i = i

        segments.append({
            'chord': current,
            'start': round(start_t, 2),
            'end': round(float(times[-1] + hop_length / sr), 2),
            'confidence': round(float(np.mean(confidence[start_i:])), 3),
        })

    # Key detection
    key_hint = None
    if 'key_logits' in output:
        key_probs = torch.softmax(output['key_logits'], dim=-1)
        key_idx = key_probs.argmax(dim=-1).item()
        key_names = [f"{n} maj" for n in notes] + [f"{n} min" for n in notes]
        key_hint = key_names[key_idx] if key_idx < 24 else None

    # LLM refinement
    if use_llm:
        duration = len(audio) / sr
        segments = llm_refinement(segments, key_hint, duration)

    return {
        'segments': segments,
        'key': key_hint,
        'duration': len(audio) / sr,
        'num_frames': len(chords),
        'model': 'ChordNet-2026',
        'hierarchical': True,
    }


def main():
    parser = argparse.ArgumentParser(description='ChordNet-2026 Inference')
    parser.add_argument('audio_file', help='Path to audio file')
    parser.add_argument('--model', default='models/chordnet_2026.pt', help='Model checkpoint')
    parser.add_argument('--device', default='cpu', help='cpu or cuda')
    parser.add_argument('--llm', action='store_true', help='Enable LLM chain-of-thought refinement')
    parser.add_argument('--output', default=None, help='Output JSON file')

    args = parser.parse_args()

    if not Path(args.audio_file).exists():
        print(f"Error: File not found: {args.audio_file}")
        sys.exit(1)

    print("=" * 70)
    print("ChordNet-2026: State-of-the-Art Chord Recognition")
    print("=" * 70)

    # Initialize model
    print("\n[1/3] Loading ChordNet-2026...")
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

    if Path(args.model).exists():
        print(f"Loading weights: {args.model}")
        checkpoint = torch.load(args.model, map_location=args.device, weights_only=True)
        model.load_state_dict(checkpoint['model_state_dict'])
    else:
        print("WARNING: No trained weights found - using random initialization")

    model = model.to(args.device)
    model.eval()

    # Run inference
    print("\n[2/3] Running inference...")
    result = predict_with_2026(model, args.audio_file, args.device, use_llm=args.llm)

    # Display results
    print("\n[3/3] Results:")
    print("-" * 70)
    print(f"{'Time':<15} {'Chord':<12} {'Duration':<10} {'Confidence'}")
    print("-" * 70)

    for seg in result['segments']:
        time_str = f"{seg['start']:.2f}s"
        dur = f"{seg['end'] - seg['start']:.2f}s"
        conf = seg.get('confidence', 0)
        src = seg.get('source', 'model')
        marker = " [LLM]" if src == 'llm_refined' else ""
        print(f"{time_str:<15} {seg['chord']:<12} {dur:<10} {conf:.3f}{marker}")

    print(f"\nDetected Key: {result['key'] or 'Unknown'}")
    print(f"Duration: {result['duration']:.2f}s")
    print(f"Total Segments: {len(result['segments'])}")

    # Save
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"\nSaved to: {args.output}")
    else:
        default_out = Path(args.audio_file).stem + "_chords_2026.json"
        with open(default_out, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"\nSaved to: {default_out}")


if __name__ == "__main__":
    main()
