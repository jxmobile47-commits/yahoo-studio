import React from 'react';

export interface ChordGridHeaderProps {
  timeSignature: number;
  keySignature?: string;
  isDetectingKey?: boolean;
  hasPickupBeats?: boolean;
  pickupBeatsCount?: number;
  className?: string;
}

/**
 * Header component for ChordGrid displaying time signature, key signature, and pickup beats
 * Extracted from ChordGrid for better component organization and reusability
 */
export const ChordGridHeader: React.FC<ChordGridHeaderProps> = ({
  timeSignature,
  keySignature,
  isDetectingKey = false,
  hasPickupBeats = false,
  pickupBeatsCount = 0,
  className = ''
}) => {
  return (
    <div className={`flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      {/* Left side - Title with digital aesthetic */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          {/* Decorative accent bar */}
          <div className="h-5 w-1 rounded-full bg-gradient-to-b from-cyan-400 to-blue-500 dark:from-cyan-300 dark:to-blue-400" />
          <h3 className="m-0 text-base font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-lg"
              style={{ fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif' }}>
            Chord Progression
          </h3>
        </div>
      </div>

      {/* Right side - Modern gradient tags */}
      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end sm:gap-2">
        {/* Time signature tag - gradient pill */}
        <div className="rounded-full border border-white/20 bg-gradient-to-r from-blue-500/90 to-cyan-500/90 px-3 py-1 shadow-sm shadow-blue-500/20 backdrop-blur-sm dark:border-white/10 dark:from-blue-600/80 dark:to-cyan-600/80 dark:shadow-blue-900/30">
          <span className="text-xs font-semibold text-white tracking-wide sm:text-sm"
                style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}>
            Time: {timeSignature === 6 ? '6/8' : `${timeSignature}/4`}
          </span>
        </div>

        {/* Key signature tag - gradient pill */}
        {keySignature && (
          <div className="rounded-full border border-white/20 bg-gradient-to-r from-emerald-500/90 to-teal-500/90 px-3 py-1 shadow-sm shadow-emerald-500/20 backdrop-blur-sm dark:border-white/10 dark:from-emerald-600/80 dark:to-teal-600/80 dark:shadow-emerald-900/30">
            <span className="text-xs font-semibold text-white tracking-wide sm:text-sm"
                  style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}>
              Key: {keySignature.replace(/b/g, '♭').replace(/#/g, '♯')}
            </span>
          </div>
        )}

        {/* Key detection loading indicator - animated pulse */}
        {isDetectingKey && (
          <div className="rounded-full border border-white/20 bg-gradient-to-r from-violet-500/90 to-purple-500/90 px-3 py-1 shadow-sm shadow-violet-500/20 backdrop-blur-sm animate-pulse dark:border-white/10 dark:from-violet-600/80 dark:to-purple-600/80">
            <span className="text-xs font-semibold text-white tracking-wide sm:text-sm"
                  style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}>
              Detecting key...
            </span>
          </div>
        )}

        {/* Pickup beats indicator - subtle gradient */}
        {hasPickupBeats && pickupBeatsCount > 0 && (
          <div className="rounded-full border border-white/20 bg-gradient-to-r from-amber-500/90 to-orange-500/90 px-3 py-1 shadow-sm shadow-amber-500/20 backdrop-blur-sm dark:border-white/10 dark:from-amber-600/80 dark:to-orange-600/80 dark:shadow-amber-900/30">
            <span className="text-xs font-semibold text-white tracking-wide sm:text-sm"
                  style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}>
              Pickup: {pickupBeatsCount} beat{pickupBeatsCount > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChordGridHeader;
