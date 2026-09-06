import type {Motion} from './motion';

// Depth cues that give flat compositions believable dimension without touching a
// single rest position. Two independent pieces, both pure and both gated by a
// brand knob that defaults to 0 (so the default output is a flat, hard cut):
//
//   parallaxOffset — a slow authored operator arc applied to a depth LAYER's
//     container. Background layers move more than foreground, selling depth.
//   settleOn — a short overshoot-and-settle kicker applied to an act container
//     right after a cut, so a cut lands like a real operator eased it in.
//
// There is no random phase or per-brand wander. Semantic layer suffixes define
// stable directions; a string hash is only a deterministic fallback for callers
// with another named layer.

export type Offset = {x: number; y: number};
export type SettleTransform = {x: number; y: number; scale: number};

// Peak drift (px) at parallax = 1, layerDepth = 1. Kept small: parallax is a
// subliminal depth cue, not a visible pan.
const PARALLAX_AMP_PX = 22;
// Two slow, incommensurate periods (seconds) so the drift never visibly repeats
// and reads as organic float; both are in the tens-of-seconds range so motion is
// slow and smooth across a normal launch video.
const DRIFT_PERIOD_X_S = 23;
const DRIFT_PERIOD_Y_S = 31;
// Vertical travel is gentler than horizontal (eyes tolerate less vertical drift).
const VERTICAL_RATIO = 0.55;

/**
 * Slow parallax drift for one depth layer. Returns a per-frame {x, y} px offset
 * whose amplitude scales with `motion.parallax` and the layer's `layerDepth`
 * (0 = pinned foreground, 1 = far background). At `motion.parallax === 0` every
 * offset is exactly {0, 0} — the flat default. `seed` (per layer) decorrelates
 * layers so they don't drift in lockstep.
 */
export const parallaxOffset = (
  frame: number,
  fps: number,
  layerDepth: number,
  motion: Motion,
  seed: string,
): Offset => {
  const amp = motion.parallax * layerDepth * PARALLAX_AMP_PX;
  if (amp === 0) return {x: 0, y: 0};
  const t = frame / fps; // seconds
  const parts = seed.split(':');
  const role = parts[parts.length - 1];
  const authored =
    role === 'bg'
      ? {x: 1, y: -0.35}
      : role === 'wash'
        ? {x: -0.55, y: 0.7}
        : role === 'content'
          ? {x: 0.28, y: 0.2}
          : null;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const angle = ((hash % 360) * Math.PI) / 180;
  const direction = authored ?? {x: Math.cos(angle), y: Math.sin(angle)};
  // Both arcs start at the authored rest position. No random initial offset.
  const x = amp * direction.x * Math.sin((2 * Math.PI * t) / DRIFT_PERIOD_X_S);
  const y =
    amp * direction.y * VERTICAL_RATIO * Math.sin((2 * Math.PI * t) / DRIFT_PERIOD_Y_S);
  return {x, y};
};

// Kicker amplitudes at settle = 1, right at the cut. A "few px" translate and a
// sub-1% scale, decaying fast so the whole gesture is spent inside ~20 frames.
const SETTLE_KICK_PX = 5;
const SETTLE_SCALE_AMP = 0.004; // 0.4% — felt, not announced
const SETTLE_TAU_FRAMES = 6; // decay time constant (env ≈ 0.007 by frame 30)
const SETTLE_RING_FRAMES = 13; // one ring ≈ 13 frames -> ~1.5 rings before it dies

/**
 * Overshoot-and-settle kicker for an act container, keyed on the cut frame.
 * Returns a small translate + sub-1% scale that is at its peak on the cut frame
 * (`frame === cutFrame`) and rings down to identity within ~30 frames. Amplitude
 * scales with `motion.settle`; at `motion.settle === 0`, or before the cut, it is
 * the exact identity {0, 0, 1}. `fps` is part of the shared helper signature for
 * symmetry with the entrance helpers even though the decay is measured in frames.
 */
export const settleOn = (
  frame: number,
  cutFrame: number,
  fps: number,
  motion: Motion,
): SettleTransform => {
  void fps;
  const elapsed = frame - cutFrame;
  if (motion.settle === 0 || elapsed < 0) return {x: 0, y: 0, scale: 1};
  const env = Math.exp(-elapsed / SETTLE_TAU_FRAMES);
  const ring = Math.cos((2 * Math.PI * elapsed) / SETTLE_RING_FRAMES);
  const kick = motion.settle * env * ring;
  return {
    x: SETTLE_KICK_PX * kick,
    y: SETTLE_KICK_PX * 0.5 * kick,
    scale: 1 + SETTLE_SCALE_AMP * kick,
  };
};

/**
 * CSS transform for a parallax offset, or '' when the offset is exactly zero so
 * callers can skip the wrapper entirely and stay byte-identical to a flat render.
 */
export const offsetTransform = (o: Offset): string =>
  o.x === 0 && o.y === 0 ? '' : `translate(${o.x}px, ${o.y}px)`;

/**
 * CSS transform for a settle kicker, or '' at the identity {0, 0, 1} so callers
 * can skip the wrapper entirely and stay byte-identical to a hard cut.
 */
export const settleTransform = (s: SettleTransform): string =>
  s.x === 0 && s.y === 0 && s.scale === 1
    ? ''
    : `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
