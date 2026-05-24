/**
 * Replicate Cloud Demucs Service
 *
 * Uses Replicate's cloud API for stem separation over the internet.
 * Requires a Replicate API token. Get one at:
 * https://replicate.com/account/api-tokens
 *
 * Model: facebookresearch/demucs
 * Quality: ~85% (true ML separation, no local server needed)
 */

export interface ReplicateProgress {
  phase: string;
  message: string;
}

const REPLICATE_API = 'https://api.replicate.com/v1';

export async function separateWithReplicate(
  audioFile: File,
  apiToken: string,
  onProgress?: (p: ReplicateProgress) => void
): Promise<Record<string, string>> {
  const report = (phase: string, message: string) => onProgress?.({ phase, message });

  report('uploading', 'Uploading audio to Replicate cloud…');

  // Upload file to Replicate's temporary storage
  const uploadRes = await fetch(`${REPLICATE_API}/files`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}` },
    body: audioFile,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.detail || `Upload failed: ${uploadRes.status}`);
  }

  const uploadData = await uploadRes.json();
  const fileUrl: string = uploadData.urls?.get || uploadData.url;
  if (!fileUrl) throw new Error('No upload URL from Replicate');

  report('running', 'Running Demucs on Replicate cloud…');

  // Create prediction using demucs-hq
  const predictionRes = await fetch(`${REPLICATE_API}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: '25a173108cff34272b4fe03e661982a8eba6952b11770f1eff7d0d0e5b092211',
      input: { audio: fileUrl, stems: 'all', model: 'htdemucs' },
    }),
  });

  if (!predictionRes.ok) {
    const err = await predictionRes.json().catch(() => ({}));
    throw new Error(err.detail || `Prediction failed: ${predictionRes.status}`);
  }

  const prediction = await predictionRes.json();
  const predictionId: string = prediction.id;

  // Poll for completion
  let status = prediction.status;
  let polls = 0;
  const maxPolls = 180; // ~15 minutes

  while (status !== 'succeeded' && status !== 'failed' && status !== 'canceled' && polls < maxPolls) {
    await new Promise(r => setTimeout(r, 5000));
    polls++;

    const pollRes = await fetch(`${REPLICATE_API}/predictions/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${apiToken}` },
    });

    if (!pollRes.ok) continue;
    const data = await pollRes.json();
    status = data.status;

    report('running', `Processing… ${Math.round((polls / maxPolls) * 100)}%`);

    if (status === 'succeeded' && data.output) {
      report('done', 'Separation complete!');
      return normalizeOutput(data.output);
    }
  }

  if (status === 'failed') throw new Error('Replicate prediction failed');
  if (status === 'canceled') throw new Error('Replicate prediction canceled');
  throw new Error('Replicate prediction timed out');
}

function normalizeOutput(output: unknown): Record<string, string> {
  if (typeof output === 'string') return { vocals: output, other: output };
  if (Array.isArray(output)) {
    const map: Record<string, string> = {};
    const names = ['vocals', 'drums', 'bass', 'other'];
    output.forEach((url, i) => { if (typeof url === 'string') map[names[i] || `stem_${i}`] = url; });
    return map;
  }
  if (output && typeof output === 'object') return output as Record<string, string>;
  throw new Error('Unexpected output format');
}
