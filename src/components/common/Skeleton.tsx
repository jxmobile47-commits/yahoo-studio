'use client';

import React from 'react';

/**
 * Reusable Skeleton loader components with shimmer animation.
 * Use these for consistent loading states across the app.
 */

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

export function Skeleton({
  className = '',
  width,
  height,
  rounded = 'md',
}: SkeletonProps) {
  const roundedClass = {
    none: '',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  }[rounded];

  return (
    <div
      className={`relative overflow-hidden bg-gray-200 dark:bg-gray-700 ${roundedClass} ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/20 dark:via-white/10 to-transparent" />
    </div>
  );
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={14}
          width={i === lines - 1 ? '70%' : '100%'}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <Skeleton width={40} height={40} rounded="full" />
        <div className="flex-1">
          <Skeleton width="60%" height={14} className="mb-2" />
          <Skeleton width="40%" height={12} />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

export function SkeletonChordGrid({ rows = 4, cols = 16 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-1">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} width={48} height={48} rounded="md" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonAudioPlayer() {
  return (
    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="flex items-center gap-3 mb-3">
        <Skeleton width={48} height={48} rounded="full" />
        <div className="flex-1">
          <Skeleton width="50%" height={16} className="mb-2" />
          <Skeleton width="30%" height={12} />
        </div>
      </div>
      <Skeleton height={80} rounded="md" className="mb-3" />
      <div className="flex gap-2">
        <Skeleton width={32} height={32} rounded="full" />
        <Skeleton width={32} height={32} rounded="full" />
        <Skeleton className="flex-1" height={32} />
      </div>
    </div>
  );
}
