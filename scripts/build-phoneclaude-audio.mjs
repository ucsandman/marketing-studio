// Source of truth for phoneclaude launch AUDIO copy: props/phoneclaude-audio.json is
// GENERATED. Edit VO lines and the music prompt here, never in the JSON.
//
// Narration acts here are already zero-indexed (feature-0/1/2) in
// out/phoneclaude/marketing/brief.json, matching launchTiming.ts /
// audioMix.ts's `feature-(\d+)` regex directly — no reindexing needed. Text is
// copied verbatim from brief.json's narration array (already written for the
// ear: "U I", "Apple I D").
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'studio', 'public', 'phoneclaude', 'audio');

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

// Spoken copy: terse, technical, honest narrator voice; no hype, no em dashes.
// Text mirrors out/phoneclaude/marketing/brief.json's narration array verbatim.
const LINES = [
  {id: 'logo', text: 'sidetap.'},
  {id: 'hook', text: 'This is a real iPhone, driven from Windows. No Mac. No jailbreak.'},
  {
    id: 'demo',
    text: 'It reads the actual screen, finds real buttons, and types like a person. You watch every move, live.',
  },
  {
    // Trimmed from brief.json's approved "...Exact buttons, exact labels, no
    // guessing." — judge-av-sync measured a 533ms overrun of the feature-0 act
    // budget (210 frames); cut "no guessing" (2 words) to fit, meaning already
    // carried by "Exact buttons, exact labels."
    id: 'feature-0',
    text: 'Under it all: the real U I element tree. Exact buttons, exact labels.',
  },
  {
    id: 'feature-1',
    text:
      'Nervous? Same. That is why the red stop button freezes everything, and ambiguous sends ' +
      'abort before a word gets typed.',
  },
  {
    id: 'feature-2',
    text: 'A free Apple I D is enough. One command fixes the signing Apple makes hard.',
  },
  {id: 'end', text: 'Your PC can text your mom now. Clone it free and drive your phone.'},
];

// Restrained, technical electronic bed for a hacker-tool brand: terminal
// ambience with momentum, not consumer-gadget gloss. Blue is the brand's
// action color, so no warm/bright synth pads. No vocals.
const MUSIC_PROMPT =
  'minimal technical electronic bed, dry clicky sequenced pulse like a terminal cursor, ' +
  'restrained analog bass, steady confident tempo around 100 bpm, cold precise synths, ' +
  'quiet forward momentum, no pads, no vocals, no consumer-gadget gloss, no cinematic swell';

// total duration in ms: phoneclaude's picture is locked to a custom actLengths
// override (props/phoneclaude-launch.json), not the shared defaults — read it
// here rather than hardcode so this stays correct if the override ever moves.
const launchProps = JSON.parse(readFileSync(join(root, 'props', 'phoneclaude-launch.json'), 'utf8'));
const actLengths = launchProps.actLengths ?? {};
const telemetry = JSON.parse(readFileSync(join(root, 'props', 'phoneclaude-demo.json'), 'utf8')).telemetry;
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
  const scriptPath = join(root, 'out', 'phoneclaude', 'vo-script.json');
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
  music: {src: 'phoneclaude/audio/music.mp3', durationMs: durations.music},
  lines: LINES.map((l) => ({
    act: l.id,
    src: `phoneclaude/audio/${l.id}.mp3`,
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

writeFileSync(join(root, 'props', 'phoneclaude-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote props/phoneclaude-audio.json (${totalMs}ms track, ${LINES.length} lines)`);
