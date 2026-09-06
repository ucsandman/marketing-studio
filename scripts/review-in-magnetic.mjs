#!/usr/bin/env node
// review-in-magnetic — proposes a "review reel" of a run's VIDEO assets into
// an open Magnetic editor over the agent sidecar. Imports every VIDEO asset
// (.mp4/.webm) from the product workspace's marketing/run.json (the same inventory
// Mission Control reads), then proposes ONE batch that appends each clip to
// the spine in inventory order with a green marker at its cumulative start
// (named by the asset's run.json id — Task 6's verdict puller keys on this).
// Writes product-owned marketing/magnetic-review.json so Task 6 can diff the
// user's edit against what was proposed. Nothing lands on the timeline until
// the human clicks Accept in the editor (propose_edits semantics) — this
// script only proposes.
//
// Usage: node scripts/review-in-magnetic.mjs <brand> [--skip <key[,key]>]
//   --skip  run.json asset ids to leave out of the reel. Skipped assets are
//           still recorded in the manifest as {key, skipped: true} so the
//           verdict puller marks them unreviewed — never silently approved.
//           Curation is the human's call: the driver WARNS when two included
//           assets share an identical duration (e.g. dashclaw's launch-video
//           launch.mp4 vs audio-track launch-final.mp4 — the same 55s content
//           remixed) but never auto-skips.
//
// Duration source (probed against the product-owned run.json):
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
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

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

// Duplicate-content heuristic: two included video assets with identical
// durations (±0.05s) are probably the same content twice (a remix/supersede
// pair like launch.mp4 vs launch-final.mp4). Returns warning strings — the
// caller prints them to stderr; nothing is ever auto-skipped.
export function duplicateDurationWarnings(assets) {
  const warnings = [];
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      if (Math.abs(assets[i].durationSec - assets[j].durationSec) <= 0.05) {
        warnings.push(
          `warning: '${assets[i].key}' and '${assets[j].key}' have identical durations — possible duplicate content; consider --skip <key>`
        );
      }
    }
  }
  return warnings;
}

// Orchestrates the whole driver against a given repo root (overridable in
// tests so a fixture run.json + stub sidecar never touch real product media).
// `skip` names run.json asset ids to exclude from import/proposal; they are
// recorded in the manifest as {key, skipped: true}. Returns the written
// manifest.
export async function runDriver({root, brand, workspace, skip = []}) {
  const marketingDir = workspace.marketingDir;
  const runPath = join(marketingDir, 'run.json');
  let run;
  try {
    run = JSON.parse(readFileSync(runPath, 'utf8'));
  } catch (err) {
    throw new Error(`review-in-magnetic: failed to read run manifest at ${runPath}: ${err.message}`);
  }

  const allVideo = videoAssets(run);

  // Unknown --skip keys fail loud: a typo silently skipping nothing would let
  // the duplicate ride into the reel anyway.
  const videoKeys = new Set(allVideo.map((a) => a.key));
  for (const key of skip) {
    if (!videoKeys.has(key)) {
      throw new Error(`review-in-magnetic: --skip key "${key}" matches no VIDEO asset in ${runPath}`);
    }
  }

  const skipped = allVideo.filter((a) => skip.includes(a.key));
  const assets = withCumulativeStarts(allVideo.filter((a) => !skip.includes(a.key)));
  if (assets.length === 0) {
    throw new Error(`review-in-magnetic: no VIDEO assets (.mp4/.webm) found in ${runPath}`);
  }

  for (const w of duplicateDurationWarnings(assets)) console.error(w);

  const paths = assets.map((a) => resolveWorkspacePath(workspace, a.file));
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
    assets: [
      ...assetsWithIds.map(({key, file, fileName, assetId}) => ({key, file, fileName, assetId})),
      ...skipped.map(({key}) => ({key, skipped: true})),
    ],
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
  const argv = process.argv.slice(2);
  let brand = null;
  const skip = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip') {
      const value = argv[++i];
      if (!value) {
        console.error('review-in-magnetic: --skip requires a comma-separated list of asset keys');
        process.exit(1);
        return;
      }
      skip.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--project') {
      i += 1;
    } else if (a.startsWith('--project=')) {
      continue;
    } else if (!a.startsWith('-') && !brand) {
      brand = a;
    } else {
      console.error(`review-in-magnetic: unknown argument "${a}"`);
      process.exit(1);
      return;
    }
  }
  if (!brand) {
    console.error('Usage: node scripts/review-in-magnetic.mjs <brand> --project <product-repo> [--skip <key[,key]>]');
    process.exit(1);
    return;
  }
  const workspace = resolveWorkspace(root, {brand, project: projectArg(argv)});
  await runDriver({root, brand, workspace, skip});
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
