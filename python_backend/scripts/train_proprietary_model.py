#!/usr/bin/env python3
"""
Training script for Proprietary Chord Recognition Model
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import numpy as np
from pathlib import Path
import logging
import argparse
import json
from tqdm import tqdm

# Add parent to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from models.proprietary_chord_model import ProprietaryChordNet

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ChordDataset(Dataset):
    """Dataset for chord recognition"""

    def __init__(self, data_dir, split='train', max_samples=None):
        self.data_dir = Path(data_dir)
        self.split = split

        # Load sample indices
        sample_dirs = sorted([d for d in self.data_dir.glob('sample_*') if d.is_dir()])

        if max_samples:
            sample_dirs = sample_dirs[:max_samples]

        # Split data (80/20)
        split_idx = int(len(sample_dirs) * 0.8)
        if split == 'train':
            sample_dirs = sample_dirs[:split_idx]
        else:
            sample_dirs = sample_dirs[split_idx:]

        self.samples = []
        for sample_dir in sample_dirs:
            if (sample_dir / "features.npy").exists() and (sample_dir / "labels.npy").exists():
                self.samples.append(sample_dir)

        logger.info(f"Loaded {len(self.samples)} {split} samples")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample_dir = self.samples[idx]

        features = np.load(str(sample_dir / "features.npy")).astype(np.float32)
        labels = np.load(str(sample_dir / "labels.npy")).astype(np.int64)

        # Add channel dimension: (1, freq_bins, time_steps)
        features = np.expand_dims(features, axis=0)

        return {
            'features': torch.from_numpy(features),
            'labels': torch.from_numpy(labels)
        }


class ChordTrainer:
    """Trainer for chord recognition model"""

    def __init__(
        self,
        model,
        train_loader,
        val_loader,
        device='cpu',
        learning_rate=1e-3
    ):
        self.model = model.to(device)
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.device = device

        self.criterion = nn.CrossEntropyLoss(ignore_index=0)  # Ignore 'N' chord
        self.optimizer = optim.Adam(model.parameters(), lr=learning_rate)
        self.scheduler = optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer, mode='min', factor=0.5, patience=5, verbose=True
        )

        self.best_val_loss = float('inf')
        self.patience_counter = 0
        self.max_patience = 10

    def _pad_batch(self, batch):
        """Pad sequences to same length in batch"""
        features = [item['features'] for item in batch]
        labels = [item['labels'] for item in batch]

        # Find max time steps
        max_time = max(f.shape[-1] for f in features)

        # Pad features
        padded_features = []
        padded_labels = []
        for f, l in zip(features, labels):
            if f.shape[-1] < max_time:
                pad_size = max_time - f.shape[-1]
                f = torch.nn.functional.pad(f, (0, pad_size))
                l = torch.nn.functional.pad(l, (0, pad_size), value=0)
            padded_features.append(f)
            padded_labels.append(l)

        return {
            'features': torch.stack(padded_features),
            'labels': torch.stack(padded_labels)
        }

    def train_epoch(self, epoch):
        """Train for one epoch"""
        self.model.train()
        total_loss = 0
        progress_bar = tqdm(self.train_loader, desc=f"Epoch {epoch}")

        for batch in progress_bar:
            features = batch['features'].to(self.device)  # (B, 1, F, T)
            labels = batch['labels'].to(self.device)      # (B, T)

            # Forward pass
            self.optimizer.zero_grad()
            logits = self.model(features)  # (B, T, num_chords)

            # Reshape for loss computation
            logits_reshaped = logits.reshape(-1, self.model.num_chords)
            labels_reshaped = labels.reshape(-1)

            # Compute loss
            loss = self.criterion(logits_reshaped, labels_reshaped)

            # Backward pass
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            self.optimizer.step()

            total_loss += loss.item()
            progress_bar.set_postfix({'loss': f'{loss.item():.4f}'})

        avg_loss = total_loss / len(self.train_loader)
        logger.info(f"Epoch {epoch} - Train Loss: {avg_loss:.4f}")
        return avg_loss

    def validate(self, epoch):
        """Validate model"""
        self.model.eval()
        total_loss = 0
        correct = 0
        total = 0

        with torch.no_grad():
            for batch in tqdm(self.val_loader, desc="Validation"):
                features = batch['features'].to(self.device)
                labels = batch['labels'].to(self.device)

                logits = self.model(features)
                logits_reshaped = logits.reshape(-1, self.model.num_chords)
                labels_reshaped = labels.reshape(-1)

                loss = self.criterion(logits_reshaped, labels_reshaped)
                total_loss += loss.item()

                # Calculate accuracy (ignore padding 'N')
                predictions = torch.argmax(logits_reshaped, dim=1)
                mask = labels_reshaped != 0
                correct += (predictions[mask] == labels_reshaped[mask]).sum().item()
                total += mask.sum().item()

        avg_loss = total_loss / len(self.val_loader)
        accuracy = correct / total if total > 0 else 0

        logger.info(f"Epoch {epoch} - Val Loss: {avg_loss:.4f}, Accuracy: {accuracy:.4f}")

        return avg_loss, accuracy

    def train(self, num_epochs, model_save_path='models/proprietary_model.pt'):
        """Train for multiple epochs"""
        Path(model_save_path).parent.mkdir(parents=True, exist_ok=True)

        for epoch in range(1, num_epochs + 1):
            train_loss = self.train_epoch(epoch)
            val_loss, val_accuracy = self.validate(epoch)

            self.scheduler.step(val_loss)

            # Save best model
            if val_loss < self.best_val_loss:
                self.best_val_loss = val_loss
                self.patience_counter = 0
                torch.save(self.model.state_dict(), model_save_path)
                logger.info(f"Saved best model to {model_save_path}")
            else:
                self.patience_counter += 1
                if self.patience_counter >= self.max_patience:
                    logger.info(f"Early stopping after {epoch} epochs")
                    break


def collate_fn(batch):
    """Custom collate function for variable-length sequences"""
    features = [item['features'] for item in batch]
    labels = [item['labels'] for item in batch]

    max_time = max(f.shape[-1] for f in features)

    padded_features = []
    padded_labels = []
    for f, l in zip(features, labels):
        if f.shape[-1] < max_time:
            pad_size = max_time - f.shape[-1]
            f = torch.nn.functional.pad(f, (0, pad_size))
            l = torch.nn.functional.pad(l, (0, pad_size), value=0)
        padded_features.append(f)
        padded_labels.append(l)

    return {
        'features': torch.stack(padded_features),
        'labels': torch.stack(padded_labels)
    }


def main():
    parser = argparse.ArgumentParser(description='Train proprietary chord recognition model')
    parser.add_argument('--data-dir', default='data/training', help='Training data directory')
    parser.add_argument('--epochs', type=int, default=100, help='Number of epochs')
    parser.add_argument('--batch-size', type=int, default=8, help='Batch size')
    parser.add_argument('--learning-rate', type=float, default=1e-3, help='Learning rate')
    parser.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    parser.add_argument('--model-save-path', default='models/proprietary_model.pt')

    args = parser.parse_args()

    logger.info(f"Using device: {args.device}")

    # Load datasets
    train_dataset = ChordDataset(args.data_dir, split='train')
    val_dataset = ChordDataset(args.data_dir, split='val')

    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=0,
        collate_fn=collate_fn
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=0,
        collate_fn=collate_fn
    )

    # Create model
    model = ProprietaryChordNet(
        num_chords=170,
        input_channels=1,
        freq_bins=84,
        lstm_hidden=256,
        lstm_layers=2,
        dropout=0.3,
        use_attention=True
    )

    logger.info(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Create trainer
    trainer = ChordTrainer(
        model,
        train_loader,
        val_loader,
        device=args.device,
        learning_rate=args.learning_rate
    )

    # Train
    trainer.train(num_epochs=args.epochs, model_save_path=args.model_save_path)

    logger.info("Training completed!")


if __name__ == "__main__":
    main()
