#!/usr/bin/env node
// scripts/verify-cue.mjs — prove a sound cue is present in the DELIVERED file.
//
// A window-peak check alone can pass on a cue that starts late (silent head) or is
// buried under the mix — it only proves the cue is loud SOMEWHERE in the window. Read
// the ENVELOPE. Ported from AbubakrChan/product-launch-motion's verify-cue.sh; see
// docs/PLAYBOOK.md "Loudness mastering".
//
// Shells to plain `ffmpeg` on PATH, not `npx remotion ffmpeg` — Remotion's bundled
// build has no volumedetect filter.
//
// Usage: node scripts/verify-cue.mjs <file.mp4> <startSec> <durSec> [--strict] [--min-peak -20]
// Advisory: exit 0 with a verdict line. --strict exits 1 when the loudest 100ms slice in
// the window is under --min-peak dB — a source too quiet for any cue volume to fix.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const minPeakIdx = argv.indexOf('--min-peak');
const minPeak = minPeakIdx >= 0 ? Number(argv[minPeakIdx + 1]) : -20;
const skip = new Set(minPeakIdx >= 0 ? [minPeakIdx, minPeakIdx + 1] : []);
const positional = argv.filter((a, i) => !skip.has(i) && a !== '--strict');
const [file, startArg, durArg] = positional;

const start = Number(startArg);
const dur = Number(durArg);
if (!file || !existsSync(resolve(file)) || !Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0) {
  console.error('usage: node scripts/verify-cue.mjs <file.mp4> <startSec> <durSec> [--strict] [--min-peak -20]');
  process.exit(1);
}
const filePath = resolve(file);

// ffmpeg writes volumedetect's report to stderr and still exits 0 on a clean read.
function parseVol(text, key) {
  const m = text.match(new RegExp(`${key}:\\s*(-?[\\d.]+|-inf) dB`));
  if (!m) return NaN;
  return m[1] === '-inf' ? -Infinity : Number(m[1]);
}

function measure(ss, t) {
  const res = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-ss', ss.toFixed(3), '-t', t.toFixed(3), '-i', filePath, '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
    {encoding: 'utf8'},
  );
  const text = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return {mean: parseVol(text, 'mean_volume'), max: parseVol(text, 'max_volume')};
}

const fmt = (v) => (Number.isFinite(v) ? `${v.toFixed(1)} dB` : v === -Infinity ? '-inf dB' : '? dB');

const end = start + dur;
console.log(`window  ${start}s -> ${end.toFixed(2)}s\n`);

console.log('WINDOW');
const whole = measure(start, dur);
if (Number.isNaN(whole.mean)) {
  console.error(`verify-cue: could not measure ${filePath} — is ffmpeg installed and the window in range?`);
  process.exit(1);
}
console.log(`  mean_volume: ${fmt(whole.mean)}   max_volume: ${fmt(whole.max)}`);

console.log('\nENVELOPE (max_volume per 100ms — the cue should start where the animation starts)');
const slices = Math.ceil(dur / 0.1);
const envelope = [];
for (let i = 0; i < slices; i++) {
  const t = start + i * 0.1;
  const {max} = measure(t, 0.1);
  envelope.push(max);
  console.log(`  t=${t.toFixed(3).padEnd(8)} ${fmt(max).padStart(9)}`);
}

const finite = envelope.filter((v) => !Number.isNaN(v));
const loudest = finite.length ? Math.max(...finite) : -Infinity;
const verdict = loudest >= minPeak ? 'PASS' : 'FAIL';
console.log(`\nverify-cue: ${verdict} — loudest slice in window is ${fmt(loudest)} (min-peak ${minPeak} dB)`);
if (verdict === 'FAIL') {
  console.log('  every slice is quiet — the SOURCE is too quiet for any cue volume to fix:');
  console.log('    node scripts/level-sfx.mjs <asset>');
} else if (envelope.slice(0, Math.max(1, Math.round(slices * 0.2))).every((v) => v < loudest - 12)) {
  console.log('  the loudest slice is late — the cue may have a silent head, landing after the animation it punctuates.');
}
console.log('  read the ENVELOPE, not just the window: a window-peak check cannot see a cue that starts late.');

process.exit(strict && verdict === 'FAIL' ? 1 : 0);
