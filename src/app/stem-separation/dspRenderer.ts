/**
 * Browser DSP Stem Renderer
 * Fallback when no cloud or local ML backend is available.
 * Uses bandpass filtering for rough separation (~40% quality).
 */

export interface StemConfig {
  key: string;
  label: string;
  color: string;
  freqLow: number;
  freqHigh: number;
  gain: number;
}

export async function renderStemAudioDSP(
  audioBuffer: AudioBuffer,
  stem: StemConfig,
): Promise<AudioBuffer> {
  const sr = audioBuffer.sampleRate;
  const len = audioBuffer.length;
  const ch = audioBuffer.numberOfChannels;

  const ctx = new OfflineAudioContext(ch, len, sr);
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;

  let lastNode: AudioNode = source;

  if (stem.freqLow > 20) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = stem.freqLow;
    hp.Q.value = 0.7;
    lastNode.connect(hp);
    lastNode = hp;
  }

  if (stem.freqHigh < sr / 2 - 100) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = stem.freqHigh;
    lp.Q.value = 0.7;
    lastNode.connect(lp);
    lastNode = lp;
  }

  // Vocal extraction: mid-side center channel
  if (stem.key === 'vocals' && ch >= 2) {
    const merger = ctx.createChannelMerger(2);
    const splitter = ctx.createChannelSplitter(2);
    lastNode.connect(splitter);
    const lGain = ctx.createGain(); lGain.gain.value = 0.5;
    const rGain = ctx.createGain(); rGain.gain.value = 0.5;
    splitter.connect(lGain, 0);
    splitter.connect(rGain, 1);
    const mid = ctx.createGain(); mid.gain.value = 1.0;
    lGain.connect(mid);
    rGain.connect(mid);
    lastNode = mid;
  }

  const gain = ctx.createGain();
  gain.gain.value = stem.gain;
  lastNode.connect(gain);
  gain.connect(ctx.destination);

  source.start(0);
  return ctx.startRendering();
}
