// Emits standards-compliant sidecar captions for the launch video:
//   out/<brand>/captions/launch.srt  (SRT: sequence numbers + HH:MM:SS,mmm)
//   out/<brand>/captions/launch.vtt  (WEBVTT header + HH:MM:SS.mmm)
//
// The cue math is a plain-JS MIRROR of studio/src/lib/captionTiming.ts +
// launchTiming.ts (constants copied below) — captions ride the exact same VO
// windows as the burned-in <CaptionTrack>. Keep the two in sync.
//
// Usage:
//   node scripts/build-captions.mjs <brand>            write the .srt/.vtt files
//   node scripts/build-captions.mjs <brand> --check    parse the written files back
//                                                       and validate them (exit 1 on any fault)
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const brand = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--project');
const project = projectArg(args);
const check = args.includes('--check');

if (!brand) {
  console.error('usage: node scripts/build-captions.mjs <brand> --project <product-repo> [--check]');
  process.exit(1);
}
const workspace = resolveWorkspace(root, {brand, project});

// --- launchTiming.ts mirror (constants must match the TS source) ---
const FPS = 30;
const LOGO_LEN = 150;
const HOOK_LEN = 186;
const DEMO_FALLBACK_LEN = 240;
const DEMO_TAIL = 24;
const FEATURE_LEN = 180;
const END_LEN = 150;
const VO_LEAD = 12; // audioMix.ts

// `lengths` mirrors launchTiming's ActLengths override (read from the launch props);
// an absent override reproduces the shared constants exactly.
const buildTiming = (telemetryDurationMs, featureCount, lengths) => {
  const l = lengths ?? {};
  const demoLen = telemetryDurationMs
    ? Math.ceil((telemetryDurationMs / 1000) * FPS) + (l.demoTail ?? DEMO_TAIL)
    : DEMO_FALLBACK_LEN;
  let cursor = 0;
  const next = (len) => {
    const act = {from: cursor, len};
    cursor += len;
    return act;
  };
  const logo = next(l.logo ?? LOGO_LEN);
  const hook = next(l.hook ?? HOOK_LEN);
  const demo = next(demoLen);
  const features = Array.from({length: featureCount}, (_, i) => next(l.features?.[i] ?? FEATURE_LEN));
  const end = next(l.end ?? END_LEN);
  return {logo, hook, demo, features, end};
};

const actFor = (key, timing) => {
  if (key === 'logo' || key === 'hook' || key === 'demo' || key === 'end') return timing[key];
  const m = key.match(/^feature-(\d+)$/);
  if (m && timing.features[Number(m[1])]) return timing.features[Number(m[1])];
  throw new Error(`caption manifest references unknown act "${key}"`);
};

// captionTiming.ts captionCues() mirror
const captionCues = (lines, timing) =>
  lines.map((line) => {
    const act = actFor(line.act, timing);
    const fromFrame = act.from + VO_LEAD;
    const toFrame = Math.min(
      fromFrame + Math.ceil((line.durationMs / 1000) * FPS),
      act.from + act.len,
    );
    return {text: line.text, fromFrame, toFrame};
  });

// --- inputs ---
const audioPath = join(workspace.propsDir, `${brand}-audio.json`);
if (!existsSync(audioPath)) {
  console.error(`build-captions: missing audio props ${audioPath} — run scripts/build-${brand}-audio.mjs first`);
  process.exit(1);
}
const audio = JSON.parse(readFileSync(audioPath, 'utf8'));

// Act timing needs the launch feature count + demo telemetry length; both live in
// the generated launch props.
const launchPath = join(workspace.propsDir, `${brand}-launch.json`);
if (!existsSync(launchPath)) {
  console.error(`build-captions: missing launch props ${launchPath} — run scripts/build-launch-props.mjs first`);
  process.exit(1);
}
const launch = JSON.parse(readFileSync(launchPath, 'utf8'));
const telemetryDurationMs = launch.demo?.telemetry?.durationMs ?? null;
const featureCount = Array.isArray(launch.features) ? launch.features.length : 0;

const timing = buildTiming(telemetryDurationMs, featureCount, launch.actLengths ?? null);
const cues = captionCues(audio.lines, timing);

// --- timecode formatting ---
const pad = (n, w = 2) => String(n).padStart(w, '0');
const frameToMs = (frame) => Math.round((frame / FPS) * 1000);
const fmt = (ms, sep) => {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mmm = total % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(mmm, 3)}`;
};

const toSrt = (cs) =>
  cs
    .map(
      (c, i) =>
        `${i + 1}\n${fmt(frameToMs(c.fromFrame), ',')} --> ${fmt(frameToMs(c.toFrame), ',')}\n${c.text}`,
    )
    .join('\n\n') + '\n';

const toVtt = (cs) =>
  'WEBVTT\n\n' +
  cs
    .map(
      (c) =>
        `${fmt(frameToMs(c.fromFrame), '.')} --> ${fmt(frameToMs(c.toFrame), '.')}\n${c.text}`,
    )
    .join('\n\n') +
  '\n';

const outDir = workspace.captionsDir;
const srtPath = join(outDir, 'launch.srt');
const vttPath = join(outDir, 'launch.vtt');

// --- checker: parse the on-disk files back and validate against the source cues ---
const TC_SRT = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/;
const TC_VTT = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;
const tcMs = (m, o) =>
  Number(m[o]) * 3600000 + Number(m[o + 1]) * 60000 + Number(m[o + 2]) * 1000 + Number(m[o + 3]);

const validate = (path, kind) => {
  if (!existsSync(path)) throw new Error(`${kind}: file not found (${path}) — run without --check first`);
  const text = readFileSync(path, 'utf8');
  let body = text;
  if (kind === 'VTT') {
    if (!text.startsWith('WEBVTT')) throw new Error('VTT: missing WEBVTT header');
    body = text.replace(/^WEBVTT\s*\n\n?/, '');
  }
  const blocks = body.trim().split(/\n\n/);
  if (blocks.length !== cues.length) {
    throw new Error(`${kind}: cue count ${blocks.length} != expected ${cues.length}`);
  }
  const re = kind === 'SRT' ? TC_SRT : TC_VTT;
  let prevStart = -1;
  blocks.forEach((block, i) => {
    const lines = block.split('\n');
    let idx = 0;
    if (kind === 'SRT') {
      if (String(i + 1) !== lines[0]) throw new Error(`SRT: bad sequence number at cue ${i + 1}: "${lines[0]}"`);
      idx = 1;
    }
    const m = re.exec(lines[idx]);
    if (!m) throw new Error(`${kind}: bad timecode at cue ${i + 1}: "${lines[idx]}"`);
    const start = tcMs(m, 1);
    const end = tcMs(m, 5);
    if (!(end > start)) throw new Error(`${kind}: cue ${i + 1} end not after start`);
    if (start < prevStart) throw new Error(`${kind}: cue ${i + 1} starts before the previous cue`);
    prevStart = start;
    const body = lines.slice(idx + 1).join('\n');
    if (!body.trim()) throw new Error(`${kind}: cue ${i + 1} has no text`);
  });
  return blocks.length;
};

if (check) {
  try {
    const n1 = validate(srtPath, 'SRT');
    const n2 = validate(vttPath, 'VTT');
    console.log(`build-captions --check OK: ${n1} SRT cues, ${n2} VTT cues valid (${brand})`);
  } catch (err) {
    console.error(`build-captions --check FAILED: ${err.message}`);
    process.exit(1);
  }
} else {
  if (cues.length === 0) {
    console.error(`build-captions: ${brand}-audio.json has no lines`);
    process.exit(1);
  }
  mkdirSync(outDir, {recursive: true});
  writeFileSync(srtPath, toSrt(cues));
  writeFileSync(vttPath, toVtt(cues));
  console.log(`wrote ${srtPath} + ${vttPath} (${cues.length} cues)`);
}
