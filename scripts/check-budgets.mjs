#!/usr/bin/env node
// Byte-budget gate: scans out/<brand>/'s known asset locations (matrix/, thumbs/,
// postkit/, and the top-level statics outputs render-statics.mjs / the per-brand
// statics scripts produce) and checks each file against a hardcoded byte budget for
// its asset type. THIS IS A HARD GATE — exits non-zero if any file is OVER budget.
//
// Usage: node scripts/check-budgets.mjs <brand> [--json]
//
// Budget table (BUDGETS below): readme gif 5MB; web hero/og mp4 8MB (LaunchVideo
// matrix rows, id-prefixed `launch-`, plus og.mp4 — the picture-locked hero video
// meant to be embedded/autoplay on a web page); social mp4 50MB (SocialClip matrix
// rows, id-prefixed `social-`, and WrapClip segment rows, id-prefixed `wrap-` —
// both uploaded natively to platforms that transcode on ingest, so the budget is
// looser); webm 6MB; thumbs jpg 400KB. Files that don't
// match any of the five budgets (og.gif, og-image.png, .props json, caption/alt.txt,
// POST.md, srt/vtt, a .png thumb fallback) are not part of this contract and are
// skipped, not flagged — og.gif in particular is known-heavy by design (see
// docs/PLAYBOOK.md) and was deliberately left out of the table given to this script.
//
// Missing known-location directories/files are skipped with a log note, not an error.
import {existsSync, readdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join} from 'node:path';

export const BUDGETS = {
  'readme-gif': {label: 'readme gif', maxBytes: 5 * 1024 * 1024},
  'web-hero-og-mp4': {label: 'web hero/og mp4', maxBytes: 8 * 1024 * 1024},
  'social-mp4': {label: 'social mp4', maxBytes: 50 * 1024 * 1024},
  webm: {label: 'webm', maxBytes: 6 * 1024 * 1024},
  'thumb-jpg': {label: 'thumbs jpg', maxBytes: 400 * 1024},
};

// Which budget applies to a given file path (only the basename is inspected, so
// this works for absolute paths, relative paths, or bare filenames). Returns null
// when no budget covers the file.
export function matchBudget(filePath) {
  const base = basename(filePath).toLowerCase();
  if (base === 'readme.gif') return BUDGETS['readme-gif'];
  if (base.endsWith('.webm')) return BUDGETS.webm;
  if (/^thumb-.*\.jpe?g$/.test(base)) return BUDGETS['thumb-jpg'];
  if (base === 'og.mp4') return BUDGETS['web-hero-og-mp4'];
  if (base.endsWith('.mp4')) {
    // scripts/platforms.json ids: launch-* = LaunchVideo (web hero), social-* =
    // SocialClip. build-postkit.mjs copies matrix files into postkit/<platform>/
    // under the same name, so this rule holds in both locations. wrap-* = WrapClip
    // segment exports (out/<brand>/matrix/wrap-<segmentId>/wrap-<aspect>.mp4 and
    // their postkit copies) — uploaded natively like SocialClip, and no per-aspect
    // budget classes exist, so they reuse the social-mp4 budget.
    if (base.startsWith('launch-')) return BUDGETS['web-hero-og-mp4'];
    if (base.startsWith('social-')) return BUDGETS['social-mp4'];
    if (base.startsWith('wrap-')) return BUDGETS['social-mp4'];
  }
  return null;
}

// Pure check: given a list of file paths, return per-file PASS/OVER results for
// whichever ones match a budget (unmatched files are silently excluded).
export function checkFiles(files) {
  const results = [];
  for (const file of files) {
    const budget = matchBudget(file);
    if (!budget) continue;
    const bytes = statSync(file).size;
    results.push({
      path: file,
      bytes,
      budget: budget.label,
      maxBytes: budget.maxBytes,
      status: bytes > budget.maxBytes ? 'OVER' : 'PASS',
    });
  }
  return results;
}

// Lists files (not directories) inside dir, descending into subdirectories at any
// depth when {recursive:true} — used for postkit/<platform>/<file>, matrix segment
// dirs (matrix/wrap-<segmentId>/<file>), and postkit segment kits
// (postkit/wrap-<segmentId>/<platform>/<file>). Missing dir -> null so the caller
// can log a skip note instead of an error. Dotdirs (matrix/.props/) are ignored at
// every level.
function listFiles(dir, {recursive = false} = {}) {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir, {withFileTypes: true});
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) files.push(...(listFiles(full, {recursive}) ?? []));
      continue;
    }
    files.push(full);
  }
  return files;
}

function fmtSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function main() {
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
  });

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const brand = args.find((a) => !a.startsWith('--'));
  const jsonOut = args.includes('--json');

  if (!brand) {
    console.error('usage: node scripts/check-budgets.mjs <brand> [--json]');
    process.exit(1);
  }

  const brandOut = join(root, 'out', brand);
  const notes = [];
  const allFiles = [];

  const locations = [
    {dir: join(brandOut, 'matrix'), recursive: true, label: `out/${brand}/matrix/`},
    {dir: join(brandOut, 'thumbs'), recursive: false, label: `out/${brand}/thumbs/`},
    {dir: join(brandOut, 'postkit'), recursive: true, label: `out/${brand}/postkit/`},
  ];
  for (const loc of locations) {
    const files = listFiles(loc.dir, {recursive: loc.recursive});
    if (files === null) {
      notes.push(`skipped ${loc.label} (not found)`);
      continue;
    }
    allFiles.push(...files);
  }

  // Statics outputs land directly in out/<brand>/ (render-statics.mjs and the
  // per-brand variants); only the two with a defined budget are worth scanning.
  for (const name of ['readme.gif', 'og.mp4']) {
    const p = join(brandOut, name);
    if (existsSync(p)) allFiles.push(p);
    else notes.push(`skipped out/${brand}/${name} (not found)`);
  }

  const results = checkFiles(allFiles);
  const overCount = results.filter((r) => r.status === 'OVER').length;

  if (jsonOut) {
    console.log(JSON.stringify({brand, notes, results, checked: results.length, overCount}, null, 2));
  } else {
    for (const note of notes) console.log(`check-budgets: ${note}`);
    for (const r of results) {
      const rel = r.path.slice(root.length + 1).replace(/\\/g, '/');
      console.log(`${r.status}  ${rel}  ${fmtSize(r.bytes)} / ${fmtSize(r.maxBytes)}  (${r.budget})`);
    }
    console.log(`check-budgets: ${results.length} file(s) checked, ${overCount} over budget`);
  }

  process.exit(overCount > 0 ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
