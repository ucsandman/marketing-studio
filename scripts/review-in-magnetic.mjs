#!/usr/bin/env node
// review-in-magnetic — proposes a "review reel" of a run's VIDEO assets into
// an open Magnetic editor over the agent sidecar. Imports every VIDEO asset
// (.mp4/.webm) from out/<brand>/marketing/run.json (the same inventory
// Mission Control reads), then proposes ONE batch that appends each clip to
// the spine in inventory order with a green marker at its cumulative start
// (named by the asset's run.json id — Task 6's verdict puller keys on this).
// Writes out/<brand>/marketing/magnetic-review.json so Task 6 can diff the
// user's edit against what was proposed. Nothing lands on the timeline until
// the human clicks Accept in the editor (propose_edits semantics) — this
// script only proposes.
//
// Usage: node scripts/review-in-magnetic.mjs <brand>
//
// Duration source (probed against the live out/dashclaw/marketing/run.json):
// every asset whose "artifact" is a single video file already carries a
// "duration" string (e.g. "28.39s") written by the phase-2 pilot run. That
// metadata is used directly to compute cumulative marker seconds; there is no
// ffprobe fallback. A video asset lacking a parseable duration fails loud
// naming it, rather than guessing (a wrong guess silently misplaces every
// marker after it on the reel).
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join, resolve} from 'node:path';
import {callTool} from './lib/magnetic-sidecar.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const VIDEO_EXTS = ['.mp4', '.webm'];

// --- pure/orchestration helpers (exported for scripts/review-in-magnetic.test.mjs) ---

// run.json duration strings look like "28.39s" / "10.0s". Returns null if the
// field is missing or not in that shape.
export function parseDurationSec(duration) {
  if (typeof duration !== 'string') return null;
  const m = /^([\d.]+)s$/.exec(duration.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Filters run.json's top-level assets down to VIDEO assets: those whose
// single-file "artifact" string ends in .mp4/.webm. This naturally excludes
// multi-file artifact strings (e.g. og-assets' "a.png + b.mp4 + c.gif" ends
// in .gif) and non-video assets. Returns {key, file, fileName, durationSec}
// in run.json's own assets order; throws naming any video asset missing a
// parseable duration.
export function videoAssets(run) {
  const assets = Array.isArray(run?.assets) ? run.assets : [];
  const out = [];
  for (const entry of assets) {
    if (typeof entry.artifact !== 'string') continue;
    const isVideo = VIDEO_EXTS.some((ext) => entry.artifact.toLowerCase().endsWith(ext));
    if (!isVideo) continue;
    const durationSec = parseDurationSec(entry.duration);
    if (durationSec === null) {
      throw new Error(
        `review-in-magnetic: video asset "${entry.id}" has no parseable "duration" in run.json (got ${JSON.stringify(entry.duration)})`
      );
    }
    out.push({key: entry.id, file: entry.artifact, fileName: basename(entry.artifact), durationSec});
  }
  return out;
}

// Assigns each asset its cumulative start on the assembled spine (the sum of
// every earlier asset's duration, in inventory order).
export function withCumulativeStarts(assets) {
  let atSec = 0;
  return assets.map((a) => {
    const withStart = {...a, atSec};
    atSec += a.durationSec;
    return withStart;
  });
}

// Builds the propose_edits ops: append_clip then a green add_marker (named by
// the asset's key) per asset, in order. Wire shape per
// scripts/magnetic-mcp.mjs's propose_edits schema: {name, input}.
export function buildOps(assetsWithAssetIds) {
  const ops = [];
  for (const a of assetsWithAssetIds) {
    ops.push({name: 'append_clip', input: {asset_id: a.assetId}});
    ops.push({name: 'add_marker', input: {at_sec: a.atSec, text: a.key, color: 'green'}});
  }
  return ops;
}

// Orchestrates the whole driver against a given repo root (overridable in
// tests so a fixture run.json + stub sidecar never touch the real out/ tree).
// Returns the written manifest.
export async function runDriver({root, brand}) {
  const marketingDir = join(root, 'out', brand, 'marketing');
  const runPath = join(marketingDir, 'run.json');
  let run;
  try {
    run = JSON.parse(readFileSync(runPath, 'utf8'));
  } catch (err) {
    throw new Error(`review-in-magnetic: failed to read run manifest at ${runPath}: ${err.message}`);
  }

  const assets = withCumulativeStarts(videoAssets(run));
  if (assets.length === 0) {
    throw new Error(`review-in-magnetic: no VIDEO assets (.mp4/.webm) found in ${runPath}`);
  }

  const paths = assets.map((a) => resolve(root, a.file));
  console.log(`review-in-magnetic: importing ${paths.length} video asset(s)...`);
  const imported = await callTool('import_media', {paths});
  const importedAssets = Array.isArray(imported?.assets) ? imported.assets : [];
  const byFileName = new Map(importedAssets.map((a) => [a.fileName, a.assetId]));

  const assetsWithIds = assets.map((a) => {
    const assetId = byFileName.get(a.fileName);
    if (!assetId) {
      throw new Error(`review-in-magnetic: import_media did not return an assetId for "${a.fileName}"`);
    }
    return {...a, assetId};
  });

  const ops = buildOps(assetsWithIds);
  console.log(`review-in-magnetic: proposing ${assetsWithIds.length} clip(s) + marker(s)...`);
  await callTool('propose_edits', {ops});

  const manifest = {
    proposedAt: new Date().toISOString(),
    assets: assetsWithIds.map(({key, file, fileName, assetId}) => ({key, file, fileName, assetId})),
  };
  mkdirSync(marketingDir, {recursive: true});
  const outPath = join(marketingDir, 'magnetic-review.json');
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`review-in-magnetic: wrote ${outPath}`);
  return manifest;
}

// --- CLI ---

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const brand = process.argv[2];
  if (!brand) {
    console.error('Usage: node scripts/review-in-magnetic.mjs <brand>');
    process.exit(1);
    return;
  }
  await runDriver({root, brand});
}

// Import-safe (the test file imports the pure/orchestration helpers above):
// only run when executed directly, matching build-magnetic-demo-media.mjs's
// isMain convention.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
