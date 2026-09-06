import {Easing, interpolate, spring} from 'remotion';
import type {Brand} from './brand';

// The single place brand "motion personality" math lives. Templates route their
// entrance choreography (springs, eased reveals, inter-element stagger) through
// these helpers passing `brand.motion`, so one knob per brand retunes the FEEL of
// every animation without ever moving a rest position.
//
// Design invariants (see motion.test.ts):
//   - f(0) == 0 and every helper settles to 1 (rest positions never change).
//   - exuberance 0  -> overdamped, NO overshoot (mechanical).
//   - exuberance 1  -> underdamped, visible overshoot (bouncy).
//   - tempo 2       -> an entrance completes in half the frames.

export type Motion = Brand['motion'];

// Mirrors the zod defaults in brand.ts; exported so tests and the few pure callers
// that need a baseline don't re-declare the numbers.
export const DEFAULT_MOTION: Motion = {
  tempo: 1,
  exuberance: 0.35,
  stagger: 0.5,
  overshoot: 0.25,
  parallax: 0,
  settle: 0,
  textReveal: 'spring',
};

// Stiffness/mass are held at Remotion's legacy spring defaults (what every
// `spring({config:{damping:200}})` call in the repo already used); personality
// rides entirely on the damping RATIO, so the natural frequency and the rest
// point stay familiar and only the bounce/settle character changes.
const STIFFNESS = 100;
const MASS = 1;
const CRITICAL = 2 * Math.sqrt(STIFFNESS * MASS); // damping at zeta == 1  (= 20)

// exuberance 0 -> overdamped (zeta > 1, no overshoot); exuberance 1 -> underdamped
// (zeta < 1, bounce). Log-lerp between the two keeps the sweep smooth and crosses
// critical (zeta == 1) around exuberance ~0.55, so the low/default band stays
// bounce-free (matching the prior damping:200 feel) and overshoot only emerges as a
// brand deliberately dials exuberance up. `overshoot` nudges the ratio lower still,
// trimming or extending how far a lively entrance travels past its rest point.
const ZETA_STIFF = 4; // damping ratio at exuberance 0
const ZETA_LOOSE = 0.3; // damping ratio at exuberance 1

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Zero-slope progress at both ends for camera, cursor, and focus transitions. */
export const smootherstep = (v: number): number => {
  const t = clamp01(v);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * Restrained physical press: approach remains at rest, pressure builds after
 * the real cue, then releases without a snap or spring overshoot.
 */
export const pressScaleAt = (
  now: number,
  cue: number,
  options: {press: number; release: number; depth?: number},
): number => {
  const {press, release, depth = 0.1} = options;
  const elapsed = now - cue;
  if (elapsed < 0 || elapsed >= press + release) return 1;
  if (elapsed <= press) return 1 - depth * smootherstep(elapsed / Math.max(1, press));
  return 1 - depth * (1 - smootherstep((elapsed - press) / Math.max(1, release)));
};

export type PointerPhase = 'idle' | 'approach' | 'hover' | 'press' | 'release';

/** Semantic pointer state derived only from authored/recorded click times. */
export const pointerPhaseAt = (
  cues: number[],
  now: number,
  options: {approach: number; hover: number; press: number; release: number},
): PointerPhase => {
  const previous = [...cues].reverse().find((cue) => cue <= now);
  if (previous !== undefined) {
    const elapsed = now - previous;
    if (elapsed < options.press) return 'press';
    if (elapsed < options.press + options.release) return 'release';
  }
  const next = cues.find((cue) => cue > now);
  if (next === undefined) return 'idle';
  const until = next - now;
  if (until <= options.hover) return 'hover';
  if (until <= options.approach) return 'approach';
  return 'idle';
};

const dampingRatio = (exuberance: number, overshoot: number): number => {
  const e = clamp01(exuberance);
  const base = Math.pow(ZETA_STIFF, 1 - e) * Math.pow(ZETA_LOOSE, e);
  return base * (1 - 0.35 * clamp01(overshoot));
};

/**
 * Brand-tuned entrance spring. Drop-in for `spring({frame, fps, config})`: returns
 * 0 at its start frame and settles to 1, overshooting past 1 when the brand is
 * exuberant. `tempo` scales evolution speed; `delayFrames` shifts the start.
 */
export const brandSpring = (
  frame: number,
  fps: number,
  motion: Motion,
  opts: {delayFrames?: number} = {},
): number => {
  const {delayFrames = 0} = opts;
  const zeta = dampingRatio(motion.exuberance, motion.overshoot);
  return spring({
    frame: (frame - delayFrames) * motion.tempo,
    fps,
    config: {damping: zeta * CRITICAL, stiffness: STIFFNESS, mass: MASS},
  });
};

/**
 * Tempo-scaled eased progress 0..1 for interpolate-style reveals (kickers, CTAs).
 * At tempo 1 it reproduces `interpolate(frame - delayFrames, [0, durFrames], ...)`;
 * tempo 2 reaches 1 in half the real frames. `fps` is part of the shared helper
 * signature for symmetry with brandSpring even though the eased ramp is fps-free.
 */
export const entrance = (
  frame: number,
  fps: number,
  motion: Motion,
  opts: {delayFrames?: number; durFrames: number; easing?: (t: number) => number},
): number => {
  void fps;
  const {delayFrames = 0, durFrames, easing = Easing.linear} = opts;
  const local = (frame - delayFrames) * motion.tempo;
  return interpolate(local, [0, durFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
};

/**
 * Frame delay for the index-th element in a staggered group. `stagger` scales the
 * base gap; at the default (0.5) it is an identity multiplier, so existing
 * `i * baseFrames` cadence is preserved unchanged.
 */
export const staggerDelay = (index: number, baseFrames: number, motion: Motion): number =>
  index * baseFrames * (motion.stagger / DEFAULT_MOTION.stagger);

// ---- Quantified motion standards -------------------------------------------
// The numeric half of Emil Kowalski's review-animations STANDARDS.md
// (github.com/emilkowalski/skills, MIT) that judge-motion.mjs had not ported
// yet, plus Val Head's macro perception thresholds (valhead.com, "How fast
// should your UI animations be?") and the Nielsen Norman one-second flow
// ceiling.
//
// These live HERE, not in the judge, because judge-motion.mjs imports them:
// PLAYBOOK's rule is that duration math lives in ONE pure lib and is never
// re-derived at a second site. Templates pick durations through msFrames() so a
// number in a composition traces to a stated band instead of being a magic
// frame count.
//
// NOTE ON EASING: the studio deliberately does NOT carry named cubic-bezier
// constants. Kowalski's table names three CSS curves; this repo composes
// Remotion's easing algebra instead (Easing.out(Easing.cubic) and friends),
// which is already consistent across every component. Adding a parallel
// bezier vocabulary would be a second way to say the same thing.

/**
 * Duration band per element class, in milliseconds, BEFORE brand tempo scales
 * it. Pass the midpoint (or either edge) to msFrames().
 */
export const DURATION_MS = {
  /** Button press, counter tick, state acknowledgement. */
  feedback: [100, 160],
  /** Tooltip, popover, small floating label. */
  tooltip: [125, 200],
  /** Dropdown, menu, select expansion. */
  dropdown: [150, 250],
  /** Modal, drawer, full-card or panel entrance. */
  panel: [200, 500],
} as const;

/** Ceiling for a single UI motion beat; past this it reads sluggish. */
export const BEAT_CEILING_MS = 300;

/** Under this a change reads as instant rather than animated. */
export const INSTANT_MS = 100;

/** A single beat longer than this breaks narrative flow (Nielsen Norman). */
export const FLOW_CEILING_MS = 1000;

/**
 * Safe entrance scale band. Nothing in the real world appears from nothing, and
 * nothing legible appears from a scale so small it reads as a different object:
 * entrances start inside this band, never at 0.
 */
export const ENTRY_SCALE = [0.9, 0.97] as const;

/**
 * Perceptible stagger band between items in a group, in milliseconds. Below the
 * floor a group reads as one simultaneous (mechanical) event; above the ceiling
 * the group stops reading as a group at all.
 */
export const STAGGER_MS = [30, 80] as const;

/**
 * Milliseconds -> frames at the brand's tempo. Inverse of the tempo convention
 * in brandSpring/entrance (which multiply elapsed frames by tempo), so a brisker
 * brand spends FEWER frames on the same stated duration. Always at least 1
 * frame: a 0-frame duration would divide by zero in interpolate().
 */
export const msFrames = (ms: number, fps: number, motion: Motion): number =>
  Math.max(1, Math.round(((ms / 1000) * fps) / motion.tempo));

/**
 * Entrance scale for a 0..1 progress value, starting inside ENTRY_SCALE and
 * settling exactly at 1. `exuberance` picks the start: a terse brand barely
 * scales (0.97), a lively one travels the whole band (0.9).
 *
 * Unlike brandSpring/entrance this is NOT 0 at progress 0 — it is a scale, not a
 * progress, and a scale of 0 is the exact failure judge-motion's scale-zero rule
 * exists to catch. It still settles to 1, so rest positions never move.
 */
export const entryScale = (progress: number, motion: Motion): number => {
  const [lo, hi] = ENTRY_SCALE;
  const from = hi - (hi - lo) * clamp01(motion.exuberance);
  return from + (1 - from) * clamp01(progress);
};

/**
 * Frame delay for the index-th element of a staggered group, expressed in
 * milliseconds instead of base frames. Companion to staggerDelay() for new
 * call sites that want to state a gap in the units STAGGER_MS is defined in.
 */
export const staggerMsDelay = (
  index: number,
  ms: number,
  fps: number,
  motion: Motion,
): number =>
  Math.round(index * ((ms / 1000) * fps) * (motion.stagger / DEFAULT_MOTION.stagger));

/**
 * The effective gap a `staggerDelay(i, baseFrames, motion)` cadence produces, in
 * milliseconds — what judge-motion checks against STAGGER_MS. Exported so the
 * judge reads the real formula rather than re-deriving the multiplier.
 */
export const staggerEffectiveMs = (
  baseFrames: number,
  fps: number,
  motion: Motion,
): number => (baseFrames * (motion.stagger / DEFAULT_MOTION.stagger) * 1000) / fps;
