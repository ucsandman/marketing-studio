#!/usr/bin/env node
// scripts/build-dashclaw-film-audio.mjs — copy source of truth for DashClawFilm's
// audio: the narration lines with the film-second each one starts on, the SFX cues
// keyed to the frames the film lands things on, and the music prompt. Generates
// props/dashclaw-film-audio.json (never hand-edit it) and the audio files under
// studio/public/dashclaw/film-audio/ through the ElevenLabs feeder.
//
// Usage: node scripts/build-dashclaw-film-audio.mjs [--force [id,id,...|music]]
// Then:  node scripts/score-film.mjs dashclaw out/dashclaw/film/film-v1.mp4
//
// Unlike postflop's builder the start seconds are NOT derived from timeline.ts:
// out/dashclaw/marketing/film-spec.md's narration table states an absolute second
// per line and those are the approved numbers, so they are transcribed literally
// and the overlap check below reports against the MEASURED durations. A line that
// overruns its slot is trimmed HERE, in the copy; the picture is never stretched to
// fit speech (PLAYBOOK timing rule), and score-film refuses colliding lines outright.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {TOTAL} from '../studio/src/films/dashclaw/timeline.ts';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FPS = 30;

// Narration, transcribed from film-spec.md's table. `at` is the film second the
// line starts. 74 words over 40 s: the hall carries the film, the voice rides it.
// Every figure the UI shows (risk 0.82, d-4f21, 00:00:04) stays OUT of the spoken
// copy — the brief carries no numeric proof points, so the narration asserts none.
const LINES = [
  {id: 'hall', at: 1.0, text: 'At three in the morning, your agent is still working.'},
  {id: 'agent', at: 6.0, text: 'It reads. It writes. It deploys. Nobody is watching.'},
  {id: 'reach', at: 12.0, text: 'Until it reaches for something that cannot be undone.'},
  {id: 'intercept', at: 15.5, text: 'DashClaw holds it. Risk scored, bound to the exact command, waiting for you.'},
  {id: 'release', at: 22.5, text: 'One click. It runs. And the decision is on the record.'},
  {id: 'ledger', at: 27.5, text: 'Every action, chained to the decision that allowed it.'},
  // 35.0 so the line lands with the lockup (frame 1068) and "dashclaw dot io"
  // meets the CTA (frame 1110), not 2.6 s ahead of it.
  {id: 'wide', at: 35.0, text: 'Govern your agents at dashclaw dot io.'},
];

// SFX cues: ABSOLUTE film frame + asset. The spec names four: the hold (390, where
// every sound but the room tone stops), the click (600), the release (675, fans
// return) and the wide's out-of-phase freezes. The two extra whooshes are the
// ground flips — the held card arriving and the ledger rows arriving — which are
// the only other things in the film that ARRIVE rather than land.
const SFX = [
  {frame: 390, name: 'tick'}, // HOLD 1: the world stops
  {frame: 458, name: 'whoosh'}, // the held-action card slides in
  {frame: 600, name: 'tick'}, // the Allow click
  {frame: 675, name: 'whoosh'}, // the release: fans return
  {frame: 822, name: 'whoosh'}, // the ledger rows waterfall in
  // Shot 7's freezes, deliberately unevenly spaced so the rhythm reads as dozens
  // of agents out of phase rather than a metronome.
  {frame: 996, name: 'tick'},
  {frame: 1032, name: 'tick'},
  {frame: 1071, name: 'tick'},
  {frame: 1113, name: 'tick'},
];

const MUSIC_PROMPT =
  'low continuous room tone of a dark server hall, deep steady rack fan hum and quiet ' +
  'air handling, faint distant electrical drone, no melody, no drums, no risers, no ' +
  'cinematic swell, no vocals, unchanging and patient, sits far under spoken narration, ' +
  'ends without resolution';

const argv = process.argv.slice(2);
const forceIdx = argv.indexOf('--force');
const forceList = forceIdx >= 0 ? (argv[forceIdx + 1] && !argv[forceIdx + 1].startsWith('--') ? argv[forceIdx + 1].split(',') : ['*']) : [];
const shouldForce = (id) => forceList.includes('*') || forceList.includes(id);

const publicDir = join(root, 'studio', 'public', 'dashclaw', 'film-audio');
mkdirSync(publicDir, {recursive: true});
const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: only the lines whose mp3 is missing (or forced) hit the API.
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(publicDir, `${l.id}.mp3`)));
if (pending.length) {
  const scriptPath = join(publicDir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(`node feeders/audio/client.mjs vo --script "${scriptPath}" --out "${publicDir}" --brand dashclaw --timestamps`);
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
    src: `dashclaw/film-audio/${l.id}.mp3`,
    startMs: Math.round(l.at * 1000),
    durationMs: probeMs(join(publicDir, `${l.id}.mp3`)),
    words,
  };
});

const manifest = {
  brandId: 'dashclaw',
  composition: 'DashClawFilm',
  fps: FPS,
  totalFrames: TOTAL,
  music: {src: 'dashclaw/film-audio/music.mp3', durationMs: probeMs(musicFile)},
  lines,
  sfx: SFX,
};
const outPath = join(root, 'props', 'dashclaw-film-audio.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${outPath}: ${lines.length} VO lines, ${SFX.length} sfx cues, music ${manifest.music.durationMs}ms`);

// The measured overlap check. score-film REFUSES a manifest whose lines collide,
// and it is the last step before delivery — reporting the collision here, next to
// the copy that causes it, is what makes the fix a trim instead of a mystery.
let collisions = 0;
for (const [i, l] of lines.entries()) {
  const end = l.startMs + l.durationMs;
  const next = lines[i + 1];
  const clash = next && end > next.startMs;
  if (clash) collisions++;
  console.log(
    `  ${l.id.padEnd(12)} ${(l.startMs / 1000).toFixed(2)}s -> ${(end / 1000).toFixed(2)}s  (${l.durationMs}ms)` +
      (clash ? `  <-- COLLIDES with ${next.id} at ${(next.startMs / 1000).toFixed(2)}s: trim this line` : ''),
  );
}
if (collisions) {
  console.log(`  ${collisions} collision(s): score-film will refuse this manifest until the copy is trimmed.`);
}
