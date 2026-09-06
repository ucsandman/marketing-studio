#!/usr/bin/env node
// scripts/build-offlocalhost-session-audio.mjs — copy source of truth for the Off
// Localhost AgentSession film's audio: the narration lines with the film-second each
// one starts on, and the music prompt. Generates props/offlocalhost-session-audio.json
// (never hand-edit it) and the audio files under studio/public/offlocalhost/session-audio/
// through the ElevenLabs feeder.
//
// Usage: node scripts/build-offlocalhost-session-audio.mjs [--force [id,id,...|music]]
// Then:  node scripts/score-film.mjs offlocalhost out/offlocalhost/session/session-v2.mp4 \
//          --manifest props/offlocalhost-session-audio.json --out out/offlocalhost/session-final.mp4
//
// Every `at` comes from THE timeline (studio/src/lib/sessionTiming.ts run over
// props/offlocalhost-session.json), never from a still or a stopwatch, so a line
// starts on the beat it narrates and reflows with it. The line budget is the gap to
// the next beat's line; a line that overruns is trimmed HERE, in the copy, because
// the picture is never stretched to fit speech (PLAYBOOK timing rule). score-film
// refuses a manifest whose lines collide, so an overrun fails loudly.
//
// No SFX cues: the terminal in this film makes no sound.
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {requireAudioWorkspace} from './lib/sound-design.mjs';
import {sessionTiming, welcomeBoxHeight} from '../studio/src/lib/sessionTiming.ts';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = requireAudioWorkspace(root, 'offlocalhost');
const FPS = 30;
const session = JSON.parse(readFileSync(join(workspace.propsDir, 'offlocalhost-session.json'), 'utf8'));
const timeline = sessionTiming(FPS, session.beats, {
  endHoldFrames: session.endHoldFrames,
  welcomeHeight: welcomeBoxHeight(session.header.tips.length),
});
const sec = (frames) => frames / FPS;
/** Second a beat's clock starts, by its 1-based position in the props file. */
const beat = (n) => sec(timeline.beats[n - 1].start);

// Narration. Each line opens 0.3s after the beat it describes so the picture lands
// first; the sign-off waits 0.6s for the end card to arrive.
const LINES = [
  {id: 'open', at: beat(1) + 0.3, text: 'Two commands in Claude Code. The first one makes every marketing asset from your repo.'},
  {id: 'render', at: beat(6) + 0.3, text: 'It reads your brand tokens, films the running app, renders the film, and scores it with generated voice and music.'},
  {id: 'judges', at: beat(9) + 0.3, text: 'Seven judges check the result before you look. Nothing leaves your machine.'},
  {id: 'launch', at: beat(10) + 0.3, text: 'The second one takes the product live. Domain, hosting, payments, email, and the posts on every platform.'},
  {id: 'approval', at: beat(13) + 0.3, text: 'Anything that costs money waits for your approval.'},
  // Trimmed to fit the beat, not the other way round. The full line ("... Hacker News
  // and Product Hunt are staged. You press submit.") measured 7370ms against a 4150ms
  // slot, and the half that went is the half the transcript is showing while it plays.
  {id: 'dryrun', at: beat(16) + 0.3, text: 'Everything is a dry run until you pass live.'},
  // The end card is 2.5s and the sign-off opens 0.6s into it, so this line has 1950ms.
  // "Off Localhost. Your repo works. Get it off localhost." measured 5020ms and even
  // "Off Localhost. Get it off localhost." measured 3290ms; the card already carries
  // the wordmark and offlocalhost.com, so the imperative is what is left to say.
  {id: 'end', at: sec(timeline.endCardFrom) + 0.6, text: 'Get it off localhost.'},
];

const MUSIC_PROMPT =
  'a quiet, minimal electronic bed with a soft pulse and no drums, calm, for a developer ' +
  'tool, understated dynamics that stay under spoken narration, no vocals';

const argv = process.argv.slice(2);
const forceIdx = argv.indexOf('--force');
const forceList = forceIdx >= 0 ? (argv[forceIdx + 1] && !argv[forceIdx + 1].startsWith('--') ? argv[forceIdx + 1].split(',') : ['*']) : [];
const shouldForce = (id) => forceList.includes('*') || forceList.includes(id);

const publicDir = join(workspace.publicDir, 'session-audio');
mkdirSync(publicDir, {recursive: true});
const run = (cmd) => execSync(cmd, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});

// VO: only the lines whose mp3 is missing (or forced) hit the API.
const pending = LINES.filter((l) => shouldForce(l.id) || !existsSync(join(publicDir, `${l.id}.mp3`)));
if (pending.length) {
  const scriptPath = join(publicDir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify({lines: pending}));
  const out = run(`node feeders/audio/client.mjs vo --project "${workspace.projectRoot}" --script "${scriptPath}" --out "${publicDir}" --brand offlocalhost`);
  process.stdout.write(out);
}

// Music: exact film length from the feeder.
const filmMs = Math.round((timeline.durationInFrames / FPS) * 1000);
const musicFile = join(publicDir, 'music.mp3');
if (shouldForce('music') || !existsSync(musicFile)) {
  const out = run(`node feeders/audio/client.mjs music --project "${workspace.projectRoot}" --prompt "${MUSIC_PROMPT}" --length-ms ${filmMs} --out "${musicFile}"`);
  process.stdout.write(out);
}

const probeMs = (file) => {
  const out = run(`node feeders/audio/client.mjs probe --file "${file}"`);
  const m = out.match(/(\d+)ms/);
  if (!m) throw new Error(`could not measure ${file}`);
  return Number(m[1]);
};

const lines = LINES.map((l) => ({
  id: l.id,
  text: l.text,
  src: `session-audio/${l.id}.mp3`,
  startMs: Math.round(l.at * 1000),
  durationMs: probeMs(join(publicDir, `${l.id}.mp3`)),
}));

// score-film trims the bed to the film and muxes with -shortest, so a bed shorter
// than the picture takes frames off the end of the delivered file. Fail here, loudly,
// rather than ship a film the music cut short.
const musicMs = probeMs(musicFile);
if (musicMs < filmMs) {
  throw new Error(`music bed is ${filmMs - musicMs}ms short of the film (${musicMs}ms < ${filmMs}ms); re-run with --force music`);
}

const manifest = {
  brandId: 'offlocalhost',
  composition: 'AgentSession',
  fps: FPS,
  totalFrames: timeline.durationInFrames,
  music: {src: 'session-audio/music.mp3', durationMs: musicMs},
  lines,
  sfx: [],
};
mkdirSync(workspace.propsDir, {recursive: true});
const outPath = join(workspace.propsDir, 'offlocalhost-session-audio.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${outPath}: ${lines.length} VO lines, no sfx cues, music ${manifest.music.durationMs}ms`);
// The gap column is what a trim has to buy: score-film wants 150ms of breath before
// the next line, and the last line has to end inside the film.
lines.forEach((l, i) => {
  const end = l.startMs + l.durationMs;
  const next = lines[i + 1] ? lines[i + 1].startMs : filmMs;
  console.log(
    `  ${l.id.padEnd(9)} ${(l.startMs / 1000).toFixed(2)}s -> ${(end / 1000).toFixed(2)}s  (${l.durationMs}ms)  gap ${((next - end) / 1000).toFixed(2)}s`,
  );
});
