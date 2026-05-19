'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface MidiNoteEvent {
  type: 'noteOn' | 'noteOff';
  note: number;       // MIDI note (0-127)
  velocity: number;   // 0-127
  channel: number;    // 0-15
  timestamp: number;
}

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
}

interface UseMidiControllerReturn {
  isSupported: boolean;
  isConnected: boolean;
  devices: MidiDevice[];
  selectedDevice: string | null;
  activeNotes: Set<number>;
  lastEvent: MidiNoteEvent | null;
  error: string | null;
  selectDevice: (id: string) => void;
  requestAccess: () => Promise<void>;
}

/**
 * Web MIDI API hook for real-time MIDI controller input.
 * Supports note on/off, velocity, and multiple devices.
 *
 * Usage:
 *   const { activeNotes, lastEvent, isConnected } = useMidiController();
 *   // activeNotes has all currently held keys
 *   // lastEvent triggers on every note on/off
 */
export function useMidiController(): UseMidiControllerReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [lastEvent, setLastEvent] = useState<MidiNoteEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accessRef = useRef<MIDIAccess | null>(null);
  const activeNotesRef = useRef<Set<number>>(new Set());

  // Check Web MIDI support
  useEffect(() => {
    if (typeof window !== 'undefined' && 'navigator' in window) {
      setIsSupported('requestMIDIAccess' in navigator);
    }
  }, []);

  const handleMidiMessage = useCallback((event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 3) return;

    const status = data[0] ?? 0;
    const note = data[1] ?? 0;
    const velocity = data[2] ?? 0;
    const channel = status & 0x0f;
    const command = status & 0xf0;

    // Note On (0x90) with velocity > 0
    if (command === 0x90 && velocity > 0) {
      activeNotesRef.current.add(note);
      setActiveNotes(new Set(activeNotesRef.current));
      setLastEvent({
        type: 'noteOn',
        note,
        velocity,
        channel,
        timestamp: Date.now(),
      });
    }
    // Note Off (0x80) or Note On with velocity 0
    else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      activeNotesRef.current.delete(note);
      setActiveNotes(new Set(activeNotesRef.current));
      setLastEvent({
        type: 'noteOff',
        note,
        velocity: 0,
        channel,
        timestamp: Date.now(),
      });
    }
  }, []);

  const updateDevices = useCallback((midiAccess: MIDIAccess) => {
    const inputs: MidiDevice[] = [];
    midiAccess.inputs.forEach((input) => {
      inputs.push({
        id: input.id,
        name: input.name || 'Unknown Device',
        manufacturer: input.manufacturer || 'Unknown',
      });
    });
    setDevices(inputs);

    // Auto-select first device if none selected
    if (inputs.length > 0 && !selectedDevice) {
      const first = inputs[0];
      if (first) {
        setSelectedDevice(first.id);
      }
    }
  }, [selectedDevice]);

  const connectDevice = useCallback((deviceId: string) => {
    const access = accessRef.current;
    if (!access) return;

    // Disconnect all first
    access.inputs.forEach((input) => {
      input.onmidimessage = null;
    });

    // Connect selected device
    const input = access.inputs.get(deviceId);
    if (input) {
      input.onmidimessage = handleMidiMessage as any;
      setIsConnected(true);
      setSelectedDevice(deviceId);
    }
  }, [handleMidiMessage]);

  const requestAccess = useCallback(async () => {
    try {
      setError(null);
      const midiAccess = await (navigator as any).requestMIDIAccess({
        sysex: false,
      });
      accessRef.current = midiAccess;

      updateDevices(midiAccess);
      setIsConnected(midiAccess.inputs.size > 0);

      // Listen for device changes
      midiAccess.onstatechange = (e: MIDIConnectionEvent) => {
        updateDevices(midiAccess);
        if (e.port?.type === 'input') {
          if (e.port.state === 'connected' && e.port.connection === 'open') {
            setIsConnected(true);
          } else if (midiAccess.inputs.size === 0) {
            setIsConnected(false);
          }
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MIDI access denied');
      setIsConnected(false);
    }
  }, [updateDevices]);

  const selectDevice = useCallback((id: string) => {
    connectDevice(id);
  }, [connectDevice]);

  // Auto-connect when device list changes and we have a selection
  useEffect(() => {
    if (selectedDevice && accessRef.current) {
      connectDevice(selectedDevice);
    }
  }, [selectedDevice, devices.length, connectDevice]);

  return {
    isSupported,
    isConnected,
    devices,
    selectedDevice,
    activeNotes,
    lastEvent,
    error,
    selectDevice,
    requestAccess,
  };
}
