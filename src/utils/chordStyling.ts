/**
 * Pure utility functions for chord grid styling and layout
 * Extracted from ChordGrid component for reusability and testability
 */

export interface GridLayoutConfig {
  measuresPerRow: number;
  cellsPerRow: number;
  totalRows: number;
}

const MEASURE_COLUMN_GAP_PX = 4;
const WITHIN_MEASURE_BEAT_GAP_PX = 2;
const MEASURE_LEFT_CHROME_PX = 5;

export const estimateBeatCellWidth = (
  availableWidth: number,
  measuresPerRow: number,
  timeSignature: number,
): number => {
  if (availableWidth <= 0 || measuresPerRow <= 0 || timeSignature <= 0) {
    return 0;
  }

  const totalCells = measuresPerRow * timeSignature;
  const withinMeasureGaps = measuresPerRow * Math.max(0, timeSignature - 1) * WITHIN_MEASURE_BEAT_GAP_PX;
  const measureGaps = Math.max(0, measuresPerRow - 1) * MEASURE_COLUMN_GAP_PX;
  const measureChrome = measuresPerRow * MEASURE_LEFT_CHROME_PX;

  return (availableWidth - withinMeasureGaps - measureGaps - measureChrome) / totalCells;
};

/**
 * Dynamic font sizing system based on cell size and chord complexity
 */
export const getDynamicFontSize = (cellSize: number, chordLength: number = 1): string => {
  if (cellSize === 0) return 'text-sm'; // Default fallback

  // Base font size calculation: scale with cell size
  let baseFontSize: number;

  if (cellSize < 50) {
    baseFontSize = 9; // Very small cells (mobile, complex time signatures)
  } else if (cellSize < 70) {
    baseFontSize = 11; // Small cells (mobile optimized)
  } else if (cellSize < 90) {
    baseFontSize = 13; // Medium cells
  } else if (cellSize < 110) {
    baseFontSize = 15; // Large cells
  } else {
    baseFontSize = 17; // Very large cells (wide screens)
  }

  // Adjust for chord complexity (longer chord names get slightly smaller fonts)
  if (chordLength > 4) {
    baseFontSize = Math.max(8, baseFontSize - 2);
  } else if (chordLength > 2) {
    baseFontSize = Math.max(8, baseFontSize - 1);
  }

  // Convert to Tailwind CSS classes
  if (baseFontSize <= 9) return 'text-xs';
  if (baseFontSize <= 11) return 'text-sm';
  if (baseFontSize <= 13) return 'text-base';
  if (baseFontSize <= 15) return 'text-lg';
  return 'text-xl';
};

/**
 * Generates CSS grid columns class based on beats per measure
 */
export const getGridColumnsClass = (beatsPerMeasure: number): string => {
  switch (beatsPerMeasure) {
    case 2: return 'grid-cols-2';
    case 3: return 'grid-cols-3';
    case 4: return 'grid-cols-4';
    case 5: return 'grid-cols-5';
    case 6: return 'grid-cols-6';
    case 7: return 'grid-cols-7';
    case 8: return 'grid-cols-8';
    case 9: return 'grid-cols-9';
    case 10: return 'grid-cols-10';
    case 11: return 'grid-cols-11';
    case 12: return 'grid-cols-12';
    default:
      // For unusual time signatures, fall back to a flexible grid
      return 'grid-cols-4'; // Default fallback
  }
};

/**
 * Chord type color mapping for modern visual distinction
 */
const CHORD_TYPE_COLORS: Record<string, { light: string; dark: string; textLight: string; textDark: string }> = {
  major: {
    light: 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200',
    dark: 'bg-gradient-to-br from-amber-950/40 to-orange-950/30 border-amber-700/50',
    textLight: 'text-amber-900',
    textDark: 'text-amber-100',
  },
  minor: {
    light: 'bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200',
    dark: 'bg-gradient-to-br from-blue-950/40 to-indigo-950/30 border-blue-700/50',
    textLight: 'text-blue-900',
    textDark: 'text-blue-100',
  },
  diminished: {
    light: 'bg-gradient-to-br from-purple-50 to-fuchsia-50 border-purple-200',
    dark: 'bg-gradient-to-br from-purple-950/40 to-fuchsia-950/30 border-purple-700/50',
    textLight: 'text-purple-900',
    textDark: 'text-purple-100',
  },
  augmented: {
    light: 'bg-gradient-to-br from-rose-50 to-pink-50 border-rose-200',
    dark: 'bg-gradient-to-br from-rose-950/40 to-pink-950/30 border-rose-700/50',
    textLight: 'text-rose-900',
    textDark: 'text-rose-100',
  },
  seventh: {
    light: 'bg-gradient-to-br from-teal-50 to-cyan-50 border-teal-200',
    dark: 'bg-gradient-to-br from-teal-950/40 to-cyan-950/30 border-teal-700/50',
    textLight: 'text-teal-900',
    textDark: 'text-teal-100',
  },
  default: {
    light: 'bg-gradient-to-br from-white to-gray-50 border-gray-200',
    dark: 'bg-gradient-to-br from-gray-800 to-gray-900 border-gray-600',
    textLight: 'text-gray-800',
    textDark: 'text-gray-100',
  },
};

function getChordType(chord: string): string {
  if (!chord || chord === '') return 'default';
  const lower = chord.toLowerCase();
  if (lower.includes('dim') || lower.includes('°')) return 'diminished';
  if (lower.includes('aug') || lower.includes('+')) return 'augmented';
  if (lower.includes('7') || lower.includes('9') || lower.includes('maj7') || lower.includes('m7')) return 'seventh';
  if (lower.startsWith('m') && !lower.startsWith('maj')) return 'minor';
  return 'major';
}

/**
 * Generates chord cell styling classes
 * Modern: gradients, color-coded by chord type, rounded corners, subtle shadows
 */
export const getChordStyle = (
  chord: string,
  beatIndex: number,
  isClickable: boolean,
  hasPickupBeats: boolean,
  timeSignature: number,
  pickupBeatsCount: number,
  alignmentPaddingBeatCount: number = 0
): string => {
  // Modern base classes with rounded corners and smooth transitions
  const baseClasses = `relative flex flex-col items-start justify-center aspect-square transition-all duration-200 border rounded-md overflow-hidden ${
    isClickable ? 'cursor-pointer' : ''
  }`;

  // Determine cell type
  const isEmpty = chord === '';
  const isAlignmentPaddingBeat = isEmpty && beatIndex < alignmentPaddingBeatCount;
  const isPickupBeat = hasPickupBeats && beatIndex < timeSignature && beatIndex >= (timeSignature - pickupBeatsCount);

  let classes = `${baseClasses}`;
  let textColor = "text-gray-800 dark:text-gray-100";

  // Alignment-only leading padding beats should visually disappear into the grid
  if (isAlignmentPaddingBeat) {
    classes = `${baseClasses} alignment-padding-cell bg-gray-100/80 dark:bg-gray-800/60 border-transparent dark:border-transparent`;
    textColor = "text-gray-500 dark:text-gray-400";
  }
  // Modern empty cell styling with subtle depth
  else if (isEmpty) {
    classes = `${baseClasses} bg-gray-100/60 dark:bg-gray-800/50 border-gray-200/70 dark:border-gray-700/50`;
    textColor = "text-gray-500 dark:text-gray-400";
  }
  // Modern pickup beat styling with accent glow
  else if (isPickupBeat) {
    classes = `${baseClasses} bg-gradient-to-br from-sky-50 to-blue-100 dark:from-sky-950/30 dark:to-blue-900/20 border-sky-300 dark:border-sky-600/50`;
    textColor = "text-sky-800 dark:text-sky-100";
  }
  // Color-coded chord cells based on chord type
  else {
    const chordType = getChordType(chord);
    const colors = CHORD_TYPE_COLORS[chordType] ?? CHORD_TYPE_COLORS.default;
    classes = `${baseClasses} ${colors!.light} dark:${colors!.dark}`;
    textColor = `${colors!.textLight} dark:${colors!.textDark}`;
  }

  // NOTE: Current beat highlighting is handled purely via CSS class 'current-beat-highlight'
  // added by ChordGrid effect to avoid React re-renders. Do not style current beat here.

  return `${classes} ${textColor}`;
};

/**
 * Magenta-inspired chord progression variation generator.
 * Uses a simplified Markov transition model (inspired by Magenta's ImprovRNN / MusicVAE)
 * to suggest chord substitutions and next-chord predictions.
 *
 * @param currentProgression - Array of chord symbols (e.g. ['C', 'Am', 'F', 'G'])
 * @param variationCount - Number of variation suggestions to return
 * @returns Array of suggested progressions, each with a confidence score
 */
export interface ChordVariation {
  progression: string[];
  confidence: number; // 0.0 - 1.0
  description: string;
}

// Simplified transition probabilities inspired by common harmonic motion
// (Magenta models learn these from large MIDI corpora)
const MAGENTA_TRANSITION_MAP: Record<string, Record<string, number>> = {
  'C':  { 'Am': 0.35, 'F': 0.25, 'G': 0.20, 'Em': 0.10, 'Dm': 0.07, 'C': 0.03 },
  'Am': { 'Dm': 0.30, 'F': 0.25, 'G': 0.20, 'Em': 0.15, 'C': 0.07, 'Am': 0.03 },
  'F':  { 'C': 0.30, 'G': 0.25, 'Am': 0.20, 'Dm': 0.15, 'Em': 0.07, 'F': 0.03 },
  'G':  { 'C': 0.35, 'Em': 0.20, 'Am': 0.20, 'F': 0.15, 'Dm': 0.07, 'G': 0.03 },
  'Dm': { 'G': 0.30, 'Am': 0.25, 'F': 0.20, 'C': 0.15, 'Em': 0.07, 'Dm': 0.03 },
  'Em': { 'Am': 0.30, 'C': 0.25, 'G': 0.20, 'F': 0.15, 'Dm': 0.07, 'Em': 0.03 },
};

const SUBSTITUTION_MAP: Record<string, string[]> = {
  'C':  ['Cmaj7', 'C6', 'C/E', 'C/G'],
  'Am': ['Am7', 'Am9', 'Am/E', 'F#m7b5'],
  'F':  ['Fmaj7', 'F6', 'Dm7', 'F/A'],
  'G':  ['G7', 'G/B', 'G/D', 'Em7'],
  'Dm': ['Dm7', 'Dm9', 'Dm/F', 'Bdim'],
  'Em': ['Em7', 'Em9', 'Em/G', 'C/E'],
};

/**
 * Generates chord progression variations inspired by Magenta's MusicVAE / ImprovRNN.
 * Applies Markov-chain next-chord prediction and jazz-style substitution heuristics.
 */
export const generateMagentaStyleVariations = (
  currentProgression: string[],
  variationCount: number = 3
): ChordVariation[] => {
  if (!currentProgression || currentProgression.length === 0) {
    return [];
  }

  const results: ChordVariation[] = [];
  const normalizedBase = currentProgression.map(c => c.replace(/maj7|7|6|9|\/.*$/, '').trim());

  // --- Variation 1: Simple substitution with extensions ---
  const substitutionVariation: string[] = currentProgression.map((chord, i) => {
    const base = normalizedBase[i]!;
    const subs = SUBSTITUTION_MAP[base] || [chord];
    // Deterministic but varied: use index + length to pick
    return subs[(i + subs.length) % subs.length]!;
  });
  results.push({
    progression: substitutionVariation,
    confidence: 0.85,
    description: 'Magenta-style chord substitution with extensions',
  });

  // --- Variation 2: Markov-chain next-chord walk ---
  if (currentProgression.length >= 2) {
    const markovWalk: string[] = [currentProgression[0]!];
    for (let i = 1; i < currentProgression.length; i++) {
      const prevBase = normalizedBase[i - 1]!;
      const transitions = MAGENTA_TRANSITION_MAP[prevBase];
      if (transitions) {
        const candidates: [string, number][] = Object.entries(transitions);
        // Weighted random selection (simplified)
        const weights: number[] = candidates.map(([, w]) => w);
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * totalWeight;
        let chosen = candidates[0]![0];
        for (let j = 0; j < candidates.length; j++) {
          r -= weights[j]!;
          if (r <= 0) { chosen = candidates[j]![0]; break; }
        }
        markovWalk.push(chosen);
      } else {
        markovWalk.push(currentProgression[i]!);
      }
    }
    results.push({
      progression: markovWalk,
      confidence: 0.72,
      description: 'Markov-chain progression (ImprovRNN-inspired)',
    });
  }

  // --- Variation 3: Retrograde + substitution (MusicVAE latent-space mirror) ---
  const reversed = [...currentProgression].reverse().map((chord, i) => {
    const base = normalizedBase[currentProgression.length - 1 - i]!;
    const subs = SUBSTITUTION_MAP[base] || [chord];
    return subs[i % subs.length]!;
  });
  results.push({
    progression: reversed,
    confidence: 0.60,
    description: 'Retrograde with substitution (MusicVAE mirror)',
  });

  // Return only requested count
  return results.slice(0, variationCount);
};

/**
 * Calculates responsive grid layout configuration
 */
export const calculateGridLayout = (
  _isUploadPage: boolean,
  timeSignature: number,
  chordsLength: number,
  containerWidth: number,
  screenWidth: number,
  isChatbotOpen: boolean,
  isLyricsPanelOpen: boolean
): GridLayoutConfig => {
  // Previously: upload page forced 4 measures per row which under-utilized wide layouts.
  // Change: use the same responsive algorithm across pages so large screens can display more cells per row.

  // Determine container size category based on actual container width
  const effectiveWidth = containerWidth > 0 ? containerWidth : screenWidth;
  const isMobilePortrait = effectiveWidth < 375;
  const isMobileLandscape = effectiveWidth >= 375 && effectiveWidth < 768;
  const isTablet = effectiveWidth >= 768 && effectiveWidth < 1024;
  const isDesktop = effectiveWidth >= 1024;

  // Check if any panel is open
  const anyPanelOpen = isChatbotOpen || isLyricsPanelOpen;

  // Responsive algorithm: Consistent 16-20 cells per row target
  let targetCellsPerRow: number;

  if (isMobilePortrait) {
    targetCellsPerRow = anyPanelOpen ? 8 : 12;
  } else if (isMobileLandscape) {
    targetCellsPerRow = anyPanelOpen ? 12 : 16;
  } else if (isTablet) {
    targetCellsPerRow = anyPanelOpen ? 16 : 20;
  } else if (isDesktop) {
    targetCellsPerRow = anyPanelOpen ? 16 : 20;
  } else { // Large desktop
    targetCellsPerRow = anyPanelOpen ? 20 : 24;
  }

  // Calculate measures per row based on target cells
  let measuresPerRow = Math.max(1, Math.floor(targetCellsPerRow / timeSignature));

  // Apply time signature complexity limits for readability
  if (timeSignature >= 7) {
    const maxMeasures = anyPanelOpen ? 2 : 3;
    measuresPerRow = Math.min(measuresPerRow, maxMeasures);
  } else if (timeSignature >= 5) {
    const maxMeasures = anyPanelOpen ? 3 : 4;
    measuresPerRow = Math.min(measuresPerRow, maxMeasures);
  }

  // Minimum cell size constraint
  const DESKTOP_CELL_SIZE = 80;
  const MIN_CELL_SIZE = DESKTOP_CELL_SIZE * 0.7;
  const MIN_TOUCH_TARGET = 44;
  const EFFECTIVE_MIN_SIZE = Math.max(MIN_CELL_SIZE, MIN_TOUCH_TARGET);

  const availableWidth = effectiveWidth * 0.95;
  let maxMeasuresWithMinSize = 0;

  while (
    estimateBeatCellWidth(availableWidth, maxMeasuresWithMinSize + 1, timeSignature) >= EFFECTIVE_MIN_SIZE
  ) {
    maxMeasuresWithMinSize += 1;
  }

  // Apply minimum cell size constraint
  if (maxMeasuresWithMinSize > 0 && maxMeasuresWithMinSize < measuresPerRow) {
    measuresPerRow = maxMeasuresWithMinSize;
  }

  let finalMeasuresPerRow = Math.max(1, measuresPerRow);

  // Compact portrait phones lose too much context if we drop to a single measure
  if (timeSignature > 0) {
    const isPortraitPhone = screenWidth >= 375 && screenWidth < 600;
    const isCompactContainer = effectiveWidth >= 300 && effectiveWidth < 520;
    const MIN_COMPACT_CELL_SIZE = 34; // relaxed threshold to preserve two measures on narrow phones
    if (finalMeasuresPerRow === 1 && isPortraitPhone && isCompactContainer) {
      const desiredMeasures = 2;
      const requiredCellSize = estimateBeatCellWidth(availableWidth, desiredMeasures, timeSignature);

      if (requiredCellSize >= MIN_COMPACT_CELL_SIZE) {
        finalMeasuresPerRow = desiredMeasures;
      }
    }
  }

  if (timeSignature > 0) {
    const expandedMeasuresPerRow = finalMeasuresPerRow + 1;
    const relaxedExpansionCellSize = effectiveWidth < 640 ? 42 : effectiveWidth < 1024 ? 46 : 50;

    if (
      expandedMeasuresPerRow <= Math.max(finalMeasuresPerRow, maxMeasuresWithMinSize)
      && estimateBeatCellWidth(availableWidth, expandedMeasuresPerRow, timeSignature) >= relaxedExpansionCellSize
    ) {
      finalMeasuresPerRow = expandedMeasuresPerRow;
    }
  }

  return {
    measuresPerRow: finalMeasuresPerRow,
    cellsPerRow: finalMeasuresPerRow * timeSignature,
    totalRows: Math.ceil(chordsLength / (finalMeasuresPerRow * timeSignature))
  };
};
