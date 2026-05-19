#!/usr/bin/env python3
"""
Master Data Collection Pipeline
===============================
Orchestrates all data collection sources into unified training dataset.

Sources:
  1. Web scraping (Ultimate Guitar, Chordie)
  2. YouTube + chord matching
  3. Public datasets (Billboard, Isophonics, Lakh MIDI)
  4. Synthetic data generation
  5. User feedback/corrections

Usage:
  python master_collector.py --target-samples 50000 --output data/training
"""

import subprocess
import sys
from pathlib import Path
import json
import logging
from typing import Dict, List
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s: %(message)s')
logger = logging.getLogger(__name__)


@dataclass
class CollectionStats:
    """Track data collection progress"""
    scraped: int = 0
    youtube: int = 0
    public: int = 0
    synthetic: int = 0
    user_feedback: int = 0
    total: int = 0
    target: int = 0

    def to_dict(self):
        return {
            'scraped': self.scraped,
            'youtube': self.youtube,
            'public': self.public,
            'synthetic': self.synthetic,
            'user_feedback': self.user_feedback,
            'total': self.total,
            'target': self.target,
            'progress_pct': round(100 * self.total / self.target, 1) if self.target > 0 else 0,
        }


class MasterCollector:
    """Orchestrate all data collection sources"""

    def __init__(self, output_dir='data/training', target_samples=50000):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.target = target_samples
        self.stats = CollectionStats(target=target_samples)
        self.stats_file = self.output_dir / 'collection_stats.json'

    def load_existing_stats(self):
        """Load progress from previous run"""
        if self.stats_file.exists():
            with open(self.stats_file) as f:
                data = json.load(f)
                self.stats = CollectionStats(**data)
            logger.info(f"Loaded existing stats: {self.stats.total}/{self.stats.target}")

    def save_stats(self):
        """Save current progress"""
        with open(self.stats_file, 'w') as f:
            json.dump(self.stats.to_dict(), f, indent=2)

    def count_samples(self, directory: Path) -> int:
        """Count existing samples in directory"""
        if not directory.exists():
            return 0
        return len(list(directory.glob('sample_*')))

    def collect_scraped(self, max_songs: int = 5000) -> int:
        """Step 1: Scrape chord websites"""
        logger.info("=" * 70)
        logger.info("STEP 1: Scraping chord websites (Ultimate Guitar, Chordie)")
        logger.info("=" * 70)

        script = Path(__file__).parent / 'scrape_chord_websites.py'
        scraped_dir = self.output_dir / 'scraped_raw'

        try:
            result = subprocess.run([
                sys.executable, str(script),
                '--output', str(scraped_dir),
                '--max-songs', str(max_songs),
            ], capture_output=True, text=True, timeout=3600)

            logger.info(result.stdout)
            if result.returncode != 0:
                logger.error(f"Scraping failed: {result.stderr}")

        except Exception as e:
            logger.error(f"Scraping error: {e}")

        # Convert to training format if audio available
        # (This requires audio files - skip if not available)
        self.stats.scraped = self.count_samples(scraped_dir)
        return self.stats.scraped

    def collect_youtube(self, playlist_id: Optional[str] = None, max_songs: int = 1000) -> int:
        """Step 2: Download from YouTube with chord matching"""
        logger.info("=" * 70)
        logger.info("STEP 2: YouTube audio + chord collection")
        logger.info("=" * 70)

        if not playlist_id:
            logger.info("No playlist ID provided, skipping YouTube collection")
            logger.info("To use: python master_collector.py --youtube-playlist PL...")
            return 0

        script = Path(__file__).parent / 'youtube_collector.py'
        youtube_dir = self.output_dir / 'youtube'

        try:
            result = subprocess.run([
                sys.executable, str(script),
                '--playlist', playlist_id,
                '--output', str(youtube_dir),
                '--max-songs', str(max_songs),
            ], capture_output=True, text=True, timeout=7200)

            logger.info(result.stdout)

        except Exception as e:
            logger.error(f"YouTube collection error: {e}")

        self.stats.youtube = self.count_samples(youtube_dir)
        return self.stats.youtube

    def collect_public_datasets(self) -> int:
        """Step 3: Download public academic datasets"""
        logger.info("=" * 70)
        logger.info("STEP 3: Public datasets (Billboard, Lakh MIDI)")
        logger.info("=" * 70)

        script = Path(__file__).parent / 'public_datasets.py'
        public_dir = self.output_dir / 'public'

        try:
            result = subprocess.run([
                sys.executable, str(script),
                '--output', str(public_dir),
            ], capture_output=True, text=True, timeout=7200)

            logger.info(result.stdout)

        except Exception as e:
            logger.error(f"Public dataset error: {e}")

        self.stats.public = self.count_samples(public_dir)
        return self.stats.public

    def collect_synthetic(self, n_samples: int = 10000) -> int:
        """Step 4: Generate synthetic training data"""
        logger.info("=" * 70)
        logger.info("STEP 4: Synthetic data generation")
        logger.info("=" * 70)

        needed = self.target - self.stats.total
        if needed <= 0:
            logger.info("Target already reached, skipping synthetic")
            return 0

        generate = min(n_samples, needed)

        script = Path(__file__).parent / 'synthetic_generator.py'
        synthetic_dir = self.output_dir / 'synthetic'

        try:
            result = subprocess.run([
                sys.executable, str(script),
                '--output', str(synthetic_dir),
                '--n-samples', str(generate),
            ], capture_output=True, text=True, timeout=7200)

            logger.info(result.stdout)

        except Exception as e:
            logger.error(f"Synthetic generation error: {e}")

        self.stats.synthetic = self.count_samples(synthetic_dir)
        return self.stats.synthetic

    def merge_all_sources(self):
        """Merge all data sources into unified training directory"""
        logger.info("=" * 70)
        logger.info("STEP 5: Merging all data sources")
        logger.info("=" * 70)

        unified_dir = self.output_dir / 'unified'
        unified_dir.mkdir(exist_ok=True)

        sources = ['scraped_raw', 'youtube', 'public', 'synthetic']
        sample_id = 0

        for source in sources:
            source_dir = self.output_dir / source
            if not source_dir.exists():
                continue

            samples = sorted(source_dir.glob('sample_*'))
            logger.info(f"Merging {len(samples)} from {source}")

            for sample in samples:
                target = unified_dir / f"sample_{sample_id:06d}"

                # Copy files
                if (sample / 'features.npy').exists() and (sample / 'labels.npy').exists():
                    target.mkdir(exist_ok=True)
                    import shutil
                    shutil.copy(sample / 'features.npy', target / 'features.npy')
                    shutil.copy(sample / 'labels.npy', target / 'labels.npy')

                    if (sample / 'metadata.json').exists():
                        shutil.copy(sample / 'metadata.json', target / 'metadata.json')

                    sample_id += 1

        logger.info(f"Unified dataset: {sample_id} samples")
        self.stats.total = sample_id
        return sample_id

    def run_full_pipeline(
        self,
        youtube_playlist: Optional[str] = None,
        skip_scrape: bool = False,
        skip_youtube: bool = False,
        skip_public: bool = False,
        skip_synthetic: bool = False,
    ):
        """Run complete data collection pipeline"""
        logger.info("=" * 70)
        logger.info("YAHOO STUDIO - Master Data Collection Pipeline")
        logger.info(f"Target: {self.target:,} training samples")
        logger.info("=" * 70)

        self.load_existing_stats()

        # Step 1: Web scraping
        if not skip_scrape and self.stats.total < self.target:
            self.collect_scraped()
            self.save_stats()

        # Step 2: YouTube
        if not skip_youtube and self.stats.total < self.target:
            self.collect_youtube(youtube_playlist)
            self.save_stats()

        # Step 3: Public datasets
        if not skip_public and self.stats.total < self.target:
            self.collect_public_datasets()
            self.save_stats()

        # Step 4: Synthetic (fills remaining gap)
        if not skip_synthetic and self.stats.total < self.target:
            needed = self.target - self.stats.total
            self.collect_synthetic(n_samples=needed)
            self.save_stats()

        # Step 5: Merge
        self.merge_all_sources()
        self.save_stats()

        # Summary
        logger.info("=" * 70)
        logger.info("COLLECTION COMPLETE")
        logger.info("=" * 70)
        logger.info(f"Total samples: {self.stats.total:,}")
        logger.info(f"  - Scraped:     {self.stats.scraped:,}")
        logger.info(f"  - YouTube:     {self.stats.youtube:,}")
        logger.info(f"  - Public:      {self.stats.public:,}")
        logger.info(f"  - Synthetic:   {self.stats.synthetic:,}")
        logger.info(f"  - User:        {self.stats.user_feedback:,}")
        logger.info(f"Target: {self.stats.target:,}")
        logger.info(f"Progress: {self.stats.to_dict()['progress_pct']}%")
        logger.info("=" * 70)

        return self.stats


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Master data collection pipeline')
    parser.add_argument('--target-samples', type=int, default=50000,
                        help='Target number of training samples')
    parser.add_argument('--output', default='data/training',
                        help='Output directory')
    parser.add_argument('--youtube-playlist', help='YouTube playlist ID')
    parser.add_argument('--skip-scrape', action='store_true')
    parser.add_argument('--skip-youtube', action='store_true')
    parser.add_argument('--skip-public', action='store_true')
    parser.add_argument('--skip-synthetic', action='store_true')

    args = parser.parse_args()

    collector = MasterCollector(args.output, args.target_samples)
    collector.run_full_pipeline(
        youtube_playlist=args.youtube_playlist,
        skip_scrape=args.skip_scrape,
        skip_youtube=args.skip_youtube,
        skip_public=args.skip_public,
        skip_synthetic=args.skip_synthetic,
    )
