'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CorrectionRating {
  rating: number;
  label: string;
  emoji: string;
  color: string;
}

const RATINGS: CorrectionRating[] = [
  { rating: -1, label: 'Too Aggressive', emoji: '🔴', color: 'text-red-400 bg-red-900/30 border-red-700' },
  { rating: 0, label: 'OK', emoji: '🟡', color: 'text-yellow-400 bg-yellow-900/30 border-yellow-700' },
  { rating: 1, label: 'Too Subtle', emoji: '🟠', color: 'text-orange-400 bg-orange-900/30 border-orange-700' },
  { rating: 2, label: 'Perfect!', emoji: '🟢', color: 'text-green-400 bg-green-900/30 border-green-700' },
];

interface VocalFeedbackPanelProps {
  currentNote?: string | null;
  originalMidi?: number | null;
  correctedMidi?: number | null;
  scale?: string;
  sessionId?: string;
  onFeedbackSubmitted?: () => void;
}

export default function VocalFeedbackPanel({
  currentNote,
  originalMidi,
  correctedMidi,
  scale = 'C major',
  sessionId = 'default',
  onFeedbackSubmitted,
}: VocalFeedbackPanelProps) {
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showManualAdjust, setShowManualAdjust] = useState(false);
  const [manualTarget, setManualTarget] = useState(correctedMidi || 0);
  const [stats, setStats] = useState<any>(null);
  const [prefs, setPrefs] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Load user preferences
  useEffect(() => {
    fetch('/api/vocal/preferences')
      .then(r => r.json())
      .then(data => {
        if (data.success) setPrefs(data.preferences);
      })
      .catch(() => {});
  }, []);

  const submitRating = useCallback(async (rating: number) => {
    if (!originalMidi || !correctedMidi) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/vocal/feedback/rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          rating,
          original_midi: originalMidi,
          corrected_midi: correctedMidi,
          target_scale: scale,
          comment,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
        setSelectedRating(rating);
        if (data.auto_adjusted_strength) {
          setPrefs((p: any) => ({ ...p, correction_strength: data.auto_adjusted_strength }));
        }
        onFeedbackSubmitted?.();
        setTimeout(() => { setSubmitted(false); setComment(''); }, 3000);
      }
    } catch (e) {
      console.error('Rating submit failed:', e);
    } finally {
      setSubmitting(false);
    }
  }, [originalMidi, correctedMidi, scale, sessionId, comment, onFeedbackSubmitted]);

  const submitManualCorrection = useCallback(async () => {
    if (!originalMidi || manualTarget === undefined) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/vocal/feedback/correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          original_midi: originalMidi,
          corrected_midi: correctedMidi,
          user_target_midi: manualTarget,
          scale,
          note_name: currentNote || '',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
        setShowManualAdjust(false);
        onFeedbackSubmitted?.();
        setTimeout(() => setSubmitted(false), 3000);
      }
    } catch (e) {
      console.error('Correction submit failed:', e);
    } finally {
      setSubmitting(false);
    }
  }, [originalMidi, correctedMidi, manualTarget, scale, sessionId, currentNote, onFeedbackSubmitted]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vocal/stats');
      const data = await res.json();
      if (data.success) setStats(data);
    } catch (e) {
      console.error('Stats load failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-3">
      {/* Feedback prompt */}
      <div className="p-3 bg-gray-800 rounded-xl border border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400 uppercase tracking-wide">
            How was the correction?
          </span>
          {prefs && (
            <span className="text-[10px] text-gray-500">
              Strength: {Math.round(prefs.correction_strength * 100)}%
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          {RATINGS.map((r) => (
            <button
              key={r.rating}
              onClick={() => submitRating(r.rating)}
              disabled={submitting}
              className={`p-2 rounded-lg border text-xs font-medium transition-all ${
                selectedRating === r.rating
                  ? r.color + ' ring-1 ring-white/20'
                  : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:bg-gray-700'
              } disabled:opacity-50`}
            >
              <span className="mr-1">{r.emoji}</span>
              {r.label}
            </button>
          ))}
        </div>

        {/* Comment */}
        <input
          type="text"
          placeholder="Optional comment..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full px-3 py-1.5 text-xs rounded-lg bg-gray-700 border border-gray-600 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-pink-500"
        />

        {/* Manual correction */}
        <button
          onClick={() => { setShowManualAdjust(!showManualAdjust); setManualTarget(correctedMidi || 0); }}
          className="mt-2 text-[10px] text-gray-500 hover:text-pink-400 underline"
        >
          {showManualAdjust ? 'Cancel manual adjust' : 'Manually adjust this note'}
        </button>

        <AnimatePresence>
          {showManualAdjust && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-2 space-y-2 overflow-hidden"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-16">Original:</span>
                <span className="text-xs font-mono text-gray-300">{originalMidi?.toFixed(1)} MIDI</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-16">Corrected:</span>
                <span className="text-xs font-mono text-pink-400">{correctedMidi?.toFixed(1)} MIDI</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-16">Target:</span>
                <input
                  type="number"
                  step={0.1}
                  value={manualTarget}
                  onChange={(e) => setManualTarget(Number(e.target.value))}
                  className="w-24 px-2 py-1 text-xs rounded bg-gray-700 border border-gray-600 text-white"
                />
                <span className="text-[10px] text-gray-500">MIDI</span>
              </div>
              <button
                onClick={submitManualCorrection}
                disabled={submitting}
                className="px-3 py-1 text-xs rounded bg-pink-600 text-white hover:bg-pink-500 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Correction'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success message */}
        <AnimatePresence>
          {submitted && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-2 p-2 bg-green-900/30 border border-green-700 rounded-lg text-xs text-green-400 text-center"
            >
              ✅ Feedback saved! AI is learning from your input.
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Stats button */}
      <button
        onClick={loadStats}
        className="w-full px-3 py-2 text-xs rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors flex items-center justify-center gap-2"
      >
        📊 {loading ? 'Loading...' : 'View My Stats'}
      </button>

      {/* Stats display */}
      <AnimatePresence>
        {stats && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 bg-gray-800 rounded-xl border border-gray-700 space-y-3">
              <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
                Your Feedback History
              </div>

              {/* Rating distribution */}
              {stats.ratings && (
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Rating Distribution</div>
                  <div className="flex gap-1 h-16 items-end">
                    {Object.entries(stats.ratings.distribution || {}).map(([rating, count]) => {
                      const r = Number(rating);
                      const maxCount = Math.max(...Object.values(stats.ratings.distribution || {}).map((v: unknown) => Number(v)));
                      const height = maxCount > 0 ? (count as number / maxCount) * 100 : 0;
                      const colors: Record<number, string> = {
                        [-1]: 'bg-red-500',
                        0: 'bg-yellow-500',
                        1: 'bg-orange-500',
                        2: 'bg-green-500',
                      };
                      return (
                        <div key={rating} className="flex-1 flex flex-col items-center gap-1">
                          <div
                            className={`w-full ${colors[r] || 'bg-gray-500'} rounded-t transition-all`}
                            style={{ height: `${Math.max(height, 5)}%` }}
                          />
                          <span className="text-[9px] text-gray-500">{count as number}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-xs text-center text-gray-400 mt-1">
                    Satisfaction: {stats.ratings.satisfaction_percent?.toFixed(0)}%
                  </div>
                </div>
              )}

              {/* Correction stats */}
              {stats.corrections && (
                <div className="text-xs text-gray-400">
                  <div>Total corrections: {stats.corrections.total_corrections}</div>
                  <div>Mean error: {stats.corrections.mean_abs_error_cents?.toFixed(1)} cents</div>
                </div>
              )}

              {/* Popular scales */}
              {stats.popular_scales && stats.popular_scales.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Popular Scales</div>
                  <div className="flex flex-wrap gap-1">
                    {stats.popular_scales.slice(0, 5).map((s: any) => (
                      <span key={s.scale} className="px-2 py-0.5 text-[10px] rounded bg-gray-700 text-gray-300">
                        {s.scale} ({s.usage_count})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auto-retrain status */}
      <AutoRetrainStatus />
    </div>
  );
}

function AutoRetrainStatus() {
  const [status, setStatus] = useState<any>(null);
  const [retraining, setRetraining] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/vocal/retrain-status');
      const data = await res.json();
      if (data.success) setStatus(data);
    } catch (e) {
      console.error('Retrain status failed:', e);
    }
  }, []);

  const triggerRetrain = useCallback(async () => {
    setRetraining(true);
    try {
      const res = await fetch('/api/vocal/trigger-retrain', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(`Retraining complete! New version: ${data.report?.version}\nImprovement: ${data.report?.evaluation?.improvement_percent?.toFixed(1)}%`);
        checkStatus();
      }
    } catch (e) {
      console.error('Retrain trigger failed:', e);
    } finally {
      setRetraining(false);
    }
  }, [checkStatus]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  if (!status) return null;

  const progress = Math.min(
    100,
    ((status.stats?.total_corrections || 0) / status.stats?.min_corrections) * 50 +
    ((status.stats?.total_ratings || 0) / status.stats?.min_ratings) * 50
  );

  return (
    <div className="p-3 bg-gray-800 rounded-xl border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 uppercase tracking-wide">
          🤖 AI Learning Progress
        </span>
        <span className="text-[10px] text-gray-500">
          v{status.current_version}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
        <motion.div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      <div className="text-[10px] text-gray-500 mb-2">
        Corrections: {status.stats?.total_corrections || 0} / {status.stats?.min_corrections || 50} |
        Ratings: {status.stats?.total_ratings || 0} / {status.stats?.min_ratings || 20}
      </div>

      {status.should_retrain ? (
        <button
          onClick={triggerRetrain}
          disabled={retraining}
          className="w-full px-3 py-2 text-xs rounded-lg bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 animate-pulse"
        >
          {retraining ? '🔄 Training...' : '🚀 Retrain AI Model'}
        </button>
      ) : (
        <div className="text-[10px] text-gray-500 text-center">
          {progress < 100
            ? `Need more feedback to retrain (${Math.round(progress)}%)`
            : 'Ready to retrain!'
          }
        </div>
      )}
    </div>
  );
}
