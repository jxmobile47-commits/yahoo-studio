'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiDownload, FiMusic, FiZap, FiCheckCircle, FiClock, FiDatabase } from 'react-icons/fi';

export type ProcessingStage =
  | 'idle'
  | 'cache-check'
  | 'downloading'
  | 'extracting'
  | 'beat-detection'
  | 'chord-recognition'
  | 'complete';

interface SmartProgressBannerProps {
  stage: ProcessingStage;
  isFromCache?: boolean;
  fileSizeMB?: number;
  durationSeconds?: number;
}

const STAGES: { id: ProcessingStage; label: string; icon: React.ReactNode; etaSeconds: number }[] = [
  { id: 'cache-check', label: 'Checking cache', icon: <FiDatabase className="w-4 h-4" />, etaSeconds: 1 },
  { id: 'downloading', label: 'Downloading audio', icon: <FiDownload className="w-4 h-4" />, etaSeconds: 15 },
  { id: 'extracting', label: 'Extracting audio', icon: <FiMusic className="w-4 h-4" />, etaSeconds: 5 },
  { id: 'beat-detection', label: 'Detecting beats', icon: <FiZap className="w-4 h-4" />, etaSeconds: 20 },
  { id: 'chord-recognition', label: 'Recognizing chords', icon: <FiMusic className="w-4 h-4" />, etaSeconds: 30 },
  { id: 'complete', label: 'Complete', icon: <FiCheckCircle className="w-4 h-4" />, etaSeconds: 0 },
];

export default function SmartProgressBanner({
  stage,
  isFromCache,
  fileSizeMB,
  durationSeconds,
}: SmartProgressBannerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (stage === 'idle' || stage === 'complete') {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(interval);
  }, [stage]);

  if (stage === 'idle') return null;

  if (isFromCache) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 p-4 mb-4"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-100 dark:bg-green-800/40">
            <FiZap className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-900 dark:text-green-100">
              ⚡ Loaded from cache — Instant!
            </p>
            <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">
              This song was previously analyzed by another user
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  const currentIdx = STAGES.findIndex(s => s.id === stage);
  if (currentIdx < 0) return null;

  const currentStage = STAGES[currentIdx];
  if (!currentStage) return null;

  // Total ETA from current stage to completion
  const remainingEta = STAGES.slice(currentIdx).reduce((sum, s) => sum + s.etaSeconds, 0);
  const totalEta = STAGES.reduce((sum, s) => sum + s.etaSeconds, 0);
  const overallProgress = Math.min(100, (elapsed / totalEta) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 p-4 mb-4 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-800/40 text-blue-600 dark:text-blue-400">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}>
            {currentStage.icon}
          </motion.div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
            {currentStage.label}...
          </p>
          <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <FiClock className="w-3 h-3" />
              {elapsed}s elapsed
            </span>
            <span>~{remainingEta}s remaining</span>
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-blue-200 dark:bg-blue-900/40 overflow-hidden mb-3">
        <motion.div
          className="h-full bg-gradient-to-r from-blue-500 to-cyan-400"
          initial={{ width: 0 }}
          animate={{ width: `${overallProgress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Stage pills */}
      <div className="flex flex-wrap gap-1.5">
        {STAGES.filter(s => s.id !== 'complete' && s.id !== 'cache-check').map((s, i) => {
          const stageIdx = STAGES.findIndex(x => x.id === s.id);
          const status =
            stageIdx < currentIdx ? 'done' :
            stageIdx === currentIdx ? 'active' : 'pending';
          return (
            <div
              key={s.id}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
                status === 'done'
                  ? 'bg-green-200 dark:bg-green-800/50 text-green-800 dark:text-green-200'
                  : status === 'active'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {status === 'done' ? <FiCheckCircle className="w-3 h-3" /> : s.icon}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
          );
        })}
      </div>

      {/* Cache info hint */}
      <AnimatePresence>
        {elapsed > 30 && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="text-[11px] text-blue-600 dark:text-blue-400 mt-2 italic"
          >
            💡 First-time analysis takes longer. Future users will get instant results from cache.
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
