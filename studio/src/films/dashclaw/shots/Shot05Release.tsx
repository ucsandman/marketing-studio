import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {entrance} from '../../../lib/motion';
import {OVERLAP, SHOTS} from '../timeline';
import {Plate, RACK, RACK_COMMAND, STRIP, Timestamp} from '../ui';

// Shot 5 "release" (film 660-817, 158 frames incl. the tail). The film's second
// half of THE HOLD. It opens on the identical frozen frame shot 3 left on screen
// — ui/Plate.tsx re-serves reach's plate frame 60 for the OVERLAP handover — so
// the cut at 660 is invisible and what the viewer sees is the world starting
// again, not a new shot. The light passes into the rack, the face pulses white
// once, and the camera rises up and back through the fog until the aisle is a
// line among many.
//
// The glyph and its rule are NOT re-animated here. They are already drawn: shot
// 3 left them settled on ui/rack.ts's coordinates, so this shot renders them at
// full strength on frame 0 and then lets the pulse consume them. Re-running an
// entrance would restage a beat the audience already watched land.
//
// THE PULSE IS THE PLATE'S, NOT THIS FILE'S (2026-09-03, measured). The rack
// face's own emissive strip and the agent light entering it take the face from
// a mean of 87 to 204 over plate frames 0-16, with real falloff, cast shadows
// and bloom — the spec's "the rack face pulses white once" is already on the
// picture. A 2D white radial on top of that fired six frames EARLY (its peak sat
// at plate frame 10, the plate's at 16), which read as two events rather than
// one; it was deleted rather than retimed, because a flat gradient can only
// degrade a rendered flash. If the beat ever needs a kicker, align its peak to
// local frame 24, not 18.

const FROM = SHOTS[4].from;
const SPEC_LEN = 150;

// The world starts moving on the frame the plate handover ends. Every beat in
// this shot hangs off that, so a change to OVERLAP moves them together.
const MOVES_AT = OVERLAP;

// The label clears AS the world resumes, not after it. It is drawn at fixed
// screen coordinates while the plate's camera is already rising, so every frame
// it survives past the resume is a frame it reads as a sticker on a moving
// picture; 12 frames is enough to register as released and short enough that
// the rack has barely moved under it.
const CLEAR_IN = MOVES_AT;
const CLEAR_DUR = 12;

export const Shot05Release: React.FC<{brand: Brand; len: number; plates: boolean}> = ({
  brand,
  plates,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const ease = {easing: Easing.out(Easing.cubic)} as const;

  // The command has been released, so the rack stops advertising it.
  const clear = entrance(frame, fps, brand.motion, {
    delayFrames: CLEAR_IN,
    durFrames: CLEAR_DUR,
    ...ease,
  });
  const label = 1 - clear;

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <Plate brand={brand} mono={fonts.mono} shot="release" available={plates} />

      <div style={{position: 'absolute', left: RACK.x, top: RACK.y, opacity: label}}>
        <div
          style={{
            fontFamily: fonts.mono,
            fontWeight: 500,
            fontSize: RACK.fontSize,
            letterSpacing: RACK.letterSpacing,
            lineHeight: 1,
            color: brand.colors.ink2,
          }}
        >
          {RACK_COMMAND}
        </div>
      </div>

      {/* Already drawn in shot 3, on the plate's own strip — rendered here at
          full length on frame 0 and cleared with the label, never re-drawn. */}
      <div
        style={{
          position: 'absolute',
          left: STRIP.x,
          top: STRIP.y - STRIP.thickness / 2,
          width: STRIP.length,
          height: STRIP.thickness,
          backgroundColor: brand.colors.brand,
          opacity: label,
          transform: `rotate(${STRIP.angleDeg}deg)`,
          transformOrigin: 'left center',
        }}
      />

      {/* clockSeconds() holds 03:12:14 until film frame 668 and resumes from
          there, so the clock restarts on the frame the world does. */}
      <Timestamp
        brand={brand}
        mono={fonts.mono}
        filmFrame={FROM + Math.min(frame, SPEC_LEN)}
      />
    </AbsoluteFill>
  );
};
