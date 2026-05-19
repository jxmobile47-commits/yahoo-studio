'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS_BY_PAGE: Record<string, { title: string; shortcuts: Shortcut[] }> = {
  '/vocal-synth': {
    title: 'Vocal Synth Shortcuts',
    shortcuts: [
      { keys: ['Space'], description: 'Play / Pause' },
      { keys: ['1'], description: 'Select tool' },
      { keys: ['2'], description: 'Draw tool' },
      { keys: ['3'], description: 'Erase tool' },
      { keys: ['Delete'], description: 'Delete selected note' },
      { keys: ['←', '→'], description: 'Resize selected note' },
      { keys: ['?'], description: 'Show this help' },
    ],
  },
  '/beat-maker': {
    title: 'Beat Maker Shortcuts',
    shortcuts: [
      { keys: ['Space'], description: 'Play / Pause' },
      { keys: ['?'], description: 'Show this help' },
    ],
  },
  '/stem-separation': {
    title: 'Stem Separation Shortcuts',
    shortcuts: [
      { keys: ['Space'], description: 'Play / Pause' },
      { keys: ['?'], description: 'Show this help' },
    ],
  },
};

const DEFAULT_SHORTCUTS = {
  title: 'Keyboard Shortcuts',
  shortcuts: [
    { keys: ['?'], description: 'Show this help' },
    { keys: ['Esc'], description: 'Close modal' },
  ],
};

export default function KeyboardShortcutsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setIsOpen(v => !v);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const config = SHORTCUTS_BY_PAGE[pathname] || DEFAULT_SHORTCUTS;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-white dark:bg-[#1E252E] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                ⌨️ {config.title}
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-2">
              {config.shortcuts.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {s.description}
                  </span>
                  <div className="flex gap-1">
                    {s.keys.map((k, j) => (
                      <kbd
                        key={j}
                        className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-sm text-gray-700 dark:text-gray-200"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 text-center">
              Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600">?</kbd> anytime to show shortcuts
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
