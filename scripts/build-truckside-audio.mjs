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
import {requireAudioWorkspace} from './lib/sound-design.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = requireAudioWorkspace(root, 'truckside');
const outDir = join(workspace.publicDir, 'audio');

const forceFlagIdx = process.argv.indexOf('--force');
const forceArg = forceFlagIdx >= 0 ? process.argv[forceFlagIdx + 1] : undefined;
const forceIds =
  forceFlagIdx >= 0 && forceArg && !forceArg.startsWith('--') ? new Set(forceArg.split(',')) : null;
const forceAll = forceFlagIdx >= 0 && !forceIds;
const shouldForce = (id) => forceAll || (forceIds?.has(id) ?? false);

// Spoken copy: plain, concrete, verbs first; a back-office tool for a one-truck
// trades owner. No hype, no em dashes, no exclamation marks. "Truckside" is spoken
// as the wordmark (speechHint in brands/truckside.json primes the ear-gate).
// Verbatim from marketing/brief.json's approved narration array (109 words across
// seven acts). The brief numbers its feature lines 1/2/3; they are re-keyed to the
// zero-indexed acts here and nowhere else. Nothing is written differently for the ear
// in this script: "truckside.io" is never spoken, and every other word is ordinary
// English a TTS model reads correctly.
const LINES = [
  {id: 'logo', text: 'Truckside. The back office for a business that runs out of a truck.'},
  {
    id: 'hook',
    text: 'You were under a door when it rang. Truckside answered and booked the window.',
  },
  {
    id: 'demo',
    text: 'This is the whole office. One screen you work from your phone between jobs.',
  },
  {
    id: 'feature-0',
    text: 'The call gets answered. The caller gets a window. Emergencies go to the top of your list.',
  },
  {
    id: 'feature-1',
    text: 'The job becomes a quote off the rate card set up for your shop. You approve it.',
  },
  {
    id: 'feature-2',
    text: 'The nudges, the reminders, the review requests are written and waiting. You clear each with a tap.',
  },
  {
    // PROTECTED: "Every message and charge waits for your tap" is the verified gate
    // scope. If this line ever has to be trimmed, cut from the second sentence.
    id: 'end',
    text: 'Every message and charge waits for your tap. Open the demo and watch a call get booked.',
  },
];

// A plain, working bed for a tradesperson: warm and grounded, quiet momentum, not
// consumer-app gloss and not cinematic. Green is calm competence, so no bright neon
// synth. No vocals.
const MUSIC_PROMPT =
  'acoustic daylight bed for a working day, steady and unhurried around 92 bpm, soft ' +
  'fingerpicked acoustic guitar with light hand percussion and a plain even pulse, warm ' +
  'and ordinary, background music a tradesperson would not notice, no vocals, no risers, ' +
  'no cinematic swell, no synth pads or startup sheen, no aggressive drums';

// Total duration. The directed film's real length is the shot plan's total (authored
// shot durations minus the dissolve overlaps), so read that when it exists; the
// actLengths sum is only the fallback for a legacy, act-shaped render.
const launchProps = JSON.parse(readFileSync(join(workspace.propsDir, 'truckside-launch.json'), 'utf8'));
const actLengths = launchProps.actLengths ?? {};
const shotPlanPath = join(workspace.marketingDir, 'shot-plan.json');
let totalFrames;
if (existsSync(shotPlanPath)) {
  const shotPlan = JSON.parse(readFileSync(shotPlanPath, 'utf8'));
  totalFrames = shotPlan.total;
  console.log(`bed length from marketing/shot-plan.json: ${totalFrames}f`);
} else {
  const telemetry = JSON.parse(readFileSync(join(workspace.propsDir, 'truckside-demo.json'), 'utf8')).telemetry;
  const demoLen = Math.ceil((telemetry.durationMs / 1000) * 30) + (actLengths.demoTail ?? 24);
  const featureLens = [0, 1, 2].map((i) => actLengths.features?.[i] ?? 180);
  totalFrames =
    (actLengths.logo ?? 150) +
    (actLengths.hook ?? 186) +
    demoLen +
    featureLens.reduce((a, b) => a + b, 0) +
    (actLengths.end ?? 150);
}
const totalMs = Math.round((totalFrames / 30) * 1000);

mkdirSync(outDir, {recursive: true});
const durations = {};

const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: generate missing lines (or forced ones). --brand truckside resolves the
// brand voice (unset -> global unset -> default Rachel; the feeder logs which won).
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(outDir, `${l.id}.mp3`)));
if (pending.length > 0) {
  const scriptPath = join(workspace.marketingDir, 'vo-script.json');
  mkdirSync(dirname(scriptPath), {recursive: true});
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(`node feeders/audio/client.mjs vo --project "${workspace.projectRoot}" --brand truckside --script "${scriptPath}" --out "${outDir}"`);
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

// A generated bed ends the way a piece of MUSIC ends. Asked for exactly the film's
// length, the model spends its last seconds on an outro that decays to silence, and
// that outro lands INSIDE the picture: the 2026-09-05 bed was at -21.8 dB through its
// body, -35.7 dB at 72s and -92.0 dB at 76s, so the delivered mix fell under
// judge-audio's -35 dB floor 3.02s before the last frame (trailing-silence FAIL,
// measured 2026-09-06). Two things keep the bed alive to the last frame:
//   - ask for OUTRO_HEADROOM_MS more than the film, so a REGENERATED bed puts its
//     outro past the end and the film-length trim never touches it;
//   - derive a film-length bed from whatever source bed is on disk, so the bed that
//     is already paid for is repaired rather than re-bought.
// score-film owns the only intended fade (BED_FADE_S under the final frames); this
// file's job is to hand it a bed that is at level right up to that fade.
const OUTRO_HEADROOM_MS = 20000;
const BED_XFADE_S = 0.5; // splice length when the body has to be extended
const BODY_FLOOR_DB = 6; // a second this far under the body median is outro, not body

/** Last second of `file` still carrying body-level material, in seconds. */
const bedBodyEndS = (file) => {
  const out = run(
    // -loglevel error keeps astats' own end-of-run summary off stderr; the per-frame
    // numbers this reads arrive on stdout from ametadata's `file=-`.
    `ffmpeg -hide_banner -nostats -loglevel error -i "${file}" -af "astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null -`,
  );
  const perSecond = new Map();
  let t = null;
  for (const line of out.split(/\r?\n/)) {
    const time = line.match(/pts_time:([0-9.]+)/);
    if (time) {
      t = Number(time[1]);
      continue;
    }
    const rms = line.match(/RMS_level=(-?[0-9.]+)/);
    if (!rms || t === null) continue;
    const second = Math.floor(t);
    if (!perSecond.has(second)) perSecond.set(second, []);
    perSecond.get(second).push(10 ** (Number(rms[1]) / 10));
  }
  const seconds = [...perSecond.entries()]
    .map(([second, energies]) => ({second, db: 10 * Math.log10(energies.reduce((a, b) => a + b, 0) / energies.length)}))
    .sort((a, b) => a.second - b.second);
  if (!seconds.length) throw new Error(`could not measure the bed body of ${file}`);
  // Median over everything but the final 10s, so the outro cannot drag the reference down.
  const reference = seconds.filter((s) => s.second < Math.max(1, seconds.length - 10)).map((s) => s.db).sort((a, b) => a - b);
  const median = reference[Math.floor(reference.length / 2)];
  const body = seconds.filter((s) => s.db >= median - BODY_FLOOR_DB).at(-1);
  return {bodyEndS: (body?.second ?? seconds.at(-1).second) + 1, medianDb: median};
};

const musicFile = join(outDir, 'music.mp3');
if (shouldForce('music') || !existsSync(musicFile)) {
  const out = run(
    `node feeders/audio/client.mjs music --project "${workspace.projectRoot}" --prompt "${MUSIC_PROMPT}" --length-ms ${totalMs + OUTRO_HEADROOM_MS} --out "${musicFile}"`,
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

// Derived, film-length bed. The raw generated file stays on disk as the source.
const bedFile = join(outDir, 'bed.mp3');
const filmS = totalMs / 1000;
const {bodyEndS, medianDb} = bedBodyEndS(musicFile);
const encode = '-c:a libmp3lame -b:a 192k -ar 44100';
if (bodyEndS >= filmS) {
  console.log(`bed: body runs to ${bodyEndS.toFixed(2)}s (median ${medianDb.toFixed(1)} dB) — trimming to ${filmS.toFixed(3)}s`);
  run(`ffmpeg -hide_banner -loglevel error -y -i "${musicFile}" -t ${filmS.toFixed(3)} ${encode} "${bedFile}"`);
} else {
  // Splice a slice of the body back onto its own end. The seam sits at bodyEndS,
  // inside the film, and acrossfade makes it a dissolve rather than a cut.
  const needS = filmS - bodyEndS + BED_XFADE_S;
  const startS = bodyEndS - needS;
  if (startS < 0) throw new Error(`bed body ${bodyEndS.toFixed(2)}s is too short to extend to ${filmS.toFixed(3)}s`);
  console.log(
    `bed: body runs to ${bodyEndS.toFixed(2)}s (median ${medianDb.toFixed(1)} dB), film is ${filmS.toFixed(3)}s — splicing ${startS.toFixed(2)}-${bodyEndS.toFixed(2)}s back on with a ${BED_XFADE_S}s crossfade`,
  );
  run(
    `ffmpeg -hide_banner -loglevel error -y -i "${musicFile}" -i "${musicFile}" -filter_complex ` +
      `"[0:a]atrim=0:${bodyEndS.toFixed(3)},asetpts=N/SR/TB[body];` +
      `[1:a]atrim=${startS.toFixed(3)}:${bodyEndS.toFixed(3)},asetpts=N/SR/TB[tail];` +
      `[body][tail]acrossfade=d=${BED_XFADE_S}:c1=tri:c2=tri[bed]" ` +
      `-map "[bed]" -t ${filmS.toFixed(3)} ${encode} "${bedFile}"`,
  );
}
const bedProbe = run(`node feeders/audio/client.mjs probe --file "${bedFile}"`);
process.stdout.write(bedProbe);
const bedMs = Number(bedProbe.match(/probe OK: .+ (\d+)ms/)?.[1]);
if (!bedMs) throw new Error('no measured duration for the derived bed');
if (bedMs < totalMs - 100) throw new Error(`derived bed is ${bedMs}ms, short of the ${totalMs}ms film`);

const manifest = {
  music: {src: 'audio/bed.mp3', durationMs: bedMs},
  lines: LINES.map((l) => ({
    act: l.id,
    src: `audio/${l.id}.mp3`,
    durationMs: durations[l.id],
    text: l.text,
  })),
};

const sfxLib = ['whoosh', 'tick', 'riser'].map((k) => join(workspace.publicDir, 'sfx', `${k}.mp3`));
if (sfxLib.every((f) => existsSync(f))) {
  manifest.sfx = {enabled: true};
  console.log('sfx: library present -> manifest.sfx.enabled = true');
}

mkdirSync(workspace.propsDir, {recursive: true});
writeFileSync(join(workspace.propsDir, 'truckside-audio.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${join(workspace.propsDir, 'truckside-audio.json')} (${totalMs}ms track, ${LINES.length} lines)`);
