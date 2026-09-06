#!/usr/bin/env node
// scripts/score-film.mjs — put narration, the music bed and the SFX cues under a
// rendered bespoke film, master it, and PROVE the delivered file.
//
// A film is not done without audio (CLAUDE.md). This is the one step that turns a
// silent render into the deliverable: every VO line from the film-audio manifest is
// placed at its startMs, the bed is ducked under speech with a sidechain, each SFX
// cue lands on its frame, and the mix is mastered to master-audio's TARGET_I with a
// true-peak ceiling — then the DELIVERED mp4 is measured, never the filter graph.
//
// Usage: node scripts/score-film.mjs <brand> <film.mp4> --project <product-repo>
//                                    [--manifest <json>] [--out <path>] [--music-only]
//   --manifest   default product marketing props/<brand>-film-audio.json (built by
//                scripts/build-<brand>-film-audio.mjs; never hand-edited)
//   --out        default <film>-scored.mp4 beside the input; always refuses to
//                overwrite because versions are evidence
//   --music-only explicit opt-out of narration; recorded in score.json so
//                check-audio can flag it. Without it, a manifest with zero VO lines
//                is an error, not a silent bed.
//
// Exit 0 = delivered file verified. 1 = mix/master/verify failed (message says
// which). 2 = ffmpeg or the manifest is missing.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {TARGET_I} from './master-audio.mjs';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';
import {
  analyzeMusicBed,
  assessMusicMarkers,
  probeMedia,
  reportFindings,
  resolveNarrationLines,
  sha256File,
} from './lib/sound-design.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const BREATH_MS = 150; // minimum gap between two narration lines
export const BED_GAIN = 0.5; // bed level before ducking
export const BED_FADE_S = 0.8; // fade out under the last frames
export const SFX_GAIN = {tick: 0.28, whoosh: 0.22, riser: 0.2};
export const DELIVER_TP = -1.0; // dBTP ceiling on the DELIVERED file
export const I_TOLERANCE = 0.5; // LU
// Speech has an ~18 dB crest; 4:1 brings it to ~10 so the master converges
// (same reasoning as score-social-clip's VO_COMP).
export const VO_COMP = 'acompressor=threshold=-24dB:ratio=4:attack=3:release=100:makeup=8dB';
export const VO_EQ = 'highpass=f=75,lowpass=f=15500,equalizer=f=260:t=q:w=1:g=-1.5';
// Generated beds arrive with mean -32 dB / peak -0.6 (postflop, 2026-09-01): far
// too spiky for a linear loudnorm. Tame the bed before it meets anything else.
export const BED_COMP = 'acompressor=threshold=-20dB:ratio=4:attack=4:release=90:makeup=3dB';
// Ducking: the bed is compressed by the narration sum. level_sc=1 keys on the raw
// VO so the duck depth does not depend on the bed's own level.
export const DUCK = 'sidechaincompress=threshold=0.02:ratio=6:attack=30:release=400:makeup=1:level_sc=1';
export const MIX_COMP = 'acompressor=threshold=-24dB:ratio=4:attack=3:release=120:makeup=6dB';
export const SFX_BUS = 'highpass=f=70,lowpass=f=15000,acompressor=threshold=-18dB:ratio=2:attack=2:release=80';
export const LIMIT = 0.74; // alimiter ceiling (-2.6 dBFS) before the AAC encode
export const MAX_ITER = 4;

/** Pure: lines that start before the previous one has ended plus a breath, or
 *  that run past the film. Exported for the test. */
export function lineCollisions(lines, totalMs, breath = BREATH_MS) {
  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    const end = l.startMs + l.durationMs;
    if (end > totalMs) out.push(`${l.id} ends at ${end}ms, past the film (${totalMs}ms)`);
    const next = sorted[i + 1];
    if (next && next.startMs < end + breath) {
      out.push(`${l.id} ends at ${end}ms, ${next.id} starts at ${next.startMs}ms (< ${breath}ms breath)`);
    }
  }
  return out;
}

/**
 * Pure: the ffmpeg filter graph. Inputs: 0 = film (video only), 1 = bed, 2.. = one
 * per VO line (in manifest order), then one per distinct SFX asset (in `sfxNames`
 * order). Returns the graph whose output pad is [mix]. Exported for the test.
 */
export function mixFilter(manifest, totalS, sfxNames, {musicOnly = false, productionBuses = false} = {}) {
  const lines = musicOnly ? [] : manifest.lines;
  const fps = manifest.fps;
  const parts = [];
  const fadeStart = Math.max(0, totalS - BED_FADE_S).toFixed(3);
  parts.push(`[1:a]atrim=0:${totalS.toFixed(3)},asetpts=PTS-STARTPTS,${BED_COMP},volume=${BED_GAIN},afade=t=out:st=${fadeStart}:d=${BED_FADE_S}[bed]`);
  lines.forEach((l, i) => {
    parts.push(`[${2 + i}:a]${VO_COMP},adelay=${l.startMs}|${l.startMs}[vo${i}]`);
  });
  let bedOut = '[bed]';
  if (lines.length) {
    const voSum = lines.length === 1 ? '[vo0]' : (parts.push(`${lines.map((_, i) => `[vo${i}]`).join('')}amix=inputs=${lines.length}:normalize=0:duration=longest[vosum]`), '[vosum]');
    parts.push(`${voSum}asplit[key0][voice0]`);
    parts.push(`[voice0]${productionBuses ? VO_EQ : 'anull'}[voice]`);
    // sidechaincompress ends with its SHORTEST input, so a key that stops when the
    // last line does takes the bed down with it — and then `-shortest` on the mux
    // takes the PICTURE down to that: offlocalhost lost 17 frames and postflop's
    // film-v4-scored 22 before this pad (measured 2026-09-03). Pad the key with
    // silence to the film so the duck lasts exactly as long as the bed does.
    parts.push(`[key0]apad=whole_dur=${totalS.toFixed(3)}[key]`);
    parts.push(`[bed][key]${DUCK}[bedd]`);
    bedOut = '[bedd]';
  }
  const sfxBase = 2 + lines.length;
  const sfxPads = [];
  sfxNames.forEach((name, ni) => {
    const cues = (manifest.sfx ?? []).filter((c) => c.name === name);
    if (!cues.length) return;
    const gain = SFX_GAIN[name] ?? 0.25;
    parts.push(`[${sfxBase + ni}:a]asplit=${cues.length}${cues.map((_, ci) => `[s${ni}_${ci}]`).join('')}`);
    cues.forEach((c, ci) => {
      const ms = Math.round((c.frame / fps) * 1000);
      parts.push(`[s${ni}_${ci}]adelay=${ms}|${ms},volume=${c.gain ?? gain}[S${ni}_${ci}]`);
      sfxPads.push(`[S${ni}_${ci}]`);
    });
  });
  let mixedSfxPads = sfxPads;
  if (productionBuses && sfxPads.length) {
    parts.push(`${sfxPads.join('')}amix=inputs=${sfxPads.length}:normalize=0:duration=longest,${SFX_BUS}[sfxbus]`);
    mixedSfxPads = ['[sfxbus]'];
  }
  const inputs = [bedOut, ...(lines.length ? ['[voice]'] : []), ...mixedSfxPads];
  parts.push(`${inputs.join('')}amix=inputs=${inputs.length}:normalize=0:duration=first[mix]`);
  return parts.join(';');
}

/** Pure: next gain to try given what the delivered file measured. */
export function nextGain(gainDb, measuredI, target = TARGET_I) {
  return Number((gainDb + (target - measuredI)).toFixed(2));
}

function ff(args, {capture = false} = {}) {
  const r = spawnSync('ffmpeg', args, {encoding: 'utf8', stdio: capture ? 'pipe' : ['ignore', 'ignore', 'pipe']});
  if (r.error) {
    console.error('score-film: ffmpeg not on PATH');
    process.exit(2);
  }
  return r;
}

function durationS(file) {
  // Picture duration is authoritative. A previously muxed AAC tail can extend the
  // container by one codec frame (observed 28.053s around a 28.000s/840-frame cut).
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'json', file],
    {encoding: 'utf8'},
  );
  let d = NaN;
  try {
    d = Number(JSON.parse(String(r.stdout)).streams?.[0]?.duration);
  } catch {}
  if (!Number.isFinite(d) || d <= 0) throw new Error(`could not measure ${file}`);
  return d;
}

/** Measure the DELIVERED file: integrated loudness, true peak, LRA. */
export function measure(file) {
  const r = ff(['-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], {capture: true});
  const text = String(r.stderr);
  const num = (re) => {
    const m = text.match(re);
    return m ? Number(m[1]) : NaN;
  };
  return {I: num(/\n\s+I:\s+(-?[\d.]+) LUFS/), TP: num(/Peak:\s+(-?[\d.]+) dB/), LRA: num(/LRA:\s+(-?[\d.]+) LU/)};
}

function levelledSfx(name, dir, assetsDir) {
  const out = join(dir, `${name}.mp3`);
  if (!existsSync(out)) {
    mkdirSync(dir, {recursive: true});
    const src = join(assetsDir, 'sfx', `${name}.mp3`);
    if (!existsSync(src)) throw new Error(`no product-owned SFX asset ${src} (run scripts/build-sfx.mjs <brand> --project <repo>)`);
    const dur = name === 'tick' ? '0.5' : '1.0';
    const gain = name === 'tick' ? '22' : '16';
    const r = spawnSync('node', [join(root, 'scripts', 'level-sfx.mjs'), src, '--gain', gain, '--dur', dur, '--out', out], {encoding: 'utf8'});
    if (r.status !== 0 || !existsSync(out)) throw new Error(`level-sfx failed for ${name}: ${r.stderr}`);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : null);
  const has = (n) => argv.includes(n);
  const valueFlags = new Set(['--manifest', '--out', '--project']);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (valueFlags.has(argv[i])) {
      i += 1;
      continue;
    }
    if (!argv[i].startsWith('--')) positional.push(argv[i]);
  }
  const [brand, filmArg] = positional;
  const project = projectArg(argv);
  if (!brand || !filmArg || !project) {
    console.error('usage: node scripts/score-film.mjs <brand> <film.mp4> --project <product-repo> [--manifest <json>] [--out <path>] [--music-only]');
    process.exit(2);
  }
  const workspace = resolveWorkspace(root, {brand, project});
  const film = resolveWorkspacePath(workspace, filmArg);
  const manifestPath = flag('--manifest')
    ? resolveWorkspacePath(workspace, flag('--manifest'))
    : join(workspace.propsDir, `${brand}-film-audio.json`);
  if (!existsSync(film) || !existsSync(manifestPath)) {
    console.error(`score-film: missing ${existsSync(film) ? manifestPath : film}`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const musicOnly = has('--music-only');
  if (!musicOnly && !(manifest.lines ?? []).length) {
    console.error('score-film: the manifest has no VO lines. A film narrates the product; pass --music-only ONLY as a recorded, deliberate choice.');
    process.exit(1);
  }
  const out = flag('--out')
    ? resolveWorkspacePath(workspace, flag('--out'))
    : join(dirname(film), `${basename(film, '.mp4')}-scored.mp4`);
  if (existsSync(out)) {
    console.error(`score-film: refusing to overwrite ${out}; score into a new version`);
    process.exit(1);
  }
  const totalS = durationS(film);
  const totalMs = Math.round(totalS * 1000);
  const resolvedLines = musicOnly ? [] : resolveNarrationLines(manifest.lines, manifest.fps, totalMs);
  const resolvedManifest = {...manifest, lines: resolvedLines};
  const collisions = musicOnly ? [] : lineCollisions(resolvedLines, totalMs);
  if (collisions.length) {
    console.error('score-film: narration does not fit the picture — trim the COPY in the builder, never the timing:');
    for (const c of collisions) console.error('  ' + c);
    process.exit(1);
  }
  const pub = workspace.publicDir;
  if (!manifest.music?.src) throw new Error('film audio manifest has no music bed');
  const bed = join(pub, manifest.music.src);
  const voFiles = musicOnly ? [] : resolvedLines.map((l) => join(pub, l.src));
  for (const f of [bed, ...voFiles]) if (!existsSync(f)) throw new Error(`missing audio ${f}`);
  const workDir = join(workspace.brandRoot, '.score-work', basename(out, '.mp4'));
  mkdirSync(workDir, {recursive: true});
  const sfxNames = [...new Set((resolvedManifest.sfx ?? []).map((c) => c.name))];
  const sfxFiles = sfxNames.map((n) => levelledSfx(n, join(workDir, 'sfx'), workspace.assetsDir));
  const beatAnalysis = analyzeMusicBed(bed);
  const markerResults = assessMusicMarkers(manifest.music.markers ?? [], beatAnalysis, manifest.fps);

  // 1. mix to float WAV (no clipping in the intermediate)
  const mixWav = join(workDir, 'mix.wav');
  const inputs = [film, bed, ...voFiles, ...sfxFiles].flatMap((f) => ['-i', f]);
  const graph = mixFilter(resolvedManifest, totalS, sfxNames, {musicOnly, productionBuses: true});
  let r = ff(['-loglevel', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[mix]', '-c:a', 'pcm_f32le', '-t', totalS.toFixed(3), mixWav]);
  if (r.status !== 0) {
    console.error('score-film: mix failed\n' + r.stderr);
    process.exit(1);
  }
  const stage = join(workDir, 'stage.wav');
  r = ff(['-loglevel', 'error', '-y', '-i', mixWav, '-af', MIX_COMP, '-c:a', 'pcm_f32le', stage]);
  if (r.status !== 0) {
    console.error('score-film: stage failed\n' + r.stderr);
    process.exit(1);
  }

  // 2. master: measured gain into a limiter, re-measure the DELIVERED file, iterate
  let gain = TARGET_I - measure(stage).I + 2.5; // limiter eats ~2-3 LU on this material
  let limit = LIMIT;
  let m = null;
  let iter = 0;
  for (; iter < MAX_ITER; iter++) {
    if (existsSync(out)) rmSync(out);
    r = ff(['-loglevel', 'error', '-y', '-i', film, '-i', stage, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', `volume=${gain}dB,alimiter=limit=${limit}:level=disabled:attack=2:release=60,aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', out]);
    if (r.status !== 0) {
      console.error('score-film: master encode failed\n' + r.stderr);
      process.exit(1);
    }
    m = measure(out);
    console.log(`  pass ${iter + 1}: gain ${gain}dB limit ${limit} -> I ${m.I} LUFS, TP ${m.TP} dBTP, LRA ${m.LRA}`);
    const okI = Math.abs(m.I - TARGET_I) <= I_TOLERANCE;
    const okTP = m.TP <= DELIVER_TP;
    if (okI && okTP) break;
    if (!okTP) limit = Number((limit * 0.94).toFixed(3));
    gain = nextGain(gain, m.I);
  }
  const pass = m && Math.abs(m.I - TARGET_I) <= I_TOLERANCE && m.TP <= DELIVER_TP;
  const media = probeMedia(out);
  const outHash = await sha256File(out);
  const findings = reportFindings({
    measurements: m,
    beatAnalysis,
    markerResults,
    expectedDurationSec: totalS,
    actualDurationSec: media.durationSec,
  });
  const machinePass = pass && !findings.some((finding) => finding.level === 'error');
  const rel = (path) => relative(workspace.projectRoot, path).replaceAll('\\', '/');
  const record = {
    judge: 'sound-design-machine',
    verdict: machinePass ? 'PASS' : 'FAIL',
    generatedAt: new Date().toISOString(),
    input: {
      path: rel(out),
      sha256: outHash,
      bytes: media.bytes,
      durationSec: media.durationSec,
      audio: media.audio,
      processed: {
        voLines: musicOnly ? 0 : resolvedLines.length,
        sfxCues: (manifest.sfx ?? []).length,
        musicMarkers: markerResults.length,
        beatWindows: beatAnalysis.windows,
        beatCandidates: beatAnalysis.beatTimesMs.length,
      },
    },
    findings,
    film: filmArg,
    out: rel(out),
    manifest: rel(manifestPath),
    voLines: musicOnly ? 0 : resolvedLines.length,
    sfxCues: (manifest.sfx ?? []).length,
    musicOnly,
    measured: m,
    beatAnalysis: {
      estimatedBpm: beatAnalysis.estimatedBpm,
      confidence: beatAnalysis.confidence,
      candidates: beatAnalysis.beatTimesMs.length,
      windows: beatAnalysis.windows,
    },
    musicMarkers: markerResults,
    passes: iter + 1,
  };
  mkdirSync(workspace.marketingDir, {recursive: true});
  writeFileSync(join(workspace.marketingDir, 'score.json'), JSON.stringify(record, null, 2) + '\n');
  const reportPath = join(workspace.marketingDir, `${basename(out, '.mp4')}-audio-report.json`);
  writeFileSync(reportPath, JSON.stringify(record, null, 2) + '\n');
  rmSync(mixWav, {force: true});
  rmSync(stage, {force: true});
  console.log(`score-film [${brand}]: ${record.verdict} — ${record.voLines} VO lines, ${record.sfxCues} sfx cues, ${markerResults.length} music markers; delivered ${record.out} at I ${m?.I} LUFS / TP ${m?.TP} dBTP`);
  console.log(`  report ${rel(reportPath)} sha256 ${outHash} bytes ${media.bytes} duration ${media.durationSec}s`);
  if (!machinePass) {
    console.error(`score-film: delivered file outside the gate (I within ${I_TOLERANCE} of ${TARGET_I}, TP <= ${DELIVER_TP}) after ${iter + 1} passes`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
