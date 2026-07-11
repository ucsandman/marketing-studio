import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {alphaHex, type Brand} from '../lib/brand';
import {revealTiming} from '../lib/revealTiming';

// The "Connect" animated-mark treatment, ported from the operator-approved Claude
// Design doc ("Animated Logos.dc.html"): the S-stroke draws on BOTTOM-UP (reversed
// vs the static SynthaconMark, which draws top-down for a clean still), the source
// (bottom) terminal pops in first as the draw starts, and the destination (top)
// terminal "clicks into place" with a small overshoot as the cable connects. Plays
// ONCE and HOLDS — see lib/revealTiming.ts for the frame math and the loop-out
// omission rationale.
//
// This is a brand-scoped SET PIECE (like the per-brand Blender scenes), not the
// shared SynthaconMark, which stays contract-pure ({size, color}). Every color
// here is brand-derived (brand.colors.ink for the stroke + terminal rings,
// brand.colors.brand for the glow) EXCEPT the two inner-dot hexes below, which are
// literal identity colors traced to TWO sources: the product's own logo
// (apps/web/public/synthacon.svg, whose terminal dots are two distinct hues) and
// the design doc's Connect treatment.
const TOP_DOT = '#7755CC'; // destination-terminal (cx300,cy95) inner dot
const BOTTOM_DOT = '#7B8AE0'; // source-terminal (cx114,cy322) inner dot

const PATH_D = 'M114,322 L246,322 Q302,322 302,265 Q302,208 246,208 L168,208 Q112,208 112,152 Q112,95 168,95 L300,95';

export const SynthaconReveal: React.FC<{size: number; brand: Brand}> = ({size, brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {dashoffset, bottom, top} = revealTiming(frame, fps, brand.motion.tempo);
  const stroke = brand.colors.ink;
  // Design doc: `drop-shadow(0 0 7px rgba(160,144,220,0.6))`. brand.colors.brand for
  // synthacon is #a090dc == rgb(160,144,220), so this stays brand-driven (alphaHex,
  // the same helper LogoReveal/FilmGrade already use) rather than a hardcoded rgba.
  const glow = `${brand.colors.brand}${alphaHex(0.6)}`;

  return (
    <svg viewBox="0 0 400 400" width={size} height={size} fill="none" style={{filter: `drop-shadow(0 0 7px ${glow})`}}>
      <path
        d={PATH_D}
        stroke={stroke}
        strokeWidth={52}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        strokeDasharray={100}
        strokeDashoffset={dashoffset}
      />
      {/* BOTTOM terminal (source, cx114 cy322) — pops in first as the draw starts */}
      <g style={{transformOrigin: '114px 322px', transform: `scale(${bottom.scale})`, opacity: bottom.opacity}}>
        <circle cx={114} cy={322} r={37} fill={stroke} />
        <circle cx={114} cy={322} r={20} fill={BOTTOM_DOT} />
      </g>
      {/* TOP terminal (destination, cx300 cy95) — clicks into place as the cable connects */}
      <g style={{transformOrigin: '300px 95px', transform: `scale(${top.scale})`, opacity: top.opacity}}>
        <circle cx={300} cy={95} r={37} fill={stroke} />
        <circle cx={300} cy={95} r={20} fill={TOP_DOT} />
      </g>
    </svg>
  );
};
