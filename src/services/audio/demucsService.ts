/**
 * HTDemucs Client Service
 *
 * Talks to the local Python backend's Demucs API via Next.js proxy routes.
 * Uses Meta's HTDemucs (Hybrid Transformer Demucs) for high-quality stem separation.
 *
 * Models:
 *   - htdemucs:      4 stems (vocals, drums, bass, other) — best quality
 *   - htdemucs_ft:   4 stems — fine-tuned variant
 *   - htdemucs_6s:   6 stems (vocals, drums, bass, guitar, piano, other)
 *   - hdemucs_mmi:   4 stems — MMI-trained variant
 */

export type DemucsModel = 'htdemucs' | 'htdemucs_ft' | 'htdemucs_6s' | 'hdemucs_mmi';

export interface DemucsProgress {
  message: string;
}

export interface DemucsStatus {
  success: boolean;
  available: boolean;
  models: string[];
  message: string;
}

export interface DemucsResult {
  success: boolean;
  stems?: Record<string, { download_url: string; format: string; filename: string }>;
  processing_time?: number;
  model_used?: string;
  error?: string;
}

/**
 * Check if the local HTDemucs backend is available.
 */
export async function getDemucsStatus(): Promise<DemucsStatus> {
  const res = await fetch('/api/stem/status');
  if (!res.ok) {
    return {
      success: false,
      available: false,
      models: [],
      message: `Backend error: ${res.status}`,
    };
  }
  return res.json();
}

/**
 * Separate audio into stems using local HTDemucs.
 *
 * @param audioFile   The audio file to separate
 * @param model       HTDemucs model to use (default: htdemucs)
 * @param onProgress  Optional progress callback
 * @returns Map of stem names to download URLs
 */
export async function separateWithDemucs(
  audioFile: File,
  model: DemucsModel = 'htdemucs',
  onProgress?: (update: DemucsProgress) => void
): Promise<Record<string, string>> {
  const report = (message: string) => onProgress?.({ message });

  report('Uploading to HTDemucs…');
  const fd = new FormData();
  fd.append('audio_file', audioFile);
  fd.append('model', model);

  const res = await fetch('/api/stem/separate', {
    method: 'POST',
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`HTDemucs separation failed: ${text}`);
  }

  const data: DemucsResult = await res.json();

  if (!data.success) {
    throw new Error(data.error || 'HTDemucs separation failed');
  }

  report('Processing complete!');

  const urls: Record<string, string> = {};
  if (data.stems) {
    for (const [stemName, stemInfo] of Object.entries(data.stems)) {
      urls[stemName] = stemInfo.download_url;
    }
  }

  return urls;
}
