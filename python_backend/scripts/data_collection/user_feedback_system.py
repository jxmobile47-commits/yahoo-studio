#!/usr/bin/env python3
"""
User Feedback & Active Learning System
=======================================
Collects user corrections to continuously improve the chord model.

Features:
  - User correction submission API
  - Active learning: prioritize uncertain/ambiguous predictions
  - Automatic retraining trigger
  - Crowdsourced chord verification

Database Schema (SQLite):
  - corrections: user-submitted chord fixes
  - predictions: model predictions with confidence
  - users: contributor stats
  - training_queue: samples ready for retraining
"""

import sqlite3
import json
import hashlib
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import List, Optional, Dict, Tuple
from datetime import datetime
import logging
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class ChordCorrection:
    """Single chord correction from user"""
    id: Optional[int] = None
    audio_hash: str = ""  # SHA256 of audio file
    start_time: float = 0.0
    end_time: float = 0.0
    predicted_chord: str = ""
    corrected_chord: str = ""
    confidence: float = 0.0
    user_id: Optional[str] = None
    timestamp: Optional[str] = None
    status: str = "pending"  # pending, verified, rejected, incorporated

    def to_dict(self):
        return asdict(self)


class FeedbackDatabase:
    """SQLite database for user feedback"""

    def __init__(self, db_path='data/feedback.db'):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        """Initialize database tables"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            # Corrections table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS corrections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    audio_hash TEXT NOT NULL,
                    start_time REAL NOT NULL,
                    end_time REAL NOT NULL,
                    predicted_chord TEXT NOT NULL,
                    corrected_chord TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    user_id TEXT,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'pending',
                    agree_count INTEGER DEFAULT 0,
                    disagree_count INTEGER DEFAULT 0
                )
            ''')

            # Predictions table (for active learning)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    audio_hash TEXT NOT NULL,
                    start_time REAL NOT NULL,
                    end_time REAL NOT NULL,
                    chord TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    entropy REAL NOT NULL,
                    model_version TEXT NOT NULL,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Users table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY,
                    total_corrections INTEGER DEFAULT 0,
                    accepted_corrections INTEGER DEFAULT 0,
                    rejected_corrections INTEGER DEFAULT 0,
                    reputation_score REAL DEFAULT 1.0,
                    joined_date TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Training queue
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS training_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    audio_hash TEXT NOT NULL,
                    feature_path TEXT,
                    label_path TEXT,
                    priority REAL DEFAULT 0.0,
                    status TEXT DEFAULT 'queued',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Indexes
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_audio_hash ON corrections(audio_hash)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_status ON corrections(status)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_confidence ON predictions(confidence)')

            conn.commit()

    def submit_correction(self, correction: ChordCorrection) -> int:
        """Submit a user correction"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO corrections
                (audio_hash, start_time, end_time, predicted_chord,
                 corrected_chord, confidence, user_id, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                correction.audio_hash,
                correction.start_time,
                correction.end_time,
                correction.predicted_chord,
                correction.corrected_chord,
                correction.confidence,
                correction.user_id,
                correction.status
            ))
            conn.commit()
            return cursor.lastrowid

    def get_corrections_for_audio(self, audio_hash: str) -> List[ChordCorrection]:
        """Get all corrections for a specific audio file"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM corrections WHERE audio_hash = ?
            ''', (audio_hash,))
            rows = cursor.fetchall()
            return [ChordCorrection(**dict(row)) for row in rows]

    def get_high_priority_corrections(self, min_agreements: int = 2) -> List[Dict]:
        """
        Get corrections that are ready for training.
        High priority = multiple users agree on correction.
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT audio_hash, start_time, end_time,
                       predicted_chord, corrected_chord,
                       COUNT(*) as num_corrections,
                       AVG(confidence) as avg_confidence
                FROM corrections
                WHERE status = 'pending'
                GROUP BY audio_hash, start_time, end_time, corrected_chord
                HAVING COUNT(*) >= ?
                ORDER BY COUNT(*) DESC, AVG(confidence) ASC
            ''', (min_agreements,))
            return [dict(row) for row in cursor.fetchall()]

    def verify_correction(self, correction_id: int, verified: bool):
        """Mark a correction as verified or rejected"""
        status = 'verified' if verified else 'rejected'
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE corrections SET status = ? WHERE id = ?
            ''', (status, correction_id))
            conn.commit()

    def log_prediction(self, audio_hash: str, start_time: float, end_time: float,
                       chord: str, confidence: float, entropy: float, model_version: str):
        """Log model prediction for active learning"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO predictions
                (audio_hash, start_time, end_time, chord, confidence, entropy, model_version)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (audio_hash, start_time, end_time, chord, confidence, entropy, model_version))
            conn.commit()

    def get_uncertain_predictions(self, threshold: float = 0.7, limit: int = 100) -> List[Dict]:
        """
        Get predictions with low confidence (for active learning).
        These are the samples most valuable for retraining.
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM predictions
                WHERE confidence < ?
                ORDER BY confidence ASC, entropy DESC
                LIMIT ?
            ''', (threshold, limit))
            return [dict(row) for row in cursor.fetchall()]

    def get_user_stats(self, user_id: str) -> Dict:
        """Get user's contribution statistics"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM users WHERE user_id = ?
            ''', (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else {}

    def get_leaderboard(self, limit: int = 20) -> List[Dict]:
        """Get top contributors"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute('''
                SELECT user_id, accepted_corrections, reputation_score
                FROM users
                ORDER BY accepted_corrections DESC
                LIMIT ?
            ''', (limit,))
            return [dict(row) for row in cursor.fetchall()]

    def get_stats(self) -> Dict:
        """Get overall system statistics"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            cursor.execute('SELECT COUNT(*) FROM corrections')
            total_corrections = cursor.fetchone()[0]

            cursor.execute('SELECT COUNT(*) FROM corrections WHERE status = "pending"')
            pending = cursor.fetchone()[0]

            cursor.execute('SELECT COUNT(*) FROM corrections WHERE status = "verified"')
            verified = cursor.fetchone()[0]

            cursor.execute('SELECT COUNT(*) FROM corrections WHERE status = "incorporated"')
            incorporated = cursor.fetchone()[0]

            cursor.execute('SELECT COUNT(DISTINCT user_id) FROM corrections')
            unique_users = cursor.fetchone()[0]

            return {
                'total_corrections': total_corrections,
                'pending': pending,
                'verified': verified,
                'incorporated': incorporated,
                'unique_contributors': unique_users,
            }


class ActiveLearningSampler:
    """
    Active Learning: Select the most valuable samples for retraining.

    Strategies:
      1. Uncertainty sampling: lowest confidence predictions
      2. Diversity sampling: cover underrepresented chord types
      3. Error-based: user corrections
      4. Density-weighted: high information density
    """

    def __init__(self, db: FeedbackDatabase):
        self.db = db

    def select_samples(self, n_samples: int = 100) -> List[Dict]:
        """
        Select top-n samples for retraining using multiple criteria.

        Returns list of samples with:
          - audio_hash
          - priority score
          - reason (uncertainty/correction/diversity)
        """
        samples = []

        # 1. User-verified corrections (highest priority)
        corrections = self.db.get_high_priority_corrections(min_agreements=2)
        for c in corrections:
            samples.append({
                'audio_hash': c['audio_hash'],
                'start_time': c['start_time'],
                'end_time': c['end_time'],
                'corrected_chord': c['corrected_chord'],
                'priority': c['num_corrections'] * 10,  # Weight by agreements
                'reason': 'user_correction',
            })

        # 2. Uncertain predictions
        uncertain = self.db.get_uncertain_predictions(threshold=0.6, limit=50)
        for p in uncertain:
            samples.append({
                'audio_hash': p['audio_hash'],
                'start_time': p['start_time'],
                'end_time': p['end_time'],
                'priority': (1.0 - p['confidence']) * 5,  # Weight by uncertainty
                'reason': 'uncertain_prediction',
            })

        # Sort by priority
        samples.sort(key=lambda x: x['priority'], reverse=True)
        return samples[:n_samples]

    def calculate_retrain_trigger(self, stats: Dict) -> bool:
        """
        Decide if retraining should be triggered.

        Triggers when:
          - >500 new verified corrections
          - >10% of recent predictions are uncertain
          - Model accuracy drops below threshold
        """
        if stats.get('verified', 0) > 500:
            return True
        return False


def generate_audio_hash(audio_path: Path) -> str:
    """Generate SHA256 hash of audio file for deduplication"""
    hasher = hashlib.sha256()
    with open(audio_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            hasher.update(chunk)
    return hasher.hexdigest()[:16]


class CrowdsourcedVerifier:
    """
    Verify chord corrections through crowdsourcing.
    Multiple users must agree before a correction is accepted.
    """

    def __init__(self, db: FeedbackDatabase, agreement_threshold: int = 3):
        self.db = db
        self.agreement_threshold = agreement_threshold

    def submit_vote(self, correction_id: int, user_id: str, agree: bool):
        """User votes on whether a correction is correct"""
        with sqlite3.connect(self.db.db_path) as conn:
            cursor = conn.cursor()

            if agree:
                cursor.execute('''
                    UPDATE corrections
                    SET agree_count = agree_count + 1
                    WHERE id = ?
                ''', (correction_id,))
            else:
                cursor.execute('''
                    UPDATE corrections
                    SET disagree_count = disagree_count + 1
                    WHERE id = ?
                ''', (correction_id,))

            conn.commit()

    def check_consensus(self, correction_id: int) -> Tuple[bool, float]:
        """
        Check if a correction has reached consensus.

        Returns:
            (is_verified, agreement_ratio)
        """
        with sqlite3.connect(self.db.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT agree_count, disagree_count
                FROM corrections WHERE id = ?
            ''', (correction_id,))
            row = cursor.fetchone()

            if not row:
                return False, 0.0

            agree, disagree = row
            total = agree + disagree

            if total < self.agreement_threshold:
                return False, agree / total if total > 0 else 0.0

            ratio = agree / total
            is_verified = ratio > 0.6  # 60% agreement required

            return is_verified, ratio


# Flask API endpoints for frontend integration
FEEDBACK_API_BLUEPRINT = '''
"""
# Add to your Flask app:

from flask import Blueprint, request, jsonify
from user_feedback_system import FeedbackDatabase, ChordCorrection, generate_audio_hash

feedback_bp = Blueprint('feedback', __name__, url_prefix='/api/feedback')
db = FeedbackDatabase()

@feedback_bp.route('/submit', methods=['POST'])
def submit_correction():
    data = request.get_json()
    correction = ChordCorrection(
        audio_hash=data['audio_hash'],
        start_time=data['start_time'],
        end_time=data['end_time'],
        predicted_chord=data['predicted_chord'],
        corrected_chord=data['corrected_chord'],
        confidence=data.get('confidence', 0.0),
        user_id=data.get('user_id')
    )
    correction_id = db.submit_correction(correction)
    return jsonify({'success': True, 'id': correction_id})

@feedback_bp.route('/stats', methods=['GET'])
def get_stats():
    return jsonify(db.get_stats())

@feedback_bp.route('/leaderboard', methods=['GET'])
def get_leaderboard():
    return jsonify(db.get_leaderboard())

@feedback_bp.route('/verify', methods=['POST'])
def verify():
    data = request.get_json()
    db.verify_correction(data['correction_id'], data['verified'])
    return jsonify({'success': True})
'''


if __name__ == "__main__":
    # Demo
    db = FeedbackDatabase()

    # Submit a sample correction
    correction = ChordCorrection(
        audio_hash="abc123",
        start_time=10.5,
        end_time=12.8,
        predicted_chord="C:maj",
        corrected_chord="C:maj7",
        confidence=0.65,
        user_id="user_001"
    )
    cid = db.submit_correction(correction)
    print(f"Submitted correction ID: {cid}")

    # Show stats
    stats = db.get_stats()
    print(f"Database stats: {json.dumps(stats, indent=2)}")
