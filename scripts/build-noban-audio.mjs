// Source of truth for noban launch AUDIO copy: props/noban-audio.json is GENERATED.
// Edit VO lines and the music prompt here, never in the JSON.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'studio', 'public', 'noban', 'audio');

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

// Spoken copy: written for the ear (say "noban dot gg", never "noban.gg")
const LINES = [
  {id: 'logo', text: 'This is noban. CS2 skin arbitrage with guardrails.'},
  {id: 'hook', text: 'It finds the spread. You keep the profit. The guardrails keep you honest.'},
  {id: 'demo', text: 'The trading desk scans nine venues live, ranks every opportunity by net dollars, and books each simulated trade to the ledger.'},
  {id: 'feature-0', text: 'Hard spend caps and a kill switch, enforced in the backend.'},
  {id: 'feature-1', text: 'Cost basis, realized gains, and a tax worksheet your accountant can read.'},
  {id: 'end', text: 'Simulate free at noban dot gg.'},
];

const MUSIC_PROMPT =
  'minimal dark electronic pulse, restrained analog synths, steady confident tempo around 100 bpm, precise and instrument-like, understated build, no vocals';

// total duration in ms; constants mirror studio/src/lib/launchTiming.ts
const telemetry = JSON.parse(readFileSync(join(root, 'props', 'noban-demo.json'), 'utf8')).telemetry;
const demoLen = Math.ceil((telemetry.durationMs / 1000) * 30) + 24;
// the `2 *` must track this brand's feature count in build-launch-props.mjs
const totalFrames = 150 + 186 + demoLen + 2 * 180 + 150;
const totalMs = Math.round((totalFrames / 30) * 1000);

mkdirSync(outDir, {recursive: true});
const durations = {};

const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: generate missing lines (or forced ones)
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(outDir, `${l.id}.mp3`)));
if (pending.length > 0) {
  const scriptPath = join(root, 'out', 'noban', 'vo-script.json');
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
  music: {src: 'noban/audio/music.mp3', durationMs: durations.music},
  lines: LINES.map((l) => ({
    act: l.id,
    src: `noban/audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
  })),
};

// Sound-design cue gate: enable the sfx layer only when the shared library is staged
// (run scripts/build-sfx.mjs first). Cue FRAMES are NOT written here — they are derived
// at render time from launchTiming by studio/src/lib/sfxCues.ts (mirrors how voWindows
// derives VO timing), so the builder only flips the presence flag. Absent library =>
// key omitted => renders stay byte-identical to today.
const sfxLib = ['whoosh', 'tick', 'riser'].map((k) => join(root, 'studio', 'public', 'sfx', `${k}.mp3`));
if (sfxLib.every((f) => existsSync(f))) {
  manifest.sfx = {enabled: true};
  console.log('sfx: library present -> manifest.sfx.enabled = true');
}

writeFileSync(join(root, 'props', 'noban-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote props/noban-audio.json (${totalMs}ms track, ${LINES.length} lines)`);
