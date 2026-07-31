#!/usr/bin/env node
// Quality judge #1 — A/V sync (PURE DATA, no rendering).
//
// Cross-checks three sources of truth that must agree for a LaunchVideo to play
// cleanly, without ever touching a rendered frame:
//   * launchTiming.ts act budgets (imported directly via Node TS type-stripping,
//     never re-derived — PLAYBOOK: "Duration math lives in ONE pure lib")
//   * props/<brand>-audio.json VO line durations (voWindows math mirrored below;
//     VO_LEAD comes from studio/src/lib/audioMix.ts)
//   * demo telemetry step timings (caption dwell)
//
// Advisor to the Phase-4 judge: exit 0 with the verdict in the report. `--strict`
// exits 1 if any finding is a FAIL.
//
// Usage: node scripts/judge-av-sync.mjs <brand> [--strict] [--json]
// Output: out/<brand>/marketing/judge-av-sync.json
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const FPS = 30;
// Mirror of VO_LEAD in studio/src/lib/audioMix.ts: frames of music-only lead-in
// before each VO line starts. voWindows() there places every line at
// act.from + VO_LEAD, so the time a line actually has is act.len - VO_LEAD.
export const VO_LEAD = 12;
export const MIN_DWELL_MS = 700;

// VO length in frames (mirror of voWindows: ceil(durationMs/1000 * FPS)).
export function voFrameLen(durationMs) {
  return Math.ceil((durationMs / 1000) * FPS);
}

// Resolve a manifest act key to its {from,len} act, or null if unknown.
// Mirrors actFor() in audioMix.ts but returns null instead of throwing so the
// judge can report the bad reference as a finding.
export function actFor(key, timing) {
  if (key === 'logo' || key === 'hook' || key === 'demo' || key === 'end') return timing[key];
  const m = key.match(/^feature-(\d+)$/);
  if (m && timing.features[Number(m[1])]) return timing.features[Number(m[1])];
  return null;
}

// A VO line whose audio is longer than the room left in its act after the
// lead-in gets clamped (truncated) at render time — trim the copy, not the act.
export function checkVoOverruns(lines, timing) {
  const findings = [];
  for (const line of lines) {
    const act = actFor(line.act, timing);
    if (!act) continue; // reported by checkUnknownActs
    const vf = voFrameLen(line.durationMs);
    const available = act.len - VO_LEAD;
    if (vf > available) {
      const overrunFrames = vf - available;
      const overrunMs = Math.round((overrunFrames / FPS) * 1000);
      const words = line.text.trim().split(/\s+/).filter(Boolean);
      const msPerWord = line.durationMs / Math.max(1, words.length);
      const wordsToCut = Math.max(1, Math.ceil(overrunMs / msPerWord));
      findings.push({
        check: 'vo-overrun',
        level: 'FAIL',
        act: line.act,
        overrunMs,
        wordsToCut,
        voFrames: vf,
        availableFrames: available,
        message: `VO for act "${line.act}" overruns by ${overrunMs}ms — trim the copy, don't squeeze timing (cut ~${wordsToCut} words).`,
      });
    }
  }
  return findings;
}

// An act too short to even contain the lead-in cannot start its VO after
// VO_LEAD frames (voWindows would place the start past the act end).
export function checkVoLead(lines, timing) {
  const findings = [];
  for (const line of lines) {
    const act = actFor(line.act, timing);
    if (!act) continue;
    if (act.len <= VO_LEAD) {
      findings.push({
        check: 'vo-lead',
        level: 'FAIL',
        act: line.act,
        actLen: act.len,
        message: `Act "${line.act}" (${act.len}f) is shorter than the ${VO_LEAD}-frame VO lead-in; the line starts before/at its lead window.`,
      });
    }
  }
  return findings;
}

// Consecutive caption steps closer than the minimum dwell flash by too fast.
export function checkCaptionDwell(events, minDwellMs = MIN_DWELL_MS) {
  const steps = events.filter((e) => e.type === 'step').sort((a, b) => a.t - b.t);
  const findings = [];
  for (let i = 1; i < steps.length; i++) {
    const gap = steps[i].t - steps[i - 1].t;
    if (gap < minDwellMs) {
      findings.push({
        check: 'caption-dwell',
        level: 'FAIL',
        gapMs: gap,
        from: steps[i - 1].label,
        to: steps[i].label,
        message: `Caption steps only ${gap}ms apart (min ${minDwellMs}ms): "${steps[i - 1].label}" -> "${steps[i].label}".`,
      });
    }
  }
  return findings;
}

// A feature act that shows copy on screen but has no VO line reading it.
export function checkFeatureCoverage(features, lines) {
  const voActs = new Set(lines.map((l) => l.act));
  const findings = [];
  features.forEach((f, i) => {
    const hasCopy =
      (f.heading && String(f.heading).trim()) ||
      (Array.isArray(f.lines) && f.lines.some((s) => s && String(s).trim()));
    if (hasCopy && !voActs.has(`feature-${i}`)) {
      findings.push({
        check: 'feature-no-vo',
        level: 'FAIL',
        act: `feature-${i}`,
        heading: f.heading || '',
        message: `Feature act "feature-${i}" has on-screen copy ("${f.heading || ''}") but no matching VO line.`,
      });
    }
  });
  return findings;
}

// A VO line pointing at an act that does not exist in the timing throws at
// render time (audioMix.actFor); catch it here.
export function checkUnknownActs(lines, timing) {
  return lines
    .filter((l) => !actFor(l.act, timing))
    .map((l) => ({
      check: 'unknown-act',
      level: 'FAIL',
      act: l.act,
      message: `VO line references unknown act "${l.act}" (not in launchTiming).`,
    }));
}

export function runAvSync({timing, lines, features, telemetryEvents}) {
  const findings = [
    ...checkUnknownActs(lines, timing),
    ...checkVoLead(lines, timing),
    ...checkVoOverruns(lines, timing),
    ...checkFeatureCoverage(features, lines),
    ...checkCaptionDwell(telemetryEvents),
  ];
  const verdict = findings.some((f) => f.level === 'FAIL') ? 'FAIL' : 'PASS';
  return {findings, verdict};
}

async function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const brand = argv.find((a) => !a.startsWith('--'));
  if (!brand) {
    console.error('usage: node scripts/judge-av-sync.mjs <brand> [--strict] [--json]');
    process.exit(1);
  }

  const launchPath = join(root, 'props', `${brand}-launch.json`);
  const audioPath = join(root, 'props', `${brand}-audio.json`);
  const demoPath = join(root, 'props', `${brand}-demo.json`);
  if (!existsSync(launchPath)) {
    console.error(`judge-av-sync: missing ${launchPath}`);
    process.exit(1);
  }
  if (!existsSync(audioPath)) {
    console.error(`judge-av-sync: missing ${audioPath}`);
    process.exit(1);
  }
  const launch = JSON.parse(readFileSync(launchPath, 'utf8'));
  const audio = JSON.parse(readFileSync(audioPath, 'utf8'));

  const features = Array.isArray(launch.features) ? launch.features : [];
  const lines = Array.isArray(audio.lines) ? audio.lines : [];

  // Caption dwell reads canonical demo telemetry; fall back to the copy embedded
  // in launch props if the standalone demo props file is absent.
  let telemetryEvents = [];
  let telemetrySource = 'none';
  if (existsSync(demoPath)) {
    telemetryEvents = JSON.parse(readFileSync(demoPath, 'utf8'))?.telemetry?.events ?? [];
    telemetrySource = `props/${brand}-demo.json`;
  } else if (launch.demo?.telemetry?.events) {
    telemetryEvents = launch.demo.telemetry.events;
    telemetrySource = `props/${brand}-launch.json (embedded)`;
  }

  const telemetryDurationMs = launch.demo?.telemetry?.durationMs ?? null;
  const mod = await import(new URL('../studio/src/lib/launchTiming.ts', import.meta.url));
  const timing = mod.launchTiming(telemetryDurationMs, features.length, launch.actLengths ?? null);

  const {findings, verdict} = runAvSync({timing, lines, features, telemetryEvents});

  const report = {
    judge: 'av-sync',
    brand,
    generatedAt: new Date().toISOString(),
    verdict,
    inputs: {
      launch: `props/${brand}-launch.json`,
      audio: `props/${brand}-audio.json`,
      telemetry: telemetrySource,
    },
    timing: {
      logo: timing.logo,
      hook: timing.hook,
      demo: timing.demo,
      features: timing.features,
      end: timing.end,
      total: timing.total,
    },
    summary: {
      voLines: lines.length,
      features: features.length,
      captionSteps: telemetryEvents.filter((e) => e.type === 'step').length,
      findings: findings.length,
    },
    findings,
  };

  const outDir = join(root, 'out', brand, 'marketing');
  mkdirSync(outDir, {recursive: true});
  const outPath = join(outDir, 'judge-av-sync.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`judge-av-sync [${brand}]: ${verdict} (${findings.length} finding(s))`);
    for (const f of findings) console.log(`  [${f.level}] ${f.check}: ${f.message}`);
    console.log(`  report -> out/${brand}/marketing/judge-av-sync.json`);
  }

  process.exit(strict && verdict === 'FAIL' ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
