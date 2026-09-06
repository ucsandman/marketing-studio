// Shared post-render sound-design primitives. This module contains no CLI side
// effects so score-film and the production judges can import the same measurements.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, statSync} from 'node:fs';
import {projectArg, resolveWorkspace} from './workspace.mjs';

export const MAX_BRIDGE_FRAMES = 15; // 500 ms at the studio's 30 fps
export const MARKER_TOLERANCE_MS = 120;
const ANALYSIS_RATE = 400;
const WINDOW_SAMPLES = 20; // 50 ms onset envelope

export function requireAudioWorkspace(engineRoot, brand, argv = process.argv.slice(2)) {
  const project = projectArg(argv);
  if (!project) throw new Error(`audio build for ${brand} requires --project <product-repo>`);
  return resolveWorkspace(engineRoot, {brand, project});
}

export function resolveNarrationLines(lines, fps, totalMs) {
  return lines.map((line) => {
    if (!line.bridge) return {...line};
    const {kind, cutMs, frames} = line.bridge;
    if (!['J', 'L'].includes(kind)) throw new Error(`${line.id}: bridge kind must be J or L`);
    if (!Number.isInteger(frames) || frames < 1 || frames > MAX_BRIDGE_FRAMES) {
      throw new Error(`${line.id}: bridge must be 1-${MAX_BRIDGE_FRAMES} frames`);
    }
    if (!Number.isFinite(cutMs) || cutMs < 0 || cutMs > totalMs) {
      throw new Error(`${line.id}: bridge cutMs is outside the picture`);
    }
    const handleMs = (frames / fps) * 1000;
    const startMs = kind === 'J' ? cutMs - handleMs : cutMs + handleMs - line.durationMs;
    if (startMs < 0 || startMs + line.durationMs > totalMs) {
      throw new Error(`${line.id}: ${kind}-bridge runs outside the picture`);
    }
    return {...line, startMs: Math.round(startMs)};
  });
}

export function detectBeatGrid(samples, sampleRate = ANALYSIS_RATE) {
  const envelope = [];
  for (let i = 0; i + WINDOW_SAMPLES <= samples.length; i += WINDOW_SAMPLES) {
    let sum = 0;
    for (let j = i; j < i + WINDOW_SAMPLES; j++) sum += samples[j] * samples[j];
    envelope.push(Math.sqrt(sum / WINDOW_SAMPLES));
  }
  if (envelope.length < 40) return {estimatedBpm: null, confidence: 0, beatTimesMs: [], windows: envelope.length};
  const flux = envelope.map((value, i) => Math.max(0, value - (envelope[i - 1] ?? value)));
  // Silence and constant/DC input have no positive onset energy. Without this
  // guard best.lag remains zero and the BPM octave-fold loop never terminates.
  if (!flux.some((value) => value > 0)) {
    return {estimatedBpm: null, confidence: 0, beatTimesMs: [], windows: envelope.length};
  }
  const sorted = [...flux].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const threshold = median * 2.5 + 1e-6;
  const peaks = [];
  for (let i = 2; i < flux.length - 2; i++) {
    if (flux[i] < threshold || flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    if (peaks.length && i - peaks.at(-1) < 4) {
      if (flux[i] > flux[peaks.at(-1)]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  let best = {lag: 0, score: 0};
  for (let lag = 7; lag <= 20; lag++) {
    let dot = 0;
    let aa = 0;
    let bb = 0;
    for (let i = lag; i < flux.length; i++) {
      dot += flux[i] * flux[i - lag];
      aa += flux[i] ** 2;
      bb += flux[i - lag] ** 2;
    }
    const score = aa && bb ? dot / Math.sqrt(aa * bb) : 0;
    if (score > best.score) best = {lag, score};
  }
  if (best.lag === 0 || best.score <= 0) {
    return {estimatedBpm: null, confidence: 0, beatTimesMs: [], windows: envelope.length};
  }
  let bpm = 60 / (best.lag * (WINDOW_SAMPLES / sampleRate));
  while (bpm < 70) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  const confidence = Number(best.score.toFixed(3));
  return {
    // Stay conservative: beds and room tone often exhibit weak codec periodicity.
    // Only a strong autocorrelation plus repeated onsets earns a BPM claim.
    estimatedBpm: confidence >= 0.55 && peaks.length >= 8 ? Number(bpm.toFixed(1)) : null,
    confidence,
    beatTimesMs: peaks.map((i) => Math.round(i * (WINDOW_SAMPLES / sampleRate) * 1000)),
    windows: envelope.length,
  };
}

export function analyzeMusicBed(file) {
  const result = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(ANALYSIS_RATE), '-af', 'highpass=f=40,lowpass=f=180', '-f', 'f32le', 'pipe:1'],
    {encoding: null, maxBuffer: 16 * 1024 * 1024},
  );
  if (result.error || result.status !== 0) {
    return {estimatedBpm: null, confidence: 0, beatTimesMs: [], windows: 0, error: String(result.stderr ?? result.error)};
  }
  const bytes = result.stdout;
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  return detectBeatGrid(samples, ANALYSIS_RATE);
}

export function assessMusicMarkers(markers, analysis, fps) {
  return (markers ?? []).map((marker) => {
    const timeMs = marker.timeMs ?? (marker.frame / fps) * 1000;
    if (!analysis.beatTimesMs.length) {
      return {...marker, timeMs: Math.round(timeMs), nearestBeatMs: null, deltaMs: null, aligned: null};
    }
    const nearestBeatMs = analysis.beatTimesMs.reduce((best, value) =>
      Math.abs(value - timeMs) < Math.abs(best - timeMs) ? value : best,
    );
    const deltaMs = Math.round(nearestBeatMs - timeMs);
    return {
      ...marker,
      timeMs: Math.round(timeMs),
      nearestBeatMs,
      deltaMs,
      aligned: Math.abs(deltaMs) <= MARKER_TOLERANCE_MS,
    };
  });
}

export function probeMedia(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,sample_rate,channels', '-of', 'json', file],
    {encoding: 'utf8'},
  );
  if (result.error || result.status !== 0) throw new Error(`ffprobe failed for ${file}: ${result.stderr ?? result.error}`);
  const data = JSON.parse(result.stdout);
  const audio = (data.streams ?? []).find((stream) => stream.codec_type === 'audio') ?? null;
  return {
    durationSec: Number(data.format?.duration),
    bytes: Number(data.format?.size ?? statSync(file).size),
    audio: audio
      ? {codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels}
      : null,
  };
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(file);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

export function reportFindings({measurements, beatAnalysis, markerResults, expectedDurationSec, actualDurationSec}) {
  const findings = [];
  if (Math.abs(actualDurationSec - expectedDurationSec) > 0.05) {
    findings.push({level: 'error', category: 'duration', message: `Audio mux changed picture duration by ${(actualDurationSec - expectedDurationSec).toFixed(3)}s`});
  }
  if (beatAnalysis.estimatedBpm == null) {
    findings.push({level: 'info', category: 'rhythm', message: `No defensible BPM estimate; confidence ${beatAnalysis.confidence} from ${beatAnalysis.windows} analysis windows`});
  } else {
    findings.push({level: 'info', category: 'rhythm', message: `Measured ${beatAnalysis.estimatedBpm} BPM at confidence ${beatAnalysis.confidence}; detected ${beatAnalysis.beatTimesMs.length} onset candidates`});
  }
  for (const marker of markerResults) {
    findings.push({
      level: marker.aligned === false ? 'warning' : marker.aligned === true ? 'info' : 'incomplete',
      category: 'music-marker',
      message: marker.nearestBeatMs == null
        ? `${marker.id} could not be compared with a measured beat`
        : `${marker.id} is ${Math.abs(marker.deltaMs)}ms from the nearest measured beat`,
      timeSec: marker.timeMs / 1000,
      evidence: marker,
    });
  }
  findings.push({
    level: 'info',
    category: 'delivery',
    message: `Delivered I ${measurements.I} LUFS, TP ${measurements.TP} dBTP, LRA ${measurements.LRA} LU`,
    evidence: measurements,
  });
  findings.push({
    level: 'incomplete',
    category: 'perceptual-review',
    message: 'Machine measurements do not establish intelligibility, taste, sync feel, or whether the mix should ship.',
  });
  return findings;
}
