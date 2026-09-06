// Source of truth for postflop launch AUDIO copy: props/postflop-audio.json
// is GENERATED. Edit VO lines and the music prompt here, never in the JSON.
//
// NOTE on act ids: brief.json's narration labels features 1-indexed
// (feature-1/2/3, matching the human-readable act table), but launchTiming.ts /
// audioMix.ts's `feature-(\d+)` regex indexes the features array 0-indexed
// (feature-0/1/2 -> timing.features[0/1/2]). The LINES below use the code's
// zero-indexed ids, so VO stays aligned with the correct on-screen feature act:
// brief feature-1 (measured-exploitability) -> feature-0, feature-2 (workbench)
// -> feature-1, feature-3 (node-locking) -> feature-2. Brief's feature-4
// (performance/benchmarks) has no on-screen act in this cut and carries no line.
//
// TRIM NOTE (2026-09-01): props/postflop-launch.json carries an EXPLICIT
// actLengths override (logo 180, hook 324, features [192, 252, 252], end 324)
// that BEATS measured VO in launchTiming.ts (`l.logo ?? voActLen(...)`), so the
// picture is locked at 2307 frames (76.9s) regardless of narration length —
// every line below is trimmed to FIT its act's spoken budget (actLen - 24f for
// VO_LEAD 12 + VO_PAD 12), not to a shared runtime ceiling. Budgets: logo
// 5200ms, hook 10000ms, demo 25300ms (telemetry-fixed, no risk), feature-0
// 5600ms, feature-1/2 7600ms each, end 10000ms. Trims from brief.json's
// narration[], preserving these claims exactly:
//   - hook: "measures" + "separate best response calculator" stay intact —
//     never collapsed into an unqualified "it measures itself".
//   - feature-0: "tagged measured" and "percent of pot" stay intact.
//   - feature-1: "same Rust engine" + "nothing to install" stay intact.
//   - end: "M I T licensed" and the CTA "Solve your first spot in the
//     browser" stay intact.
//
// DATA TRAP: props/postflop-demo.json's telemetry.durationMs (49472) is a STALE
// capture and does NOT match the locked picture — the current locked demo act
// (783f = ceil(25300/1000*30)+24) comes from props/postflop-launch.json's own
// embedded `demo.telemetry.durationMs` (25300), which this script reads
// directly rather than trusting the sibling `-demo.json` file. judge-av-sync.mjs
// and judge-audio.mjs both prefer `props/<brand>-demo.json` when it exists, so
// they will compute against the stale 49472ms value — a pre-existing data bug
// out of this script's file-ownership scope; flagged, not fixed here.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {requireAudioWorkspace} from './lib/sound-design.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = requireAudioWorkspace(root, 'postflop');
const outDir = join(workspace.publicDir, 'audio');

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

// Spoken copy: written for the ear ("G T O", "E Vs", "M I T licensed", never the
// written form). Deadpan-measured narrator per brands/postflop.json voice: exacting,
// printed, no hype, no exclamation marks. Text is trimmed from
// out/postflop/marketing/brief.json's narration array — see the TRIM NOTE above.
const LINES = [
  {id: 'logo', text: "postflop. An open source solver for heads up no limit hold'em."},
  {
    id: 'hook',
    // TRIM ROUND 1 (2026-09-01): brief text verbatim measured 10340ms, 340ms over the
    // 10000ms budget. Dropped the trailing "at every report" clause per the dispatch
    // fallback. MUST-SURVIVE claims kept intact: "measures" + "a separate best
    // response calculator" — never collapsed into an unqualified "it measures itself".
    text:
      'A solver that grades its own homework can be confidently wrong. This one measures ' +
      'convergence instead: a separate best response calculator.',
  },
  {
    id: 'demo',
    text:
      'Give it a board, both ranges, stacks, pot and sizings. Then walk the whole tree: ' +
      'per hand strategies, E Vs, blockers, every runout.',
  },
  {
    id: 'feature-0',
    text: 'Exploitability is printed in chips and percent of pot, tagged measured.',
  },
  {
    id: 'feature-1',
    text: 'The same Rust engine runs in your browser as WebAssembly. Solve a spot on the page, nothing to install.',
  },
  {
    id: 'feature-2',
    text: 'Lock any node. Villain never bluffs this river. The solver answers the question you actually asked.',
  },
  {
    id: 'end',
    text: "Never take its word for it. M I T licensed: read the source, run the benchmarks. Solve your first spot in the browser.",
  },
];

// Measured, exacting, printed instrumental bed: a spare, dry, metronomic pulse for a
// printed measurement report being typeset. Brand voice: bone paper + ink rules,
// yellow only as a filled stamp block, no hype.
const MUSIC_PROMPT =
  'spare dry metronomic instrumental, soft mechanical ticks and clicks on a steady even ' +
  'pulse like a printed measurement report being typeset, restrained low end, no risers, ' +
  'no EDM build, no cinematic epic drums, no poker or casino cliches, no triumphant swell, ' +
  'understated dynamics that stay under spoken narration, no vocals';

// total duration in ms: postflop's actLengths override is explicit for logo/hook/
// features/end, and the demo act is telemetry-derived from postflop-launch.json's
// OWN embedded telemetry (see DATA TRAP note above) — this reproduces the exact
// 2307-frame (76.9s) picture lock.
const launchProps = JSON.parse(readFileSync(join(workspace.propsDir, 'postflop-launch.json'), 'utf8'));
const actLengths = launchProps.actLengths ?? {};
const telemetry = launchProps.demo.telemetry;
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

// VO: generate missing lines (or forced ones). --brand resolves
// ELEVENLABS_VOICE_ID_POSTFLOP over the global/default voice (PLAYBOOK: "Builders
// must pass --brand <id> to get their own voice"); falls back gracefully when unset.
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(outDir, `${l.id}.mp3`)));
if (pending.length > 0) {
  const scriptPath = join(workspace.marketingDir, 'vo-script.json');
  mkdirSync(dirname(scriptPath), {recursive: true});
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(
    `node feeders/audio/client.mjs vo --project "${workspace.projectRoot}" --script "${scriptPath}" --out "${outDir}" --brand postflop${WANT_TIMESTAMPS ? ' --timestamps' : ''}`,
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
      `node feeders/audio/client.mjs words --project "${workspace.projectRoot}" --file "${join(outDir, `${l.id}.mp3`)}" --text "${l.text.replaceAll('"', '\\"')}" --out "${sidecar}"`,
  );
  process.stdout.write(out);
  const j = JSON.parse(readFileSync(sidecar, 'utf8'));
  wordTables[l.id] = {words: j.words, estimated: true};
}

const musicFile = join(outDir, 'music.mp3');
if (shouldForce('music') || !existsSync(musicFile)) {
  const out = run(
    `node feeders/audio/client.mjs music --project "${workspace.projectRoot}" --prompt "${MUSIC_PROMPT}" --length-ms ${totalMs} --out "${musicFile}"`,
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
  music: {src: 'audio/music.mp3', durationMs: durations.music},
  // Spread-only-when-present: an explicit `words: undefined` serializes the key away
  // in some paths, and an explicit `wordsEstimated: false` would dirty every existing
  // manifest diff.
  lines: LINES.map((l) => ({
    act: l.id,
    src: `audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
    ...(wordTables[l.id] ? {words: wordTables[l.id].words} : {}),
    ...(wordTables[l.id]?.estimated ? {wordsEstimated: true} : {}),
  })),
};

// Sound-design cue gate: enable the sfx layer only when the shared library is staged
// (run scripts/build-sfx.mjs first).
const sfxLib = ['whoosh', 'tick', 'riser'].map((k) => join(workspace.publicDir, 'sfx', `${k}.mp3`));
if (sfxLib.every((f) => existsSync(f))) {
  manifest.sfx = {enabled: true};
  console.log('sfx: library present -> manifest.sfx.enabled = true');
}

mkdirSync(workspace.propsDir, {recursive: true});
writeFileSync(join(workspace.propsDir, 'postflop-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${join(workspace.propsDir, 'postflop-audio.json')} (${totalMs}ms track, ${LINES.length} lines)`);
