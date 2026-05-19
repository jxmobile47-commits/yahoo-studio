/**
 * AI Beat Pattern Generation
 * ==========================
 * Pre-built drum patterns and AI-generated variations.
 * Genre-aware pattern generation with fill-ins and humanization.
 */

export interface BeatStep {
  active: boolean;
  velocity: number; // 0-1
}

export interface DrumPatternTemplate {
  name: string;
  genre: string;
  bpm: [number, number]; // min, max
  channels: Record<string, BeatStep[]>;
}

// Standard 16-step patterns (will expand to 32)
const PATTERNS: DrumPatternTemplate[] = [
  // ===== HOUSE / TECHNO =====
  {
    name: 'Four-on-the-Floor',
    genre: 'house',
    bpm: [120, 130],
    channels: {
      kick:  [
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
      ],
      snare: [
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.9 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.9 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
      ],
      hihat: [
        { active: true, velocity: 0.7 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.7 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.7 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.7 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
      ],
      clap: [
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.8 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.8 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
      ],
    },
  },

  // ===== HIP-HOP =====
  {
    name: 'Boom Bap',
    genre: 'hiphop',
    bpm: [85, 95],
    channels: {
      kick:  [
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: true, velocity: 0.6 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.8 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
      ],
      snare: [
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.9 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.9 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
      ],
      hihat: [
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
      ],
    },
  },

  // ===== D&B / JUNGLE =====
  {
    name: 'Amen Break',
    genre: 'dnb',
    bpm: [170, 180],
    channels: {
      kick:  [
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.6 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.8 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.7 }, { active: false, velocity: 0 },
      ],
      snare: [
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.9 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.9 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.7 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
      ],
      hihat: [
        { active: true, velocity: 0.6 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.4 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.6 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.4 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
      ],
    },
  },

  // ===== TRAP =====
  {
    name: 'Trap Beat',
    genre: 'trap',
    bpm: [130, 150],
    channels: {
      kick:  [
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.6 }, { active: false, velocity: 0 },
      ],
      snare: [
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.9 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
      ],
      hihat: [
        { active: true, velocity: 0.7 }, { active: true, velocity: 0.4 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.4 },
        { active: true, velocity: 0.7 }, { active: true, velocity: 0.4 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.4 },
        { active: true, velocity: 0.7 }, { active: true, velocity: 0.4 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.4 },
        { active: true, velocity: 0.7 }, { active: true, velocity: 0.4 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.4 },
      ],
      percussion: [
        { active: false, velocity: 0 }, { active: true, velocity: 0.5 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: true, velocity: 0.4 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: true, velocity: 0.5 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: true, velocity: 0.4 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
      ],
    },
  },

  // ===== DISCO / FUNK =====
  {
    name: 'Disco Groove',
    genre: 'disco',
    bpm: [110, 125],
    channels: {
      kick:  [
        { active: true, velocity: 1.0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.6 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.8 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
      ],
      snare: [
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.5 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.9 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
      ],
      hihat: [
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.5 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.5 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.5 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.6 }, { active: true, velocity: 0.3 },
        { active: true, velocity: 0.5 }, { active: true, velocity: 0.3 },
      ],
      openhat: [
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
        { active: true, velocity: 0.8 }, { active: false, velocity: 0 },
        { active: false, velocity: 0 }, { active: false, velocity: 0 },
      ],
    },
  },
];

/**
 * Get all available pattern templates
 */
export function getPatternTemplates(): DrumPatternTemplate[] {
  return PATTERNS;
}

/**
 * Apply a pattern template to channels
 */
export function applyPattern(
  template: DrumPatternTemplate,
  stepsPerPattern: number = 32
): Record<string, { active: boolean; velocity: number }[]> {
  const result: Record<string, { active: boolean; velocity: number }[]> = {};

  // Expand 16-step pattern to 32 steps (or requested length)
  for (const [channelId, steps] of Object.entries(template.channels)) {
    const expanded: { active: boolean; velocity: number }[] = [];
    for (let i = 0; i < stepsPerPattern; i++) {
      const srcIdx = i % steps.length;
      const src = steps[srcIdx];
      if (!src) continue;
      expanded.push({ active: !!src.active, velocity: src.velocity ?? 0 });
    }
    result[channelId] = expanded;
  }

  return result;
}

/**
 * Generate a drum fill for the last measure
 */
export function generateFill(
  basePattern: Record<string, { active: boolean; velocity: number }[]>,
  intensity: number = 0.8
): Record<string, { active: boolean; velocity: number }[]> {
  const result: Record<string, { active: boolean; velocity: number }[]> = {};
  const stepsPerPattern = basePattern.kick?.length || 32;
  const measureLength = stepsPerPattern / 2; // 16 steps per measure at 32 total

  for (const [channelId, steps] of Object.entries(basePattern)) {
    const newSteps = steps.map((s, i) => ({ ...s }));

    // Fill starts at second half of last measure
    const fillStart = stepsPerPattern - measureLength / 2;

    if (channelId === 'snare') {
      // Snare roll: rapid snare hits
      for (let i = fillStart; i < stepsPerPattern; i += 2) {
        newSteps[i] = { active: true, velocity: intensity * (0.5 + Math.random() * 0.5) };
      }
    } else if (channelId === 'kick') {
      // Sparse kicks during fill
      for (let i = fillStart; i < stepsPerPattern; i++) {
        if (Math.random() > 0.7) {
          newSteps[i] = { active: true, velocity: intensity * 0.8 };
        }
      }
    } else if (channelId === 'hihat' || channelId === 'openhat') {
      // Open hihat on last beat
      newSteps[stepsPerPattern - 4] = { active: true, velocity: intensity };
      newSteps[stepsPerPattern - 2] = { active: true, velocity: intensity * 0.8 };
    }

    result[channelId] = newSteps;
  }

  return result;
}

/**
 * Humanize a pattern (velocity and timing variations)
 */
export function humanizePattern(
  pattern: Record<string, { active: boolean; velocity: number }[]>,
  amount: number = 0.1
): Record<string, { active: boolean; velocity: number }[]> {
  const result: Record<string, { active: boolean; velocity: number }[]> = {};

  for (const [channelId, steps] of Object.entries(pattern)) {
    result[channelId] = steps.map((s) => ({
      active: s.active,
      velocity: s.active
        ? Math.max(0.1, Math.min(1.0, s.velocity + (Math.random() - 0.5) * amount))
        : 0,
    }));
  }

  return result;
}

/**
 * Randomize a pattern (add/remove hits probabilistically)
 */
export function randomizePattern(
  pattern: Record<string, { active: boolean; velocity: number }[]>,
  density: number = 0.3
): Record<string, { active: boolean; velocity: number }[]> {
  const result: Record<string, { active: boolean; velocity: number }[]> = {};

  for (const [channelId, steps] of Object.entries(pattern)) {
    result[channelId] = steps.map((s) => {
      if (!s.active && Math.random() < density * 0.2) {
        return { active: true, velocity: 0.3 + Math.random() * 0.4 };
      }
      return { ...s };
    });
  }

  return result;
}

/**
 * Generate variation of existing pattern
 */
export function generateVariation(
  pattern: Record<string, { active: boolean; velocity: number }[]>,
  variationAmount: number = 0.3
): Record<string, { active: boolean; velocity: number }[]> {
  const result: Record<string, { active: boolean; velocity: number }[]> = {};

  for (const [channelId, steps] of Object.entries(pattern)) {
    result[channelId] = steps.map((s) => {
      if (Math.random() < variationAmount) {
        return {
          active: !s.active,
          velocity: s.active ? 0 : 0.5 + Math.random() * 0.3,
        };
      }
      return { ...s };
    });
  }

  return result;
}

/**
 * Find pattern by name
 */
export function findPattern(name: string): DrumPatternTemplate | undefined {
  return PATTERNS.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get patterns by genre
 */
export function getPatternsByGenre(genre: string): DrumPatternTemplate[] {
  return PATTERNS.filter((p) => p.genre === genre);
}
