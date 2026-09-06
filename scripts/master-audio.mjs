#!/usr/bin/env node
// scripts/master-audio.mjs — post-render loudness mastering (Phase A).
//
// Two-pass loudnorm to -14 LUFS integrated / -1.0 dBTP / LRA 7, a true-peak limiter,
// then a full re-encode (film grain defeats -c:v copy's inter-frame compression).
// Ported from AbubakrChan/product-launch-motion's master.sh — see docs/PLAYBOOK.md
// "Loudness mastering" for the two traps this encodes (linear=true still clips
// without the limiter; alimiter needs level=disabled or it re-boosts past target).
//
// Shells to plain `ffmpeg` on PATH, not `npx remotion ffmpeg` — Remotion's bundled
// build lacks the alimiter/ebur128 filters this script depends on.
//
// Usage: node scripts/master-audio.mjs <in.mp4> --project <product-repo> [--out <path>]
// Default out is a versioned sibling (in.mp4 -> in-v2.mp4, in-v2.mp4 -> in-v3.mp4);
// an existing file is never overwritten.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join, basename, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

export const TARGET_I = -14;
const TARGET_TP = -1.0; // the DELIVERED-file gate
// The processing chain works to -2.0 dBTP, not -1.0: alimiter constrains sample
// peaks only, and AAC re-encoding overshoots the ceiling by ~0.5 dB of true
// peak on real masters. Without this headroom, verification fails every run.
export const CHAIN_TP = -2.0;
export const TARGET_LRA = 7;
const LIMIT = 0.794; // ~-2.0 dBFS, the limiter ceiling (matches CHAIN_TP)
const I_TOLERANCE = 0.5;

function main() {
  const argv = process.argv.slice(2);
  const project = projectArg(argv);
  const outIdx = argv.indexOf('--out');
  const outArg = outIdx >= 0 ? argv[outIdx + 1] : null;
  const projectIdx = argv.indexOf('--project');
  const outSkip = new Set([
    ...(outIdx >= 0 ? [outIdx, outIdx + 1] : []),
    ...(projectIdx >= 0 ? [projectIdx, projectIdx + 1] : []),
  ]);
  const input = argv.find((a, i) => !outSkip.has(i) && !a.startsWith('--'));

  if (!input || !project) {
    console.error('usage: node scripts/master-audio.mjs <in.mp4> --project <product-repo> [--out <path>]');
    process.exit(1);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const workspace = resolveWorkspace(root, {brand: 'audio-master', project});
  const inputAbs = resolveWorkspacePath(workspace, input);
  if (!existsSync(inputAbs)) {
    console.error(`master-audio: missing ${inputAbs}`);
    process.exit(1);
  }

  // in.mp4 -> in-v2.mp4; in-v3.mp4 -> in-v4.mp4; skip any name already on disk.
  function versionedOut(inPath) {
    const ext = extname(inPath);
    const dir = dirname(inPath);
    const base = basename(inPath, ext);
    const m = base.match(/^(.*)-v(\d+)$/);
    const stem = m ? m[1] : base;
    let n = m ? Number(m[2]) + 1 : 2;
    let candidate = join(dir, `${stem}-v${n}${ext}`);
    while (existsSync(candidate)) {
      n += 1;
      candidate = join(dir, `${stem}-v${n}${ext}`);
    }
    return candidate;
  }

  const outputAbs = outArg ? resolveWorkspacePath(workspace, outArg) : versionedOut(inputAbs);
  if (existsSync(outputAbs)) {
    console.error(`refusing to overwrite existing file: ${outputAbs}`);
    process.exit(1);
  }

  function ffmpeg(args) {
    return spawnSync('ffmpeg', args, {encoding: 'utf8'});
  }

  console.log(`-- pass 1 - measuring ${inputAbs}`);
  const measureRes = ffmpeg(['-hide_banner', '-i', inputAbs, '-af', `loudnorm=I=${TARGET_I}:print_format=json`, '-f', 'null', '-']);
  const measureText = `${measureRes.stdout ?? ''}${measureRes.stderr ?? ''}`;
  const measureJson = measureText.match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/);
  if (!measureJson) {
    console.error('master-audio: could not parse loudnorm measurement from ffmpeg output:');
    console.error(measureText);
    process.exit(1);
  }
  const measured = JSON.parse(measureJson[0]);
  console.log(`   measured  I ${measured.input_i} LUFS - TP ${measured.input_tp} dBTP - LRA ${measured.input_lra} - thresh ${measured.input_thresh}`);

  // linear=true applies ONE gain for the whole file and will not back off for a single
  // loud transient added after measuring — the limiter is the fix, not belt-and-braces.
  const af =
    `loudnorm=I=${TARGET_I}:TP=${CHAIN_TP}:LRA=${TARGET_LRA}:linear=true:` +
    `measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh},` +
    // alimiter applies makeup gain to level_out unless level=disabled — omitting it overshoots the target.
    `alimiter=limit=${LIMIT}:level=disabled:attack=5:release=50`;

  console.log(`-- pass 2 - correcting, limiting and re-encoding -> ${outputAbs}`);
  const encodeRes = ffmpeg([
    '-hide_banner', '-y', '-i', inputAbs,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-tune', 'film', '-pix_fmt', 'yuv420p',
    '-af', af,
    // loudnorm resamples to 192kHz internally; without an explicit rate the AAC
    // encoder lands on 96kHz (measured: two 96k masters on 2026-08-13) and the
    // ear-gate's sample-rate check flags the delivered file. Pin the chain's rate.
    '-ar', '48000',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    outputAbs,
  ]);
  if (encodeRes.status !== 0 || !existsSync(outputAbs)) {
    console.error(`master-audio: encode failed (exit ${encodeRes.status})`);
    console.error(encodeRes.stderr ?? '');
    process.exit(1);
  }

  console.log(`-- verify - measuring the DELIVERED file (never trust the filter graph's own report)`);
  const verifyRes = ffmpeg(['-hide_banner', '-i', outputAbs, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
  const verifyText = `${verifyRes.stdout ?? ''}${verifyRes.stderr ?? ''}`;
  const iMatch = verifyText.match(/^\s*I:\s*(-?[\d.]+) LUFS/m);
  const peakMatch = verifyText.match(/^\s*Peak:\s*(-?[\d.]+) dB(?:TP|FS)/m);
  const lraMatch = verifyText.match(/^\s*LRA:\s*(-?[\d.]+) LU/m);
  if (!iMatch || !peakMatch || !lraMatch) {
    console.error('master-audio: could not parse ebur128 verification from ffmpeg output:');
    console.error(verifyText);
    process.exit(1);
  }
  const deliveredI = Number(iMatch[1]);
  const deliveredPeak = Number(peakMatch[1]);
  const deliveredLra = Number(lraMatch[1]);
  console.log(`   I: ${deliveredI} LUFS   Peak: ${deliveredPeak} dBTP   LRA: ${deliveredLra} LU`);

  const iOk = Math.abs(deliveredI - TARGET_I) <= I_TOLERANCE;
  const peakOk = deliveredPeak <= TARGET_TP;
  if (!iOk || !peakOk) {
    console.error(
      `master-audio: FAILED verification — I must be within ${I_TOLERANCE} LUFS of ${TARGET_I} ` +
        `(got ${deliveredI}) and Peak must be <= ${TARGET_TP} dBTP (got ${deliveredPeak}).`,
    );
    process.exit(1);
  }
  console.log(`master-audio: OK -> ${outputAbs}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
