import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {useFormat} from '../lib/layout';
import {brandSpring} from '../lib/motion';

/**
 * A mono label typeset in ink, then a FILLED accent block carrying ink text
 * snapping in beside it — the "measured" stamp of the Proof Sheet direction
 * (out/postflop/marketing/direction.md).
 *
 * The block is the only shape the accent is allowed to take for a `ctaStyle:
 * 'block'` brand: never coloured type, never an outline, never a glow. The label
 * settles first so the block reads as landing ON a statement that is already
 * printed, which is the whole point of the beat.
 */
export const MeasuredStamp: React.FC<{
  label: string;
  tag: string;
  brand: Brand;
  // Act-local frame the block lands on. The label settles LEAD frames earlier.
  at: number;
}> = ({label, tag, brand, at}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scale} = useFormat();
  const fonts = loadBrandFonts(brand);
  const LEAD = 18;
  const labelIn = brandSpring(frame, fps, brand.motion, {delayFrames: Math.max(0, at - LEAD)});
  const stampIn = brandSpring(frame, fps, brand.motion, {delayFrames: at});
  const size = Math.round(34 * scale);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: Math.round(22 * scale),
        fontFamily: fonts.mono,
        fontSize: size,
        letterSpacing: '0.08em',
      }}
    >
      <div
        style={{
          color: brand.colors.ink2,
          // Casing is presentation, so the label is stored in the props builder in
          // sentence case (the copy linter rejects an unallowlisted ALL-CAPS word)
          // and uppercased here, the same way Headline treats its kicker.
          textTransform: 'uppercase',
          opacity: labelIn,
          transform: `translateY(${(1 - labelIn) * 10}px)`,
        }}
      >
        {label}
      </div>
      <div
        style={{
          backgroundColor: brand.colors.brand,
          color: brand.colors.ink,
          padding: `${Math.round(9 * scale)}px ${Math.round(20 * scale)}px`,
          opacity: stampIn,
          // Lands from a hair under rest, within the repo's entry-scale band; the
          // left origin makes it read as stamped down beside the label, not zoomed.
          transform: `scale(${0.94 + 0.06 * stampIn})`,
          transformOrigin: 'left center',
        }}
      >
        {tag}
      </div>
    </div>
  );
};
