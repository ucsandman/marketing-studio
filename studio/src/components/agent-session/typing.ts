/**
 * VENDORED from the `claude-code-remotion` skill by flocker.md (MIT, 2026):
 * github.com/flocker-md/skills/blob/main/skills/claude-code-remotion/references/typing.ts
 * Copied verbatim; the header below is the original's. Keep it that way — the
 * upstream file is the diffable source, and this repo's only change is this credit.
 *
 * Human-feeling typing animation for "user" input in compositions.
 *
 * Two things separate this from a linear character reveal: each keystroke gets
 * its own slightly different interval, and the user hesitates after punctuation
 * — a beat after a comma, a longer one after a full stop. Both are what make
 * typed text read as a person rather than a teleprompter.
 *
 * All variation comes from `seeded()` below — as a hash, not a random number.
 * `Math.random()` must never be used here: frames are rendered concurrently and
 * often in separate processes, so an unseeded value would differ frame to frame
 * or between renders and the text would flicker instead of type.
 *
 * This module has no imports. It works in Remotion, in any other animation
 * framework, or on its own.
 */

/**
 * A stable 0..1 value derived from a string. Not random — the same seed always
 * gives the same number, making a render reproducible.
 *
 * FNV-1a hash, then murmur3-style finalizer to scramble the low bits so that
 * seeds differing by one character (eg. `"k1"` vs `"k2"`) land far apart.
 */
export const seeded = (seed: string): number => {
  let h = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619); // FNV prime
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

export type TypingOptions = {
  /** Baseline characters per second. Human range is ~15–35. */
  cps?: number;
  /** Per-keystroke speed wobble, as a fraction of the base interval (0–1). */
  jitter?: number;
  /** Extra dwell in seconds after a given character. */
  pauses?: Record<string, number>;
  /** How much the pause lengths vary, as a fraction (0–1). */
  pauseJitter?: number;
  /** Vary this to get a different-but-still-deterministic performance. */
  seed?: string;
};

/** Hesitation after punctuation, in seconds. Sentence endings dwell longest. */
export const DEFAULT_PAUSES: Record<string, number> = {
  ",": 0.16,
  ";": 0.2,
  ":": 0.2,
  ".": 0.3,
  "?": 0.3,
  "!": 0.3,
  "—": 0.18,
  "\n": 0.42,
};

const DEFAULTS = {
  cps: 24,
  jitter: 0.45,
  pauses: DEFAULT_PAUSES,
  pauseJitter: 0.5,
};

// Schedules are pure functions of their inputs and get rebuilt on every frame
const cache = new Map<string, number[]>();

/**
 * Seconds from typing start at which each character has appeared.
 * `text[i]` lands with `schedule[i]`, monotonically.
 */
export const typingSchedule = (
  text: string,
  opts: TypingOptions = {},
): number[] => {
  const cps = opts.cps ?? DEFAULTS.cps;
  const jitter = opts.jitter ?? DEFAULTS.jitter;
  const pauses = opts.pauses ?? DEFAULTS.pauses;
  const pauseJitter = opts.pauseJitter ?? DEFAULTS.pauseJitter;
  const seed = opts.seed ?? text;

  const key = `${seed}|${cps}|${jitter}|${pauseJitter}|${JSON.stringify(
    pauses,
  )}|${text}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const base = 1 / cps;
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < text.length; i += 1) {
    // Each keystroke takes the base interval scaled by ±jitter.
    const wobble = 1 + (seeded(`${seed}:k${i}`) * 2 - 1) * jitter;
    t += base * wobble;
    out.push(t);
    // The character lands, then the hand hesitates before reaching again.
    const pause = pauses[text[i]];
    if (pause) {
      const scale = 1 - pauseJitter + seeded(`${seed}:p${i}`) * pauseJitter * 2;
      t += pause * scale;
    }
  }

  cache.set(key, out);
  return out;
};

/**
 * The visible slice of `text` at `frame`, typed as a person would.
 * Pair with a caret for the full effect.
 *
 * ```tsx
 * const shown = typeHuman(PROMPT, frame, F.typeStart, fps, { cps: 25 });
 * ```
 */
export const typeHuman = (
  text: string,
  frame: number,
  startFrame: number,
  fps: number,
  opts: TypingOptions = {},
): string => {
  const elapsed = (frame - startFrame) / fps;
  if (elapsed <= 0) return "";
  const schedule = typingSchedule(text, opts);
  let n = 0;
  while (n < schedule.length && schedule[n] <= elapsed) n += 1;
  return text.slice(0, n);
};

/**
 * How many frames the full string takes to type.
 *
 * Derive the beat that follows from this rather than hand-tuning a frame number
 */
export const typingDurationInFrames = (
  text: string,
  fps: number,
  opts: TypingOptions = {},
): number => {
  const schedule = typingSchedule(text, opts);
  return Math.ceil((schedule[schedule.length - 1] ?? 0) * fps);
};

/**
 * A held beat of roughly `seconds`, varied by `jitter`.
 *
 * The pause between the last keystroke and hitting enter, where a person reads 
 * back what they typed. 
 * 
 * Works equally well for agent-side pacing: give each gap between tool
 * calls or messages its own constant seeded pause.
 *
 * Deterministic like the rest of the module: the length is drawn from `seed`,
 * so it is stable across frames and across renders.
 */
export const settleDelayInFrames = (
  fps: number,
  opts: { seconds?: number; jitter?: number; seed?: string } = {},
): number => {
  const seconds = opts.seconds ?? 2;
  const jitter = opts.jitter ?? 0.25;
  const seed = opts.seed ?? "settle";
  const scale = 1 + (seeded(`${seed}:settle`) * 2 - 1) * jitter;
  return Math.round(seconds * scale * fps);
};

/**
 * Whether a keystroke landed `withinSeconds` of now — use it to hold a
 * caret solid while typing and resume blinking once the 'user' input stops.
 */
export const isTyping = (
  text: string,
  frame: number,
  startFrame: number,
  fps: number,
  opts: TypingOptions = {},
  withinSeconds = 0.35,
): boolean => {
  const elapsed = (frame - startFrame) / fps;
  if (elapsed <= 0) return false;
  const schedule = typingSchedule(text, opts);
  const last = schedule[schedule.length - 1] ?? 0;
  return elapsed < last + withinSeconds;
};
