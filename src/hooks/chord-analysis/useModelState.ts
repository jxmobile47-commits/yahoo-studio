import { useState, useEffect, useRef } from 'react';
import { getSafeBeatModel, getSafeChordModel } from '@/utils/modelFiltering';

// Define detector types
export type BeatDetectorType = 'madmom' | 'beat-transformer';
export type ChordDetectorType = 'chord-cnn-lstm' | 'btc-sl' | 'btc-pl';

export interface ModelState {
  beatDetector: BeatDetectorType;
  chordDetector: ChordDetectorType;
  modelsInitialized: boolean;
  beatDetectorRef: React.MutableRefObject<BeatDetectorType>;
  chordDetectorRef: React.MutableRefObject<ChordDetectorType>;
  setBeatDetector: (detector: BeatDetectorType) => void;
  setChordDetector: (detector: ChordDetectorType) => void;
}

export interface UseModelStateOptions {
  initialBeatDetector?: BeatDetectorType | null;
  initialChordDetector?: ChordDetectorType | null;
}

/**
 * Custom hook for managing model selection state with localStorage persistence
 * Extracted from analyze page component - maintains ZERO logic changes
 */
export const useModelState = (options: UseModelStateOptions = {}): ModelState => {
  const { initialBeatDetector = null, initialChordDetector = null } = options;
  const previousInitialBeatDetectorRef = useRef<BeatDetectorType | null>(
    initialBeatDetector ? getSafeBeatModel(initialBeatDetector) : null,
  );
  const previousInitialChordDetectorRef = useRef<ChordDetectorType | null>(
    initialChordDetector ? getSafeChordModel(initialChordDetector) : null
  );

  // Forced defaults: Beat-Transformer + BTC-SL (ChordMini Transformer)
  // Model selection UI removed — these are now the only models used.
  const [beatDetector, setBeatDetector] = useState<BeatDetectorType>(() => {
    if (initialBeatDetector) {
      return getSafeBeatModel(initialBeatDetector);
    }
    return 'beat-transformer';
  });

  const [chordDetector, setChordDetector] = useState<ChordDetectorType>(() => {
    if (initialChordDetector) {
      return getSafeChordModel(initialChordDetector);
    }
    return 'btc-sl';
  });

  const [modelsInitialized, setModelsInitialized] = useState<boolean>(false);

  // Use refs to ensure we always get the latest model values
  const beatDetectorRef = useRef(beatDetector);
  const chordDetectorRef = useRef(chordDetector);

  // Update refs when state changes
  useEffect(() => {
    beatDetectorRef.current = beatDetector;
  }, [beatDetector]);

  useEffect(() => {
    chordDetectorRef.current = chordDetector;
  }, [chordDetector]);

  useEffect(() => {
    if (initialBeatDetector && initialBeatDetector !== previousInitialBeatDetectorRef.current) {
      const safeModel = getSafeBeatModel(initialBeatDetector);
      previousInitialBeatDetectorRef.current = safeModel;
      const timer = window.setTimeout(() => {
        setBeatDetector(safeModel);
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, [initialBeatDetector]);

  useEffect(() => {
    if (!initialChordDetector) {
      return;
    }

    const safeModel = getSafeChordModel(initialChordDetector);

    if (safeModel !== previousInitialChordDetectorRef.current) {
      previousInitialChordDetectorRef.current = safeModel;
      const timer = window.setTimeout(() => {
        setChordDetector(safeModel);
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, [initialChordDetector]);

  // Persist beat detector selection to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('yahooStudio_beat_detector', beatDetector);
    }
  }, [beatDetector]);

  // Persist chord detector selection to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('yahooStudio_chord_detector', chordDetector);
    }
  }, [chordDetector]);

  // Mark models as initialized after component mount to allow user interaction
  useEffect(() => {
    const timer = setTimeout(() => {
      setModelsInitialized(true);
    }, 100); // Minimal delay to prevent flash, allow immediate cache checking

    return () => clearTimeout(timer);
  }, []);

  return {
    beatDetector,
    chordDetector,
    modelsInitialized,
    beatDetectorRef,
    chordDetectorRef,
    setBeatDetector,
    setChordDetector,
  };
};
