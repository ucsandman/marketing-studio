import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {brandSpring, entryScale} from '../../../lib/motion';

// The brand's signature: a filled yellow block carrying ink mono text. It is the
// ONLY place #ffe000 is allowed to appear. It snaps in on the brand spring and
// drops the last couple of pixels into place, weighted by brand.motion.settle.
//
// It never fades. #ffe000 at partial opacity — over bone paper or over the dark
// panel — is a yellow wash, which brands/postflop.json's voice forbids outright.
// The reveal is brand.motion.textReveal = 'maskWipe': a left-to-right inset clip
// on the same spring, so the block is either full strength or not yet there.

export type StampProps = {
  brand: Brand;
  mono: string;
  text: string;
  delayFrames?: number;
  fontSize?: number;
  /** Horizontal/vertical block padding around the text. */
  padding?: string;
  style?: React.CSSProperties;
};

export const Stamp: React.FC<StampProps> = ({
  brand,
  mono,
  text,
  delayFrames = 0,
  fontSize = 26,
  padding = '6px 14px',
  style,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = brandSpring(frame, fps, brand.motion, {delayFrames});
  // settle: the block arrives a few px high and drops onto its rest position.
  const drop = -10 * brand.motion.settle * (1 - p);
  return (
    <span
      style={{
        display: 'inline-block',
        // hugs its text even when dropped straight into a stretching flex column
        alignSelf: 'flex-start',
        backgroundColor: brand.colors.brand,
        color: brand.colors.ink,
        fontFamily: mono,
        fontWeight: 700,
        fontSize,
        letterSpacing: 1.4,
        padding,
        clipPath: `inset(0% ${((1 - p) * 100).toFixed(2)}% 0% 0%)`,
        transform: `translateY(${drop.toFixed(2)}px) scale(${entryScale(p, brand.motion).toFixed(4)})`,
        transformOrigin: 'left center',
        ...style,
      }}
    >
      {text}
    </span>
  );
};
