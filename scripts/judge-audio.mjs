#!/usr/bin/env node
// Quality judge #2 — the ear-gate. Sibling of judge-av-sync.mjs, but where that
// judge reads PLAN (JSON cross-checked against JSON, never touching a rendered
// frame), this one reads OUTPUT: it transcribes the FINAL rendered deliverable and
// diffs what was actually said against props/<brand>-audio.json, the manifest that
// claims what should have been said. It also emits a picture (waveform +
// spectrogram, act boundaries and VO windows drawn on top) so an agent with no ears
// can still see the audio.
//
// Advisory: exit 0 with the verdict in the report, matching judge-av-sync's exact
// contract. `--strict` exits 1 if any finding is FAIL. Exit 2 (whisper/model
// unavailable) takes precedence over everything — see docs/superpowers/specs/
// 2026-08-12-judge-audio-design.md "Error handling".
//
// Usage: node scripts/judge-audio.mjs <brand> [--asset launch-final] [--strict] [--json]
// Output: out/<brand>/marketing/judge-audio.json, out/<brand>/marketing/judge-audio.png
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {TARGET_I, CHAIN_TP, TARGET_LRA} from './master-audio.mjs';
import {FADE_IN, FADE_OUT} from '../studio/src/lib/audioMix.ts';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FPS = 30;

// --- Explicit thresholds (revisable once more assets are measured, per the spec) --
export const SILENCE_NOISE_DB = -35; // level scripts/build-magnetic-demo-media.mjs already uses
export const SILENCE_MIN_D = 0.3; // shortest silence ffmpeg's silencedetect will report
export const EDGE_SILENCE_TOLERANCE_S = 0.5; // slack added on top of the fade duration
// audioMix.ts fades every track in/out over FADE_IN/FADE_OUT frames, so a correctly
// built asset ends with a quiet tail BY DESIGN — the FAIL bar must track the fade,
// not a flat guess (a flat 1.0s bar failed costclaw's own 1.26s trailing fade, which
// is the fade, not a defect). Derived, never hardcoded: retuning a fade in audioMix.ts
// moves this gate with it, matching the one-source-of-truth rule already applied to
// the loudness targets.
export const LEADING_SILENCE_FAIL_S = FADE_IN / FPS + EDGE_SILENCE_TOLERANCE_S;
export const TRAILING_SILENCE_FAIL_S = FADE_OUT / FPS + EDGE_SILENCE_TOLERANCE_S;
export const INTERIOR_GAP_WARN_S = 8.0; // interior speechless stretch over this -> WARN
// Heard-word gap that separates one VO line's segment from the next. Measured on the
// costclaw baseline: largest INTRA-line gap 0.72s (mid-sentence breath), smallest
// INTER-line (act-transition) gap 1.42s — 1.0s sits cleanly between the two.
export const SEGMENT_GAP_MS = 1000;
export const CONTENT_SIMILARITY_THRESHOLD = 0.7;
export const TIMING_TOLERANCE_S = 0.35;
export const ACT_WINDOW_SLACK_S = 0.5; // VO_LEAD (0.4s) plus rendering slop
export const MIN_GAP_FOR_DUCK_S = 0.3; // shortest neighboring gap usable as a music-only reference
export const MIN_DUCK_DB = 0.5; // wide tolerance: master-audio's loudnorm compresses dynamics
export const LUFS_WARN_TOLERANCE = 1.0;
export const LUFS_FAIL_TOLERANCE = 3.0;
export const LRA_WARN_TOLERANCE = 4.0;
export const EXPECTED_SAMPLE_RATE = 48000;

// ---------------------------------------------------------------------------
// Normalization + similarity — LOAD-BEARING, not polish. Measured deltas on a
// known-good asset (manifest vs whisper): "n p x costclaw audit" heard as "NPX Cost
// Claw audit"; "CostClaw." heard as "Cost Claw,"; "Each priced, with evidence." heard
// as "each priced with evidence". An exact string diff false-positives on every one.
// ---------------------------------------------------------------------------

// Insert a space at a lower->upper case boundary BEFORE lowercasing, so "CostClaw"
// and "Cost Claw" both normalize to the same two tokens.
const splitCamel = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

// lowercase, split camelCase, strip punctuation, collapse whitespace, then join runs
// of single-character tokens ("n p x" -> "npx") — everything but camelCase-merge
// (handled by squash() in similarity()) that the spec's normalization calls for.
export function normalizeTokens(text) {
  const cleaned = splitCamel(String(text ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];
  const raw = cleaned.split(' ');
  const tokens = [];
  let run = '';
  for (const t of raw) {
    if (t.length === 1) {
      run += t;
    } else {
      if (run) { tokens.push(run); run = ''; }
      tokens.push(t);
    }
  }
  if (run) tokens.push(run);
  return tokens;
}

// Concatenates tokens with no separator. Comparing squashed strings (rather than the
// token arrays directly) makes word-segmentation differences invisible: "costclaw"
// (one manifest token) and "cost"+"claw" (two heard tokens, whisper's proper-noun
// capitalization) squash to the identical string, so they compare equal.
export function squash(tokens) {
  return tokens.join('');
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

// Token similarity via edit distance over the squashed strings, in [0,1]. 1 means
// identical content once segmentation/casing/punctuation differences are removed.
export function similarity(tokensA, tokensB) {
  const a = squash(tokensA);
  const b = squash(tokensB);
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length, 1);
}

// ---------------------------------------------------------------------------
// ffmpeg/ffprobe output parsers — pure, tested against captured REAL stderr/stdout.
// ---------------------------------------------------------------------------

// ffprobe -show_entries format=duration -show_entries
// stream=index,codec_type,codec_name,sample_rate,duration -of json <file>
export function parseFfprobeStreams(parsed) {
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const videoDurationS = Number(parsed?.format?.duration ?? video?.duration ?? NaN);
  return {
    hasAudio: Boolean(audio),
    videoDurationS,
    audioDurationS: audio ? Number(audio.duration) : null,
    sampleRate: audio ? Number(audio.sample_rate) : null,
  };
}

// ffmpeg -i <file> -af ebur128=peak=true:framelog=quiet -f null - (stderr Summary block)
export function parseEbur128(text) {
  const iMatch = text.match(/^\s*I:\s*(-?[\d.]+) LUFS/m);
  const lraMatch = text.match(/^\s*LRA:\s*(-?[\d.]+) LU/m);
  const peakMatch = text.match(/^\s*Peak:\s*(-?[\d.]+) dB(?:TP|FS)/m);
  if (!iMatch || !lraMatch || !peakMatch) return null;
  return {integratedLufs: Number(iMatch[1]), lra: Number(lraMatch[1]), truePeakDb: Number(peakMatch[1])};
}

// ffmpeg -i <file> -af silencedetect=noise=<n>dB:d=<d> -f null - (stderr lines)
export function parseSilenceEvents(text) {
  const starts = [...text.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...text.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)].map((m) => ({
    endS: Number(m[1]),
    durationS: Number(m[2]),
  }));
  const events = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    events.push({startS: starts[i], endS: ends[i].endS, durationS: ends[i].durationS});
  }
  return events;
}

// ffmpeg -i <file> -ss <a> -to <b> -af volumedetect -f null - (stderr lines)
export function parseVolumeDetect(text) {
  const meanMatch = text.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  const maxMatch = text.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
  if (!meanMatch) return null;
  return {meanDb: Number(meanMatch[1]), maxDb: maxMatch ? Number(maxMatch[1]) : null};
}

// ---------------------------------------------------------------------------
// Word-stream segmentation + line matching
// ---------------------------------------------------------------------------

// Heard words (seconds, from transcribe.py) -> contiguous segments split wherever
// the gap to the next word exceeds gapMs. On a correctly rendered launch video this
// lines up with VO-line boundaries (see SEGMENT_GAP_MS).
export function groupWordsByGap(words, gapMs = SEGMENT_GAP_MS) {
  const groups = [];
  let cur = [];
  for (const w of words) {
    const startMs = w.start * 1000;
    if (cur.length && startMs - cur[cur.length - 1].endMs > gapMs) {
      groups.push(cur);
      cur = [];
    }
    cur.push({w: w.w, startMs, endMs: w.end * 1000});
  }
  if (cur.length) groups.push(cur);
  return groups.map((g) => ({
    startMs: g[0].startMs,
    endMs: g[g.length - 1].endMs,
    tokens: g.flatMap((w) => normalizeTokens(w.w)),
    text: g.map((w) => w.w).join(' '),
  }));
}

// Greedy best-content-match bipartite assignment of manifest lines to heard
// segments, unconstrained by position — so a reordered-but-correct transcript is
// still FOUND (checkOrder reports the reordering separately from checkContent
// reporting the wording). Returns one entry per manifest line, in manifest order;
// `segment`/`segmentIndex` are null when no segment was left to claim.
export function matchLinesToSegments(lines, segments) {
  const pairs = [];
  for (const line of lines) {
    const lineTokens = normalizeTokens(line.text);
    for (let si = 0; si < segments.length; si++) {
      pairs.push({act: line.act, si, score: similarity(lineTokens, segments[si].tokens)});
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedActs = new Set();
  const usedSegs = new Set();
  const bestFor = new Map();
  for (const p of pairs) {
    if (usedActs.has(p.act) || usedSegs.has(p.si)) continue;
    usedActs.add(p.act);
    usedSegs.add(p.si);
    bestFor.set(p.act, p);
  }
  return lines.map((line) => {
    const best = bestFor.get(line.act);
    return {
      act: line.act,
      manifestText: line.text,
      durationMs: line.durationMs,
      segment: best ? segments[best.si] : null,
      segmentIndex: best ? best.si : null,
      score: best ? best.score : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Findings — {check, level, ...fields, message}, the judge-av-sync shape. Unlike
// that judge (which reports anomalies only, absence = pass), every check here
// always emits a finding per act so the report is a complete, self-documenting
// table of what was heard — acceptance rests on reading "PASS" off the report, not
// on inferring it from silence.
// ---------------------------------------------------------------------------

export function checkStream({videoDurationS, audioDurationS, hasAudio, sampleRate}) {
  const findings = [];
  if (!hasAudio || audioDurationS == null) {
    findings.push({check: 'stream', level: 'FAIL', message: 'No audio stream found in the rendered file.'});
    return findings;
  }
  const shortBy = videoDurationS - audioDurationS;
  findings.push({
    check: 'stream',
    level: shortBy > 0.5 ? 'FAIL' : 'PASS',
    videoDurationS,
    audioDurationS,
    message: shortBy > 0.5
      ? `Audio stream (${audioDurationS.toFixed(2)}s) is short of the video (${videoDurationS.toFixed(2)}s) by ${shortBy.toFixed(2)}s.`
      : `Audio stream spans the video (${audioDurationS.toFixed(2)}s of ${videoDurationS.toFixed(2)}s).`,
  });
  findings.push({
    check: 'sample-rate',
    level: sampleRate === EXPECTED_SAMPLE_RATE ? 'PASS' : 'WARN',
    sampleRate,
    message: sampleRate === EXPECTED_SAMPLE_RATE
      ? `Sample rate is ${sampleRate}Hz.`
      : `Sample rate is ${sampleRate}Hz, expected ${EXPECTED_SAMPLE_RATE}Hz (not a hard rule outside the Magnetic handoff).`,
  });
  return findings;
}

export function checkLoudness({integratedLufs, truePeakDb, lra}) {
  const iOffBy = Math.abs(integratedLufs - TARGET_I);
  const peakOverBy = truePeakDb - CHAIN_TP;
  const lraOffBy = Math.abs(lra - TARGET_LRA);
  let level = 'PASS';
  if (iOffBy > LUFS_FAIL_TOLERANCE || truePeakDb > 0) level = 'FAIL';
  else if (iOffBy > LUFS_WARN_TOLERANCE || peakOverBy > 0 || lraOffBy > LRA_WARN_TOLERANCE) level = 'WARN';
  return [{
    check: 'loudness',
    level,
    integratedLufs,
    truePeakDb,
    lra,
    targetI: TARGET_I,
    chainTp: CHAIN_TP,
    targetLra: TARGET_LRA,
    message: `I: ${integratedLufs} LUFS (target ${TARGET_I}), Peak: ${truePeakDb} dBTP (chain ${CHAIN_TP}), LRA: ${lra} LU (target ${TARGET_LRA}).`,
  }];
}

export function checkEdgeSilence(events, videoDurationS) {
  const leading = events.find((e) => e.startS < 0.05);
  const trailing = events.find((e) => Math.abs(e.endS - videoDurationS) < 0.1);
  const leadingS = leading?.durationS ?? 0;
  const trailingS = trailing?.durationS ?? 0;
  return [
    {
      check: 'leading-silence',
      level: leadingS > LEADING_SILENCE_FAIL_S ? 'FAIL' : 'PASS',
      seconds: leadingS,
      message: `${leadingS.toFixed(2)}s of leading silence (fail over ${LEADING_SILENCE_FAIL_S.toFixed(2)}s = FADE_IN ${FADE_IN}f/${FPS}fps + ${EDGE_SILENCE_TOLERANCE_S}s).`,
    },
    {
      check: 'trailing-silence',
      level: trailingS > TRAILING_SILENCE_FAIL_S ? 'FAIL' : 'PASS',
      seconds: trailingS,
      message: `${trailingS.toFixed(2)}s of trailing silence (fail over ${TRAILING_SILENCE_FAIL_S.toFixed(2)}s = FADE_OUT ${FADE_OUT}f/${FPS}fps + ${EDGE_SILENCE_TOLERANCE_S}s).`,
    },
  ];
}

// The interior speechless stretch is NOT digital silence — the music keeps playing
// at BASE level while no VO is heard, so silencedetect (which gates on signal level)
// cannot see it. The only reliable signal is the gap between recognized words in the
// transcript, so this reads the word stream, not ffmpeg's silencedetect.
export function checkInteriorGap(words) {
  if (words.length < 2) {
    return [{check: 'interior-speechless', level: 'PASS', gapS: 0, message: 'Not enough words to measure a gap.'}];
  }
  let maxGapMs = 0, gapStartS = 0, gapEndS = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start * 1000 - words[i - 1].end * 1000;
    if (gap > maxGapMs) {
      maxGapMs = gap;
      gapStartS = words[i - 1].end;
      gapEndS = words[i].start;
    }
  }
  const gapS = maxGapMs / 1000;
  return [{
    check: 'interior-speechless',
    level: gapS > INTERIOR_GAP_WARN_S ? 'WARN' : 'PASS',
    gapS,
    fromS: gapStartS,
    toS: gapEndS,
    message: gapS > INTERIOR_GAP_WARN_S
      ? `VO stops at ${gapStartS.toFixed(2)}s and resumes at ${gapEndS.toFixed(2)}s — ${gapS.toFixed(1)}s speechless (warn over ${INTERIOR_GAP_WARN_S}s; likely the demo section playing under music by design).`
      : `Largest interior speechless stretch is ${gapS.toFixed(1)}s.`,
  }];
}

export function checkContent(matches) {
  return matches.map((m) => {
    if (!m.segment) {
      return {
        check: 'content', level: 'FAIL', act: m.act, score: 0,
        manifestText: m.manifestText, heardText: null,
        message: `Act "${m.act}": no matching heard segment — manifest line was not heard at all.`,
      };
    }
    const pass = m.score >= CONTENT_SIMILARITY_THRESHOLD;
    return {
      check: 'content', level: pass ? 'PASS' : 'FAIL', act: m.act, score: Number(m.score.toFixed(3)),
      manifestText: m.manifestText, heardText: m.segment.text,
      message: pass
        ? `Act "${m.act}": heard as expected (score ${m.score.toFixed(2)}).`
        : `Act "${m.act}": wording mismatch (score ${m.score.toFixed(2)}) — manifest: "${m.manifestText}" / heard: "${m.segment.text}".`,
    };
  });
}

// Ordering checked separately from wording: a reordered-but-correct transcript is a
// different bug (line B rendered before line A) than a misheard word.
export function checkOrder(matches) {
  const heard = matches.filter((m) => m.segment);
  let outOfOrder = null;
  for (let i = 1; i < heard.length; i++) {
    if (heard[i].segment.startMs < heard[i - 1].segment.startMs) {
      outOfOrder = [heard[i - 1].act, heard[i].act];
      break;
    }
  }
  return [{
    check: 'order',
    level: outOfOrder ? 'FAIL' : 'PASS',
    acts: heard.map((m) => m.act),
    message: outOfOrder
      ? `Act "${outOfOrder[1]}" is heard before act "${outOfOrder[0]}" finishes — manifest lines are out of order in the render.`
      : `${heard.length}/${matches.length} manifest lines heard in order.`,
  }];
}

// Measured spoken span vs manifest durationMs AND vs the act's absolute window from
// launchTiming.ts (`acts`, {from,len} in frames) — the comparison judge-av-sync
// structurally cannot make because it never touches the rendered file.
export function checkTiming(matches, acts) {
  return matches.map((m) => {
    if (!m.segment) {
      return {check: 'timing', level: 'SKIPPED', act: m.act, message: `Act "${m.act}": not heard, cannot measure timing.`};
    }
    const measuredS = (m.segment.endMs - m.segment.startMs) / 1000;
    const manifestS = m.durationMs / 1000;
    const deltaS = measuredS - manifestS;
    const act = acts?.[m.act];
    let withinActWindow = null;
    if (act) {
      const actStartS = act.from / FPS;
      const actEndS = (act.from + act.len) / FPS;
      withinActWindow =
        m.segment.startMs / 1000 >= actStartS - ACT_WINDOW_SLACK_S &&
        m.segment.endMs / 1000 <= actEndS + ACT_WINDOW_SLACK_S;
    }
    const pass = Math.abs(deltaS) <= TIMING_TOLERANCE_S && withinActWindow !== false;
    return {
      check: 'timing', level: pass ? 'PASS' : 'FAIL', act: m.act,
      measuredS: Number(measuredS.toFixed(2)), manifestS: Number(manifestS.toFixed(2)), deltaS: Number(deltaS.toFixed(2)),
      withinActWindow,
      message: pass
        ? `Act "${m.act}": measured ${measuredS.toFixed(2)}s vs manifest ${manifestS.toFixed(2)}s (delta ${deltaS.toFixed(2)}s).`
        : `Act "${m.act}": measured ${measuredS.toFixed(2)}s vs manifest ${manifestS.toFixed(2)}s (delta ${deltaS.toFixed(2)}s, tolerance ${TIMING_TOLERANCE_S}s)` +
          (withinActWindow === false ? ' and falls outside its launchTiming.ts act window.' : '.'),
    };
  });
}

// Mean level inside the VO window vs a neighboring music-only gap. Tolerance is wide
// (MIN_DUCK_DB) because master-audio's loudnorm compresses dynamics on the delivered
// file — this asserts "a duck is present", not its depth.
export function duckFinding(act, voMeanDb, musicMeanDb) {
  const duckDb = musicMeanDb - voMeanDb;
  return {
    check: 'duck', level: duckDb >= MIN_DUCK_DB ? 'PASS' : 'WARN', act,
    voMeanDb, musicMeanDb, duckDb: Number(duckDb.toFixed(2)),
    message: duckDb >= MIN_DUCK_DB
      ? `Act "${act}": music is ${duckDb.toFixed(1)}dB quieter during VO than the neighboring music-only region — duck present.`
      : `Act "${act}": music is only ${duckDb.toFixed(1)}dB quieter during VO than the neighboring music-only region — duck not clearly measurable here (wide tolerance; master-audio's loudnorm compresses dynamics).`,
  };
}

// For each matched line, the larger of its neighboring gaps (before/after, in the
// full segments list) usable as a music-only reference window, or null.
export function neighborGapWindow(segments, segmentIndex) {
  if (segmentIndex == null) return null;
  const before = segmentIndex > 0 ? {startMs: segments[segmentIndex - 1].endMs, endMs: segments[segmentIndex].startMs} : null;
  const after = segmentIndex < segments.length - 1 ? {startMs: segments[segmentIndex].endMs, endMs: segments[segmentIndex + 1].startMs} : null;
  const dur = (w) => (w ? w.endMs - w.startMs : -1);
  const candidate = dur(after) >= dur(before) ? after : before;
  if (!candidate || dur(candidate) / 1000 < MIN_GAP_FOR_DUCK_S) return null;
  return candidate;
}

// ---------------------------------------------------------------------------
// Impure helpers (shell out to ffmpeg/ffprobe/python)
// ---------------------------------------------------------------------------

function ffmpeg(args) {
  return spawnSync('ffmpeg', args, {encoding: 'utf8'});
}

function ffprobeJson(file) {
  const res = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-show_entries', 'stream=index,codec_type,codec_name,sample_rate,duration',
    '-of', 'json', file,
  ], {encoding: 'utf8'});
  if (res.status !== 0) {
    console.error(`judge-audio: ffprobe failed on ${file}:`);
    console.error(res.stderr ?? '');
    process.exit(1);
  }
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`judge-audio: could not parse ffprobe output for ${file}:`);
    console.error(res.stdout);
    process.exit(1);
  }
}

function volumeDetectMean(file, startS, endS) {
  const res = ffmpeg(['-hide_banner', '-nostats', '-i', file, '-ss', String(startS), '-to', String(endS), '-af', 'volumedetect', '-f', 'null', '-']);
  const parsed = parseVolumeDetect(`${res.stdout ?? ''}${res.stderr ?? ''}`);
  return parsed ? parsed.meanDb : null;
}

// Loads the model ONCE per process (verified ~15.7s of a ~25s run) and transcribes
// every requested file in that load. Returns {available:false} when faster_whisper
// or its model can't be loaded (exit 2 from transcribe.py, or the interpreter/script
// itself is missing) — the judge degrades to levels-and-picture rather than dying.
function transcribe(files) {
  const script = join(root, 'feeders', 'audio', 'transcribe.py');
  const res = spawnSync('python', [script, ...files], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (res.error || res.status === 2) {
    return {available: false, reason: res.error ? String(res.error.message) : (res.stderr ?? '').trim()};
  }
  if (res.status !== 0) {
    console.error('judge-audio: transcribe.py failed:');
    console.error(res.stderr ?? '');
    process.exit(1);
  }
  try {
    return {available: true, data: JSON.parse(res.stdout).files};
  } catch {
    console.error('judge-audio: could not parse transcribe.py output:');
    console.error(res.stdout);
    process.exit(1);
  }
}

function loadOrTranscribe(assetPathAbs, cachePath) {
  const stat = statSync(assetPathAbs);
  if (existsSync(cachePath)) {
    try {
      const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (cache.size === stat.size && cache.mtimeMs === stat.mtimeMs) {
        return {available: true, data: cache.data};
      }
    } catch {
      // fall through to a fresh transcribe
    }
  }
  const result = transcribe([assetPathAbs]);
  if (!result.available) return result;
  const data = result.data[assetPathAbs];
  writeFileSync(cachePath, JSON.stringify({size: stat.size, mtimeMs: stat.mtimeMs, model: 'small', data}, null, 2));
  return {available: true, data};
}

// showwavespic + showspectrumpic, vstacked, with act boundaries and VO windows drawn
// on top. fontfile is passed as a bare relative name with ffmpeg's cwd set to the
// Fonts directory — Windows drive-letter colons (C:/...) inside an ffmpeg filter
// value hit a documented escaping trap (verified: `fontfile=C\:/Windows/...` still
// fails to parse even correctly escaped), and this sidesteps it entirely.
function renderPicture(assetPathAbs, outPngAbs, videoDurationS, acts, voWindowsMs) {
  const W = 1600, WAVE_H = 260, SPEC_H = 260, TOTAL_H = WAVE_H + SPEC_H;
  const px = (s) => Math.max(0, Math.min(W, Math.round((s / videoDurationS) * W)));
  const filters = [];
  filters.push(`[0:a]showwavespic=s=${W}x${WAVE_H}:colors=white[wave]`);
  filters.push(`[0:a]showspectrumpic=s=${W}x${SPEC_H}:legend=disabled[spec]`);
  filters.push('[wave][spec]vstack=inputs=2[base]');
  let label = 'base';
  voWindowsMs.forEach((v, i) => {
    const x0 = px(v.startMs / 1000), x1 = px(v.endMs / 1000);
    const w = Math.max(1, x1 - x0);
    const nxt = `v${i}`;
    filters.push(`[${label}]drawbox=x=${x0}:y=0:w=${w}:h=${WAVE_H}:color=0x22c55e@0.30:t=fill[${nxt}]`);
    label = nxt;
  });
  acts.forEach((a, i) => {
    const x0 = px(a.startS);
    const nxt = `b${i}`;
    filters.push(`[${label}]drawbox=x=${x0}:y=0:w=2:h=${TOTAL_H}:color=white@0.85:t=fill[${nxt}]`);
    label = nxt;
  });
  acts.forEach((a, i) => {
    const x0 = px(a.startS) + 4;
    const nxt = `t${i}`;
    filters.push(`[${label}]drawtext=fontfile=arial.ttf:text='${a.name}':x=${x0}:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=3[${nxt}]`);
    label = nxt;
  });
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', assetPathAbs, '-filter_complex', filters.join(';'), '-frames:v', '1', '-map', `[${label}]`, outPngAbs];
  const res = spawnSync('ffmpeg', args, {encoding: 'utf8', cwd: 'C:/Windows/Fonts'});
  if (res.status !== 0 || !existsSync(outPngAbs)) {
    console.error('judge-audio: picture render failed:');
    console.error(res.stderr ?? '');
    process.exit(1);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const assetIdx = argv.indexOf('--asset');
  const asset = assetIdx >= 0 ? argv[assetIdx + 1] : 'launch-final';
  const skip = new Set(assetIdx >= 0 ? [assetIdx, assetIdx + 1] : []);
  const brand = argv.find((a, i) => !skip.has(i) && !a.startsWith('--'));
  if (!brand) {
    console.error('usage: node scripts/judge-audio.mjs <brand> [--asset launch-final] [--strict] [--json]');
    process.exit(1);
  }

  const assetPathAbs = join(root, 'out', brand, `${asset}.mp4`);
  const audioPath = join(root, 'props', `${brand}-audio.json`);
  const launchPath = join(root, 'props', `${brand}-launch.json`);
  const demoPath = join(root, 'props', `${brand}-demo.json`);
  if (!existsSync(assetPathAbs)) {
    console.error(`judge-audio: missing ${assetPathAbs}`);
    process.exit(1);
  }
  if (!existsSync(audioPath)) {
    console.error(`judge-audio: missing ${audioPath}`);
    process.exit(1);
  }
  if (!existsSync(launchPath)) {
    console.error(`judge-audio: missing ${launchPath}`);
    process.exit(1);
  }

  const audio = JSON.parse(readFileSync(audioPath, 'utf8'));
  const launch = JSON.parse(readFileSync(launchPath, 'utf8'));
  const lines = Array.isArray(audio.lines) ? audio.lines : [];
  const features = Array.isArray(launch.features) ? launch.features : [];
  const telemetryDurationMs = existsSync(demoPath)
    ? JSON.parse(readFileSync(demoPath, 'utf8'))?.telemetry?.durationMs ?? null
    : launch.demo?.telemetry?.durationMs ?? null;

  const mod = await import(new URL('../studio/src/lib/launchTiming.ts', import.meta.url));
  const timing = mod.launchTiming(
    telemetryDurationMs,
    features.length,
    launch.actLengths ?? null,
    mod.voTimingFrom(lines, features.length, {force: launch.voTiming ?? null}),
  );
  const actByKey = {logo: timing.logo, hook: timing.hook, demo: timing.demo, end: timing.end};
  timing.features.forEach((a, i) => { actByKey[`feature-${i}`] = a; });
  const actList = [
    {name: 'logo', ...timing.logo, startS: timing.logo.from / FPS},
    {name: 'hook', ...timing.hook, startS: timing.hook.from / FPS},
    {name: 'demo', ...timing.demo, startS: timing.demo.from / FPS},
    ...timing.features.map((a, i) => ({name: `feature-${i}`, ...a, startS: a.from / FPS})),
    {name: 'end', ...timing.end, startS: timing.end.from / FPS},
  ];

  const ffprobeParsed = ffprobeJson(assetPathAbs);
  const stream = parseFfprobeStreams(ffprobeParsed);
  const videoDurationS = stream.videoDurationS;

  const outDir = join(root, 'out', brand, 'marketing');
  mkdirSync(outDir, {recursive: true});
  const cachePath = join(outDir, `heard-${asset}.json`);
  const transcript = loadOrTranscribe(assetPathAbs, cachePath);

  const findings = [...checkStream(stream)];

  if (stream.hasAudio) {
    const ebur128Res = ffmpeg(['-hide_banner', '-nostats', '-i', assetPathAbs, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
    const ebur128 = parseEbur128(`${ebur128Res.stdout ?? ''}${ebur128Res.stderr ?? ''}`);
    if (!ebur128) {
      console.error('judge-audio: could not parse ebur128 output:');
      console.error(ebur128Res.stderr ?? '');
      process.exit(1);
    }
    findings.push(...checkLoudness(ebur128));

    const silenceRes = ffmpeg(['-hide_banner', '-nostats', '-i', assetPathAbs, '-af', `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_D}`, '-f', 'null', '-']);
    const silenceEvents = parseSilenceEvents(`${silenceRes.stdout ?? ''}${silenceRes.stderr ?? ''}`);
    findings.push(...checkEdgeSilence(silenceEvents, videoDurationS));
  }

  let matches = [];
  let voWindowsMs = [];
  if (!transcript.available) {
    findings.push({check: 'transcript', level: 'SKIPPED', message: `faster_whisper unavailable: ${transcript.reason}. Content/order/timing/duck findings skipped; stream, loudness, silence and the picture still ran.`});
    for (const line of lines) {
      findings.push({check: 'content', level: 'SKIPPED', act: line.act, message: `Act "${line.act}": transcript unavailable.`});
      findings.push({check: 'timing', level: 'SKIPPED', act: line.act, message: `Act "${line.act}": transcript unavailable.`});
    }
    findings.push({check: 'order', level: 'SKIPPED', message: 'transcript unavailable.'});
    findings.push({check: 'interior-speechless', level: 'SKIPPED', message: 'transcript unavailable.'});
  } else {
    const words = transcript.data.words ?? [];
    const segments = groupWordsByGap(words);
    matches = matchLinesToSegments(lines, segments);
    voWindowsMs = matches.filter((m) => m.segment).map((m) => ({startMs: m.segment.startMs, endMs: m.segment.endMs}));

    findings.push(...checkContent(matches));
    findings.push(...checkOrder(matches));
    findings.push(...checkTiming(matches, actByKey));
    findings.push(...checkInteriorGap(words));

    for (const m of matches) {
      if (!m.segment) continue;
      const gap = neighborGapWindow(segments, m.segmentIndex);
      if (!gap) continue;
      const voDb = volumeDetectMean(assetPathAbs, m.segment.startMs / 1000, m.segment.endMs / 1000);
      const musicDb = volumeDetectMean(assetPathAbs, gap.startMs / 1000, gap.endMs / 1000);
      if (voDb == null || musicDb == null) continue;
      findings.push(duckFinding(m.act, voDb, musicDb));
    }
  }

  const outPngAbs = join(outDir, 'judge-audio.png');
  renderPicture(assetPathAbs, outPngAbs, videoDurationS, actList, voWindowsMs);

  const verdict = findings.some((f) => f.level === 'FAIL') ? 'FAIL' : 'PASS';
  const report = {
    judge: 'audio',
    brand,
    asset,
    generatedAt: new Date().toISOString(),
    verdict,
    inputs: {
      video: `out/${brand}/${asset}.mp4`,
      manifest: `props/${brand}-audio.json`,
      launch: `props/${brand}-launch.json`,
      transcriptCache: `out/${brand}/marketing/heard-${asset}.json`,
    },
    summary: {
      linesInManifest: lines.length,
      linesHeard: matches.filter((m) => m.segment).length,
      whisperAvailable: transcript.available,
      videoDurationS,
      findings: findings.length,
    },
    findings,
  };

  const outPath = join(outDir, 'judge-audio.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`judge-audio [${brand}/${asset}]: ${verdict} (${findings.length} finding(s))`);
    for (const f of findings) console.log(`  [${f.level}] ${f.check}${f.act ? ` (${f.act})` : ''}: ${f.message}`);
    console.log(`  report -> out/${brand}/marketing/judge-audio.json`);
    console.log(`  picture -> out/${brand}/marketing/judge-audio.png`);
  }

  if (!transcript.available) process.exit(2);
  process.exit(strict && verdict === 'FAIL' ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
