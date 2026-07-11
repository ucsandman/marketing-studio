import {Easing, interpolate} from 'remotion';

// Frame math for the Synthacon "Connect" vector logo reveal, ported from the
// operator-approved Claude Design doc ("Animated Logos.dc.html"). The S-stroke
// draws on bottom-up while its two patch-cable terminals animate: the BOTTOM
// (source) terminal pops in first as the draw starts, the TOP (destination)
// terminal stays hidden until the stroke is nearly done, then "clicks into
// place" with a small overshoot as the cable connects. Plays ONCE and HOLDS —
// the design's grpFade loop-out (84-95%) is for looping web embeds and is
// intentionally omitted here; a video reveal ends held, not faded.
//
// Duration math lives in this ONE pure lib (PLAYBOOK convention, see
// lib/launchTiming.ts) so SynthaconReveal.tsx only ever consumes the output.

export type TerminalState = {scale: number; opacity: number};
export type RevealState = {dashoffset: number; bottom: TerminalState; top: TerminalState};

// Base duration at tempo 1. `tempo` scales the window exactly like
// brandSpring/entrance in lib/motion.ts (tempo 2 -> half the frames): divide
// the duration by tempo, never multiply frame by tempo directly.
const DURATION_S = 2.8;

// CSS `cubic-bezier(0.4, 0, 0.2, 1)` — the "standard" ease the design doc names
// for the stroke draw-on; reused for the terminal scale/opacity ramps too since
// the doc doesn't restate a different curve for them.
const EASE = Easing.bezier(0.4, 0, 0.2, 1);

const ramp = (t: number, from: number, to: number, range: [number, number]): number =>
  interpolate(t, range, [from, to], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE});

/**
 * Reveal state at `frame` (fps, tempo). `t` is the elapsed fraction of the
 * tempo-scaled 2.8s window, clamped to [0, 1] so the whole reveal holds its
 * final state forever once the window ends (play once, no loop).
 */
export const revealTiming = (frame: number, fps: number, tempo: number): RevealState => {
  const t = Math.min(1, Math.max(0, frame / fps / (DURATION_S / tempo)));

  const dashoffset = ramp(t, 100, 0, [0, 0.46]);

  const bottomV = ramp(t, 0, 1, [0, 0.09]);
  const bottom: TerminalState = {scale: bottomV, opacity: bottomV};

  let top: TerminalState;
  if (t <= 0.44) {
    top = {scale: 0, opacity: 0};
  } else if (t <= 0.52) {
    const local = ramp(t, 0, 1, [0.44, 0.52]);
    top = {scale: local * 1.28, opacity: local};
  } else if (t <= 0.58) {
    top = {scale: ramp(t, 1.28, 1, [0.52, 0.58]), opacity: 1};
  } else {
    top = {scale: 1, opacity: 1};
  }

  return {dashoffset, bottom, top};
};
