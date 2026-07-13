#!/usr/bin/env node
// pull-magnetic-verdicts — reconciles a Magnetic review reel back into
// review.json.
//
// Reads out/<brand>/marketing/magnetic-review.json (the manifest
// scripts/review-in-magnetic.mjs wrote: which assets were imported and
// proposed, keyed by run.json's own asset id), read_timeline's the live
// Magnetic sequence over the agent sidecar, and diffs [file=<name>]
// provenance tags (final-cut-pro's buildCopilotContext — src/renderer/
// copilot/context.ts:65 spine, ~193 connected clips — every clip line
// carries one) against the manifest to decide each asset's verdict:
//
//   - manifest asset (imported) whose fileName survives on the timeline,
//     even trimmed, → approved (presence is the test, not duration)
//   - manifest asset (imported) whose fileName is absent from the timeline
//     → rejected (the human deleted it)
//   - skipped, or import failed (no assetId) → unreviewed — never silently
//     approved
//   - clips the user added themselves (fileNames not in the manifest) are
//     not in this map at all — ignored, not ours to verdict
//
// Verdicts are appended into out/<brand>/marketing/review.json in exactly
// the shape and atomic-write convention scripts/mission-control.mjs's
// Approve/Redo writer uses (probed: reviewPath at mission-control.mjs:54,
// the read-modify-write array + JSON.stringify(_, null, 2) + '\n' shape and
// atomicWrite temp-file+rename pattern at ~65-72 and ~319-337). Each entry
// is {assetId, action, note, at} — same four fields mission-control writes
// for a redo, with action carrying the verdict string itself instead of
// 'redo' — a new source appending to the same correction log, not a new
// format.
//
// Usage: node scripts/pull-magnetic-verdicts.mjs <brand>
import {readFileSync, writeFileSync, renameSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join, resolve} from 'node:path';
import {callTool} from './lib/magnetic-sidecar.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// --- pure mapping (exported for scripts/pull-magnetic-verdicts.test.mjs) ---

// Every [file=<name>] tag read_timeline's text carries, spine and connected
// clips alike.
function fileNamesOnTimeline(timelineText) {
  const names = new Set();
  const re = /\[file=([^\]]+)\]/g;
  let m;
  while ((m = re.exec(timelineText)) !== null) names.add(m[1]);
  return names;
}

// manifest: {proposedAt, assets: [{key,file,fileName,assetId} | {key,skipped:true}]}
// (a non-skipped entry missing assetId counts as an import failure).
// timelineText: read_timeline's .text field (not the {ok,text} wrapper).
// Returns {[key]: 'approved'|'rejected'|'unreviewed'}, one entry per manifest
// asset in manifest order. Never destructure fileName blindly — skipped
// entries don't carry one.
export function mapVerdicts(manifest, timelineText) {
  const onTimeline = fileNamesOnTimeline(timelineText);
  const verdicts = {};
  for (const asset of manifest?.assets ?? []) {
    if (asset.skipped === true || !asset.assetId) {
      verdicts[asset.key] = 'unreviewed';
    } else if (onTimeline.has(asset.fileName)) {
      verdicts[asset.key] = 'approved';
    } else {
      verdicts[asset.key] = 'rejected';
    }
  }
  return verdicts;
}

// --- review.json writer (mirrors mission-control.mjs's atomicWrite and the
// read-modify-write-array pattern its redo branch uses, verbatim) ---

function atomicWrite(target, data) {
  const tmp = join(
    dirname(target),
    `.${basename(target)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  writeFileSync(tmp, data);
  renameSync(tmp, target); // rename over target is atomic; a concurrent reader sees old-or-new, never partial
}

function mergeVerdicts(reviewPath, verdicts) {
  let review = [];
  if (existsSync(reviewPath)) {
    try {
      const parsed = JSON.parse(readFileSync(reviewPath, 'utf8'));
      if (Array.isArray(parsed)) review = parsed;
    } catch {
      review = [];
    }
  }
  const at = new Date().toISOString();
  for (const [assetId, action] of Object.entries(verdicts)) {
    review.push({assetId, action, note: '', at});
  }
  atomicWrite(reviewPath, JSON.stringify(review, null, 2) + '\n');
}

// --- per-asset summary table --------------------------------------------

function printSummary(manifest, verdicts) {
  const rows = (manifest?.assets ?? []).map((a) => ({
    key: a.key,
    fileName: a.fileName ?? '(skipped)',
    verdict: verdicts[a.key] ?? 'unreviewed',
  }));
  const cols = ['key', 'fileName', 'verdict'];
  const header = {key: 'KEY', fileName: 'FILE', verdict: 'VERDICT'};
  const widths = Object.fromEntries(
    cols.map((c) => [c, Math.max(header[c].length, ...rows.map((r) => String(r[c]).length))]),
  );
  const line = (r) => cols.map((c) => String(r[c]).padEnd(widths[c])).join('  ');
  console.log(line(header));
  for (const r of rows) console.log(line(r));
}

// --- orchestration (exported for scripts/pull-magnetic-verdicts.test.mjs) ---

export async function runPull({root, brand}) {
  const marketingDir = join(root, 'out', brand, 'marketing');
  const manifestPath = join(marketingDir, 'magnetic-review.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `pull-magnetic-verdicts: failed to read manifest at ${manifestPath} — run review-in-magnetic first (${err.message})`,
    );
  }

  const {text} = await callTool('read_timeline');
  const verdicts = mapVerdicts(manifest, text);

  const reviewPath = join(marketingDir, 'review.json');
  mergeVerdicts(reviewPath, verdicts);

  printSummary(manifest, verdicts);
  return verdicts;
}

// --- CLI ---

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const argv = process.argv.slice(2);
  const brand = argv.find((a) => !a.startsWith('-'));
  if (!brand) {
    console.error('Usage: node scripts/pull-magnetic-verdicts.mjs <brand>');
    process.exit(1);
    return;
  }
  await runPull({root, brand});
}

// Import-safe (the test file imports mapVerdicts/runPull): only run when
// executed directly, matching review-in-magnetic.mjs's isMain convention.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
