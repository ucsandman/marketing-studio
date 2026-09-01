#!/usr/bin/env node
// Quality judge #1 — A/V sync (PURE DATA, no rendering).
//
// Cross-checks three sources of truth that must agree for a LaunchVideo to play
// cleanly, without ever touching a rendered frame:
//   * launchTiming.ts act budgets (imported directly via Node TS type-stripping,
//     never re-derived — PLAYBOOK: "Duration math lives in ONE pure lib")
//   * props/<brand>-audio.json VO line durations (voWindows math mirrored below;
//     VO_LEAD comes from studio/src/lib/launchTiming.ts)
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
// Mirror of VO_LEAD in studio/src/lib/launchTiming.ts: frames of music-only lead-in
// before each VO line starts. voWindows() there places every line at
// act.from + VO_LEAD, so the time a line actually has is act.len - VO_LEAD.
export const VO_LEAD = 12;
export const MIN_DWELL_MS = 700;
// Mirrors of the cue-discipline constants in studio/src/lib/wordCues.ts. main()
// passes that module's real values into checkCueDiscipline; these are the defaults
// so the check stays callable (and unit-testable) without the dynamic import.
export const MAX_CUES_PER_BEAT = 2;
export const BEAT_FRAMES = 12;
export const LAG_TOLERANCE_FRAMES = 6;

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

// --- Word-locked timing checks --------------------------------------------
// Every check below returns [] when no line carries `words`, so a manifest written
// before Phase B produces a byte-identical report.

// `words` present but not reconstructing `text` -> the cue table is aligned to the
// wrong sentence and every reveal in the act is wrong.
export function checkWordText(lines) {
  const findings = [];
  for (const line of lines) {
    if (!Array.isArray(line.words) || line.words.length === 0) continue;
    const rebuilt = line.words.map((w) => w.w).join(' ');
    const expected = String(line.text ?? '').trim().replace(/\s+/g, ' ');
    if (rebuilt !== expected) {
      findings.push({
        check: 'word-text-mismatch',
        level: 'FAIL',
        act: line.act,
        message: `Word table for act "${line.act}" does not reconstruct its text; every cue in the act points at the wrong word.`,
      });
    }
  }
  return findings;
}

// The last word's measured END must fit inside the act after the lead-in. Stronger
// than checkVoOverruns, which measures the FILE (trailing silence inflates it).
export function checkWordFit(lines, timing, fps = FPS) {
  const findings = [];
  for (const line of lines) {
    if (!Array.isArray(line.words) || line.words.length === 0) continue;
    const act = actFor(line.act, timing);
    if (!act) continue; // reported by checkUnknownActs
    const lastEndMs = line.words[line.words.length - 1].endMs;
    const endFrame = Math.ceil((lastEndMs / 1000) * fps);
    const available = act.len - VO_LEAD;
    if (endFrame > available) {
      const overrunMs = Math.round(((endFrame - available) / fps) * 1000);
      findings.push({
        check: 'word-overrun',
        level: 'FAIL',
        act: line.act,
        overrunMs,
        spokenFrames: endFrame,
        availableFrames: available,
        message: `Spoken words in act "${line.act}" run ${overrunMs}ms past the act (measured to the last word, not the file end).`,
      });
    }
  }
  return findings;
}

// Even-distribution times: sync is approximate, the operator must know.
export function checkEstimatedWords(lines) {
  return lines
    .filter((l) => l.wordsEstimated)
    .map((l) => ({
      check: 'estimated-word-times',
      level: 'WARN',
      act: l.act,
      message: `Act "${l.act}" uses even-distribution word times (wordsEstimated), not the TTS alignment; sync is approximate — do not ship a hero film on these.`,
    }));
}

/**
 * Cue discipline. `cues` is [{act, frames: (number|null)[], wordFrames: number[], actLen}]
 * built by the caller from alignWordCues/alignPhraseCues.
 *
 * cue-lag compares each cue to its NEAREST word frame (absolute distance): a cue
 * derived by the align helpers sits `lead` frames BEFORE its word, so the nearest
 * frame is always the word it was cut from, and a hand-authored late cue reads as a
 * positive lag.
 */
export function checkCueDiscipline(cues, opts = {}) {
  const maxPerBeat = opts.maxPerBeat ?? MAX_CUES_PER_BEAT;
  const beatFrames = opts.beatFrames ?? BEAT_FRAMES;
  const lagTolerance = opts.lagTolerance ?? LAG_TOLERANCE_FRAMES;
  const findings = [];
  for (const cue of cues) {
    const frames = cue.frames ?? [];
    const unmatched = frames.filter((f) => f === null || f === undefined).length;
    if (unmatched > 0) {
      findings.push({
        check: 'cue-unmatched',
        level: 'WARN',
        act: cue.act,
        unmatched,
        message: `${unmatched} on-screen unit(s) in act "${cue.act}" have no matching VO word; they keep the stagger cascade.`,
      });
    }
    const hits = frames.filter((f) => typeof f === 'number').sort((a, b) => a - b);
    for (let i = 0; i < hits.length; i++) {
      let inBeat = 0;
      for (let j = i; j < hits.length && hits[j] - hits[i] < beatFrames; j++) inBeat++;
      if (inBeat > maxPerBeat) {
        findings.push({
          check: 'cue-density',
          level: 'FAIL',
          act: cue.act,
          frame: hits[i],
          cuesInBeat: inBeat,
          message: `${inBeat} cues inside ${beatFrames} frames from ${hits[i]} in act "${cue.act}" (max ${maxPerBeat} per beat).`,
        });
        break;
      }
    }
    if (hits.length > 0 && cue.actLen) {
      const early = hits.filter((f) => f < cue.actLen / 2).length;
      if (early > hits.length / 2) {
        findings.push({
          check: 'cue-front-loaded',
          level: 'WARN',
          act: cue.act,
          early,
          total: hits.length,
          message: `${early}/${hits.length} cues in act "${cue.act}" land in the first half; weight reveals to the back half.`,
        });
      }
    }
    const wordFrames = cue.wordFrames ?? [];
    if (wordFrames.length > 0) {
      for (const f of hits) {
        const nearest = wordFrames.reduce(
          (best, w) => (Math.abs(f - w) < Math.abs(f - best) ? w : best),
          wordFrames[0],
        );
        const lag = f - nearest;
        if (lag > lagTolerance) {
          findings.push({
            check: 'cue-lag',
            level: 'FAIL',
            act: cue.act,
            frame: f,
            lagFrames: lag,
            message: `Cue at frame ${f} in act "${cue.act}" trails its word by ${lag} frames (max ${lagTolerance}); past ~200ms it reads as lag.`,
          });
        }
      }
    }
  }
  return findings;
}

// Known limitation (Phase B): sfxCues derives its per-feature tick frames from the
// STAGGER formula. Once a feature act is word-cued the reveals move and the ticks
// stay put. The fix is threading the cue arrays into SoundTrack; until then, warn.
export function checkSfxTickDrift(sfxEnabled, cues) {
  if (!sfxEnabled) return [];
  const acts = cues.filter((c) => c.act.startsWith('feature-')).map((c) => c.act);
  if (acts.length === 0) return [];
  return [
    {
      check: 'sfx-tick-drift',
      level: 'WARN',
      acts,
      message: `Word-cued feature act(s) ${acts.join(', ')} still get stagger-derived sfx tick frames; the ticks no longer land on the reveals.`,
    },
  ];
}

// Report only — no FAIL/WARN, no absolute threshold (judge-drift's rule: don't
// invent a constant nobody has calibrated). Frame/seconds at which the first
// claim-carrying copy (the hook act) can land on screen, driven entirely by the
// logo act length launchTiming resolved, plus how many acts it resolved in
// total. Override: actLengths.logo (LaunchVideo schema; unset by every brand
// today, so this always reports the LOGO_LEN default until one sets it).
export function checkHookOnset(timing, fps = FPS) {
  const frame = timing.logo.len;
  const seconds = Math.round((frame / fps) * 10) / 10;
  const actsResolved = 4 + timing.features.length; // logo, hook, demo, end + features
  return {
    frame,
    seconds,
    actsResolved,
    message: `hook copy on screen at frame ${frame} (${seconds.toFixed(1)}s); ${actsResolved} acts resolved.`,
  };
}

export function runAvSync({
  timing,
  lines,
  features,
  telemetryEvents,
  wordCues = [],
  sfxEnabled = false,
  cueOpts,
}) {
  const findings = [
    ...checkUnknownActs(lines, timing),
    ...checkVoLead(lines, timing),
    ...checkVoOverruns(lines, timing),
    ...checkFeatureCoverage(features, lines),
    ...checkCaptionDwell(telemetryEvents),
    ...checkWordText(lines),
    ...checkWordFit(lines, timing),
    ...checkEstimatedWords(lines),
    ...checkCueDiscipline(wordCues, cueOpts),
    ...checkSfxTickDrift(sfxEnabled, wordCues),
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
  const wc = await import(new URL('../studio/src/lib/wordCues.ts', import.meta.url));
  // Same four arguments the renderer builds (Root.tsx calculateMetadata +
  // LaunchVideo): with word timings present the acts are VO-driven, so the judge
  // must measure against the picture that will actually render.
  const timing = mod.launchTiming(
    telemetryDurationMs,
    features.length,
    launch.actLengths ?? null,
    mod.voTimingFrom(lines, features.length, {force: launch.voTiming ?? null}),
  );

  // Cue tables the renderer will build for the word-locked reveals.
  const wordCues = [];
  const hookLine = lines.find((l) => l.act === 'hook');
  if (hookLine?.words && launch.headline) {
    wordCues.push({
      act: 'hook',
      frames: wc.alignWordCues(String(launch.headline).split(' '), hookLine, FPS),
      wordFrames: wc.wordCueFrames(hookLine, FPS),
      actLen: timing.hook.len,
    });
  }
  features.forEach((f, i) => {
    const line = lines.find((l) => l.act === `feature-${i}`);
    if (line?.words && Array.isArray(f.lines)) {
      wordCues.push({
        act: `feature-${i}`,
        frames: wc.alignPhraseCues(f.lines, line, FPS),
        wordFrames: wc.wordCueFrames(line, FPS),
        actLen: timing.features[i].len,
      });
    }
  });

  const hookOnset = checkHookOnset(timing);

  const {findings, verdict} = runAvSync({
    timing,
    lines,
    features,
    telemetryEvents,
    wordCues,
    sfxEnabled: Boolean(audio.sfx?.enabled),
    cueOpts: {
      maxPerBeat: wc.MAX_CUES_PER_BEAT,
      beatFrames: wc.BEAT_FRAMES,
      lagTolerance: wc.LAG_TOLERANCE_FRAMES,
    },
  });

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
    hookOnset,
    summary: {
      voLines: lines.length,
      wordLines: lines.filter((l) => l.words).length,
      estimatedWordLines: lines.filter((l) => l.wordsEstimated).length,
      cuedActs: wordCues.length,
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
    console.log(`  ${hookOnset.message}`);
    console.log(`  report -> out/${brand}/marketing/judge-av-sync.json`);
  }

  process.exit(strict && verdict === 'FAIL' ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
