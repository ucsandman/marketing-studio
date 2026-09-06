// Source of truth for TenWords launch AUDIO copy: props/tenwords-audio.json is
// GENERATED. Edit VO lines and the music prompt here, never in the JSON.
//
// ACT IDS: brief.json's narration labels features 1-indexed (feature-1/2/3), but
// launchTiming.ts / audioMix.ts index the features ARRAY (feature-0/1/2). The film's
// feature order is also not the brief's (see scripts/build-launch-props.mjs), so the
// mapping is explicit here:
//   feature-0  <- brief narration feature-1  (the ten word guarantee)
//   feature-1  <- brief narration feature-3  (your key, your browser)
//   feature-2  <- brief narration feature-2  (restore, the closing beat)
//
// VO-FIRST: tenwords' picture lock is DERIVED from these measured lines
// (launchTiming.voActLen), so the act lengths follow the voice rather than the
// voice being trimmed to fit an act. Only the logo act is pinned, in
// props/tenwords-launch.json.
//
// BOUNDARY: this script owns the VOICE. Music generation is off by default and
// belongs to the audio-track pass, which runs this with --music once the picture
// is locked (the prompt below is the brief's, ready for it).
//
// Usage: node scripts/build-tenwords-audio.mjs [--force [ids]] [--no-timestamps] [--music]
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {requireAudioWorkspace} from './lib/sound-design.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = requireAudioWorkspace(root, 'tenwords');
const outDir = join(workspace.publicDir, 'audio');

// --force              regenerate every line (and music, when --music is on)
// --force <id,id,...>  regenerate only the listed acts, e.g. --force hook,demo
const forceFlagIdx = process.argv.indexOf('--force');
const forceArg = forceFlagIdx >= 0 ? process.argv[forceFlagIdx + 1] : undefined;
const forceIds = forceFlagIdx >= 0 && forceArg && !forceArg.startsWith('--')
  ? new Set(forceArg.split(','))
  : null;
const forceAll = forceFlagIdx >= 0 && !forceIds;
const shouldForce = (id) => forceAll || (forceIds?.has(id) ?? false);

// TRAP (PLAYBOOK): re-rendering the VO, or changing voice/model, invalidates every
// word time in the film. There is no partial rescue — delete the affected
// studio/public/tenwords/audio/*.words.json sidecars and re-run with --force <id>.
const WANT_TIMESTAMPS = !process.argv.includes('--no-timestamps');
const WANT_MUSIC = process.argv.includes('--music');

// Spoken copy: calm, exact, unhurried. Written for the ear ("alt T", "tenwords dot
// io"). No hype, no em dashes. Text mirrors out/tenwords/marketing/brief.json's
// narration, with two length edits noted inline.
const LINES = [
  {id: 'logo', text: 'TenWords.'},
  {
    id: 'hook',
    // The fold and the headline in the hook act are word-locked to "collapses" and
    // the second "Ten" in this line (props/tenwords-launch.json hookFold). Changing
    // either word moves the film's signature beat.
    text: 'Another ten thousand word read you will never finish. Then the page collapses. Ten words per paragraph.',
  },
  {
    id: 'demo',
    // Widened from brief.json's demo line: the demo act is a 31s window of real
    // capture, and the approved 24-word line left two thirds of it unnarrated.
    // Every added clause states something the footage is showing at that moment.
    text:
      'Press alt T on any article. TenWords reads every paragraph first, then the whole page folds ' +
      'at once. Ten words each, with a red pilcrow where the paragraph used to be, and a ten word ' +
      'summary of the whole article pinned to the top.',
  },
  {
    id: 'feature-0',
    text: 'The ten word guarantee is enforced in code. It counts every word, so you never have to check its work.',
  },
  {
    id: 'feature-1',
    text: 'Your key stays in your browser. No middle server, no analytics. A long article costs about a tenth of a cent.',
  },
  {
    id: 'feature-2',
    // brief.json's "Restore is one click. The original page comes right back."
    // opened with the clause that names the act's heading, so the closing beat
    // states the differentiator one last time before the CTA.
    text: 'Because the page collapses in place, restore is one click. The original page comes right back.',
  },
  {
    id: 'end',
    text: 'TenWords. Condense any article, restore with one click. Your reading pile, back under control. tenwords dot io.',
  },
];

// Sparse felt piano under a narrated page (direction.md: music is a quiet bed, never
// a driver). Print does not glow, so nothing shimmering, cinematic, or synthetic.
const MUSIC_PROMPT =
  'sparse felt piano, single unhurried notes with long space between them, soft room tone, ' +
  'quiet and contemplative like a library, low dynamics that sit under spoken narration, ' +
  'no drums, no synth pads, no risers, no cinematic swell, no vocals';

mkdirSync(outDir, {recursive: true});
const durations = {};

const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: generate missing lines (or forced ones)
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(outDir, `${l.id}.mp3`)));
if (pending.length > 0) {
  const scriptPath = join(workspace.marketingDir, 'vo-script.json');
  mkdirSync(dirname(scriptPath), {recursive: true});
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(
    `node feeders/audio/client.mjs vo --project "${workspace.projectRoot}" --script "${scriptPath}" --out "${outDir}"${WANT_TIMESTAMPS ? ' --timestamps' : ''}`,
  );
  process.stdout.write(out);
  for (const m of out.matchAll(/vo OK: (.+)\.mp3 (\d+)ms/g)) durations[m[1]] = Number(m[2]);
}

// Lines skipped this run still need a measured duration; probe the file on disk
// instead of re-hitting the API.
for (const l of LINES) {
  if (durations[l.id] !== undefined) continue;
  const file = join(outDir, `${l.id}.mp3`);
  if (!existsSync(file)) continue; // caught by the completeness check below
  const out = run(`node feeders/audio/client.mjs probe --file "${file}"`);
  process.stdout.write(out);
  const m = out.match(/probe OK: .+ (\d+)ms/);
  if (m) durations[l.id] = Number(m[1]);
}

// Word-level timings per line. A sidecar written by `vo --timestamps` is MEASURED;
// anything else gets even-distribution times (marked estimated, warned by judge-av-sync).
const wordTables = {};
for (const l of LINES) {
  const sidecar = join(outDir, `${l.id}.words.json`);
  if (existsSync(sidecar)) {
    const j = JSON.parse(readFileSync(sidecar, 'utf8'));
    wordTables[l.id] = {words: j.words, estimated: Boolean(j.estimated)};
    continue;
  }
  if (!WANT_TIMESTAMPS) continue;
  if (!existsSync(join(outDir, `${l.id}.mp3`))) continue;
  const out = run(
      `node feeders/audio/client.mjs words --project "${workspace.projectRoot}" --file "${join(outDir, `${l.id}.mp3`)}" --text "${l.text.replaceAll('"', '\\"')}" --out "${sidecar}"`,
  );
  process.stdout.write(out);
  const j = JSON.parse(readFileSync(sidecar, 'utf8'));
  wordTables[l.id] = {words: j.words, estimated: true};
}

const missing = LINES.filter((l) => !durations[l.id]);
if (missing.length > 0) {
  throw new Error(`no measured duration for: ${missing.map((l) => l.id).join(', ')}`);
}

// Total runtime comes from THE formula, fed with the durations just measured — the
// same call Root.tsx's calculateMetadata makes, so a music track built to this
// length matches the picture exactly.
const {launchTiming} = await import(new URL('../studio/src/lib/launchTiming.ts', import.meta.url));
const launchPath = join(workspace.propsDir, 'tenwords-launch.json');
const actLengths = existsSync(launchPath)
  ? JSON.parse(readFileSync(launchPath, 'utf8')).actLengths ?? null
  : null;
const telemetry = JSON.parse(readFileSync(join(workspace.propsDir, 'tenwords-launch-demo.json'), 'utf8')).telemetry;
const timing = launchTiming(telemetry.durationMs, 3, actLengths, {
  logo: durations.logo,
  hook: durations.hook,
  demo: durations.demo,
  features: [durations['feature-0'], durations['feature-1'], durations['feature-2']],
  end: durations.end,
});
const totalMs = Math.round((timing.total / 30) * 1000);

let music = null;
if (WANT_MUSIC) {
  const musicFile = join(outDir, 'music.mp3');
  if (shouldForce('music') || !existsSync(musicFile)) {
    const out = run(
      `node feeders/audio/client.mjs music --project "${workspace.projectRoot}" --prompt "${MUSIC_PROMPT}" --length-ms ${totalMs} --out "${musicFile}"`,
    );
    process.stdout.write(out);
    durations.music = Number(out.match(/music OK: .+ (\d+)ms/)?.[1]);
  } else {
    const out = run(`node feeders/audio/client.mjs probe --file "${musicFile}"`);
    process.stdout.write(out);
    durations.music = Number(out.match(/probe OK: .+ (\d+)ms/)?.[1]);
  }
  if (!durations.music) throw new Error('no measured duration for music');
  music = {src: 'audio/music.mp3', durationMs: durations.music};
}

const manifest = {
  music,
  lines: LINES.map((l) => ({
    act: l.id,
    src: `audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
    ...(wordTables[l.id] ? {words: wordTables[l.id].words} : {}),
    ...(wordTables[l.id]?.estimated ? {wordsEstimated: true} : {}),
  })),
};

// Sound-design cue gate: enable the sfx layer only when tenwords' quiet-register
// assets are staged. tenwords passes hookFold, so LaunchVideo's cueOverride replaces
// the generic whoosh/tick/riser table with foldCues() (paper-tick + clunk only) —
// gate on those two files, not the generic trio (direction.md forbids whoosh/riser).
const sfxLib = ['paper-tick', 'clunk'].map((k) => join(workspace.publicDir, 'sfx', `${k}.mp3`));
if (sfxLib.every((f) => existsSync(f))) {
  manifest.sfx = {enabled: true};
  console.log('sfx: library present -> manifest.sfx.enabled = true');
}

mkdirSync(workspace.propsDir, {recursive: true});
writeFileSync(join(workspace.propsDir, 'tenwords-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `wrote ${join(workspace.propsDir, 'tenwords-audio.json')} (${LINES.length} lines, VO-derived film ${timing.total} frames / ${totalMs}ms` +
    `${music ? '' : ', music pending the audio-track pass'})`,
);
