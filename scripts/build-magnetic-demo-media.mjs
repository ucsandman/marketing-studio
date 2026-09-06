#!/usr/bin/env node
// Builds Magnetic's demo footage media: three silent "b-roll" clips (visually
// distinct variants of feeders/blender/scenes/background_loop.py, rendered under
// the magnetic brand) plus one voiceover take (clip-a's picture + a speech track
// with two deliberate 2-3s dead-air pauses mid-take) that Task 7's recording
// imports and Rough Cut is expected to detect on camera.
//
// Idempotent via scripts/lib/cache.mjs (content-hash per stage, re-checked against
// what's actually on disk). VO generation tries ElevenLabs (feeders/audio/client.mjs
// vo); a documented exit 2 (no ELEVENLABS_API_KEY) falls back to Windows SAPI TTS via
// PowerShell — same technique as C:\projects\final-cut-pro\scripts\make-fixtures.mjs
// (READ-ONLY reference, not imported).
//
// Blender renders run in 60-frame CHUNKS, one fresh Blender process each, with a
// hard per-chunk timeout. Reason (observed 2026-07-12): a single full-length
// --animation run rendered 66 frames in ~34s then hung, producing nothing for 9+
// minutes until killed. Chunking stays under the observed hang point, turns a
// recurrence into a loud per-chunk failure instead of a silent stall, and gives
// natural resume (contiguous frames on disk + a render-config marker; a config
// mismatch deterministically cleans the clip's frame dir). Chunk determinism was
// verified: frame 1 rendered via --frame vs via a chunked --animation range is
// pixel-identical (max channel diff 0/255).
//
// Usage: node scripts/build-magnetic-demo-media.mjs --project <repo> [--stage <name>]
//   --stage render-a|render-b|render-c  render that clip's PNG frames (resumable)
//   --stage encode                      encode all three frame dirs to mp4
//   --stage vo                          VO take: speech + pauses muxed over clip-a
//   --stage all                         everything in order (default)
// Output (product-owned, gitignored):
//   <repo>/marketing/assets/magnetic/assets/demo-media/{clip-a,clip-b,clip-c,voiceover-take}.mp4
import {execSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {checkCache, cacheKey, storeCache} from './lib/cache.mjs';
import {ffmpeg} from './lib/remotion.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = 'magnetic';
let WORKSPACE;
let FOOTAGE_DIR;
let VO_DIR;
let OUT_DIR;
const FPS = 30;
const FRAME_COUNT = 240; // 8s @ 30fps: plenty for filmstrip/skim footage, and the
// picture loops seamlessly (background_loop's whole-cycle phase drift), so longer
// timeline durations come free via looping rather than more render time.
const CHUNK_FRAMES = 60; // frames per Blender process; under the observed frame-67 hang
// Two-level chunk timeout. render.py enforces CHUNK_TIMEOUT_S itself (Popen.wait
// timeout -> taskkill /T /F on Blender's process TREE — killing only the node-side
// shell child leaves python/blender orphans that can keep writing into framesDir).
// The node execSync timeout is a strictly larger outer fallback that should never
// fire; if it somehow does, the pre-chunk stray-frame cleanup below contains any
// contamination an orphan could have produced.
const CHUNK_TIMEOUT_S = 200; // ~35s expected per chunk; a hang fails loudly here
const CHUNK_TIMEOUT_MS = 260_000; // outer node fallback, > CHUNK_TIMEOUT_S

// Three variants of the one scene, distinguished by the Wave texture's knobs
// (--scale/--distortion/--detail/--phase-start) AND by hue+brightness
// (--accent/--accent-strength/--shadow-strength) so the filmstrip browser reads
// three different SCENES, not one pattern at three densities. Hues are diegetic
// footage content (muted cinematic families), not brand chrome — the brand's
// color rules (green = waveforms-only etc.) govern chrome/copy, not what the
// "filmed" footage may depict. Strengths tuned by measured mean luma: the
// original 0.08 tuning measured 26.4/255; these land 53-59/255 (~2x, so
// thumbnails read in a dark UI while staying moody).
const VARIANTS = [
  // navy/blue wave — the VO take reuses this clip's picture
  {id: 'a', scale: 1.2, distortion: 2.4, detail: 2.0, phaseStart: 0.0, accent: '#0a84ff', accentStrength: 0.42, shadowStrength: 0.05},
  // deep muted teal, tight turbulent bands
  {id: 'b', scale: 2.6, distortion: 4.0, detail: 3.5, phaseStart: 0.4, accent: '#2e8b74', accentStrength: 0.5, shadowStrength: 0.06},
  // dark muted warm amber, broad calm bands
  {id: 'c', scale: 0.6, distortion: 1.0, detail: 1.0, phaseStart: 0.75, accent: '#c08a45', accentStrength: 0.33, shadowStrength: 0.045},
];

// Written for the ear; two scripted dead-air gaps sit between the three lines.
// Kept short deliberately - clip-a's picture loops under the take (see muxTake)
// so total length isn't bounded by the 10-15s background-clip spec, but a short
// script keeps the take a natural single loop in the common case.
const VO_LINES = [
  {id: 'seg1', text: "Here's how the timeline engine works."},
  {id: 'seg2', text: "Every clip snaps and merges like it's magnetic."},
  {id: 'seg3', text: "That's the whole idea."},
];
// seg1|pause|seg2|pause|seg3. silencedetect measures the scripted pause PLUS the
// TTS lines' own edge padding (~0.3-0.5s observed), so these are set slightly
// short to keep the DETECTED silences inside the 2-3s ask.
const PAUSES_MS = [2500, 2300];

const run = (cmd, cwd = ROOT, timeout) => execSync(cmd, {cwd, stdio: 'inherit', ...(timeout ? {timeout} : {})});

const variantConfig = (variant) => ({
  brand: BRAND,
  frameCount: FRAME_COUNT,
  fps: FPS,
  ...variant,
});

// --- pure helpers (exported for scripts/build-magnetic-demo-media.test.mjs) ---

// Frame inventory of a directory listing: `prefix` is the highest N such that
// frames 1..N are all present; `strays` are frame numbers BEYOND that prefix
// (e.g. left by an orphaned Blender process a timeout failed to kill). Strays
// must be deleted before rendering — resume math assumes prefix-only content.
export function frameInventory(names) {
  const nums = names
    .map((f) => /^frame_(\d{4})\.png$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number);
  const present = new Set(nums);
  let prefix = 0;
  while (present.has(prefix + 1)) prefix += 1;
  const strays = nums.filter((n) => n > prefix).sort((x, y) => x - y);
  return {prefix, strays};
}

/** Product-owned paths shared with record-magnetic-demo.mjs. */
export function magneticMediaPaths(workspace) {
  const mediaDir = join(workspace.assetsDir, 'demo-media');
  return {
    mediaDir,
    footageDir: join(mediaDir, 'frames'),
    voDir: join(mediaDir, 'vo'),
  };
}

// Key-order-insensitive config equality (render-config.json provenance checks).
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]))
      : v;
export const sameConfig = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Extracts every `silence_duration: <s>` ffmpeg's silencedetect printed.
export const parseSilenceDurations = (text) =>
  [...text.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));

// The take must contain EXACTLY the two scripted 2-3s dead-air pauses — count
// alone would accept a 5s hole or a clipped 1.6s gap as "a pause".
export function assertScriptedPauses(durations) {
  if (durations.length !== 2) {
    throw new Error(`voiceover-take: expected 2 detected silences (the scripted pauses), found ${durations.length}`);
  }
  for (const d of durations) {
    if (d < 2 || d > 3) {
      throw new Error(`voiceover-take: detected silence of ${d.toFixed(2)}s outside the scripted 2-3s window`);
    }
  }
}

// --- stages ---

// Renders one variant's PNG frames in CHUNK_FRAMES-sized Blender runs. Resumable:
// a render-config.json marker records the exact knob set; on mismatch (or absence)
// the frame dir is cleaned — stale frames from a different config are never mixed
// in. On match, rendering resumes at the contiguous prefix, re-rendering the last
// existing frame in case the previous run died mid-write.
function renderStage(variant) {
  const framesDir = join(FOOTAGE_DIR, variant.id);
  const markerPath = join(framesDir, 'render-config.json');
  const config = variantConfig(variant);
  mkdirSync(framesDir, {recursive: true});

  const markerOk =
    existsSync(markerPath) && sameConfig(JSON.parse(readFileSync(markerPath, 'utf8')), config);
  if (!markerOk) {
    const stale = readdirSync(framesDir).filter((f) => /^frame_\d+\.png$/.test(f));
    if (stale.length > 0) {
      console.log(`render-${variant.id}: config changed/missing marker — cleaning ${stale.length} stale frame(s)`);
      rmSync(framesDir, {recursive: true, force: true});
      mkdirSync(framesDir, {recursive: true});
    }
    writeFileSync(markerPath, JSON.stringify(config, null, 2) + '\n');
  }

  // Delete frames beyond the contiguous prefix BEFORE rendering: an orphaned
  // Blender process (timeout kill that missed the tree) may have kept writing
  // frames the resume math doesn't account for.
  const inv = frameInventory(readdirSync(framesDir));
  for (const n of inv.strays) {
    const stray = join(framesDir, `frame_${String(n).padStart(4, '0')}.png`);
    rmSync(stray, {force: true});
  }
  if (inv.strays.length > 0) {
    console.log(`render-${variant.id}: removed ${inv.strays.length} stray frame(s) beyond contiguous prefix ${inv.prefix}`);
  }

  const done = inv.prefix;
  if (done >= FRAME_COUNT) {
    console.log(`render-${variant.id}: all ${FRAME_COUNT} frames present, skipping`);
    return framesDir;
  }

  // Resume at the last contiguous frame (re-render it: a killed run may have
  // left it partially written).
  let next = Math.max(1, done);
  console.log(`render-${variant.id}: rendering frames ${next}..${FRAME_COUNT} in chunks of ${CHUNK_FRAMES} (accent=${variant.accent} scale=${variant.scale} distortion=${variant.distortion} detail=${variant.detail} phase-start=${variant.phaseStart})`);
  while (next <= FRAME_COUNT) {
    const end = Math.min(next + CHUNK_FRAMES - 1, FRAME_COUNT);
    console.log(`render-${variant.id}: chunk ${next}-${end}`);
    run(
      `python feeders/blender/render.py feeders/blender/scenes/background_loop.py --project "${WORKSPACE.projectRoot}" --out "${framesDir}" --timeout ${CHUNK_TIMEOUT_S} --animation --brand ${BRAND} --frame-count ${FRAME_COUNT} --scale ${variant.scale} --distortion ${variant.distortion} --detail ${variant.detail} --phase-start ${variant.phaseStart} --accent "${variant.accent}" --accent-strength ${variant.accentStrength} --shadow-strength ${variant.shadowStrength} --start-frame ${next} --end-frame ${end}`,
      ROOT,
      CHUNK_TIMEOUT_MS,
    );
    const have = frameInventory(readdirSync(framesDir)).prefix;
    if (have < end) {
      throw new Error(`render-${variant.id}: chunk ${next}-${end} finished but only frames 1..${have} are contiguous on disk`);
    }
    next = end + 1;
  }
  console.log(`render-${variant.id}: ${FRAME_COUNT} frames complete in ${framesDir}`);
  return framesDir;
}

// Encodes one variant's completed frame dir to H.264 yuv420p faststart mp4.
// Cached on the full knob set; refuses to encode an incomplete sequence or one
// whose render-config.json provenance doesn't match the CURRENT knobs (a
// standalone `--stage encode` must never bake stale-config frames into a clip).
function encodeClip(variant) {
  const outMp4 = join(OUT_DIR, `clip-${variant.id}.mp4`);
  const framesDir = join(FOOTAGE_DIR, variant.id);
  const config = variantConfig(variant);
  const key = cacheKey({stage: `clip-${variant.id}`, ...config});
  const {hit} = checkCache(WORKSPACE, `clip-${variant.id}`, key, [outMp4]);
  if (hit) {
    console.log(`encode clip-${variant.id}: cache hit, skipping (${outMp4})`);
    return outMp4;
  }

  const markerPath = join(framesDir, 'render-config.json');
  if (!existsSync(markerPath)) {
    throw new Error(`encode clip-${variant.id}: no render-config.json in ${framesDir} — run --stage render-${variant.id} first`);
  }
  if (!sameConfig(JSON.parse(readFileSync(markerPath, 'utf8')), config)) {
    throw new Error(`encode clip-${variant.id}: render-config.json does not match the current variant knobs — frames are from a different config; run --stage render-${variant.id} first`);
  }

  const done = frameInventory(readdirSync(framesDir)).prefix;
  if (done < FRAME_COUNT) {
    throw new Error(`encode clip-${variant.id}: frames incomplete (${done}/${FRAME_COUNT}) — run --stage render-${variant.id} first`);
  }

  console.log(`encode clip-${variant.id}: -> ${outMp4}`);
  ffmpeg([
    '-y',
    '-framerate', String(FPS),
    '-i', join(framesDir, 'frame_%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outMp4,
  ]);
  if (!existsSync(outMp4)) throw new Error(`encode clip-${variant.id}: did not produce ${outMp4}`);

  storeCache(WORKSPACE, `clip-${variant.id}`, key, [outMp4]);
  return outMp4;
}

// Generates the 3 speech segments into VO_DIR (id.mp3 via ElevenLabs, or id.wav via
// the SAPI fallback below). Tries ElevenLabs first; a documented exit 2 (no key)
// falls back to Windows SAPI TTS per-line via PowerShell. Returns an array of
// resolved file paths, one per VO_LINES entry, in order.
function generateVoSegments() {
  const missing = VO_LINES.filter((l) => !existsSync(join(VO_DIR, `${l.id}.mp3`)) && !existsSync(join(VO_DIR, `${l.id}.wav`)));
  if (missing.length === 0) {
    console.log('vo: all segments already staged, skipping generation');
    return VO_LINES.map((l) => resolveSegmentPath(l.id));
  }

  const scriptPath = join(VO_DIR, 'vo-script.json');
  writeFileSync(scriptPath, JSON.stringify({lines: missing}));
  console.log(`vo: requesting ${missing.length} segment(s) from ElevenLabs...`);
  const res = spawnSync('node', ['feeders/audio/client.mjs', 'vo', '--script', scriptPath, '--out', VO_DIR], {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  process.stdout.write(res.stdout ?? '');
  process.stderr.write(res.stderr ?? '');

  if (res.status === 2) {
    console.log('vo: ELEVENLABS_API_KEY absent (documented fallback) -> Windows SAPI TTS per segment.');
    for (const l of missing) sapiSpeak(l.text, join(VO_DIR, `${l.id}.wav`));
  } else if (res.status !== 0) {
    throw new Error(`vo: feeders/audio/client.mjs exited ${res.status}`);
  }

  return VO_LINES.map((l) => resolveSegmentPath(l.id));
}

function resolveSegmentPath(id) {
  const mp3 = join(VO_DIR, `${id}.mp3`);
  const wav = join(VO_DIR, `${id}.wav`);
  if (existsSync(mp3)) return mp3;
  if (existsSync(wav)) return wav;
  throw new Error(`vo: no audio staged for segment ${id}`);
}

// Windows SAPI TTS via PowerShell (same technique as final-cut-pro's
// scripts/make-fixtures.mjs, read-only reference — not imported, this repo has no
// Node dependency on that file).
function sapiSpeak(text, outWavPath) {
  const psCommand = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    `$s.SetOutputToWaveFile('${outWavPath.replace(/'/g, "''")}');`,
    `$s.Speak('${text.replace(/'/g, "''")}');`,
    '$s.Dispose()',
  ].join(' ');
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {stdio: 'inherit'});
  if (res.status !== 0) throw new Error(`SAPI TTS (powershell.exe) exited ${res.status}`);
  if (!existsSync(outWavPath)) throw new Error(`SAPI TTS did not produce ${outWavPath}`);
  console.log(`vo: SAPI wrote ${outWavPath}`);
}

// Normalizes one segment to 44.1kHz mono PCM WAV so it concatenates cleanly with
// the generated silence beds regardless of source codec (ElevenLabs mp3 vs SAPI wav).
function normalizeToWav(srcPath, destPath) {
  ffmpeg(['-y', '-i', srcPath, '-ar', '44100', '-ac', '1', destPath]);
  if (!existsSync(destPath)) throw new Error(`normalize did not produce ${destPath}`);
}

function generateSilence(ms, destPath) {
  ffmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', (ms / 1000).toFixed(3), destPath]);
  if (!existsSync(destPath)) throw new Error(`silence generation did not produce ${destPath}`);
}

// Builds the take's audio: seg1, pause, seg2, pause, seg3, concatenated via ffmpeg's
// concat demuxer (all parts normalized to the same PCM WAV spec first).
function buildTakeAudio(segmentPaths) {
  const takeWav = join(VO_DIR, 'take.wav');
  const key = cacheKey({stage: 'take-audio', lines: VO_LINES, pausesMs: PAUSES_MS});
  const {hit} = checkCache(WORKSPACE, 'take-audio', key, [takeWav]);
  if (hit) {
    console.log(`take-audio: cache hit, skipping (${takeWav})`);
    return takeWav;
  }

  const normSegs = segmentPaths.map((p, i) => {
    const dest = join(VO_DIR, `norm-seg${i + 1}.wav`);
    normalizeToWav(p, dest);
    return dest;
  });
  const pausePaths = PAUSES_MS.map((ms, i) => {
    const dest = join(VO_DIR, `pause${i + 1}.wav`);
    generateSilence(ms, dest);
    return dest;
  });

  const parts = [normSegs[0], pausePaths[0], normSegs[1], pausePaths[1], normSegs[2]];
  const listPath = join(VO_DIR, 'concat-list.txt');
  writeFileSync(listPath, parts.map((p) => `file '${resolve(p).replace(/\\/g, '/')}'`).join('\n') + '\n');

  console.log('take-audio: concatenating seg1 + pause + seg2 + pause + seg3...');
  ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', takeWav]);
  if (!existsSync(takeWav)) throw new Error(`concat did not produce ${takeWav}`);

  storeCache(WORKSPACE, 'take-audio', key, [takeWav]);
  return takeWav;
}

// Muxes clip-a's picture under the take audio. The VO track's length depends on
// TTS pacing, so -stream_loop -1 loops clip-a's (seamless) picture as needed and
// -shortest ends the take at the AUDIO length. Video is re-encoded rather than
// stream-copied: with -c:v copy, -shortest only cuts at copied-packet boundaries
// and left a ~3s soundless video tail — a third silent stretch Rough Cut would
// detect on camera alongside the two scripted pauses.
function muxVoiceoverTake(clipAPath, takeAudioPath) {
  const outMp4 = join(OUT_DIR, 'voiceover-take.mp4');
  console.log(`voiceover-take: muxing ${clipAPath} (looped) + ${takeAudioPath} -> ${outMp4}`);
  ffmpeg([
    '-y',
    '-stream_loop', '-1', '-i', clipAPath,
    '-i', takeAudioPath,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-shortest', outMp4,
  ]);
  if (!existsSync(outMp4)) throw new Error(`mux did not produce ${outMp4}`);
  return outMp4;
}

// Verifies the take contains exactly the two scripted 2-3s dead-air pauses via
// ffmpeg's silencedetect, per the PLAYBOOK verification idiom. Asserts BOTH the
// count and each duration's [2,3]s window; logs the raw silencedetect lines.
function verifySilences(mp4Path) {
  // -vn + explicit pcm_s16le: Remotion's trimmed ffmpeg lacks wrapped_avframe
  // (the null muxer's default video encoder), so a bare `-f null -` errors with
  // "Encoder not found". Audio-only with an encoder it does ship works.
  // loud + capture 'both': silencedetect reports on ffmpeg's stderr at info level,
  // so the runner must neither add -loglevel error nor drop stderr (this replaces
  // the old shell `2>&1` merge).
  const out = ffmpeg(['-i', mp4Path, '-vn', '-af', 'silencedetect=noise=-35dB:d=1.5', '-c:a', 'pcm_s16le', '-f', 'null', '-'], {
    loud: true,
    capture: 'both',
  });
  console.log('voiceover-take: silencedetect output --');
  for (const line of out.split('\n')) {
    if (line.includes('silence_start') || line.includes('silence_end')) console.log(`  ${line.trim()}`);
  }
  const durations = parseSilenceDurations(out);
  assertScriptedPauses(durations);
  console.log(`voiceover-take: verified 2/2 scripted dead-air pauses, durations ${durations.map((d) => d.toFixed(2) + 's').join(', ')} (both within 2-3s).`);
}

function voStage() {
  const clipA = join(OUT_DIR, 'clip-a.mp4');
  // Provenance, not mere existence: clip-a must be the encode-stage output of the
  // CURRENT variant-a config (cache key covers the full knob set and the cache
  // layer re-checks the artifact exists non-empty on disk).
  const key = cacheKey({stage: 'clip-a', ...variantConfig(VARIANTS[0])});
  const {hit} = checkCache(WORKSPACE, 'clip-a', key, [clipA]);
  if (!hit) {
    throw new Error('vo: clip-a.mp4 missing or not built from the current variant-a config — run --stage encode first');
  }
  const segmentPaths = generateVoSegments();
  const takeAudioPath = buildTakeAudio(segmentPaths);
  const voiceoverPath = muxVoiceoverTake(clipA, takeAudioPath);
  verifySilences(voiceoverPath);
}

const STAGES = {
  'render-a': () => renderStage(VARIANTS[0]),
  'render-b': () => renderStage(VARIANTS[1]),
  'render-c': () => renderStage(VARIANTS[2]),
  encode: () => VARIANTS.forEach(encodeClip),
  vo: voStage,
};

async function main() {
  const argv = process.argv.slice(2);
  WORKSPACE = resolveWorkspace(ROOT, {brand: BRAND, project: projectArg(argv)});
  const paths = magneticMediaPaths(WORKSPACE);
  FOOTAGE_DIR = paths.footageDir;
  VO_DIR = paths.voDir;
  OUT_DIR = paths.mediaDir;
  const stageIdx = argv.indexOf('--stage');
  const stage = stageIdx >= 0 ? argv[stageIdx + 1] : 'all';
  if (stage !== 'all' && !STAGES[stage]) {
    throw new Error(`unknown --stage "${stage}" (expected ${Object.keys(STAGES).join('|')}|all)`);
  }

  mkdirSync(FOOTAGE_DIR, {recursive: true});
  mkdirSync(VO_DIR, {recursive: true});
  mkdirSync(OUT_DIR, {recursive: true});

  console.log(`== Magnetic demo media builder (stage: ${stage}) ==`);
  const toRun = stage === 'all' ? Object.keys(STAGES) : [stage];
  for (const name of toRun) STAGES[name]();

  if (stage === 'all' || stage === 'vo') {
    console.log('\n== Inventory ==');
    for (const f of ['clip-a.mp4', 'clip-b.mp4', 'clip-c.mp4', 'voiceover-take.mp4']) {
      console.log(`  ${join(OUT_DIR, f)}`);
    }
  }
  console.log(`build-magnetic-demo-media OK (stage: ${stage})`);
}

// Import-safe (the test file imports the pure helpers above): only run when
// executed directly, matching feeders/audio/client.mjs's isMain convention.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
