import {useVideoConfig} from 'remotion';

// One picture-locked composition fans into several social aspect ratios by
// RESPONSIVE LAYOUT, not cropping. `formatFor` is the pure derivation every
// template reads (via the `useFormat` hook) to know how big to draw type, how
// far to inset pinned chrome, and whether to stack or lay out in a row.
//
// Design invariants (see layout.test.ts):
//   - At the picture-lock master size (1920x1080) scale === 1 and the safe
//     insets stay small enough that templates reproduce their old hardcoded
//     pixel values EXACTLY (the 16:9 regression guard).
//   - Portrait buckets reserve generous top/bottom safe area for platform
//     chrome (TikTok/Reels/Shorts caption + UI rails).

export type Aspect = '16:9' | '1:1' | '4:5' | '9:16';
export type Orientation = 'landscape' | 'square' | 'portrait';

export type SafeInsets = {top: number; right: number; bottom: number; left: number};

export type Format = {
  width: number;
  height: number;
  aspect: Aspect;
  orientation: Orientation;
  scale: number;
  safe: SafeInsets;
};

// Master (picture-lock) reference the `scale` factor is measured against.
const MASTER_WIDTH = 1920;
const MASTER_HEIGHT = 1080;

// Nearest-bucket table: each aspect's width/height ratio.
const ASPECT_RATIOS: Record<Aspect, number> = {
  '16:9': 16 / 9,
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
};

// Safe-area insets as a FRACTION of the relevant axis (top/bottom scale with
// height, left/right with width — the standard title/action-safe convention).
// Landscape is deliberately tight so the master 16:9 reproduces the templates'
// original pinned offsets; portrait reserves room for platform chrome.
const SAFE_FRACTIONS: Record<Aspect, SafeInsets> = {
  '16:9': {top: 0.05, right: 0.04, bottom: 0.03, left: 0.04},
  '1:1': {top: 0.08, right: 0.06, bottom: 0.1, left: 0.06},
  '4:5': {top: 0.09, right: 0.06, bottom: 0.13, left: 0.06},
  '9:16': {top: 0.1, right: 0.06, bottom: 0.15, left: 0.06},
};

const nearestAspect = (width: number, height: number): Aspect => {
  const ratio = width / height;
  let best: Aspect = '16:9';
  let bestDelta = Infinity;
  for (const aspect of Object.keys(ASPECT_RATIOS) as Aspect[]) {
    // Compare in log space so 2:1 and 1:2 are judged symmetrically.
    const delta = Math.abs(Math.log(ratio / ASPECT_RATIOS[aspect]));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = aspect;
    }
  }
  return best;
};

/**
 * Pure format derivation. Given raw pixel dimensions, returns the nearest
 * aspect bucket, orientation, master-relative scale, and pixel safe insets.
 * The `useFormat` hook is a thin wrapper reading `useVideoConfig`; keep the math
 * here so it stays unit-testable without a React tree.
 */
export const formatFor = (width: number, height: number): Format => {
  const aspect = nearestAspect(width, height);
  const orientation: Orientation =
    width > height ? 'landscape' : width < height ? 'portrait' : 'square';
  const scale = Math.min(width / MASTER_WIDTH, height / MASTER_HEIGHT);
  const frac = SAFE_FRACTIONS[aspect];
  const safe: SafeInsets = {
    top: Math.round(frac.top * height),
    right: Math.round(frac.right * width),
    bottom: Math.round(frac.bottom * height),
    left: Math.round(frac.left * width),
  };
  return {width, height, aspect, orientation, scale, safe};
};

/** React hook: derives the current composition's responsive format. */
/**
 * objectFit for a full-bleed 16:10 capture plate. Landscape and square frames keep
 * `cover` (every capture in the repo is 1440x900 / 1600x1000, so `contain` into a
 * 16:9 frame pillarboxes the plate); a portrait frame under `cover` keeps only a
 * ~32%-wide sliver that slices through on-screen text, so it gets `contain`.
 */
export const plateFit = (orientation: Orientation): 'cover' | 'contain' =>
  orientation === 'portrait' ? 'contain' : 'cover';

export const useFormat = (): Format => {
  const {width, height} = useVideoConfig();
  return formatFor(width, height);
};
