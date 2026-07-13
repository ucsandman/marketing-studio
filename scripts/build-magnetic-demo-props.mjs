#!/usr/bin/env node
// Source of truth for props/magnetic-demo.json (ProductDemo composition,
// studio/src/templates/ProductDemo.tsx / productDemoSchema).
//
// Reads studio/public/magnetic/telemetry.json (Task 7's recorded demo: 8 step,
// 13 click, 6 focus events, durationMs 31985) and out/magnetic/marketing/brief.json
// (the approved Content Brief) and emits ProductDemo's props.
//
// Repo rule: captions never come from telemetry step labels. Task 7's raw labels
// read as beat descriptions written for the recording script and use em dashes
// (e.g. "Blade a clip, delete it — the gap closes itself."), which fails
// lint-copy.mjs. Every telemetry `step` event's label is REPLACED below with
// brief-approved copy; click/focus events (drive the cursor + camera) pass
// through untouched. Caption source per step, in telemetry t order, chosen by
// what is actually on screen at that beat:
//   1 (t=501)   features.timeline.heading         establishing shot, editor intro
//   2 (t=5015)  features.timeline.benefitLines[0]  clips snapping onto the spine
//   3 (t=13035) features.timeline.benefitLines[1]  ripple delete closing the gap
//   4 (t=17167) features.timeline.benefitLines[2]  Windows-native editing grammar
//   5 (t=20792) features.rough-cut.benefitLines[0]  VO drop, silence/filler pass
//   6 (t=23428) features.rough-cut.benefitLines[1]  ghost diff, red cut / green result
//   7 (t=26030) features.rough-cut.benefitLines[2]  Accept, one undo step
//   8 (t=28467) features.smart-render.heading       export
// long-form, transcript and agent-access aren't demonstrated by this recording
// (no visual beat for streamed memory, transcript editing, or the MCP agent), so
// they don't get a caption here; LaunchVideo carries the full feature set.
//
// Fail loudly, deterministic output (no timestamps, no randomness).
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const telemetryPath = join(root, 'studio', 'public', 'magnetic', 'telemetry.json');
const briefPath = join(root, 'out', 'magnetic', 'marketing', 'brief.json');

const telemetry = readJson(telemetryPath, 'telemetry');
const brief = readJson(briefPath, 'brief');

validateTelemetry(telemetry);
validateBrief(brief);

const feature = (key) => {
  const f = brief.features.find((x) => x.key === key);
  if (!f) throw new Error(`build-magnetic-demo-props: brief.features has no entry with key "${key}"`);
  return f;
};

// Ordered caption sources, one per telemetry step event (see header comment).
const CAPTION_SOURCES = [
  () => feature('timeline').heading,
  () => feature('timeline').benefitLines[0],
  () => feature('timeline').benefitLines[1],
  () => feature('timeline').benefitLines[2],
  () => feature('rough-cut').benefitLines[0],
  () => feature('rough-cut').benefitLines[1],
  () => feature('rough-cut').benefitLines[2],
  () => feature('smart-render').heading,
];

let stepIndex = 0;
const events = telemetry.events.map((e) => {
  if (e.type !== 'step') return e;
  const source = CAPTION_SOURCES[stepIndex];
  if (!source) {
    throw new Error(
      `build-magnetic-demo-props: telemetry has more step events (${stepIndex + 1}) than mapped captions (${CAPTION_SOURCES.length})`,
    );
  }
  const label = source();
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error(`build-magnetic-demo-props: caption source for step ${stepIndex} is empty`);
  }
  stepIndex++;
  return {...e, label};
});
if (stepIndex !== CAPTION_SOURCES.length) {
  throw new Error(
    `build-magnetic-demo-props: telemetry has ${stepIndex} step events, expected ${CAPTION_SOURCES.length}`,
  );
}

const props = {
  brandId: 'magnetic',
  video: 'magnetic/demo.webm',
  cta: brief.cta,
  telemetry: {...telemetry, events},
};

writeFileSync(join(root, 'props', 'magnetic-demo.json'), JSON.stringify(props, null, 2) + '\n');
console.log('wrote props/magnetic-demo.json');

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`build-magnetic-demo-props: failed to read ${label} at ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`build-magnetic-demo-props: failed to parse ${label} at ${path}: ${err.message}`);
  }
}

function validateTelemetry(t) {
  if (!t || typeof t !== 'object') throw new Error('build-magnetic-demo-props: telemetry.json is not an object');
  if (!t.viewport || typeof t.viewport.width !== 'number' || typeof t.viewport.height !== 'number') {
    throw new Error('build-magnetic-demo-props: telemetry.viewport missing width/height');
  }
  if (typeof t.durationMs !== 'number' || t.durationMs <= 0) {
    throw new Error('build-magnetic-demo-props: telemetry.durationMs missing/invalid');
  }
  if (!Array.isArray(t.events) || t.events.length === 0) {
    throw new Error('build-magnetic-demo-props: telemetry.events missing/empty');
  }
}

function validateBrief(b) {
  if (!b || typeof b !== 'object' || typeof b.brandId !== 'string') {
    throw new Error('build-magnetic-demo-props: brief.json is not brief-shaped (missing brandId)');
  }
  if (b.brandId !== 'magnetic') {
    throw new Error(`build-magnetic-demo-props: brief.brandId is "${b.brandId}", expected "magnetic"`);
  }
  if (!Array.isArray(b.features) || b.features.length === 0) {
    throw new Error('build-magnetic-demo-props: brief.features missing/empty');
  }
  for (const [i, f] of b.features.entries()) {
    if (!f || typeof f.key !== 'string' || typeof f.heading !== 'string' || f.heading.length === 0) {
      throw new Error(`build-magnetic-demo-props: brief.features[${i}] missing key/heading`);
    }
    if (!Array.isArray(f.benefitLines) || f.benefitLines.length < 3) {
      throw new Error(`build-magnetic-demo-props: brief.features[${i}].benefitLines needs >= 3 entries`);
    }
  }
  if (typeof b.cta !== 'string' || b.cta.length === 0) {
    throw new Error('build-magnetic-demo-props: brief.cta missing');
  }
}
