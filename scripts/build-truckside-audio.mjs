// Source of truth for truckside launch AUDIO copy: props/truckside-audio.json is
// GENERATED. Edit VO lines and the music prompt here, never in the JSON.
//
// Text mirrors out/truckside/marketing/brief.json's narration array, written for
// the ear. GATE SCOPE is load-bearing (council dissenter 2026-09-04): the end line
// must keep "every message and charge waits for your tap" and must never compress
// to "nothing happens without you" — the reception call and its booking are
// autonomous; only sends and money moves are gated. Trim other words first.
//
// Feature acts are ZERO-INDEXED (feature-0/1/2) to match audioMix.ts's
// `feature-(\d+)` regex and the launch props features array, even though the brief
// numbers them 1/2/3.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'studio', 'public', 'truckside', 'audio');

const forceFlagIdx = process.argv.indexOf('--force');
const forceArg = forceFlagIdx >= 0 ? process.argv[forceFlagIdx + 1] : undefined;
const forceIds =
  forceFlagIdx >= 0 && forceArg && !forceArg.startsWith('--') ? new Set(forceArg.split(',')) : null;
const forceAll = forceFlagIdx >= 0 && !forceIds;
const shouldForce = (id) => forceAll || (forceIds?.has(id) ?? false);

// Spoken copy: plain, concrete, verbs first; a back-office tool for a one-truck
// trades owner. No hype, no em dashes, no exclamation marks. "Truckside" is spoken
// as the wordmark (speechHint in brands/truckside.json primes the ear-gate).
const LINES = [
  {id: 'logo', text: 'Truckside.'},
  {
    id: 'hook',
    text: 'You are on the job when the call comes in, and voicemail loses it. Truckside answers instead.',
  },
  {
    id: 'demo',
    text: 'This is the whole shop, run from one dashboard while you are out on the truck.',
  },
  {
    id: 'feature-0',
    text: 'When you cannot pick up, the reception agent gets the details and books a window.',
  },
  {
    id: 'feature-1',
    text: 'Give it a job and it builds a priced quote. You approve with one tap.',
  },
  {
    id: 'feature-2',
    text: 'It drafts the nudges and reminders and holds each one until it is due.',
  },
  {
    // "still" dropped from the brief line for a wider margin against the 300f end
    // act; the protected gate clause is kept intact.
    id: 'end',
    text: 'The call that would have been lost is booked. Every message and charge waits for your tap. See the live demo.',
  },
];

// A plain, working bed for a tradesperson: warm and grounded, quiet momentum, not
// consumer-app gloss and not cinematic. Green is calm competence, so no bright neon
// synth. No vocals.
const MUSIC_PROMPT =
  'warm understated indie-electronic bed, steady mid-tempo around 95 bpm, soft muted ' +
  'electric guitar and Rhodes, gentle rounded pulse, quiet confident working-day momentum, ' +
  'grounded and honest, no vocals, no cinematic swell, no bright synth gloss, no aggressive drums';

// Total duration: truckside's picture is locked to a custom actLengths override in
// props/truckside-launch.json; read it here so this stays correct if the lock moves.
const launchProps = JSON.parse(readFileSync(join(root, 'props', 'truckside-launch.json'), 'utf8'));
const actLengths = launchProps.actLengths ?? {};
const telemetry = JSON.parse(readFileSync(join(root, 'props', 'truckside-demo.json'), 'utf8')).telemetry;
const demoLen = Math.ceil((telemetry.durationMs / 1000) * 30) + (actLengths.demoTail ?? 24);
const featureLens = [0, 1, 2].map((i) => actLengths.features?.[i] ?? 180);
const totalFrames =
  (actLengths.logo ?? 150) +
  (actLengths.hook ?? 186) +
  demoLen +
  featureLens.reduce((a, b) => a + b, 0) +
  (actLengths.end ?? 150);
const totalMs = Math.round((totalFrames / 30) * 1000);

mkdirSync(outDir, {recursive: true});
const durations = {};

const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: generate missing lines (or forced ones). --brand truckside resolves the
// brand voice (unset -> global unset -> default Rachel; the feeder logs which won).
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(outDir, `${l.id}.mp3`)));
if (pending.length > 0) {
  const scriptPath = join(root, 'out', 'truckside', 'vo-script.json');
  mkdirSync(dirname(scriptPath), {recursive: true});
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(`node feeders/audio/client.mjs vo --brand truckside --script "${scriptPath}" --out "${outDir}"`);
  process.stdout.write(out);
  for (const m of out.matchAll(/vo OK: (.+)\.mp3 (\d+)ms/g)) durations[m[1]] = Number(m[2]);
}

for (const l of LINES) {
  if (durations[l.id] !== undefined) continue;
  const file = join(outDir, `${l.id}.mp3`);
  if (!existsSync(file)) continue;
  const out = run(`node feeders/audio/client.mjs probe --file "${file}"`);
  process.stdout.write(out);
  const m = out.match(/probe OK: .+ (\d+)ms/);
  if (m) durations[l.id] = Number(m[1]);
}

const musicFile = join(outDir, 'music.mp3');
if (shouldForce('music') || !existsSync(musicFile)) {
  const out = run(
    `node feeders/audio/client.mjs music --prompt "${MUSIC_PROMPT}" --length-ms ${totalMs} --out "${musicFile}"`,
  );
  process.stdout.write(out);
  const m = out.match(/music OK: .+ (\d+)ms/);
  durations.music = Number(m?.[1]);
} else {
  const out = run(`node feeders/audio/client.mjs probe --file "${musicFile}"`);
  process.stdout.write(out);
  const m = out.match(/probe OK: .+ (\d+)ms/);
  if (m) durations.music = Number(m[1]);
}

const missing = LINES.filter((l) => !durations[l.id]);
if (missing.length > 0) {
  throw new Error(`no measured duration for: ${missing.map((l) => l.id).join(', ')}`);
}
if (!durations.music) {
  throw new Error('no measured duration for music');
}

const manifest = {
  music: {src: 'truckside/audio/music.mp3', durationMs: durations.music},
  lines: LINES.map((l) => ({
    act: l.id,
    src: `truckside/audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
  })),
};

const sfxLib = ['whoosh', 'tick', 'riser'].map((k) => join(root, 'studio', 'public', 'sfx', `${k}.mp3`));
if (sfxLib.every((f) => existsSync(f))) {
  manifest.sfx = {enabled: true};
  console.log('sfx: library present -> manifest.sfx.enabled = true');
}

writeFileSync(join(root, 'props', 'truckside-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote props/truckside-audio.json (${totalMs}ms track, ${LINES.length} lines)`);
