// Word-locked reveal cues: measured VO word times -> act-local reveal frames.
//
// DEPENDENCY RULE: this module may import ONLY from ./launchTiming (for VO_LEAD).
// No zod, no React, no Remotion — scripts/judge-av-sync.mjs imports it directly via
// Node type-stripping, which cannot resolve a transitive package import. The '.ts'
// extension is deliberate for the same reason: Node's stripper does no extensionless
// resolution (studio/tsconfig.json enables allowImportingTsExtensions for it).
import {VO_LEAD} from './launchTiming.ts';

export type Word = {w: string; startMs: number; endMs: number};
export type WordCueLine = {words?: Word[]; durationMs: number};

// Cue-authoring constants (references/03-word-locked-sync.md).
// An element that must be READ leads its word by 0.02-0.06s so it is legible ON the
// word; 2 frames at 30fps sits mid-band. A HIT (click, state flip, stat landing)
// lands exactly on the word.
export const LEAD_READ = 2;
export const LEAD_HIT = 0;
// A reveal more than 200ms after its word reads as lag; one beat carries at most 2 cues.
export const LAG_TOLERANCE_FRAMES = 6;
export const BEAT_FRAMES = 12;
export const MAX_CUES_PER_BEAT = 2;

/**
 * Act-local frame of every word start in a line. [] when the line has no words.
 * VO_LEAD is added because voWindows() starts the audio at act.from + VO_LEAD, so a
 * frame from this module is directly usable as an act-local delayFrames.
 */
export const wordCueFrames = (line: WordCueLine | null | undefined, fps: number): number[] =>
  line?.words?.map((w) => VO_LEAD + Math.round((w.startMs / 1000) * fps)) ?? [];

/** Lowercase, strip everything but [a-z0-9]. '350,' -> '350'; "Claude's" -> 'claudes'. */
export const normalizeToken = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'to',
  'for',
  'on',
  'in',
  'with',
  'your',
  'our',
  'its',
  'it',
  'is',
  'are',
  'that',
  'this',
  'then',
]);

// Greedy, in-order, one-to-one scan shared by both align helpers: each target token
// takes the frame of the first VO word at or after the last matched index whose
// normalized token is equal, so repeated words match their own occurrence and
// display order can never cross VO order. Unmatched -> null.
const alignTokens = (
  targets: (string | null)[],
  line: WordCueLine | null | undefined,
  fps: number,
  leadFrames: number,
): (number | null)[] => {
  const frames = wordCueFrames(line, fps);
  const words = line?.words;
  if (!words || frames.length === 0) return targets.map(() => null);
  const out: (number | null)[] = [];
  let cursor = 0;
  for (const target of targets) {
    let hit: number | null = null;
    if (target) {
      for (let j = cursor; j < words.length; j++) {
        if (normalizeToken(words[j].w) === target) {
          hit = Math.max(0, frames[j] - leadFrames);
          cursor = j + 1;
          break;
        }
      }
    }
    out.push(hit);
  }
  return out;
};

/**
 * Align on-screen WORDS (a headline split on spaces) to the VO word table.
 * Result length always equals displayWords.length. Frames clamp at 0.
 */
export const alignWordCues = (
  displayWords: string[],
  line: WordCueLine | null | undefined,
  fps: number,
  opts?: {leadFrames?: number},
): (number | null)[] =>
  alignTokens(
    displayWords.map((w) => normalizeToken(w) || null),
    line,
    fps,
    opts?.leadFrames ?? LEAD_READ,
  );

// "Cue the verb, not the noun": benefit lines lead with their verb, so a phrase is
// represented by its first non-stopword token ("Then your setup gets a six pillar
// score" cues on 'setup', not 'then'). Falls back to the first content token when a
// phrase is nothing but stopwords.
const phraseToken = (phrase: string): string | null => {
  const tokens = phrase
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean);
  return tokens.find((t) => !STOPWORDS.has(t)) ?? tokens[0] ?? null;
};

/** Align on-screen PHRASES (feature benefit lines) to the VO word table. */
export const alignPhraseCues = (
  displayPhrases: string[],
  line: WordCueLine | null | undefined,
  fps: number,
  opts?: {leadFrames?: number},
): (number | null)[] =>
  alignTokens(displayPhrases.map(phraseToken), line, fps, opts?.leadFrames ?? LEAD_READ);
