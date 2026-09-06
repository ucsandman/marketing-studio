#!/usr/bin/env node
// scripts/check-audio.mjs — HARD GATE: every delivered film carries a mastered
// soundtrack with narration. Exit 1 on any FAIL.
//
// Exists because two postflop cuts shipped silent on 2026-09-01 and the third
// shipped music-only; the user's rule is that a film is not done without audio and
// a voice explaining the product. Nothing upstream enforced it, so this does.
//
// Scope (what actually ships):
//   out/<brand>/postkit/**/*.mp4        except *-silent.mp4 (deliberate muted variants)
//   out/<brand>/*.mp4                   except og.mp4 (a silent web loop by design)
//                                       and *-silent.mp4
//   out/<brand>/film/                   the newest film-vN.mp4 must have a
//                                       film-vN-scored.mp4 and a score.json with
//                                       voLines > 0 (or musicOnly recorded as a
//                                       deliberate choice, which is a WARN)
// Per file: an audio stream exists, it is not silent (mean volume above
// SILENT_MEAN_DB), and integrated loudness sits within I_BAND of master-audio's
// TARGET_I. The verdict line carries the counts (checked/failed/skipped) so a
// green run on zero files reads as what it is.
//
// Usage: node scripts/check-audio.mjs <brand> [--json]
// Output: <product-repo>/marketing/assets/<brand>/marketing/check-audio.json
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join, relative} from 'node:path';
import {TARGET_I} from './master-audio.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SILENT_MEAN_DB = -45;
export const I_BAND = 2; // LU either side of TARGET_I

/** Pure: is this out/<brand>-relative mp4 path a delivery surface? Exported for the test. */
export function classify(rel) {
  const p = rel.replaceAll('\\', '/');
  const base = basename(p);
  if (base.endsWith('-silent.mp4')) return {check: false, why: 'silent variant by design'};
  if (p.startsWith('postkit/')) return {check: true, why: 'postkit'};
  if (!p.includes('/')) {
    if (base === 'og.mp4') return {check: false, why: 'og loop is silent by design'};
    // The locks and finals are what postkit and the product repo consume; the
    // director-loop versions (launch-v2.mp4), raw captures (demo.mp4) and
    // ingredients (logo-reveal.mp4) are silent on purpose until they are scored.
    if (base === 'launch.mp4' || /-final(-v\d+)?\.mp4$/.test(base)) return {check: true, why: 'lock/final'};
  }
  return {check: false, why: 'working file'};
}

/** Pure: verdict for one measured file. Exported for the test. */
export function judge({hasAudio, meanDb, I}) {
  if (!hasAudio) return {verdict: 'FAIL', reason: 'no audio stream'};
  if (!(meanDb > SILENT_MEAN_DB)) return {verdict: 'FAIL', reason: `silent (mean ${meanDb} dB)`};
  if (!(Math.abs(I - TARGET_I) <= I_BAND)) return {verdict: 'FAIL', reason: `loudness ${I} LUFS outside ${TARGET_I}±${I_BAND}`};
  return {verdict: 'PASS', reason: ''};
}

/** Pure: which film version is newest and whether it is scored. Exported for the test. */
export function filmStatus(files, score) {
  const versions = files.map((f) => f.match(/^film-v(\d+)\.mp4$/)).filter(Boolean).map((m) => Number(m[1]));
  if (!versions.length) return null;
  const v = Math.max(...versions);
  const scored = files.includes(`film-v${v}-scored.mp4`);
  if (!scored) return {version: v, verdict: 'FAIL', reason: `film-v${v}.mp4 has no film-v${v}-scored.mp4`};
  if (!score) return {version: v, verdict: 'FAIL', reason: 'no score.json (run scripts/score-film.mjs)'};
  if (score.musicOnly) return {version: v, verdict: 'WARN', reason: 'music-only: no narration (recorded as deliberate)'};
  if (!(score.voLines > 0)) return {version: v, verdict: 'FAIL', reason: 'scored without narration'};
  return {version: v, verdict: 'PASS', reason: `${score.voLines} VO lines`};
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function probe(file) {
  const s = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], {encoding: 'utf8'});
  const hasAudio = /audio/.test(String(s.stdout));
  if (!hasAudio) return {hasAudio};
  const v = spawnSync('ffmpeg', ['-i', file, '-af', 'volumedetect', '-f', 'null', '-'], {encoding: 'utf8'});
  const meanDb = Number((String(v.stderr).match(/mean_volume:\s+(-?[\d.]+)/) || [])[1]);
  const e = spawnSync('ffmpeg', ['-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], {encoding: 'utf8'});
  const I = Number((String(e.stderr).match(/\n\s+I:\s+(-?[\d.]+) LUFS/) || [])[1]);
  return {hasAudio, meanDb, I};
}

function main() {
  const argv = process.argv.slice(2);
  const brand = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--project');
  if (!brand) {
    console.error('usage: node scripts/check-audio.mjs <brand> --project <product-repo> [--json]');
    process.exit(2);
  }
  let ws;
  try {
    ws = resolveWorkspace(root, {brand, project: projectArg(argv)});
  } catch (err) {
    console.error(`check-audio: ${err.message}`);
    process.exit(2);
  }
  const outDir = ws.brandOut;
  const files = walk(join(outDir, 'postkit')).concat(
    existsSync(outDir) ? readdirSync(outDir).map((n) => join(outDir, n)).filter((p) => statSync(p).isFile()) : [],
  ).filter((p) => p.endsWith('.mp4'));
  const results = [];
  let skipped = 0;
  for (const file of files) {
    const rel = relative(outDir, file);
    const c = classify(rel);
    if (!c.check) {
      skipped++;
      continue;
    }
    const measured = probe(file);
    results.push({file: rel.replaceAll('\\', '/'), ...measured, ...judge(measured)});
  }
  const filmDir = join(outDir, 'film');
  const filmFiles = existsSync(filmDir) ? readdirSync(filmDir) : [];
  const scorePath = join(filmDir, 'score.json');
  const film = filmStatus(filmFiles, existsSync(scorePath) ? JSON.parse(readFileSync(scorePath, 'utf8')) : null);
  const failed = results.filter((r) => r.verdict === 'FAIL').length + (film && film.verdict === 'FAIL' ? 1 : 0);
  const checked = results.length + (film ? 1 : 0);
  const report = {brand, checked, failed, skipped, targetI: TARGET_I, band: I_BAND, files: results, film};
  mkdirSync(ws.marketingDir, {recursive: true});
  writeFileSync(join(ws.marketingDir, 'check-audio.json'), JSON.stringify(report, null, 2) + '\n');
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  for (const r of results) console.log(`  ${r.verdict.padEnd(4)} ${r.file}${r.reason ? '  ' + r.reason : ''}${r.I ? `  (I ${r.I})` : ''}`);
  if (film) console.log(`  ${film.verdict.padEnd(4)} film/film-v${film.version}.mp4  ${film.reason}`);
  console.log(`check-audio [${brand}]: ${failed ? 'FAIL' : 'PASS'} — checked=${checked} failed=${failed} skipped=${skipped}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url)) main();
