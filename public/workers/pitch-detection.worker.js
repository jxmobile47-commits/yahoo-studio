// Pitch Detection Web Worker
// Runs autocorrelation pitch detection off the main thread

function autocorrelationPitchDetect(buffer, sampleRate) {
  const n = buffer.length;
  // Normalize
  let sum = 0;
  for (let i = 0; i < n; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / n);
  if (rms < 0.01) return null;

  // Autocorrelation
  const ac = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) {
      s += buffer[i] * buffer[i + lag];
    }
    ac[lag] = s;
  }

  let maxVal = -Infinity;
  let maxPos = -1;
  const minPeriod = Math.floor(sampleRate / 2000);
  const maxPeriod = Math.floor(sampleRate / 50);

  for (let i = minPeriod; i < maxPeriod && i < n; i++) {
    if (ac[i] > maxVal) {
      maxVal = ac[i];
      maxPos = i;
    }
  }

  if (maxPos <= 0 || maxPos >= n - 1) return null;

  const y1 = ac[maxPos - 1] || 0;
  const y2 = ac[maxPos] || 0;
  const y3 = ac[maxPos + 1] || 0;
  const denom = 2 * (2 * y2 - y1 - y3);
  const shift = denom !== 0 ? (y3 - y1) / denom : 0;
  return sampleRate / (maxPos + shift);
}

function computeRMS(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

function medianFilter(values, windowSize) {
  const half = Math.floor(windowSize / 2);
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    const slice = [];
    for (let j = start; j < end; j++) if (values[j] !== null) slice.push(values[j]);
    if (slice.length === 0) { out[i] = null; continue; }
    slice.sort((a, b) => a - b);
    out[i] = slice[Math.floor(slice.length / 2)];
  }
  return out;
}

function frequencyToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

self.onmessage = function (e) {
  const { channelData, sampleRate, bpm, maxBeats } = e.data;
  const frameSize = 2048;
  const hopSize = 512;
  const beatsPerSecond = bpm / 60;

  const frames = [];
  const rmsValues = [];
  let maxRMS = 0;

  // Pass 1: RMS
  for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
    const frame = channelData.subarray(i, i + frameSize);
    const rms = computeRMS(frame);
    rmsValues.push(rms);
    if (rms > maxRMS) maxRMS = rms;
  }

  const silenceThreshold = maxRMS * 0.15;
  const totalFrames = Math.floor((channelData.length - frameSize) / hopSize);
  let processedFrames = 0;

  // Pass 2: pitch
  let frameIdx = 0;
  for (let i = 0; i + frameSize < channelData.length; i += hopSize) {
    const rms = rmsValues[frameIdx++];
    let midi = null;
    if (rms >= silenceThreshold) {
      const frame = channelData.subarray(i, i + frameSize);
      const freq = autocorrelationPitchDetect(frame, sampleRate);
      if (freq) {
        const m = frequencyToMidi(freq);
        if (m >= 48 && m <= 84 && isFinite(m)) midi = Math.round(m);
      }
    }
    frames.push({ time: i / sampleRate, midi });
    processedFrames++;
    if (processedFrames % 50 === 0) {
      self.postMessage({ type: 'progress', value: processedFrames / totalFrames });
    }
  }

  // Smooth
  const smoothed = medianFilter(frames.map(f => f.midi), 5);

  // Group into notes
  const notes = [];
  let currentPitch = null;
  let startTime = 0;
  let lastTime = 0;
  let frameCount = 0;
  const MIN_FRAMES = 4;

  const flush = () => {
    if (currentPitch === null || frameCount < MIN_FRAMES) return;
    const startBeat = Math.round((startTime * beatsPerSecond) * 4) / 4;
    const endBeat = Math.round((lastTime * beatsPerSecond) * 4) / 4;
    const duration = Math.max(0.25, endBeat - startBeat);
    if (duration >= 0.25 && startBeat < maxBeats) {
      notes.push({
        id: `v${Date.now()}_${notes.length}`,
        pitch: currentPitch,
        start: startBeat,
        duration: Math.min(duration, maxBeats - startBeat),
        lyric: '',
      });
    }
  };

  for (let i = 0; i < smoothed.length; i++) {
    const midi = smoothed[i];
    const frame = frames[i];
    if (midi === null || !frame) {
      flush();
      currentPitch = null;
      frameCount = 0;
      continue;
    }
    if (currentPitch === null) {
      currentPitch = midi;
      startTime = frame.time;
      lastTime = frame.time;
      frameCount = 1;
    } else if (Math.abs(midi - currentPitch) <= 1) {
      lastTime = frame.time;
      frameCount++;
    } else {
      flush();
      currentPitch = midi;
      startTime = frame.time;
      lastTime = frame.time;
      frameCount = 1;
    }
  }
  flush();

  self.postMessage({ type: 'done', notes });
};
