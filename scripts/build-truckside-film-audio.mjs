// Generates the product-owned Truckside film-audio manifest for score-film.mjs.
//
// Truckside is a LaunchVideo TEMPLATE film. Its soundtrack is normally embedded by
// re-rendering LaunchVideo with the audio props (Recipe A). When that re-render is
// blocked (the Remotion compositor intermittently crashes decoding audio + the demo
// source together, "Request closed" -> "No frame found"), this builder lets the
// proven silent picture-lock be scored via the bespoke path instead: it places every
// VO line at the SAME frame audioMix.ts would (act.from + VO_LEAD), so judge-audio and
// judge-av-sync see the identical timing.
//
// Product-workspace sources of truth (never hand-edit the output): audio + launch
// props, and the emitted shot-plan.json when the launch uses directed shots.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {requireAudioWorkspace} from './lib/sound-design.mjs';
import {timingFromShots, VO_LEAD, voWindows} from '../studio/src/lib/audioMix.ts';
import {pictureEventCues} from '../studio/src/lib/sfxCues.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = requireAudioWorkspace(root, 'truckside');
const FPS = 30;
const RISER_LEAD = 45; // studio/src/lib/sfxCues.ts
const FEATURE_LINE_DELAY = 15;
const FEATURE_LINE_STAGGER = 10; // staggerDelay(i, 10, motion 0.5) = i*10

const audio = JSON.parse(readFileSync(join(workspace.propsDir, 'truckside-audio.json'), 'utf8'));
const launch = JSON.parse(readFileSync(join(workspace.propsDir, 'truckside-launch.json'), 'utf8'));
const telemetry = JSON.parse(readFileSync(join(workspace.propsDir, 'truckside-demo.json'), 'utf8')).telemetry;
const msFromFrame = (f) => Math.round((f / FPS) * 1000);
let totalFrames;
let lines;
let sfx;
let musicMarkers = [];

if (launch.shots?.length) {
  const shotPlanPath = join(workspace.marketingDir, 'shot-plan.json');
  if (!existsSync(shotPlanPath)) throw new Error('directed Truckside audio requires the emitted marketing/shot-plan.json');
  const shotPlan = JSON.parse(readFileSync(shotPlanPath, 'utf8'));
  const shots = shotPlan.shots;
  const audioRefs = shots
    .map((shot) => (shot.audioRef === undefined ? shot.id : shot.audioRef))
    .filter((ref) => ref != null);
  const selected = new Set(audioRefs);
  const selectedLines = audio.lines.filter((line) => selected.has(line.act));
  const missing = [...selected].filter((ref) => !selectedLines.some((line) => line.act === ref));
  if (missing.length) throw new Error(`directed shot plan references missing audio acts: ${missing.join(', ')}`);
  const timing = timingFromShots(shots, selectedLines.map((line) => line.act));
  const windows = voWindows(selectedLines, timing);
  lines = selectedLines.map((line, index) => {
    const window = windows[index];
    const naturalTo = window.fromFrame + Math.ceil((line.durationMs / 1000) * FPS);
    if (naturalTo > window.toFrame) throw new Error(`${line.act}: narration is clipped by the directed shot window`);
    return {
      id: line.act,
      text: line.text,
      src: line.src,
      startMs: msFromFrame(window.fromFrame),
      durationMs: line.durationMs,
    };
  });
  totalFrames = shotPlan.total;
  sfx = audio.sfx?.enabled
    ? pictureEventCues(shots).map((cue) => ({name: cue.kind, frame: cue.frame, gain: cue.gain, eventId: cue.eventId}))
    : [];
  musicMarkers = shots
    .filter((shot) => shot.audio?.music)
    .map((shot) => ({id: `${shot.id}:${shot.audio.music}`, frame: shot.from, kind: shot.audio.music}));
} else {
  const a = launch.actLengths ?? {};
  const featureLens = (a.features ?? [180, 180, 180]).slice();
  let cursor = 0;
  const acts = {};
  const push = (key, len) => {
    acts[key] = {from: cursor, len};
    cursor += len;
  };
  push('logo', a.logo ?? 150);
  push('hook', a.hook ?? 186);
  push('demo', Math.ceil((telemetry.durationMs / 1000) * FPS) + (a.demoTail ?? 24));
  featureLens.forEach((len, i) => push(`feature-${i}`, len));
  push('end', a.end ?? 150);
  totalFrames = cursor;
  lines = audio.lines.map((line) => {
    const act = acts[line.act];
    if (!act) throw new Error(`audio manifest references unknown act "${line.act}"`);
    return {...line, id: line.act, startMs: msFromFrame(act.from + VO_LEAD)};
  });
  sfx = [];
  sfx.push({name: 'whoosh', frame: acts.hook.from}, {name: 'whoosh', frame: acts.demo.from});
  featureLens.forEach((_, i) => {
    const feature = acts[`feature-${i}`];
    sfx.push({name: 'whoosh', frame: feature.from});
    for (let li = 0; li < 3; li += 1) sfx.push({name: 'tick', frame: feature.from + FEATURE_LINE_DELAY + li * FEATURE_LINE_STAGGER});
  });
  sfx.push({name: 'riser', frame: acts.end.from - RISER_LEAD});
  if (!audio.sfx?.enabled) sfx = [];
}

const manifest = {
  brandId: 'truckside',
  composition: 'LaunchVideo',
  fps: FPS,
  totalFrames,
  music: {...audio.music, ...(musicMarkers.length ? {markers: musicMarkers} : {})},
  lines,
  sfx,
};

mkdirSync(workspace.propsDir, {recursive: true});
writeFileSync(
  join(workspace.propsDir, 'truckside-film-audio.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  `wrote props/truckside-film-audio.json: ${totalFrames}f, ${lines.length} VO lines, ${manifest.sfx.length} sfx, ${musicMarkers.length} music markers`,
);
for (const l of lines) console.log(`  ${l.id}: start ${l.startMs}ms dur ${l.durationMs}ms end ${l.startMs + l.durationMs}ms`);
