// Source of truth for costclaw launch AUDIO copy: props/costclaw-audio.json is
// GENERATED. Edit VO lines and the music prompt here, never in the JSON.
//
// NOTE on act ids: brief.json's narration labels features 1-indexed
// (feature-1/2/3, matching the human-readable act table), but launchTiming.ts /
// audioMix.ts's `feature-(\d+)` regex indexes the features array 0-indexed
// (feature-0/1/2 -> timing.features[0/1/2]). The LINES below use the code's
// zero-indexed ids so VO stays aligned with the correct on-screen feature act;
// the TEXT is copied verbatim from brief.json's feature-1/2/3 entries in order.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'studio', 'public', 'costclaw', 'audio');

// --force              regenerate every line + music
// --force <id,id,...>  regenerate only the listed acts (and/or "music"), e.g.
//                       --force hook,demo — use this to fix one overrunning line
//                       without re-paying for lines that already fit.
const forceFlagIdx = process.argv.indexOf('--force');
const forceArg = forceFlagIdx >= 0 ? process.argv[forceFlagIdx + 1] : undefined;
const forceIds = forceFlagIdx >= 0 && forceArg && !forceArg.startsWith('--')
  ? new Set(forceArg.split(','))
  : null;
const forceAll = forceFlagIdx >= 0 && !forceIds;
const shouldForce = (id) => forceAll || (forceIds?.has(id) ?? false);

// Spoken copy: written for the ear ("n p x costclaw audit", never "npx costclaw
// audit"). Dry, precise, technical narrator — no hype, no exclamation marks.
// Text mirrors out/costclaw/marketing/brief.json's narration array verbatim.
const LINES = [
  {id: 'logo', text: 'CostClaw. A local audit for Claude Code.'},
  {
    id: 'hook',
    text: 'Your Anthropic invoice is one number. The waste hides in the session logs already on your disk.',
  },
  {
    id: 'demo',
    text:
      'One free command reads those logs on your machine, prices the recoverable spend, and ranks ' +
      'the fixes by the dollars they return.',
  },
  {
    id: 'feature-0',
    text: 'Cache misses, model misrouting, sessions that outgrow the cache. Each priced, with evidence.',
  },
  {
    id: 'feature-1',
    text: 'Then your setup gets a six pillar score, from evidence only. No evidence, no score.',
  },
  {
    id: 'feature-2',
    text: 'And through all of it, your prompts and your code never leave your machine. A tripwire test keeps it that way.',
  },
  {id: 'end', text: 'Run the free audit: n p x costclaw audit. Free, no account, nothing uploaded.'},
];

// Warm, unhurried, precise instrumental bed. Tidy mechanical warmth (soft keys /
// plucks, light percussion) supporting narration without competing — no EDM
// risers, no cinematic epic swell. Brand voice: honest receipt under warm shop
// light.
const MUSIC_PROMPT =
  'warm unhurried instrumental, soft electric piano and light plucked keys over a gentle low-key ' +
  'percussive pulse, tidy and precise like careful mechanical work, restrained and confident, ' +
  'understated dynamics that stay low under spoken narration, no drums fills, no risers, no EDM ' +
  'build, no cinematic epic swell, no vocals';

// total duration in ms: costclaw's picture is locked to a custom actLengths
// override (props/costclaw-launch.json), not the shared defaults — read it
// here rather than hardcode so this stays correct if the override ever moves.
const launchProps = JSON.parse(readFileSync(join(root, 'props', 'costclaw-launch.json'), 'utf8'));
const actLengths = launchProps.actLengths ?? {};
const telemetry = JSON.parse(readFileSync(join(root, 'props', 'costclaw-demo.json'), 'utf8')).telemetry;
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

// VO: generate missing lines (or forced ones)
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(outDir, `${l.id}.mp3`)));
if (pending.length > 0) {
  const scriptPath = join(root, 'out', 'costclaw', 'vo-script.json');
  mkdirSync(dirname(scriptPath), {recursive: true});
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(`node feeders/audio/client.mjs vo --script "${scriptPath}" --out "${outDir}"`);
  process.stdout.write(out);
  for (const m of out.matchAll(/vo OK: (.+)\.mp3 (\d+)ms/g)) durations[m[1]] = Number(m[2]);
}

// any line we skipped generating this run still needs a measured duration for the
// manifest; probe the file on disk instead of re-hitting the API.
for (const l of LINES) {
  if (durations[l.id] !== undefined) continue;
  const file = join(outDir, `${l.id}.mp3`);
  if (!existsSync(file)) continue; // caught by the manifest completeness check below
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
  music: {src: 'costclaw/audio/music.mp3', durationMs: durations.music},
  lines: LINES.map((l) => ({
    act: l.id,
    src: `costclaw/audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
  })),
};

// Sound-design cue gate: enable the sfx layer only when the shared library is staged
// (run scripts/build-sfx.mjs first).
const sfxLib = ['whoosh', 'tick', 'riser'].map((k) => join(root, 'studio', 'public', 'sfx', `${k}.mp3`));
if (sfxLib.every((f) => existsSync(f))) {
  manifest.sfx = {enabled: true};
  console.log('sfx: library present -> manifest.sfx.enabled = true');
}

writeFileSync(join(root, 'props', 'costclaw-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote props/costclaw-audio.json (${totalMs}ms track, ${LINES.length} lines)`);
