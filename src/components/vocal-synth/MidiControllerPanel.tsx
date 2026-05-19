'use client';

import React, { useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMidiController, MidiNoteEvent } from '@/hooks/vocal-synth/useMidiController';
import MidiKeyboard from './MidiKeyboard';

interface MidiControllerPanelProps {
  onNoteOn?: (note: number, velocity: number) => void;
  onNoteOff?: (note: number) => void;
  onSustainPedal?: (active: boolean) => void;
}

export default function MidiControllerPanel({
  onNoteOn,
  onNoteOff,
  onSustainPedal,
}: MidiControllerPanelProps) {
  const {
    isSupported,
    isConnected,
    devices,
    selectedDevice,
    activeNotes,
    lastEvent,
    error,
    selectDevice,
    requestAccess,
  } = useMidiController();

  const [showHelp, setShowHelp] = useState(false);

  // Forward MIDI events to parent
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'noteOn') {
      onNoteOn?.(lastEvent.note, lastEvent.velocity);
    } else {
      onNoteOff?.(lastEvent.note);
    }
  }, [lastEvent, onNoteOn, onNoteOff]);

  const handleNoteClick = useCallback((note: number) => {
    onNoteOn?.(note, 100);
    setTimeout(() => onNoteOff?.(note), 200);
  }, [onNoteOn, onNoteOff]);

  if (!isSupported) {
    return (
      <div className="p-4 bg-gray-800 rounded-xl border border-gray-700 text-center">
        <div className="text-2xl mb-2">🎹</div>
        <p className="text-sm text-gray-400">
          Web MIDI API not supported in this browser.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Use Chrome, Edge, or Opera for MIDI controller support.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Connection status & controls */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-800 rounded-xl border border-gray-700">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
          <span className="text-xs text-gray-300">
            {isConnected ? `Connected (${devices.length} device${devices.length !== 1 ? 's' : ''})` : 'No MIDI device'}
          </span>
        </div>

        {!isConnected && (
          <button
            onClick={requestAccess}
            className="px-3 py-1.5 text-xs rounded bg-pink-600 text-white hover:bg-pink-500 transition-colors"
          >
            🔌 Connect MIDI
          </button>
        )}

        {devices.length > 1 && (
          <select
            value={selectedDevice || ''}
            onChange={(e) => selectDevice(e.target.value)}
            className="px-2 py-1 text-xs rounded border border-gray-600 bg-gray-700 text-gray-200"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.manufacturer})
              </option>
            ))}
          </select>
        )}

        <button
          onClick={() => setShowHelp(!showHelp)}
          className="ml-auto text-xs text-gray-500 hover:text-gray-300"
        >
          {showHelp ? 'Hide' : 'Help'}
        </button>
      </div>

      {error && (
        <div className="p-2 bg-red-900/30 border border-red-700 rounded-lg text-xs text-red-300">
          ⚠️ {error}
        </div>
      )}

      {/* Help */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 bg-gray-800 rounded-xl border border-gray-700 text-xs text-gray-400 space-y-1">
              <p><strong>Setup:</strong> Plug in a USB MIDI keyboard, then click "Connect MIDI"</p>
              <p><strong>Note On/Off:</strong> Play keys to trigger vocal synthesis in real-time</p>
              <p><strong>Velocity:</strong> Play harder for louder output</p>
              <p><strong>Supported:</strong> Chrome, Edge, Opera (not Safari/Firefox)</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active notes display */}
      {activeNotes.size > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-wrap gap-1"
        >
          {Array.from(activeNotes).sort((a, b) => a - b).map((note) => {
            const octave = Math.floor(note / 12) - 1;
            const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            return (
              <motion.span
                key={note}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="px-2 py-0.5 text-xs rounded-full bg-pink-600 text-white font-mono"
              >
                {names[note % 12]}{octave}
              </motion.span>
            );
          })}
        </motion.div>
      )}

      {/* Visual keyboard */}
      <MidiKeyboard
        activeNotes={activeNotes}
        startOctave={2}
        numOctaves={4}
        onNoteClick={handleNoteClick}
      />

      {/* Last event */}
      {lastEvent && (
        <div className="text-center">
          <span className={`text-xs font-mono ${
            lastEvent.type === 'noteOn' ? 'text-pink-400' : 'text-gray-500'
          }`}>
            {lastEvent.type === 'noteOn' ? '🔴' : '⚪'} {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][lastEvent.note % 12]}{Math.floor(lastEvent.note / 12) - 1} 
            vel={lastEvent.velocity}
          </span>
        </div>
      )}
    </div>
  );
}
