import type {Act} from './launchTiming';
import {VO_LEAD} from './audioMix';

// Pure cue derivation for burned-in captions + sidecar SRT/VTT. Captions must let
// the message survive muted autoplay (X/TikTok/Shorts), so a cue sits on the exact
// same frame window as its VO line (see voWindows() in audioMix.ts — same VO_LEAD,
// same act clamp). This module is the single source of truth for that math; the
// plain-JS mirror in scripts/build-captions.mjs points back here.

export type VoLine = {act: string; text: string; durationMs: number};
export type Cue = {text: string; fromFrame: number; toFrame: number};

type Timing = {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act};

// A display line longer than this wraps onto a second stacked line (display
// concern only — the cue stays one cue, one time window).
export const MAX_CAPTION_CHARS = 42;

// Mirrors actFor() in audioMix.ts: resolve an act key to its frame budget.
const actFor = (key: string, timing: Timing): Act => {
  if (key === 'logo' || key === 'hook' || key === 'demo' || key === 'end') return timing[key];
  const m = key.match(/^feature-(\d+)$/);
  if (m && timing.features[Number(m[1])]) return timing.features[Number(m[1])];
  throw new Error(`caption manifest references unknown act "${key}"`);
};

// Wrap a long line onto (at most) two lines at a word boundary, keeping the first
// line within maxChars. Short lines pass through unchanged.
export const splitDisplayLines = (text: string, maxChars = MAX_CAPTION_CHARS): string[] => {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  let line1 = words[0];
  let i = 1;
  for (; i < words.length; i++) {
    if ((line1 + ' ' + words[i]).length <= maxChars) line1 += ' ' + words[i];
    else break;
  }
  const line2 = words.slice(i).join(' ');
  return line2 ? [line1, line2] : [line1];
};

// Act-anchored cues (LaunchVideo): each line rides its act's VO window — starts at
// act.from + VO_LEAD, runs min(spoken length, remaining act) so an overlong line
// clamps to the act end. Empty manifest -> empty cues.
export const captionCues = (voLines: VoLine[], timing: Timing, fps: number): Cue[] =>
  voLines.map((line) => {
    const act = actFor(line.act, timing);
    const fromFrame = act.from + VO_LEAD;
    const toFrame = Math.min(
      fromFrame + Math.ceil((line.durationMs / 1000) * fps),
      act.from + act.len,
    );
    return {text: line.text, fromFrame, toFrame};
  });

// Sequential cues (SocialClip, which has no launchTiming acts): lay each line
// back-to-back from startFrame, each running its spoken length, clamped to
// maxFrame. Lines past maxFrame are dropped. Empty input -> empty cues.
export const sequentialCues = (
  voLines: VoLine[],
  fps: number,
  maxFrame: number,
  startFrame = 0,
): Cue[] => {
  const cues: Cue[] = [];
  let cursor = startFrame;
  for (const line of voLines) {
    if (cursor >= maxFrame) break;
    const toFrame = Math.min(cursor + Math.ceil((line.durationMs / 1000) * fps), maxFrame);
    cues.push({text: line.text, fromFrame: cursor, toFrame});
    cursor = toFrame;
  }
  return cues;
};

// The active cue at a frame, or null (cues never overlap within a comp).
export const cueAt = (cues: Cue[], frame: number): Cue | null =>
  cues.find((c) => frame >= c.fromFrame && frame < c.toFrame) ?? null;

// Burned caption font size in px. `52 * scale` alone floors out on the portrait
// and square export rows (scale 0.5625 at 1080-wide -> 29px, ~1.5% of frame
// height) because scale is derived from BOTH width and height (see
// formatFor() in layout.ts) and picks the smaller axis. Floor it against a
// fraction of frame height so tall/narrow formats stay readable; at the
// 1920x1080 master this floor is always below 52, so landscape is unchanged.
export const captionFontSize = (scale: number, frameHeight: number): number =>
  Math.round(Math.max(52 * scale, frameHeight * 0.028));
