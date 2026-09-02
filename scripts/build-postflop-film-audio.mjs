#!/usr/bin/env node
// scripts/build-postflop-film-audio.mjs — copy source of truth for PostflopFilm's
// audio: the narration lines with the film-second each one starts on, the SFX cues
// keyed to the frames the shots land things on, and the music prompt. Generates
// props/postflop-film-audio.json (never hand-edit it) and the audio files under
// studio/public/postflop/film-audio/ through the ElevenLabs feeder.
//
// Usage: node scripts/build-postflop-film-audio.mjs [--force [id,id,...|music]]
// Then:  node scripts/score-film.mjs postflop out/postflop/film/film-v4.mp4
//
// The line budget is the shot it narrates (studio/src/films/postflop/timeline.ts).
// A line that overruns its slot is trimmed HERE, in the copy; the picture is never
// stretched to fit speech (PLAYBOOK timing rule). score-film refuses a manifest whose
// lines collide, so an overrun fails loudly instead of talking over the next beat.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {SHOTS, TOTAL} from '../studio/src/films/postflop/timeline.ts';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30;
const shot = (id) => SHOTS.find((s) => s.id === id);
const sec = (frames) => frames / FPS;

// Narration. `at` is the film second the line starts; each is inside the shot it
// names and leaves a breath before the next line. Spoken numerals stay as words the
// TTS reads correctly; every figure is in the brief's proofPoints.
const LINES = [
  {id: 'claim', at: 0.4, text: 'Your solver is grading its own homework. postflop measures instead.'},
  {id: 'composer', at: sec(shot('composer').from) + 0.35, text: 'Give it a board, both ranges, stacks, and a convergence target.'},
  {id: 'workbench', at: sec(shot('workbench').from) + 0.4, text: 'The whole tree, solved in your browser.'},
  {id: 'convergence', at: sec(shot('convergence').from) + 0.35, text: 'A separate best-response calculator measures exploitability.'},
  {id: 'features', at: sec(shot('features').from) + 0.35, text: 'Lock any node. Seventy-seven million evals per second.'},
  {id: 'browser', at: sec(shot('browser').from) + 0.75, text: 'Rust in WebAssembly. Nothing to install.'},
  {id: 'end', at: sec(shot('end').from) + 1.0, text: 'Measured. Never asserted.'},
];

// SFX cues: film frame + asset. Frames are the shot-local landing frames in the
// shot files (Rule/Stamp delayFrames, CLICK_AT, F_STAMP, F_CLICK, WORDS) offset by
// the shot's `from`. Max two cues per beat; ticks on things that LAND, whooshes on
// things that ARRIVE.
const F = (id, local) => shot(id).from + local;
const SFX = [
  {frame: F('claim', 50), name: 'tick'}, // rule draws under the claim
  {frame: F('mark', 40), name: 'tick'}, // [measured] stamp
  {frame: F('composer', 118), name: 'tick'}, // SOLVE click
  {frame: F('workbench', 6), name: 'whoosh'}, // panel slides in
  {frame: F('workbench', 90), name: 'tick'}, // exploitability lands as a block
  {frame: F('workbench', 112), name: 'tick'}, // cell click
  {frame: F('convergence', 58), name: 'tick'}, // [measured] stamp
  {frame: F('features', 2), name: 'whoosh'}, // card grid arrives
  {frame: F('features', 48), name: 'tick'}, // LOCK UPDATED
  {frame: F('browser', 4), name: 'whoosh'}, // browser hero turns in
  {frame: F('end', 2), name: 'tick'}, // MEASURED.
  {frame: F('end', 8), name: 'tick'}, // NEVER
  {frame: F('end', 14), name: 'tick'}, // ASSERTED.
  {frame: F('end', 59), name: 'tick'}, // CTA block
];

const MUSIC_PROMPT =
  'spare dry metronomic instrumental, soft mechanical ticks and clicks on a steady even ' +
  'pulse like a printed measurement report being typeset, restrained low end, no risers, ' +
  'no EDM build, no cinematic epic drums, no poker or casino cliches, no triumphant swell, ' +
  'understated dynamics that stay under spoken narration, a clean resolved ending, no vocals';

const argv = process.argv.slice(2);
const forceIdx = argv.indexOf('--force');
const forceList = forceIdx >= 0 ? (argv[forceIdx + 1] && !argv[forceIdx + 1].startsWith('--') ? argv[forceIdx + 1].split(',') : ['*']) : [];
const shouldForce = (id) => forceList.includes('*') || forceList.includes(id);

const publicDir = join(root, 'studio', 'public', 'postflop', 'film-audio');
mkdirSync(publicDir, {recursive: true});
const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: only the lines whose mp3 is missing (or forced) hit the API.
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(publicDir, `${l.id}.mp3`)));
if (pending.length) {
  const scriptPath = join(publicDir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(`node feeders/audio/client.mjs vo --script "${scriptPath}" --out "${publicDir}" --brand postflop --timestamps`);
  process.stdout.write(out);
}

// Music: exact film length from the feeder.
const musicFile = join(publicDir, 'music.mp3');
if (shouldForce('music') || !existsSync(musicFile)) {
  const out = run(`node feeders/audio/client.mjs music --prompt "${MUSIC_PROMPT}" --length-ms ${Math.round((TOTAL / FPS) * 1000)} --out "${musicFile}"`);
  process.stdout.write(out);
}

const probeMs = (file) => {
  const out = run(`node feeders/audio/client.mjs probe --file "${file}"`);
  const m = out.match(/(\d+)ms/);
  if (!m) throw new Error(`could not measure ${file}`);
  return Number(m[1]);
};

const lines = LINES.map((l) => {
  const wordsPath = join(publicDir, `${l.id}.words.json`);
  const words = existsSync(wordsPath) ? JSON.parse(readFileSync(wordsPath, 'utf8')).words ?? null : null;
  return {
    id: l.id,
    text: l.text,
    src: `postflop/film-audio/${l.id}.mp3`,
    startMs: Math.round(l.at * 1000),
    durationMs: probeMs(join(publicDir, `${l.id}.mp3`)),
    words,
  };
});

const manifest = {
  brandId: 'postflop',
  composition: 'PostflopFilm',
  fps: FPS,
  totalFrames: TOTAL,
  music: {src: 'postflop/film-audio/music.mp3', durationMs: probeMs(musicFile)},
  lines,
  sfx: SFX,
};
const outPath = join(root, 'props', 'postflop-film-audio.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${outPath}: ${lines.length} VO lines, ${SFX.length} sfx cues, music ${manifest.music.durationMs}ms`);
for (const l of lines) {
  const end = l.startMs + l.durationMs;
  console.log(`  ${l.id.padEnd(12)} ${(l.startMs / 1000).toFixed(2)}s -> ${(end / 1000).toFixed(2)}s  (${l.durationMs}ms)`);
}
