import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {SHOTS} from '../timeline';
import {Caption, Plate, Timestamp} from '../ui';

// Shot 2 "agent" (film 150-337, 188 frames incl. the tail). A single orange
// point of light enters from behind camera and travels down the aisle ahead of
// us, reflected on the floor; the camera follows at a distance. The light IS the
// agent — it is the only orange in the hall, and the plate owns it.
//
// One caption, once: `agent-7 · unattended`. It sits directly above the clock so
// the film's mono chrome lives in one corner instead of arriving somewhere new
// each shot, and it never leaves — nothing in this film fades out under its own
// power, because a shot that fades itself out hands the next one an empty frame.

const FROM = SHOTS[1].from;
const SPEC_LEN = 180;
const CAPTION_IN = 24;

export const Shot02Agent: React.FC<{brand: Brand; len: number; plates: boolean}> = ({
  brand,
  plates,
}) => {
  const frame = useCurrentFrame();
  const fonts = loadBrandFonts(brand);
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <Plate brand={brand} mono={fonts.mono} shot="agent" available={plates} />
      <Caption
        brand={brand}
        mono={fonts.mono}
        text="agent-7 · unattended"
        delayFrames={CAPTION_IN}
        durFrames={16}
        fontSize={28}
        letterSpacing={3}
        style={{position: 'absolute', left: 76, bottom: 122}}
      />
      <Timestamp
        brand={brand}
        mono={fonts.mono}
        filmFrame={FROM + Math.min(frame, SPEC_LEN)}
      />
    </AbsoluteFill>
  );
};
