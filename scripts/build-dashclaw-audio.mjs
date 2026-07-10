// Source of truth for dashclaw launch AUDIO copy: props/dashclaw-audio.json is
// GENERATED. Edit VO lines and the music prompt here, never in the JSON.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'studio', 'public', 'dashclaw', 'audio');

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

// Spoken copy: written for the ear ("dashclaw dot io", never "dashclaw.io"). No
// logo-act line — the logo act is a silent brand reveal under music only. Serious,
// precise, no hype, no exclamation marks. Verbs: intercept, enforce, record, verify.
const LINES = [
  {id: 'hook', text: 'Nothing sensitive runs until you allow it.'},
  {
    id: 'demo',
    text:
      "Every action your unattended agent tries is intercepted and held here, risk scored, and " +
      'bound to the exact command. One click releases it, and the decision is recorded, chained ' +
      'to every governed action that follows. One ledger, many lenses, every rule that governs ' +
      'your agents.',
  },
  {id: 'feature-0', text: 'Held before they run. Risk scored. One click to allow or deny.'},
  {id: 'feature-1', text: 'One ledger, chained to the decision. Spend and risk verified, on the record.'},
  {id: 'end', text: 'Govern your agents at dashclaw dot io.'},
];

const MUSIC_PROMPT =
  'restrained minimal instrumental, quiet analog synth pulse and soft mechanical clicks like a ' +
  'relay closing, deliberate steady tempo around 92 bpm, understated tension that resolves into ' +
  'a calm steady close at the end, no drum build, no pads, no vocals, precise and controlled ' +
  'throughout';

// total duration in ms; constants mirror studio/src/lib/launchTiming.ts
const telemetry = JSON.parse(readFileSync(join(root, 'props', 'dashclaw-demo.json'), 'utf8')).telemetry;
const demoLen = Math.ceil((telemetry.durationMs / 1000) * 30) + 24;
// the `2 *` must track this brand's feature count in build-dashclaw-launch-props.mjs
const totalFrames = 150 + 186 + demoLen + 2 * 180 + 150;
const totalMs = Math.round((totalFrames / 30) * 1000);

mkdirSync(outDir, {recursive: true});
const durations = {};

const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: generate missing lines (or forced ones)
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(outDir, `${l.id}.mp3`)));
if (pending.length > 0) {
  const scriptPath = join(root, 'out', 'dashclaw', 'vo-script.json');
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
  music: {src: 'dashclaw/audio/music.mp3', durationMs: durations.music},
  lines: LINES.map((l) => ({
    act: l.id,
    src: `dashclaw/audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
  })),
};
writeFileSync(join(root, 'props', 'dashclaw-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote props/dashclaw-audio.json (${totalMs}ms track, ${LINES.length} lines)`);
