/**
 * Stemdeck Client Service
 *
 * Talks to the Stemdeck backend (github.com/stemdeckapp/stemdeck)
 * via Next.js API proxy routes.
 *
 * The Stemdeck backend must be running locally, e.g.:
 *   cd stemdeck && ./run.sh start
 * Default URL: http://localhost:8765
 */

export interface StemdeckProgress {
  message: string;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 300; // 15 minutes max

export async function separateStemsWithStemdeck(
  audioFile: File,
  onProgress?: (update: StemdeckProgress) => void
): Promise<Record<string, string>> {
  const report = (message: string) => onProgress?.({ message });

  report('Uploading to Stemdeck…');
  const fd = new FormData();
  fd.append('file', audioFile);

  const submitRes = await fetch('/api/stemdeck/jobs', { method: 'POST', body: fd });
  if (!submitRes.ok) throw new Error(`Stemdeck submit failed: ${submitRes.status}`);

  const submitData = await submitRes.json();
  const jobId: string = submitData.job_id;
  if (!jobId) throw new Error('No job_id from Stemdeck');

  report('Processing on Stemdeck…');

  let polls = 0;
  while (polls < MAX_POLLS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    polls++;

    let status: { state: string; progress?: number; error?: string; stems?: string[] };
    try {
      const res = await fetch(`/api/stemdeck/jobs/${jobId}`);
      status = await res.json();
    } catch { continue; }

    const pct = Math.round((status.progress ?? 0) * 100);
    report(`Stemdeck: ${status.state} ${pct > 0 ? pct + '%' : ''}`);

    if (status.state === 'done') {
      const stems = status.stems ?? ['vocals', 'drums', 'bass', 'other'];
      const urls: Record<string, string> = {};
      for (const s of stems) urls[s] = `/api/stemdeck/jobs/${jobId}/stems/${s}`;
      return urls;
    }
    if (status.state === 'error') {
      throw new Error(status.error ?? 'Stemdeck processing error');
    }
  }

  throw new Error('Stemdeck job timed out after 15 minutes');
}
