import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {entrance} from '../../../lib/motion';
import {SHOTS} from '../timeline';
import {Plate, RACK, RACK_COMMAND, REACH_FREEZE, Rule, STRIP, Timestamp} from '../ui';

// Shot 3 "reach" (film 330-457, 128 frames incl. the tail). The light stops at a
// rack whose face carries `deploy --prod`, accelerates toward it, and then the
// film's signature move fires: HOLD 1.
//
// THE HOLD is a stop, not a cut. At shot-local frame 60 — film frame 390 — the
// plate clamps (ui/Plate.tsx), the fog stops, the camera stops, and the clock
// stops dead at 03:12:14. The only thing that MOVES after the stop is the thin
// orange rule drawing under the command, which is the interface arriving: the
// world has frozen and something is now deciding. That single moving line is why
// the freeze reads as governance and not as a dropped frame.
//
// The glyph and its rule sit on ui/rack.ts's shared constants because shot 5
// opens on this exact frozen frame; two copies of these coordinates would show
// as a jump at film 660.

const FROM = SHOTS[2].from;
const GLYPH_IN = 18;

export const Shot03Reach: React.FC<{brand: Brand; len: number; plates: boolean}> = ({
  brand,
  plates,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);

  // The command surfaces as the light closes on it, well before the stop, so the
  // hold lands on something the viewer has already read.
  const glyph = entrance(frame, fps, brand.motion, {
    delayFrames: GLYPH_IN,
    durFrames: 16,
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <Plate brand={brand} mono={fonts.mono} shot="reach" available={plates} />

      <div style={{position: 'absolute', left: RACK.x, top: RACK.y}}>
        <div
          style={{
            fontFamily: fonts.mono,
            fontWeight: 500,
            fontSize: RACK.fontSize,
            letterSpacing: RACK.letterSpacing,
            lineHeight: 1,
            color: brand.colors.ink2,
            opacity: glyph,
            transform: `translateY(${((1 - glyph) * 6).toFixed(2)}px)`,
          }}
        >
          {RACK_COMMAND}
        </div>
      </div>

      {/* The one thing that moves after the world stops. It is laid on the
          plate's OWN emissive strip (ui/rack.ts STRIP, measured off the frozen
          frame) and rotated onto its fitted axis, so the hall carries one
          orange line at this rack rather than two: the world lights the strip
          on the hold frame, the interface draws its crisp core through it. */}
      <Rule
        brand={brand}
        delayFrames={REACH_FREEZE}
        durFrames={18}
        thickness={STRIP.thickness}
        color={brand.colors.brand}
        width={STRIP.length}
        style={{
          position: 'absolute',
          left: STRIP.x,
          top: STRIP.y - STRIP.thickness / 2,
          transform: `rotate(${STRIP.angleDeg}deg)`,
          transformOrigin: 'left center',
        }}
      />

      {/* Clamped at REACH_FREEZE: the clock is part of the world, so it stops
          when the world does and reads 03:12:14 for the rest of the shot. */}
      <Timestamp
        brand={brand}
        mono={fonts.mono}
        filmFrame={FROM + Math.min(frame, REACH_FREEZE)}
      />
    </AbsoluteFill>
  );
};
