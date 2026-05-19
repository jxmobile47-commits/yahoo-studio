/**
 * Shared hook for audio file upload + decode.
 * Eliminates duplicate `new AudioContext() + decodeAudioData` patterns
 * across beat-maker, stem-separation, vocal-synth.
 */
import { useCallback, useRef, useState } from 'react';
import { AudioContextManager } from '@/services/audio/audioContextManager';

export interface UseAudioFileUploadResult {
  isUploading: boolean;
  error: string | null;
  fileName: string | null;
  audioBuffer: AudioBuffer | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  reset: () => void;
}

export interface UseAudioFileUploadOptions {
  /** Called after successful decode. Return false to skip default state update. */
  onDecoded?: (buffer: AudioBuffer, file: File) => void | Promise<void>;
  /** Maximum file size in bytes (default: 200MB). */
  maxSizeBytes?: number;
}

const DEFAULT_MAX_SIZE = 200 * 1024 * 1024; // 200MB

export function useAudioFileUpload(
  options: UseAudioFileUploadOptions = {}
): UseAudioFileUploadResult {
  const { onDecoded, maxSizeBytes = DEFAULT_MAX_SIZE } = options;
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);

      if (file.size > maxSizeBytes) {
        setError(`File too large (max ${Math.round(maxSizeBytes / 1024 / 1024)}MB)`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      setIsUploading(true);
      setFileName(file.name);

      try {
        const ctx = AudioContextManager.instance.getContext();
        const arrayBuffer = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        setAudioBuffer(decoded);
        if (onDecoded) await onDecoded(decoded, file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to decode audio';
        setError(msg);
        console.error('[useAudioFileUpload] decode failed:', err);
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [onDecoded, maxSizeBytes]
  );

  const reset = useCallback(() => {
    setError(null);
    setFileName(null);
    setAudioBuffer(null);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  return {
    isUploading,
    error,
    fileName,
    audioBuffer,
    fileInputRef,
    handleFileChange,
    reset,
  };
}
