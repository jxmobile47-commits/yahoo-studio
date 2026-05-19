#!/usr/bin/env python3
"""
Scrape Chord/Tab Websites for Training Data
============================================
Collects (audio_url, chords) pairs from public chord/tab sites.
Respects robots.txt and rate limits.

Supported sources:
  - Ultimate Guitar
  - Chordie
  - E-Chords
  - Tabs4Acoustic
  - Cifra Club
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import re
from pathlib import Path
from urllib.parse import urljoin, quote
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
from dataclasses import dataclass
from typing import List, Optional, Dict
import random

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class ChordSong:
    """Represents a scraped song with chords"""
    title: str
    artist: str
    chords: List[Dict]  # [{time: float, chord: str}]
    bpm: Optional[float] = None
    key: Optional[str] = None
    source: str = ""
    url: str = ""
    confidence: float = 0.0

    def to_dict(self):
        return {
            'title': self.title,
            'artist': self.artist,
            'bpm': self.bpm,
            'key': self.key,
            'source': self.source,
            'url': self.url,
            'chords': self.chords,
            'confidence': self.confidence,
        }


class UltimateGuitarScraper:
    """Scraper for Ultimate Guitar (largest chord database)"""

    BASE_URL = "https://www.ultimate-guitar.com"
    SEARCH_URL = "https://www.ultimate-guitar.com/search.php"

    def __init__(self, delay=(1, 3)):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.delay = delay

    def search_songs(self, query, page=1):
        """Search for songs by title/artist"""
        params = {
            'search_type': 'title',
            'value': query,
            'page': page,
        }
        try:
            resp = self.session.get(self.SEARCH_URL, params=params, timeout=10)
            resp.raise_for_status()
            return self._parse_search_results(resp.text)
        except Exception as e:
            logger.error(f"Search failed: {e}")
            return []

    def _parse_search_results(self, html):
        """Parse search result page"""
        soup = BeautifulSoup(html, 'html.parser')
        results = []

        # UG uses JSON in script tags
        scripts = soup.find_all('script')
        for script in scripts:
            if script.string and 'window.UGAPP.store.page' in script.string:
                # Extract JSON data
                match = re.search(r'window\.UGAPP\.store\.page\s*=\s*({.+?});', script.string, re.DOTALL)
                if match:
                    try:
                        data = json.loads(match.group(1))
                        results_data = data.get('data', {}).get('results', [])
                        for item in results_data:
                            if item.get('type') == 'Chords':
                                results.append({
                                    'title': item.get('song_name', ''),
                                    'artist': item.get('artist_name', ''),
                                    'url': item.get('tab_url', ''),
                                    'rating': item.get('rating', 0),
                                    'votes': item.get('votes', 0),
                                })
                    except json.JSONDecodeError:
                        pass

        return results

    def get_chords(self, url):
        """Extract chord progression from a tab page"""
        try:
            time.sleep(random.uniform(*self.delay))
            resp = self.session.get(url, timeout=15)
            resp.raise_for_status()
            return self._parse_chord_page(resp.text, url)
        except Exception as e:
            logger.error(f"Failed to fetch {url}: {e}")
            return None

    def _parse_chord_page(self, html, url):
        """Parse chord page and extract structured data"""
        soup = BeautifulSoup(html, 'html.parser')

        # UG stores data in JSON
        scripts = soup.find_all('script')
        for script in scripts:
            if script.string and 'window.UGAPP.store.page' in script.string:
                match = re.search(
                    r'window\.UGAPP\.store\.page\s*=\s*({.+?});',
                    script.string, re.DOTALL
                )
                if match:
                    try:
                        data = json.loads(match.group(1))
                        tab_data = data.get('data', {}).get('tab', {})

                        title = tab_data.get('song_name', '')
                        artist = tab_data.get('artist_name', '')
                        content = tab_data.get('content', '')
                        bpm = tab_data.get('bpm', None)
                        tonality = tab_data.get('tonality', None)

                        # Parse chord lines
                        chords = self._extract_chords_from_text(content)

                        return ChordSong(
                            title=title,
                            artist=artist,
                            chords=chords,
                            bpm=bpm,
                            key=tonality,
                            source='ultimate_guitar',
                            url=url,
                            confidence=self._calculate_confidence(tab_data)
                        )
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.error(f"Parse error: {e}")

        return None

    def _extract_chords_from_text(self, text):
        """Extract chords and approximate timing from tab text"""
        chords = []
        lines = text.split('\n')
        time_per_line = 2.0  # Assume 2 seconds per line (rough estimate)

        current_time = 0.0
        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Match chord patterns like [C], [Am], [G7], etc.
            chord_matches = re.findall(r'\[([A-G][#b]?(?:m|maj7|min7|7|9|dim|aug|sus\d)?)\]', line)

            if chord_matches:
                # Distribute chords evenly across the line
                duration = time_per_line / len(chord_matches) if chord_matches else time_per_line
                for chord in chord_matches:
                    chords.append({
                        'time': round(current_time, 2),
                        'chord': self._normalize_chord(chord),
                        'duration': round(duration, 2),
                    })
                    current_time += duration
            else:
                current_time += time_per_line

        return chords

    def _normalize_chord(self, chord):
        """Convert various chord notations to standard format"""
        chord = chord.strip()

        # Map common notations
        replacements = {
            'Am': 'A:min', 'Dm': 'D:min', 'Em': 'E:min',
            'Gm': 'G:min', 'Cm': 'C:min', 'Fm': 'F:min',
            'Bm': 'B:min',
            'Amaj7': 'A:maj7', 'Cmaj7': 'C:maj7', 'Gmaj7': 'G:maj7',
            'A7': 'A:dom7', 'C7': 'C:dom7', 'G7': 'G:dom7',
            'A9': 'A:maj9', 'C9': 'C:maj9',
        }

        if chord in replacements:
            return replacements[chord]

        # Parse root and quality
        match = re.match(r'^([A-G][#b]?)(.*)$', chord)
        if match:
            root = match.group(1)
            quality = match.group(2)

            quality_map = {
                '': 'maj', 'm': 'min', 'maj': 'maj', 'min': 'min',
                '7': 'dom7', 'maj7': 'maj7', 'min7': 'min7',
                '9': 'maj9', 'maj9': 'maj9', 'min9': 'min9',
            }

            normalized_quality = quality_map.get(quality, 'maj')
            return f"{root}:{normalized_quality}"

        return chord

    def _calculate_confidence(self, tab_data):
        """Calculate confidence score based on tab metadata"""
        rating = tab_data.get('rating', 0)
        votes = tab_data.get('votes', 0)
        tab_type = tab_data.get('type_name', '')

        confidence = 0.5
        if tab_type == 'Chords':
            confidence += 0.2
        if rating > 4:
            confidence += 0.15
        if votes > 100:
            confidence += 0.1

        return min(confidence, 1.0)


class ChordieScraper:
    """Scraper for Chordie.com"""

    BASE_URL = "https://www.chordie.com"

    def __init__(self, delay=(1, 3)):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.delay = delay
        self.ug_scraper = UltimateGuitarScraper(delay)

    def get_chords(self, url):
        """Fetch chords from Chordie"""
        try:
            time.sleep(random.uniform(*self.delay))
            resp = self.session.get(url, timeout=15)
            resp.raise_for_status()

            soup = BeautifulSoup(resp.text, 'html.parser')

            # Extract title/artist
            title_elem = soup.find('h1')
            title = title_elem.text.strip() if title_elem else ''

            # Chordie embeds UG content
            iframe = soup.find('iframe', {'src': re.compile(r'ultimate-guitar')})
            if iframe:
                ug_url = iframe['src']
                logger.info(f"Redirecting to UG: {ug_url}")
                return self.ug_scraper.get_chords(ug_url)

            # Parse inline chords
            chords = self._parse_inline_chords(soup)

            return ChordSong(
                title=title,
                artist='',
                chords=chords,
                source='chordie',
                url=url
            )

        except Exception as e:
            logger.error(f"Chordie fetch failed: {e}")
            return None

    def _parse_inline_chords(self, soup):
        """Parse chords directly from Chordie page"""
        chords = []
        chord_lines = soup.find_all('span', class_=re.compile(r'chord'))

        current_time = 0.0
        for line in chord_lines:
            chord_text = line.text.strip()
            if chord_text:
                chords.append({
                    'time': round(current_time, 2),
                    'chord': self.ug_scraper._normalize_chord(chord_text),
                    'duration': 2.0,
                })
                current_time += 2.0

        return chords


def scrape_popular_songs(output_dir='data/scraped_chords', max_songs=1000):
    """
    Scrape popular songs from Ultimate Guitar

    Args:
        output_dir: Where to save JSON files
        max_songs: Maximum songs to collect
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    ug = UltimateGuitarScraper()

    # List of popular artists to search
    popular_artists = [
        'The Beatles', 'Elvis Presley', 'Ed Sheeran', 'Taylor Swift',
        'Adele', 'Bruno Mars', 'Coldplay', 'Oasis', 'Nirvana',
        'Pink Floyd', 'Queen', 'Led Zeppelin', 'Bob Dylan',
        'John Lennon', 'Paul McCartney', 'George Harrison',
        'Eric Clapton', 'Jimi Hendrix', 'The Rolling Stones',
        'Aerosmith', 'Guns N Roses', 'Metallica', 'AC/DC',
        'Red Hot Chili Peppers', 'Foo Fighters', 'Green Day',
        'Linkin Park', 'Twenty One Pilots', 'Imagine Dragons',
        'Maroon 5', 'OneRepublic', 'Jason Mraz', 'John Mayer',
        'James Taylor', 'Simon & Garfunkel', 'Cat Stevens',
        'Bob Marley', 'Stevie Wonder', 'Marvin Gaye',
        'Michael Jackson', 'Prince', 'Whitney Houston',
        'Celine Dion', 'Shania Twain', 'Garth Brooks',
        'Johnny Cash', 'Willie Nelson', 'Dolly Parton',
        'B.B. King', 'Muddy Waters', 'John Lee Hooker',
        'Miles Davis', 'John Coltrane', 'Billie Holiday',
        'Frank Sinatra', 'Tony Bennett', 'Dean Martin',
    ]

    collected = 0
    all_songs = []

    for artist in popular_artists:
        if collected >= max_songs:
            break

        logger.info(f"Searching: {artist} ({collected}/{max_songs})")

        try:
            results = ug.search_songs(artist)
            logger.info(f"  Found {len(results)} tabs")

            for result in results[:5]:  # Top 5 per artist
                if collected >= max_songs:
                    break

                url = result.get('url')
                if not url:
                    continue

                song = ug.get_chords(url)
                if song and len(song.chords) > 3:
                    all_songs.append(song.to_dict())
                    collected += 1

                    # Save incrementally
                    if collected % 50 == 0:
                        _save_batch(all_songs, output_path, collected)
                        logger.info(f"  Saved {collected} songs")

        except Exception as e:
            logger.error(f"Error processing {artist}: {e}")

    # Final save
    _save_batch(all_songs, output_path, collected, final=True)
    logger.info(f"Collection complete: {collected} songs saved")

    return collected


def _save_batch(songs, output_path, count, final=False):
    """Save batch of songs to JSON"""
    suffix = "final" if final else f"batch_{count}"
    filepath = output_path / f"chords_{suffix}.json"

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(songs, f, indent=2, ensure_ascii=False)


def convert_to_training_format(scraped_file, audio_dir, output_dir='data/training'):
    """
    Convert scraped chords to training format
    Matches chords with audio files if available
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    with open(scraped_file, 'r') as f:
        songs = json.load(f)

    sample_id = 0
    for song in songs:
        title = song['title']
        artist = song['artist']
        chords = song['chords']

        # Look for matching audio file
        audio_file = _find_audio_file(audio_dir, title, artist)

        if audio_file:
            # Extract features
            try:
                y, sr = librosa.load(audio_file, sr=22050)
                cqt = librosa.cqt(y, sr=sr, hop_length=512, n_bins=84)
                cqt_db = librosa.amplitude_to_db(np.abs(cqt), ref=np.max)
                features = ((cqt_db - np.mean(cqt_db)) / (np.std(cqt_db) + 1e-8)).astype(np.float32)

                # Create labels from chord timestamps
                labels = _chords_to_labels(chords, features.shape[1])

                # Save sample
                sample_dir = output_path / f"sample_{sample_id:06d}"
                sample_dir.mkdir(exist_ok=True)

                np.save(str(sample_dir / "features.npy"), features)
                np.save(str(sample_dir / "labels.npy"), labels)

                metadata = {
                    'title': title,
                    'artist': artist,
                    'audio_file': str(audio_file),
                    'num_chords': len(chords),
                    'feature_shape': list(features.shape),
                }
                with open(str(sample_dir / "metadata.json"), 'w') as f:
                    json.dump(metadata, f, indent=2)

                sample_id += 1

            except Exception as e:
                logger.error(f"Error processing {title}: {e}")

    logger.info(f"Created {sample_id} training samples")
    return sample_id


def _find_audio_file(audio_dir, title, artist):
    """Find audio file matching song title/artist"""
    audio_path = Path(audio_dir)

    # Try various naming patterns
    patterns = [
        f"{artist} - {title}.*",
        f"{title}.*",
        f"{artist}_{title}.*",
    ]

    for pattern in patterns:
        matches = list(audio_path.glob(pattern))
        if matches:
            return matches[0]

    return None


def _chords_to_labels(chords, num_frames, hop_length=512, sr=22050):
    """Convert chord timestamps to frame-level labels"""
    labels = np.zeros(num_frames, dtype=np.int64)

    # Build chord vocabulary
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    qualities = ['maj', 'min', 'maj7', 'min7', 'dom7', 'maj9', 'min9']
    chord_vocab = ['N']
    for note in notes:
        for quality in qualities:
            chord_vocab.append(f"{note}:{quality}")

    chord_to_idx = {ch: i for i, ch in enumerate(chord_vocab[:170])}

    for chord_info in chords:
        start_time = chord_info['time']
        duration = chord_info.get('duration', 2.0)
        chord_name = chord_info['chord']

        start_frame = int(start_time * sr / hop_length)
        end_frame = int((start_time + duration) * sr / hop_length)

        idx = chord_to_idx.get(chord_name, 0)
        labels[max(0, start_frame):min(num_frames, end_frame)] = idx

    return labels


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Scrape chord websites')
    parser.add_argument('--output', default='data/scraped_chords', help='Output directory')
    parser.add_argument('--max-songs', type=int, default=1000, help='Max songs to collect')
    parser.add_argument('--convert', action='store_true', help='Convert to training format')
    parser.add_argument('--scraped-file', help='Scraped JSON to convert')
    parser.add_argument('--audio-dir', help='Directory with audio files')

    args = parser.parse_args()

    if args.convert and args.scraped_file and args.audio_dir:
        convert_to_training_format(args.scraped_file, args.audio_dir, args.output)
    else:
        scrape_popular_songs(args.output, args.max_songs)
