'use client';

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  getPatternTemplates,
  applyPattern,
  humanizePattern,
  generateFill,
  generateVariation,
  DrumPatternTemplate,
} from '@/utils/beat-maker/aiBeatPatterns';

interface DrumChannel {
  id: string;
  name: string;
  color: string;
  steps: { active: boolean; velocity: number }[];
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
}

interface AIPatternGeneratorProps {
  channels: DrumChannel[];
  bpm: number;
  onApplyPattern: (channels: DrumChannel[]) => void;
  onSetBpm: (bpm: number) => void;
}

const GENRES = [
  { id: 'house', name: 'House / Techno', emoji: '🏠' },
  { id: 'hiphop', name: 'Hip-Hop', emoji: '🎤' },
  { id: 'trap', name: 'Trap', emoji: '🔥' },
  { id: 'dnb', name: 'Drum & Bass', emoji: '🥁' },
  { id: 'disco', name: 'Disco / Funk', emoji: '🕺' },
];

export default function AIPatternGenerator({
  channels,
  bpm,
  onApplyPattern,
  onSetBpm,
}: AIPatternGeneratorProps) {
  const [selectedGenre, setSelectedGenre] = useState<string>('house');
  const [humanizeAmount, setHumanizeAmount] = useState(0.15);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const templates = getPatternTemplates();
  const filteredTemplates = templates.filter((t) => t.genre === selectedGenre);

  const applyTemplate = useCallback((template: DrumPatternTemplate) => {
    setIsGenerating(true);
    const pattern = applyPattern(template, 32);

    // Merge pattern into existing channels
    const updated = channels.map((ch) => {
      const patternSteps = pattern[ch.id];
      if (patternSteps) {
        return {
          ...ch,
          steps: patternSteps.map((s) => ({ active: s.active, velocity: s.velocity })),
        };
      }
      return ch;
    });

    onApplyPattern(updated);
    onSetBpm(Math.max(template.bpm[0], Math.min(template.bpm[1], bpm)));
    setLastAction(`Applied: ${template.name}`);
    setIsGenerating(false);
  }, [channels, bpm, onApplyPattern, onSetBpm]);

  const handleHumanize = useCallback(() => {
    const pattern: Record<string, { active: boolean; velocity: number }[]> = {};
    for (const ch of channels) {
      pattern[ch.id] = ch.steps;
    }
    const humanized = humanizePattern(pattern, humanizeAmount);

    const updated = channels.map((ch) => ({
      ...ch,
      steps: humanized[ch.id]?.map((s) => ({ active: s.active, velocity: s.velocity })) ?? ch.steps,
    }));

    onApplyPattern(updated);
    setLastAction(`Humanized (${Math.round(humanizeAmount * 100)}%)`);
  }, [channels, humanizeAmount, onApplyPattern]);

  const handleGenerateFill = useCallback(() => {
    const pattern: Record<string, { active: boolean; velocity: number }[]> = {};
    for (const ch of channels) {
      pattern[ch.id] = ch.steps;
    }
    const fill = generateFill(pattern, 0.9);

    const updated = channels.map((ch) => ({
      ...ch,
      steps: fill[ch.id]?.map((s) => ({ active: s.active, velocity: s.velocity })) ?? ch.steps,
    }));

    onApplyPattern(updated);
    setLastAction('Generated drum fill');
  }, [channels, onApplyPattern]);

  const handleVariation = useCallback(() => {
    const pattern: Record<string, { active: boolean; velocity: number }[]> = {};
    for (const ch of channels) {
      pattern[ch.id] = ch.steps;
    }
    const variation = generateVariation(pattern, 0.25);

    const updated = channels.map((ch) => ({
      ...ch,
      steps: variation[ch.id]?.map((s) => ({ active: s.active, velocity: s.velocity })) ?? ch.steps,
    }));

    onApplyPattern(updated);
    setLastAction('Generated variation');
  }, [channels, onApplyPattern]);

  return (
    <div className="space-y-3">
      {/* Genre selector */}
      <div className="flex flex-wrap gap-2">
        {GENRES.map((g) => (
          <button
            key={g.id}
            onClick={() => setSelectedGenre(g.id)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              selectedGenre === g.id
                ? 'bg-pink-600 text-white border-pink-500'
                : 'bg-gray-800 text-gray-300 border-gray-600 hover:border-gray-500'
            }`}
          >
            {g.emoji} {g.name}
          </button>
        ))}
      </div>

      {/* Pattern templates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {filteredTemplates.map((template) => (
          <motion.button
            key={template.name}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => applyTemplate(template)}
            disabled={isGenerating}
            className="p-3 text-left bg-gray-800 rounded-xl border border-gray-700 hover:border-pink-500 transition-colors disabled:opacity-50"
          >
            <div className="text-sm font-medium text-gray-200">{template.name}</div>
            <div className="text-xs text-gray-500 mt-1">
              {template.bpm[0]}-{template.bpm[1]} BPM · {Object.keys(template.channels).length} channels
            </div>
          </motion.button>
        ))}
      </div>

      {/* Modifiers */}
      <div className="p-3 bg-gray-800 rounded-xl border border-gray-700 space-y-3">
        <div className="text-xs text-gray-400 uppercase tracking-wide">Modifiers</div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleHumanize}
            className="px-3 py-1.5 text-xs rounded bg-purple-600 text-white hover:bg-purple-500 transition-colors"
          >
            🎲 Humanize
          </button>
          <button
            onClick={handleGenerateFill}
            className="px-3 py-1.5 text-xs rounded bg-yellow-600 text-white hover:bg-yellow-500 transition-colors"
          >
            🥁 Fill
          </button>
          <button
            onClick={handleVariation}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors"
          >
            🔄 Variation
          </button>
        </div>

        {/* Humanize amount */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 w-16">Humanize</span>
          <input
            type="range"
            min={0}
            max={50}
            value={humanizeAmount * 100}
            onChange={(e) => setHumanizeAmount(Number(e.target.value) / 100)}
            className="flex-1 accent-purple-500"
          />
          <span className="text-xs text-gray-400 w-8">{Math.round(humanizeAmount * 100)}%</span>
        </div>
      </div>

      {/* Last action */}
      {lastAction && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-center text-green-400"
        >
          ✅ {lastAction}
        </motion.div>
      )}
    </div>
  );
}
