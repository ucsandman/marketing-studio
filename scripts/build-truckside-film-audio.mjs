// Generates props/truckside-film-audio.json for scripts/score-film.mjs.
//
// Truckside is a LaunchVideo TEMPLATE film. Its soundtrack is normally embedded by
// re-rendering LaunchVideo with the audio props (Recipe A). When that re-render is
// blocked (the Remotion compositor intermittently crashes decoding audio + the demo
// source together, "Request closed" -> "No frame found"), this builder lets the
// proven silent picture-lock be scored via the bespoke path instead: it places every
// VO line at the SAME frame audioMix.ts would (act.from + VO_LEAD), so judge-audio and
// judge-av-sync see the identical timing.
//
// Sources of truth (never hand-edit the output):
//   props/truckside-audio.json   VO line durations + src + text, music src + duration
//   props/truckside-launch.json  actLengths (the hand-locked picture)
//   props/truckside-demo.json    demo telemetry (demo act length)
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30;
const VO_LEAD = 12; // studio/src/lib/launchTiming.ts
const RISER_LEAD = 45; // studio/src/lib/sfxCues.ts
const FEATURE_LINE_DELAY = 15;
const FEATURE_LINE_STAGGER = 10; // staggerDelay(i, 10, motion 0.5) = i*10

const audio = JSON.parse(readFileSync(join(root, 'props', 'truckside-audio.json'), 'utf8'));
const launch = JSON.parse(readFileSync(join(root, 'props', 'truckside-launch.json'), 'utf8'));
const telemetry = JSON.parse(readFileSync(join(root, 'props', 'truckside-demo.json'), 'utf8')).telemetry;
const a = launch.actLengths ?? {};

const logoLen = a.logo ?? 150;
const hookLen = a.hook ?? 186;
const demoLen = Math.ceil((telemetry.durationMs / 1000) * FPS) + (a.demoTail ?? 24);
const featureLens = (a.features ?? [180, 180, 180]).slice();
const endLen = a.end ?? 150;

// Act table (from, len), mirroring launchTiming.launchTiming().
let cursor = 0;
const acts = {};
const push = (key, len) => {
  acts[key] = {from: cursor, len};
  cursor += len;
};
push('logo', logoLen);
push('hook', hookLen);
push('demo', demoLen);
featureLens.forEach((len, i) => push(`feature-${i}`, len));
push('end', endLen);
const totalFrames = cursor;

const msFromFrame = (f) => Math.round((f / FPS) * 1000);

const lines = audio.lines.map((l) => {
  const act = acts[l.act];
  if (!act) throw new Error(`audio manifest references unknown act "${l.act}"`);
  return {
    id: l.act,
    text: l.text,
    src: l.src,
    startMs: msFromFrame(act.from + VO_LEAD),
    durationMs: l.durationMs,
  };
});

// SFX cues, exact frames from sfxCues.ts (whoosh on hard cuts, tick per benefit
// line, riser into the CTA). Assets staged by scripts/build-sfx.mjs.
const sfx = [];
sfx.push({name: 'whoosh', frame: acts.hook.from});
sfx.push({name: 'whoosh', frame: acts.demo.from});
featureLens.forEach((_, i) => {
  const f = acts[`feature-${i}`];
  sfx.push({name: 'whoosh', frame: f.from});
  for (let li = 0; li < 3; li += 1) {
    sfx.push({name: 'tick', frame: f.from + FEATURE_LINE_DELAY + li * FEATURE_LINE_STAGGER});
  }
});
sfx.push({name: 'riser', frame: acts.end.from - RISER_LEAD});

const manifest = {
  brandId: 'truckside',
  composition: 'LaunchVideo',
  fps: FPS,
  totalFrames,
  music: {src: audio.music.src, durationMs: audio.music.durationMs},
  lines,
  sfx: audio.sfx?.enabled ? sfx : [],
};

writeFileSync(
  join(root, 'props', 'truckside-film-audio.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(
  `wrote props/truckside-film-audio.json: ${totalFrames}f, ${lines.length} VO lines, ${manifest.sfx.length} sfx`,
);
for (const l of lines) console.log(`  ${l.id}: start ${l.startMs}ms dur ${l.durationMs}ms end ${l.startMs + l.durationMs}ms`);
