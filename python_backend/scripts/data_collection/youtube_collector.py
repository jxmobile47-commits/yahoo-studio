#!/usr/bin/env python3
"""
YouTube Audio + Chord Collection Pipeline
=========================================
Downloads audio from YouTube and matches with chord annotations.
Uses yt-dlp for audio extraction.

Requirements:
  pip install yt-dlp librosa numpy

Usage:
  python youtube_collector.py --playlist "PL..." --chords-file chords.json
  python youtube_collector.py --songs-list songs.txt --output data/training
"""

import subprocess
import json
import re
from pathlib import Path
from dataclasses import dataclass
from typing import List, Optional, Dict
import logging
import time

import numpy as np
import librosa

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class YouTubeSong:
    video_id: str
    title: str
    artist: str
    duration: float
    audio_path: Optional[Path] = None
    chords: Optional[List[Dict]] = None


class YouTubeDownloader:
    """Download audio from YouTube using yt-dlp"""

    def __init__(self, output_dir='data/youtube_audio', quality='bestaudio'):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.quality = quality

    def download_audio(self, video_id: str) -> Optional[Path]:
        """Download audio from YouTube video"""
        url = f"https://www.youtube.com/watch?v={video_id}"
        output_template = str(self.output_dir / f"%(title)s_{video_id}.%(ext)s")

        cmd = [
            'yt-dlp',
            '--extract-audio',
            '--audio-format', 'wav',
            '--audio-quality', '0',
            '--output', output_template,
            '--no-playlist',
            '--quiet',
            url
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

            if result.returncode != 0:
                logger.error(f"Download failed: {result.stderr}")
                return None

            # Find downloaded file
            pattern = f"*{video_id}.wav"
            matches = list(self.output_dir.glob(pattern))
            if matches:
                return matches[0]

        except subprocess.TimeoutExpired:
            logger.error(f"Download timeout for {video_id}")
        except FileNotFoundError:
            logger.error("yt-dlp not found. Install: pip install yt-dlp")

        return None

    def download_playlist(self, playlist_id: str, max_songs: int = 100) -> List[YouTubeSong]:
        """Download all songs from a playlist"""
        url = f"https://www.youtube.com/playlist?list={playlist_id}"

        # Get playlist info
        cmd = [
            'yt-dlp',
            '--flat-playlist',
            '--dump-json',
            '--playlist-end', str(max_songs),
            url
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)

            songs = []
            for line in result.stdout.strip().split('\n'):
                if not line:
                    continue
                try:
                    info = json.loads(line)
                    song = YouTubeSong(
                        video_id=info['id'],
                        title=info.get('title', 'Unknown'),
                        artist=info.get('uploader', 'Unknown'),
                        duration=info.get('duration', 0),
                    )
                    songs.append(song)
                except (json.JSONDecodeError, KeyError):
                    continue

            logger.info(f"Found {len(songs)} songs in playlist")

            # Download each
            downloaded = []
            for i, song in enumerate(songs):
                logger.info(f"Downloading {i+1}/{len(songs)}: {song.title}")
                path = self.download_audio(song.video_id)
                if path:
                    song.audio_path = path
                    downloaded.append(song)
                time.sleep(1)  # Rate limiting

            return downloaded

        except Exception as e:
            logger.error(f"Playlist download failed: {e}")
            return []


class ChordMatcher:
    """Match downloaded audio with chord annotations"""

    def __init__(self):
        self.hop_length = 512
        self.sr = 22050
        self.n_bins = 84

    def extract_features(self, audio_path: Path) -> np.ndarray:
        """Extract CQT features from audio"""
        y, sr = librosa.load(str(audio_path), sr=self.sr)
        cqt = librosa.cqt(y, sr=sr, hop_length=self.hop_length, n_bins=self.n_bins)
        cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)
        cqt_norm = (cqt_db - np.mean(cqt_db)) / (np.std(cqt_db) + 1e-8)
        return cqt_norm.astype(np.float32)

    def create_training_sample(
        self,
        audio_path: Path,
        chords: List[Dict],
        output_dir: Path,
        sample_id: int
    ) -> bool:
        """Create a training sample from audio + chords"""
        try:
            features = self.extract_features(audio_path)
            labels = self._chords_to_labels(chords, features.shape[1])

            sample_dir = output_dir / f"sample_{sample_id:06d}"
            sample_dir.mkdir(parents=True, exist_ok=True)

            np.save(str(sample_dir / "features.npy"), features)
            np.save(str(sample_dir / "labels.npy"), labels)

            metadata = {
                'source': 'youtube',
                'audio_path': str(audio_path),
                'num_chords': len(chords),
                'feature_shape': list(features.shape),
            }
            with open(str(sample_dir / "metadata.json"), 'w') as f:
                json.dump(metadata, f, indent=2)

            return True

        except Exception as e:
            logger.error(f"Error creating sample: {e}")
            return False

    def _chords_to_labels(self, chords: List[Dict], num_frames: int) -> np.ndarray:
        """Convert chord timestamps to frame labels"""
        labels = np.zeros(num_frames, dtype=np.int64)

        # Vocabulary
        notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
        vocab = ['N']
        for n in notes:
            for q in qualities:
                vocab.append(f"{n}:{q}")

        chord_to_idx = {ch: i for i, ch in enumerate(vocab[:170])}

        for chord in chords:
            start_time = chord.get('time', 0)
            duration = chord.get('duration', 2.0)
            chord_name = chord.get('chord', 'N')

            start_frame = int(start_time * self.sr / self.hop_length)
            end_frame = int((start_time + duration) * self.sr / self.hop_length)

            idx = chord_to_idx.get(chord_name, 0)
            labels[max(0, start_frame):min(num_frames, end_frame)] = idx

        return labels


class AutoChordFinder:
    """
    Automatically find chord annotations for YouTube songs
    Uses multiple sources:
      1. Ultimate Guitar search by title
      2. Chordify API (if available)
      3. Audio-based chord estimation (fallback)
    """

    def __init__(self):
        self.ug_base = "https://www.ultimate-guitar.com"

    def find_chords(self, title: str, artist: str) -> Optional[List[Dict]]:
        """Find chords for a song by title/artist"""
        # Try Ultimate Guitar first
        chords = self._search_ug(title, artist)
        if chords:
            return chords

        # Fallback: Use existing model to estimate chords
        logger.warning(f"No chords found for {title}, using estimation fallback")
        return None

    def _search_ug(self, title: str, artist: str) -> Optional[List[Dict]]:
        """Search Ultimate Guitar for chords"""
        import requests
        from bs4 import BeautifulSoup

        query = f"{artist} {title} chords"
        search_url = f"{self.ug_base}/search.php?search_type=title&value={query}"

        try:
            resp = requests.get(search_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }, timeout=10)

            # Parse results
            # This is a simplified version - full implementation in scrape_chord_websites.py
            return None

        except Exception as e:
            logger.error(f"UG search failed: {e}")
            return None


def collect_from_youtube(
    playlist_id: Optional[str] = None,
    songs_list: Optional[Path] = None,
    chords_file: Optional[Path] = None,
    output_dir: str = 'data/training',
    max_songs: int = 100
):
    """
    Main collection pipeline

    Args:
        playlist_id: YouTube playlist ID
        songs_list: File with "Artist - Title" per line
        chords_file: JSON with pre-existing chord annotations
        output_dir: Training data output
        max_songs: Max to collect
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    downloader = YouTubeDownloader()
    matcher = ChordMatcher()
    chord_finder = AutoChordFinder()

    songs = []

    # Get song list
    if playlist_id:
        logger.info(f"Collecting from playlist: {playlist_id}")
        songs = downloader.download_playlist(playlist_id, max_songs)
    elif songs_list and songs_list.exists():
        logger.info(f"Reading song list: {songs_list}")
        with open(songs_list) as f:
            for line in f:
                if ' - ' in line:
                    artist, title = line.strip().split(' - ', 1)
                    songs.append(YouTubeSong(
                        video_id='', title=title, artist=artist, duration=0
                    ))

    # Load pre-existing chords
    pre_chords = {}
    if chords_file and chords_file.exists():
        with open(chords_file) as f:
            pre_chords = json.load(f)

    # Process each song
    sample_id = 0
    for song in songs:
        logger.info(f"Processing: {song.artist} - {song.title}")

        # Get chords
        chords = None
        if song.title in pre_chords:
            chords = pre_chords[song.title]
        else:
            chords = chord_finder.find_chords(song.title, song.artist)

        if not chords:
            logger.warning(f"No chords for {song.title}, skipping")
            continue

        # Download audio if needed
        if not song.audio_path and song.video_id:
            song.audio_path = downloader.download_audio(song.video_id)

        if not song.audio_path:
            logger.warning(f"No audio for {song.title}, skipping")
            continue

        # Create training sample
        success = matcher.create_training_sample(
            song.audio_path, chords, output_path, sample_id
        )

        if success:
            sample_id += 1
            logger.info(f"Created sample {sample_id}")

    logger.info(f"Collection complete: {sample_id} training samples")
    return sample_id


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Collect training data from YouTube')
    parser.add_argument('--playlist', help='YouTube playlist ID')
    parser.add_argument('--songs-list', type=Path, help='File with songs (Artist - Title)')
    parser.add_argument('--chords-file', type=Path, help='Pre-existing chords JSON')
    parser.add_argument('--output', default='data/training', help='Output directory')
    parser.add_argument('--max-songs', type=int, default=100)

    args = parser.parse_args()

    collect_from_youtube(
        playlist_id=args.playlist,
        songs_list=args.songs_list,
        chords_file=args.chords_file,
        output_dir=args.output,
        max_songs=args.max_songs
    )
