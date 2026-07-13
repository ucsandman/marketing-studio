#!/usr/bin/env node
// Handoff ingest builder: turns a Marketing Handoff (segments.json + SRT + video,
// scripts/lib/wrap-contract.mjs) into per-segment WrapClip props
// (studio/src/templates/WrapClip.tsx / wrapClipSchema).
//
// Usage: node scripts/build-wrap-props.mjs <brand> <handoffDir>
//   1. reads + validates <handoffDir>/segments.json, reads the SRT it names
//   2. stages the handoff's video to studio/public/<brand>/wrap-<basename(handoffDir)>.mp4
//   3. reads out/<brand>/marketing/brief.json for cta (fail loudly if missing —
//      copy is always brief-sourced, never invented here)
//   4. emits props/<brand>-wrap-<segmentId>.json per segment
//   5. spawns scripts/lint-copy.mjs on every emitted file; exits 1 on any violation
import {readFileSync, copyFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join, resolve} from 'node:path';
import {validateManifest, parseSrt, windowCues} from './lib/wrap-contract.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- pure helpers (exported for scripts/build-wrap-props.test.mjs) ---

// Staged video filename under studio/public/<brand>/ — derived from the handoff
// dir's own basename, so re-running against the same handoff overwrites in place.
export function stagedVideoName(handoffDir) {
  return `wrap-${basename(handoffDir)}.mp4`;
}

// Pure WrapClip props for one segment. Captions arrive windowed + re-based to the
// segment's own origin (0 == segment start) — WrapClip.tsx adds the title-card
// frame offset itself, so this must never shift them again.
export function propsForSegment(manifest, cues, segment, brandId, videoRel, cta) {
  if (!manifest.segments.some((s) => s.id === segment.id)) {
    throw new Error(`propsForSegment: segment "${segment.id}" not found in manifest.segments`);
  }
  return {
    brandId,
    video: videoRel,
    segment: {startSec: segment.startSec, endSec: segment.endSec, title: segment.title},
    captions: windowCues(cues, segment.startSec, segment.endSec),
    cta,
    music: null,
  };
}

// --- CLI ---

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`build-wrap-props: failed to read ${label} at ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`build-wrap-props: failed to parse ${label} at ${path}: ${err.message}`);
  }
}

function main() {
  const [brand, handoffDir] = process.argv.slice(2);
  if (!brand || !handoffDir) {
    console.error('Usage: node scripts/build-wrap-props.mjs <brand> <handoffDir>');
    process.exit(1);
  }

  const manifest = validateManifest(readJson(join(handoffDir, 'segments.json'), 'segments.json'));

  const srtPath = join(handoffDir, manifest.captions);
  let srtText;
  try {
    srtText = readFileSync(srtPath, 'utf8');
  } catch (err) {
    throw new Error(`build-wrap-props: failed to read captions SRT at ${srtPath}: ${err.message}`);
  }
  const cues = parseSrt(srtText);

  const videoSrc = join(handoffDir, manifest.video);
  if (!existsSync(videoSrc)) {
    throw new Error(`build-wrap-props: manifest.video "${manifest.video}" not found at ${videoSrc}`);
  }
  const stagedName = stagedVideoName(handoffDir);
  const publicDir = join(root, 'studio', 'public', brand);
  mkdirSync(publicDir, {recursive: true});
  const stagedDest = join(publicDir, stagedName);
  copyFileSync(videoSrc, stagedDest);
  console.log(`staged video -> ${stagedDest}`);
  const videoRel = `${brand}/${stagedName}`;

  const briefPath = join(root, 'out', brand, 'marketing', 'brief.json');
  if (!existsSync(briefPath)) {
    throw new Error(`build-wrap-props: brief.json missing at ${briefPath} — copy must be brief-sourced, refusing to invent a cta`);
  }
  const brief = readJson(briefPath, 'brief.json');
  if (typeof brief.cta !== 'string' || brief.cta.length === 0) {
    throw new Error(`build-wrap-props: brief.json at ${briefPath} has no cta`);
  }
  const cta = brief.cta;

  const propsDir = join(root, 'props');
  mkdirSync(propsDir, {recursive: true});

  const emitted = [];
  for (const segment of manifest.segments) {
    const props = propsForSegment(manifest, cues, segment, brand, videoRel, cta);
    const outPath = join(propsDir, `${brand}-wrap-${segment.id}.json`);
    writeFileSync(outPath, JSON.stringify(props, null, 2) + '\n');
    emitted.push(outPath);
    console.log(`wrote ${outPath}`);
  }

  let lintFailed = false;
  for (const file of emitted) {
    const res = spawnSync('node', ['scripts/lint-copy.mjs', file], {cwd: root, stdio: 'inherit'});
    if (res.status !== 0) lintFailed = true;
  }
  if (lintFailed) {
    throw new Error('build-wrap-props: lint-copy found violations in one or more emitted props files');
  }

  console.log(`build-wrap-props OK: emitted ${emitted.length} props file(s)`);
}

// Import-safe (the test file imports the pure helpers above): only run when
// executed directly, matching build-magnetic-demo-media.mjs's isMain convention.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
