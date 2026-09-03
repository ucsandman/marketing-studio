import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {SHOTS} from '../timeline';
import {Plate, Timestamp} from '../ui';

// Shot 1 "hall" (film 0-157, 158 frames incl. the 8-frame tail). A slow dolly
// down a dark aisle of racks: white slit lights, fog, floor reflections. The
// plate carries all of it.
//
// The ONLY thing this film adds to its first shot is a clock. The spec's line is
// "Nothing else on screen", and that is the whole point of the opening — there
// is no product yet, no claim, no type, just a machine room at three in the
// morning and the time. Everything the film later argues for is earned against
// this emptiness, so nothing may be added here.

const FROM = SHOTS[0].from;
/** The plate's own length; frames past it are the handover tail and hold. */
const SPEC_LEN = 150;

export const Shot01Hall: React.FC<{brand: Brand; len: number; plates: boolean}> = ({
  brand,
  plates,
}) => {
  const frame = useCurrentFrame();
  const fonts = loadBrandFonts(brand);
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <Plate brand={brand} mono={fonts.mono} shot="hall" available={plates} />
      {/* Clamped to SPEC_LEN so the clock stops ticking through the tail and the
          shot hands a genuinely static picture to shot 2's wipe. */}
      <Timestamp
        brand={brand}
        mono={fonts.mono}
        filmFrame={FROM + Math.min(frame, SPEC_LEN)}
      />
    </AbsoluteFill>
  );
};
