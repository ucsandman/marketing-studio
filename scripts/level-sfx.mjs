#!/usr/bin/env node
// scripts/level-sfx.mjs — fix a quiet SFX source at the ASSET, not the cue volume.
//
// A cue's volume cannot rescue a quiet source: summing a -38 dB signal into a -17 dB
// bed changes the mix by hundredths of a dB regardless of the volume prop. So this
// levels the asset — trims it to its first real transient (field recordings open with
// room tone; leveling the silence just makes loud silence), gains it, limits the
// peaks, and prints before/after so the numbers are on the record. It does NOT decide
// whether the result is audible in a mix — only the delivered file proves that
// (scripts/verify-cue.mjs). Ported from AbubakrChan/product-launch-motion's level-sfx.mjs.
//
// Shells to plain `ffmpeg` on PATH, not `npx remotion ffmpeg` — Remotion's bundled
// build has no volumedetect/alimiter filters.
//
// Usage: node scripts/level-sfx.mjs <in> [--gain <dB>=22] [--dur <s>=1.1] [--out <path>]
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join, basename, extname, resolve} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const FADE = 0.15; // fixed: fade the trimmed clip out over its last 150ms

const argv = process.argv.slice(2);
const flagIdx = {};
for (const name of ['gain', 'dur', 'out']) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) flagIdx[name] = i;
}
const skip = new Set(Object.values(flagIdx).flatMap((i) => [i, i + 1]));
const flag = (name, fallback) => (name in flagIdx ? argv[flagIdx[name] + 1] : fallback);

const input = argv.find((a, i) => !skip.has(i) && !a.startsWith('--'));
if (!input || !existsSync(resolve(input))) {
  console.error('usage: node scripts/level-sfx.mjs <in> [--gain <dB>=22] [--dur <s>=1.1] [--out <path>]');
  process.exit(1);
}
const inputAbs = resolve(input);
const gain = Number(flag('gain', 22));
const dur = Number(flag('dur', 1.1));
const ext = extname(inputAbs);
const output = resolve(flag('out', join(dirname(inputAbs), `${basename(inputAbs, ext)}-loud${ext}`)));

function ffmpeg(args) {
  return spawnSync('ffmpeg', args, {encoding: 'utf8'});
}

// ffmpeg writes volumedetect's report to stderr and still exits 0 on a clean read.
function measure(file, extra = []) {
  const res = ffmpeg(['-hide_banner', ...extra, '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const text = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const mean = Number(text.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1] ?? NaN);
  const max = Number(text.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1] ?? NaN);
  if (Number.isNaN(mean)) throw new Error(`level-sfx: could not measure ${file} — is ffmpeg installed and the file readable?`);
  return {mean, max};
}

const before = measure(inputAbs);

// First real transient: scan 50ms slices and return the start of the first one whose
// peak is within `window` dB of the file's overall peak — a cue must start on a hit,
// not on the room tone that preceded it.
function firstTransient(file, overallPeak, window = 12, step = 0.05, limit = 3) {
  for (let t = 0; t < limit; t += step) {
    const {max} = measure(file, ['-ss', t.toFixed(3), '-t', String(step)]);
    if (Number.isFinite(max) && max >= overallPeak - window) return t;
  }
  return 0;
}

const from = firstTransient(inputAbs, before.max);
if (from > 0) console.log(`head: first transient at ${from.toFixed(2)}s — trimming the room tone`);

const filter = `volume=${gain}dB,alimiter=level_out=0.9:limit=0.9,afade=t=out:st=${Math.max(0, dur - FADE).toFixed(3)}:d=${FADE}`;

const encodeRes = ffmpeg([
  '-hide_banner', '-y', '-ss', String(from), '-t', String(dur), '-i', inputAbs,
  '-af', filter, '-c:a', 'libmp3lame', '-b:a', '192k', output,
]);
if (encodeRes.status !== 0 || !existsSync(output)) {
  console.error(`level-sfx: encode failed (exit ${encodeRes.status})`);
  console.error(encodeRes.stderr ?? '');
  process.exit(1);
}

const after = measure(output);
const fmt = (v) => (Number.isFinite(v) ? `${v.toFixed(1)} dB` : '?');
console.log(`in   ${inputAbs}`);
console.log(`     mean ${fmt(before.mean)}   peak ${fmt(before.max)}`);
console.log(`out  ${output}`);
console.log(`     mean ${fmt(after.mean)}   peak ${fmt(after.max)}   (${(after.mean - before.mean >= 0 ? '+' : '')}${(after.mean - before.mean).toFixed(1)} dB mean)`);
console.log(`\nThis is a report, not a verdict — it does not claim the cue is audible in any mix.`);
console.log(`Prove it in the delivered file: node scripts/verify-cue.mjs <master.mp4> <cue start> <cue dur>`);
