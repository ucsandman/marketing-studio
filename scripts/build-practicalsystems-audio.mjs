// Source of truth for practicalsystems launch AUDIO copy: props/practicalsystems-audio.json
// is GENERATED. Edit VO lines and the music prompt here, never in the JSON.
//
// NOTE on act ids: brief.json's narration labels features 1-indexed
// (feature-1/2/3, matching the human-readable act table), but launchTiming.ts /
// audioMix.ts's `feature-(\d+)` regex indexes the features array 0-indexed
// (feature-0/1/2 -> timing.features[0/1/2]). The LINES below use the code's
// zero-indexed ids, so VO stays aligned with the correct on-screen feature act.
//
// TRIM NOTE (2026-08-17): the picture is locked at 2424 frames against a 2700
// (90s) ceiling — only 276 frames of headroom across every VO-widened act, and
// the demo act is fixed (telemetry-derived, never shortened for narration).
// brief.json's narration, spoken verbatim, needed ~564 frames of widening. The
// TEXT below is trimmed from that narration to fit, preserving three
// evidence-judge-scoped claims exactly:
//   - feature-1 (brief's feature-2): "cold outreach never sends without a
//     human" and "no agent charges on its own" stay separately true and
//     separately qualified — never collapsed into an unqualified "nothing
//     sends without a human" (the licence-fulfilment mailer sends
//     automatically to paying buyers, so that broader claim is false).
//   - demo: the $0.30 figure stays scoped to "metered model calls" for one
//     cycle, never "the cost of running a company" (builds bill a flat
//     Claude Code subscription seat, not metered spend).
//   - feature-2 (brief's feature-3): the honesty beat is "$0 MRR, published
//     live"; the excluded $101 figure never appears in any form.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'studio', 'public', 'practicalsystems', 'audio');

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

// --no-timestamps  opt out of word-level VO timings entirely (manifest lines carry no
//                  `words`, so launchTiming stays on the shared act constants).
const WANT_TIMESTAMPS = !process.argv.includes('--no-timestamps');

// Spoken copy: written for the ear ("practical systems dot io", "zero M R R",
// never the written form). Deadpan-honest narrator per brands/practicalsystems.json
// voice: calm and precise, no hype, no exclamation marks. Text is trimmed from
// out/practicalsystems/marketing/brief.json's narration array — see the TRIM
// NOTE above for what changed and why.
const LINES = [
  {id: 'logo', text: 'An AI runs this company.'},
  {
    id: 'hook',
    text: 'Not a demo. A live operating log. Real cycles, real costs, wins or not.',
  },
  {
    id: 'demo',
    text:
      'An autonomous CEO and a fleet of agents research, build, and ship real software. ' +
      'The last cycle spent thirty cents on metered model calls, and every step landed in the public log.',
  },
  {
    id: 'feature-0',
    text: 'The loop runs from research to a closed P and L, every cycle.',
  },
  {
    id: 'feature-1',
    text: 'Cold outreach never sends without a human. No agent charges on its own.',
  },
  {
    id: 'feature-2',
    text: 'We could hide the zero. We publish it. Zero M R R, live from Stripe, and half of profit goes to giving.',
  },
  {id: 'end', text: 'No script. Wins or not. Watch live at practical systems dot io.'},
];

// Calm, precise, matter-of-fact instrumental bed: the "operating log" motif
// (direction.md) as a steady ticking pulse, not a hype swell. Brand voice:
// honest receipts, teal live-signal accent, no exclamation marks.
const MUSIC_PROMPT =
  'calm precise instrumental, a steady even pulse like rows ticking across a live data feed, ' +
  'cool minimal synth pads with a soft muted low end, restrained and matter-of-fact with no ' +
  'triumphant swell, no risers, no EDM build, no cinematic epic drums, understated dynamics ' +
  'that stay low under spoken narration, no vocals';

// total duration in ms: practicalsystems has no actLengths override, so this
// reproduces the shared launchTiming defaults exactly (matches costclaw's
// pattern, which also reads the override key defensively via `?? {}`).
const launchProps = JSON.parse(readFileSync(join(root, 'props', 'practicalsystems-launch.json'), 'utf8'));
const actLengths = launchProps.actLengths ?? {};
const telemetry = JSON.parse(readFileSync(join(root, 'props', 'practicalsystems-demo.json'), 'utf8')).telemetry;
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
  const scriptPath = join(root, 'out', 'practicalsystems', 'vo-script.json');
  mkdirSync(dirname(scriptPath), {recursive: true});
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(
    `node feeders/audio/client.mjs vo --script "${scriptPath}" --out "${outDir}"${WANT_TIMESTAMPS ? ' --timestamps' : ''}`,
  );
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

// Word-level timings per line. A sidecar written by `vo --timestamps` is MEASURED;
// an mp3 that predates this feature gets even-distribution times instead of a paid
// re-generation (marked estimated, warned about by judge-av-sync).
const wordTables = {}; // id -> {words, estimated}
for (const l of LINES) {
  const sidecar = join(outDir, `${l.id}.words.json`);
  if (existsSync(sidecar)) {
    const j = JSON.parse(readFileSync(sidecar, 'utf8'));
    wordTables[l.id] = {words: j.words, estimated: Boolean(j.estimated)};
    continue;
  }
  if (!WANT_TIMESTAMPS) continue; // explicit opt-out -> no words -> constants mode
  if (!existsSync(join(outDir, `${l.id}.mp3`))) continue; // caught by the completeness check below
  const out = run(
    `node feeders/audio/client.mjs words --file "${join(outDir, `${l.id}.mp3`)}" --text "${l.text.replaceAll('"', '\\"')}" --out "${sidecar}"`,
  );
  process.stdout.write(out);
  const j = JSON.parse(readFileSync(sidecar, 'utf8'));
  wordTables[l.id] = {words: j.words, estimated: true};
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
  music: {src: 'practicalsystems/audio/music.mp3', durationMs: durations.music},
  // Spread-only-when-present: an explicit `words: undefined` serializes the key away
  // in some paths, and an explicit `wordsEstimated: false` would dirty every existing
  // manifest diff.
  lines: LINES.map((l) => ({
    act: l.id,
    src: `practicalsystems/audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
    ...(wordTables[l.id] ? {words: wordTables[l.id].words} : {}),
    ...(wordTables[l.id]?.estimated ? {wordsEstimated: true} : {}),
  })),
};

// Sound-design cue gate: enable the sfx layer only when the shared library is staged
// (run scripts/build-sfx.mjs first).
const sfxLib = ['whoosh', 'tick', 'riser'].map((k) => join(root, 'studio', 'public', 'sfx', `${k}.mp3`));
if (sfxLib.every((f) => existsSync(f))) {
  manifest.sfx = {enabled: true};
  console.log('sfx: library present -> manifest.sfx.enabled = true');
}

writeFileSync(join(root, 'props', 'practicalsystems-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote props/practicalsystems-audio.json (${totalMs}ms track, ${LINES.length} lines)`);
