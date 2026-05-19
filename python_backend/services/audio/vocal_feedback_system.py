#!/usr/bin/env python3
"""
Vocal Synthesis Feedback & Active Learning System
====================================================
Human-in-the-loop learning for Vocal Synth — like ChordNet-2026 but for vocals.

Features:
  - User pitch corrections ("this note should be higher")
  - Correction style ratings (too aggressive / too subtle / perfect)
  - Vocal character preferences (breathy, bright, warm, etc.)
  - Active learning: prioritize uncertain / disliked corrections for retraining
  - Auto-retrain when enough feedback accumulates
  - A/B model comparison

Tables:
  - pitch_corrections: User manual corrections to auto-tuned notes
  - correction_ratings: Thumbs up/down on pitch correction
  - user_preferences: Per-user vocal style preferences
  - model_performance: Accuracy tracking over time
  - active_learning_queue: Samples prioritized for retraining
"""

import sqlite3
import json
import numpy as np
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = Path(__file__).parent.parent.parent / "data" / "vocal_feedback.db"


@dataclass
class PitchCorrection:
    id: int
    user_id: str
    session_id: str
    original_midi: float
    corrected_midi: float
    user_target_midi: float
    scale: str
    note_name: str
    timestamp: str
    audio_hash: Optional[str] = None


@dataclass
class CorrectionRating:
    id: int
    user_id: str
    correction_id: int
    rating: int  # -1 (too aggressive), 0 (ok), +1 (too subtle), +2 (perfect)
    comment: str
    timestamp: str


@dataclass
class UserPreference:
    user_id: str
    correction_strength: float = 0.8
    preferred_scale: str = 'C major'
    vocal_character: str = 'neutral'  # neutral, breathy, bright, warm, nasal
    vibrato_amount: float = 0.5
    formant_shift: float = 1.0
    auto_harmony: bool = True
    harmony_type: str = '3rd'
    created_at: str = ''
    updated_at: str = ''


class VocalFeedbackDatabase:
    """
    SQLite database for vocal synthesis feedback.
    Learns from user corrections to improve pitch correction over time.
    """

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = Path(db_path) if db_path else DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """Initialize all tables"""
        conn = self._get_conn()
        cursor = conn.cursor()

        # Pitch corrections: user manually fixed auto-tuned note
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS pitch_corrections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                original_midi REAL NOT NULL,
                corrected_midi REAL NOT NULL,
                user_target_midi REAL NOT NULL,
                correction_error_cents REAL NOT NULL,
                scale TEXT NOT NULL,
                note_name TEXT,
                confidence REAL,
                audio_hash TEXT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Correction ratings: user rates auto-correction quality
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS correction_ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                original_midi REAL,
                corrected_midi REAL,
                target_scale TEXT,
                rating INTEGER NOT NULL,  -- -1=too aggressive, 0=ok, 1=too subtle, 2=perfect
                comment TEXT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # User preferences: learned vocal style per user
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_preferences (
                user_id TEXT PRIMARY KEY,
                correction_strength REAL DEFAULT 0.8,
                preferred_scale TEXT DEFAULT 'C major',
                vocal_character TEXT DEFAULT 'neutral',
                vibrato_amount REAL DEFAULT 0.5,
                formant_shift REAL DEFAULT 1.0,
                auto_harmony INTEGER DEFAULT 1,
                harmony_type TEXT DEFAULT '3rd',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Model performance: track accuracy over time
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS model_performance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_version TEXT NOT NULL,
                test_date TEXT DEFAULT CURRENT_TIMESTAMP,
                mean_error_cents REAL,
                notes_in_scale_percent REAL,
                user_satisfaction REAL,  -- average rating
                total_corrections INTEGER,
                total_ratings INTEGER,
                accuracy_trend TEXT  -- improving, stable, declining
            )
        ''')

        # Active learning queue: samples prioritized for retraining
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS active_learning_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                original_midi REAL,
                corrected_midi REAL,
                user_target_midi REAL,
                uncertainty_score REAL NOT NULL,  -- model confidence
                priority_score REAL NOT NULL,     -- combined: error * uncertainty
                status TEXT DEFAULT 'pending',    -- pending, used, discarded
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # A/B test results
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ab_tests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_name TEXT NOT NULL,
                model_a_version TEXT,
                model_b_version TEXT,
                user_id TEXT,
                chosen_model TEXT,  -- A or B
                rating INTEGER,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Scale popularity: which scales users prefer
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS scale_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scale TEXT NOT NULL,
                usage_count INTEGER DEFAULT 1,
                avg_satisfaction REAL,
                last_used TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        conn.commit()
        conn.close()
        logger.info("Vocal feedback database initialized")

    # ============== PITCH CORRECTIONS ==============

    def log_pitch_correction(
        self,
        user_id: str,
        session_id: str,
        original_midi: float,
        corrected_midi: float,
        user_target_midi: float,
        scale: str,
        note_name: str = '',
        confidence: float = 0.0,
        audio_hash: Optional[str] = None,
    ) -> int:
        """
        Log when user manually corrects an auto-tuned note.
        This is the most valuable training signal.
        """
        error_cents = (corrected_midi - user_target_midi) * 100

        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO pitch_corrections
            (user_id, session_id, original_midi, corrected_midi, user_target_midi,
             correction_error_cents, scale, note_name, confidence, audio_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, session_id, original_midi, corrected_midi, user_target_midi,
              error_cents, scale, note_name, confidence, audio_hash))
        correction_id = cursor.lastrowid
        conn.commit()
        conn.close()

        # Add to active learning queue
        uncertainty = abs(error_cents) / 100  # Higher error = more uncertain
        priority = uncertainty * (1 + confidence)
        self._add_to_learning_queue(
            user_id, session_id, original_midi, corrected_midi,
            user_target_midi, uncertainty, priority
        )

        logger.info(f"Pitch correction logged: {note_name} error={error_cents:.1f}cents")
        return correction_id

    def get_correction_stats(self, user_id: Optional[str] = None) -> Dict:
        """Get correction statistics for analysis"""
        conn = self._get_conn()
        cursor = conn.cursor()

        if user_id:
            cursor.execute('''
                SELECT COUNT(*) as count,
                       AVG(ABS(correction_error_cents)) as mean_abs_error,
                       AVG(correction_error_cents) as mean_error,
                       scale
                FROM pitch_corrections
                WHERE user_id = ?
                GROUP BY scale
            ''', (user_id,))
        else:
            cursor.execute('''
                SELECT COUNT(*) as count,
                       AVG(ABS(correction_error_cents)) as mean_abs_error,
                       AVG(correction_error_cents) as mean_error,
                       scale
                FROM pitch_corrections
                GROUP BY scale
            ''')

        rows = cursor.fetchall()
        conn.close()

        return {
            'total_corrections': sum(r['count'] for r in rows),
            'mean_abs_error_cents': rows[0]['mean_abs_error'] if rows else 0,
            'by_scale': {r['scale']: {'count': r['count'], 'error': r['mean_abs_error']} for r in rows},
        }

    # ============== CORRECTION RATINGS ==============

    def rate_correction(
        self,
        user_id: str,
        session_id: str,
        rating: int,  # -1, 0, 1, 2
        original_midi: Optional[float] = None,
        corrected_midi: Optional[float] = None,
        target_scale: str = '',
        comment: str = '',
    ) -> int:
        """
        User rates the quality of auto-correction.
        -1: Too aggressive (over-corrected)
         0: OK but not great
         1: Too subtle (under-corrected)
         2: Perfect!
        """
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO correction_ratings
            (user_id, session_id, original_midi, corrected_midi, target_scale, rating, comment)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, session_id, original_midi, corrected_midi, target_scale, rating, comment))
        rating_id = cursor.lastrowid
        conn.commit()
        conn.close()

        # Update user preference based on rating pattern
        self._update_preference_from_rating(user_id, rating)

        logger.info(f"Correction rated: {rating} by {user_id}")
        return rating_id

    def get_rating_stats(self, user_id: Optional[str] = None) -> Dict:
        """Get rating distribution"""
        conn = self._get_conn()
        cursor = conn.cursor()

        if user_id:
            cursor.execute('''
                SELECT rating, COUNT(*) as count
                FROM correction_ratings
                WHERE user_id = ?
                GROUP BY rating
            ''', (user_id,))
        else:
            cursor.execute('''
                SELECT rating, COUNT(*) as count
                FROM correction_ratings
                GROUP BY rating
            ''')

        rows = cursor.fetchall()
        conn.close()

        distribution = {-1: 0, 0: 0, 1: 0, 2: 0}
        for r in rows:
            distribution[r['rating']] = r['count']

        total = sum(distribution.values())
        satisfaction = (distribution[2] * 2 + distribution[1] * 1 + distribution[0] * 0 + distribution[-1] * -1) / max(total, 1)

        return {
            'distribution': distribution,
            'total_ratings': total,
            'satisfaction_score': satisfaction,
            'satisfaction_percent': (satisfaction + 1) / 3 * 100,
        }

    # ============== USER PREFERENCES ==============

    def get_user_preferences(self, user_id: str) -> UserPreference:
        """Get or create user preferences"""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM user_preferences WHERE user_id = ?', (user_id,))
        row = cursor.fetchone()
        conn.close()

        if row:
            return UserPreference(
                user_id=row['user_id'],
                correction_strength=row['correction_strength'],
                preferred_scale=row['preferred_scale'],
                vocal_character=row['vocal_character'],
                vibrato_amount=row['vibrato_amount'],
                formant_shift=row['formant_shift'],
                auto_harmony=bool(row['auto_harmony']),
                harmony_type=row['harmony_type'],
                created_at=row['created_at'],
                updated_at=row['updated_at'],
            )

        # Create default preferences
        return self._create_default_preferences(user_id)

    def update_preferences(self, user_id: str, **kwargs) -> UserPreference:
        """Update user preferences"""
        allowed = ['correction_strength', 'preferred_scale', 'vocal_character',
                   'vibrato_amount', 'formant_shift', 'auto_harmony', 'harmony_type']
        updates = {k: v for k, v in kwargs.items() if k in allowed}

        if not updates:
            return self.get_user_preferences(user_id)

        conn = self._get_conn()
        cursor = conn.cursor()

        # Ensure user exists
        cursor.execute('SELECT 1 FROM user_preferences WHERE user_id = ?', (user_id,))
        if not cursor.fetchone():
            self._create_default_preferences(user_id)

        set_clause = ', '.join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [user_id]
        cursor.execute(f'''
            UPDATE user_preferences
            SET {set_clause}, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        ''', values)
        conn.commit()
        conn.close()

        return self.get_user_preferences(user_id)

    def _create_default_preferences(self, user_id: str) -> UserPreference:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR IGNORE INTO user_preferences (user_id)
            VALUES (?)
        ''', (user_id,))
        conn.commit()
        conn.close()
        return UserPreference(user_id=user_id)

    def _update_preference_from_rating(self, user_id: str, rating: int):
        """
        Auto-adjust correction strength based on ratings.
        - Too aggressive (-1): decrease strength
        - Too subtle (1): increase strength
        """
        prefs = self.get_user_preferences(user_id)
        current = prefs.correction_strength

        if rating == -1:  # Too aggressive
            new_strength = max(0.3, current - 0.05)
        elif rating == 1:  # Too subtle
            new_strength = min(1.0, current + 0.05)
        else:
            return

        self.update_preferences(user_id, correction_strength=round(new_strength, 2))
        logger.info(f"Auto-adjusted correction strength for {user_id}: {current:.2f} → {new_strength:.2f}")

    # ============== ACTIVE LEARNING ==============

    def _add_to_learning_queue(
        self, user_id: str, session_id: str,
        original_midi: float, corrected_midi: float,
        user_target_midi: float, uncertainty: float, priority: float
    ):
        """Add sample to active learning queue"""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO active_learning_queue
            (user_id, session_id, original_midi, corrected_midi, user_target_midi,
             uncertainty_score, priority_score)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, session_id, original_midi, corrected_midi, user_target_midi,
              uncertainty, priority))
        conn.commit()
        conn.close()

    def get_learning_samples(self, n: int = 100) -> List[Dict]:
        """
        Get top-priority samples for retraining.
        Prioritizes: high error + high uncertainty + user corrections.
        """
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT * FROM active_learning_queue
            WHERE status = 'pending'
            ORDER BY priority_score DESC
            LIMIT ?
        ''', (n,))
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return rows

    def mark_samples_used(self, sample_ids: List[int]):
        """Mark samples as used for training"""
        conn = self._get_conn()
        cursor = conn.cursor()
        placeholders = ','.join('?' * len(sample_ids))
        cursor.execute(f'''
            UPDATE active_learning_queue
            SET status = 'used'
            WHERE id IN ({placeholders})
        ''', sample_ids)
        conn.commit()
        conn.close()

    # ============== MODEL PERFORMANCE ==============

    def log_model_performance(
        self,
        model_version: str,
        mean_error_cents: float,
        notes_in_scale_percent: float,
        user_satisfaction: float,
        total_corrections: int,
        total_ratings: int,
    ):
        """Log model performance metrics"""
        conn = self._get_conn()
        cursor = conn.cursor()

        # Determine trend
        cursor.execute('''
            SELECT user_satisfaction FROM model_performance
            WHERE model_version = ?
            ORDER BY test_date DESC
            LIMIT 1
        ''', (model_version,))
        prev = cursor.fetchone()

        if prev:
            diff = user_satisfaction - prev['user_satisfaction']
            if diff > 0.05:
                trend = 'improving'
            elif diff < -0.05:
                trend = 'declining'
            else:
                trend = 'stable'
        else:
            trend = 'new'

        cursor.execute('''
            INSERT INTO model_performance
            (model_version, mean_error_cents, notes_in_scale_percent,
             user_satisfaction, total_corrections, total_ratings, accuracy_trend)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (model_version, mean_error_cents, notes_in_scale_percent,
              user_satisfaction, total_corrections, total_ratings, trend))
        conn.commit()
        conn.close()

    def get_performance_history(self, model_version: Optional[str] = None) -> List[Dict]:
        """Get performance history"""
        conn = self._get_conn()
        cursor = conn.cursor()

        if model_version:
            cursor.execute('''
                SELECT * FROM model_performance
                WHERE model_version = ?
                ORDER BY test_date DESC
            ''', (model_version,))
        else:
            cursor.execute('''
                SELECT * FROM model_performance
                ORDER BY test_date DESC
                LIMIT 50
            ''')

        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return rows

    # ============== SCALE ANALYTICS ==============

    def log_scale_usage(self, scale: str, satisfaction: Optional[float] = None):
        """Track which scales users prefer"""
        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO scale_usage (scale, usage_count, avg_satisfaction)
            VALUES (?, 1, ?)
            ON CONFLICT(scale) DO UPDATE SET
                usage_count = usage_count + 1,
                avg_satisfaction = (avg_satisfaction * usage_count + excluded.avg_satisfaction) / (usage_count + 1),
                last_used = CURRENT_TIMESTAMP
        ''', (scale, satisfaction or 0.5))

        conn.commit()
        conn.close()

    def get_popular_scales(self, limit: int = 10) -> List[Dict]:
        """Get most-used scales"""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT scale, usage_count, avg_satisfaction
            FROM scale_usage
            ORDER BY usage_count DESC
            LIMIT ?
        ''', (limit,))
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return rows

    # ============== AUTO-RETRAIN TRIGGERS ==============

    def should_retrain(self, min_corrections: int = 50, min_ratings: int = 20) -> Tuple[bool, Dict]:
        """
        Check if enough feedback has accumulated to trigger retraining.

        Returns:
            (should_retrain, stats)
        """
        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute('SELECT COUNT(*) as count FROM pitch_corrections')
        correction_count = cursor.fetchone()['count']

        cursor.execute('SELECT COUNT(*) as count FROM correction_ratings')
        rating_count = cursor.fetchone()['count']

        cursor.execute("SELECT COUNT(*) as count FROM active_learning_queue WHERE status = 'pending'")
        pending_samples = cursor.fetchone()['count']

        cursor.execute('''
            SELECT AVG(rating) as avg_rating
            FROM correction_ratings
            WHERE timestamp > datetime('now', '-7 days')
        ''')
        recent_rating = cursor.fetchone()['avg_rating'] or 0

        conn.close()

        stats = {
            'total_corrections': correction_count,
            'total_ratings': rating_count,
            'pending_samples': pending_samples,
            'recent_avg_rating': recent_rating,
            'min_corrections': min_corrections,
            'min_ratings': min_ratings,
        }

        should = correction_count >= min_corrections and rating_count >= min_ratings
        return should, stats

    def get_all_feedback_summary(self) -> Dict:
        """Get complete feedback summary for dashboard"""
        return {
            'corrections': self.get_correction_stats(),
            'ratings': self.get_rating_stats(),
            'popular_scales': self.get_popular_scales(),
            'performance': self.get_performance_history()[:5],
            'learning_queue_size': len(self.get_learning_samples(1000)),
        }


if __name__ == "__main__":
    # Demo
    db = VocalFeedbackDatabase()

    # Simulate user feedback
    db.log_pitch_correction(
        user_id="user_001",
        session_id="sess_123",
        original_midi=60.3,
        corrected_midi=60.0,
        user_target_midi=61.0,
        scale="C major",
        note_name="C#4",
    )

    db.rate_correction(
        user_id="user_001",
        session_id="sess_123",
        rating=-1,
        target_scale="C major",
        comment="Too aggressive, should have kept it closer to original",
    )

    prefs = db.get_user_preferences("user_001")
    print(f"User preference correction strength: {prefs.correction_strength}")

    should, stats = db.should_retrain(min_corrections=1, min_ratings=1)
    print(f"Should retrain: {should}")
    print(json.dumps(stats, indent=2))
