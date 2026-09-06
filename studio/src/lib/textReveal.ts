import type {CSSProperties} from 'react';
import {brandSpring, staggerDelay} from './motion';
import type {Motion} from './motion';

// Per-brand kinetic-typography presets. Each preset maps its args -> a style
// fragment applied to ONE animated unit (a word, or a character for charStagger).
// Every preset rides the shared lib/motion helpers, so a brand's tempo/stagger/
// exuberance retune the reveal, and every preset is identity at rest (opacity 1,
// no residual transform/filter/clip) once the unit has settled.
//
// The 'spring' preset is the extracted legacy Headline word behavior verbatim, so a
// brand left on the default renders byte-identically to before this feature.

// Canonical preset list. brand.ts inlines the same four literals in its zod enum
// (kept in sync deliberately to avoid a brand -> textReveal -> motion import cycle).
export const TEXT_REVEALS = ['spring', 'maskWipe', 'blurIn', 'charStagger'] as const;
export type TextReveal = (typeof TEXT_REVEALS)[number];

// Above this many non-space characters, charStagger falls back to word units so a
// long headline does not spawn hundreds of independent springs per rendered frame.
export const CHAR_STAGGER_CAP = 60;

export type RevealFragment = Pick<CSSProperties, 'opacity' | 'transform' | 'filter' | 'clipPath'>;

export type RevealArgs = {
  frame: number;
  fps: number;
  motion: Motion;
  index: number;
  total: number;
  scale: number;
  // Word-locked cue: act-local frame this unit reveals on, overriding the stagger
  // cascade. Absent/null -> the exact legacy wordDelay math, so byte-identity holds.
  delayOverride?: number | null;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// Shared lead-in + per-unit stagger the legacy word reveal used: an 8-frame lead
// and a 4-frame gap scaled by the brand's stagger knob (lib/motion.staggerDelay).
const wordDelay = (index: number, motion: Motion): number => 8 + staggerDelay(index, 4, motion);

// EXACT legacy Headline word math. Do not "improve" — byte-identity depends on it.
const spring = ({frame, fps, motion, index, scale, delayOverride}: RevealArgs): RevealFragment => {
  const s = brandSpring(frame, fps, motion, {delayFrames: delayOverride ?? wordDelay(index, motion)});
  return {opacity: s, transform: `translateY(${(1 - s) * 40 * scale}px)`};
};

// Terse, mechanical: a hard left->right clip wipe carried by the brand's spring easing.
const maskWipe = ({frame, fps, motion, index, delayOverride}: RevealArgs): RevealFragment => {
  const s = clamp01(
    brandSpring(frame, fps, motion, {delayFrames: delayOverride ?? wordDelay(index, motion)}),
  );
  return {opacity: 1, transform: 'translateY(0px)', clipPath: `inset(0 ${(1 - s) * 100}% 0 0)`};
};

// Soft focus-pull: blur 8px -> 0 with a small rise, per word.
const blurIn = ({frame, fps, motion, index, scale, delayOverride}: RevealArgs): RevealFragment => {
  const s = brandSpring(frame, fps, motion, {delayFrames: delayOverride ?? wordDelay(index, motion)});
  const c = clamp01(s);
  return {opacity: c, filter: `blur(${(1 - c) * 8}px)`, transform: `translateY(${(1 - s) * 20 * scale}px)`};
};

// Confident sequenced cascade: per-character opacity + rise on a tighter (1.5-frame)
// gap so a whole headline's characters fan in within a hook act.
const charStagger = ({frame, fps, motion, index, scale, delayOverride}: RevealArgs): RevealFragment => {
  const s = brandSpring(frame, fps, motion, {
    delayFrames: delayOverride ?? 8 + staggerDelay(index, 1.5, motion),
  });
  return {opacity: clamp01(s), transform: `translateY(${(1 - s) * 28 * scale}px)`};
};

const presets: Record<TextReveal, (args: RevealArgs) => RevealFragment> = {
  spring,
  maskWipe,
  blurIn,
  charStagger,
};

/** Resolve one unit's style fragment for a brand's chosen reveal preset. */
export const revealFragment = (preset: TextReveal, args: RevealArgs): RevealFragment =>
  presets[preset](args);

/** Editorial line reveal: the baseline rises through a clean clipping mask. */
export const lineMaskFragment = (
  args: Omit<RevealArgs, 'total'> & {total?: number},
): RevealFragment => {
  const s = clamp01(
    brandSpring(args.frame, args.fps, args.motion, {
      delayFrames: args.delayOverride ?? 6 + staggerDelay(args.index, 3, args.motion),
    }),
  );
  return {
    opacity: 1,
    transform: `translateY(${(1 - s) * 34 * args.scale}px)`,
    clipPath: `inset(${(1 - s) * 100}% 0 0 0)`,
  };
};

/**
 * Whether Headline should split `text` into characters (charStagger under the cap)
 * or words (every other preset, or charStagger above the cap).
 */
export const revealUnit = (preset: TextReveal, text: string): 'word' | 'char' =>
  preset === 'charStagger' && text.replace(/\s/g, '').length <= CHAR_STAGGER_CAP ? 'char' : 'word';
