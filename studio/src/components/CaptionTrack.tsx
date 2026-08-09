import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import type {Brand} from '../lib/brand';
import {alphaHex} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {useFormat} from '../lib/layout';
import type {Cue} from '../lib/captionTiming';
import {cueAt, splitDisplayLines} from '../lib/captionTiming';

const FADE = 6; // frames of fade in/out at each cue edge

// Brand-safe burned-in caption (lower third). Renders the active cue inside the
// format's safe insets, bottom-anchored above safe.bottom and clear of the pinned
// progress bar. No active cue -> renders nothing.
export const CaptionTrack: React.FC<{cues: Cue[]; brand: Brand}> = ({cues, brand}) => {
  const frame = useCurrentFrame();
  const {scale, safe} = useFormat();
  const cue = cueAt(cues, frame);
  if (!cue) return null;

  // A cue this short (e.g. a spoken line clamped hard against a clip's end)
  // can leave < 2*FADE frames between its edges, which would make the two
  // interior breakpoints collide or invert — Remotion's interpolate requires
  // a strictly increasing inputRange. Shrink the fade to fit; below 2 frames
  // there is no room for a ramp at all, so hold full opacity for the cue.
  const cueLen = cue.toFrame - cue.fromFrame;
  const fadeFrames = Math.max(0, Math.min(FADE, Math.ceil(cueLen / 2) - 1));
  const fade =
    fadeFrames > 0
      ? interpolate(
          frame,
          [cue.fromFrame, cue.fromFrame + fadeFrames, cue.toFrame - fadeFrames, cue.toFrame],
          [0, 1, 1, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
        )
      : 1;

  const fonts = loadBrandFonts(brand);
  const lines = splitDisplayLines(cue.text);
  const fontSize = Math.round(52 * scale);

  return (
    <div
      style={{
        position: 'absolute',
        left: safe.left,
        right: safe.right,
        // sit above the pinned FloatBar (which floors at safe.bottom)
        bottom: safe.bottom + Math.round(80 * scale),
        display: 'flex',
        justifyContent: 'center',
        opacity: fade,
      }}
    >
      <div
        style={{
          maxWidth: '100%',
          padding: `${Math.round(20 * scale)}px ${Math.round(38 * scale)}px`,
          borderRadius: Math.round(14 * scale),
          background: `${brand.colors.surface}${alphaHex(0.85)}`,
          border: `1px solid ${brand.colors.line}`,
          textAlign: 'center',
        }}
      >
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              fontFamily: fonts.body,
              fontWeight: 600,
              fontSize,
              lineHeight: 1.25,
              color: brand.colors.ink,
            }}
          >
            {l}
          </div>
        ))}
      </div>
    </div>
  );
};
