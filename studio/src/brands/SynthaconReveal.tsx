import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {alphaHex, type Brand} from '../lib/brand';
import {revealLoopTiming, revealTiming} from '../lib/revealTiming';

// The "Connect" animated-mark treatment, ported from the operator-approved Claude
// Design doc ("Animated Logos.dc.html"): the S-stroke draws on BOTTOM-UP (reversed
// vs the static SynthaconMark, which draws top-down for a clean still), the source
// (bottom) terminal pops in first as the draw starts, and the destination (top)
// terminal "clicks into place" with a small overshoot as the cable connects. Plays
// ONCE and HOLDS by default (LogoReveal, EndCard). Pass `loop` for embeds
// (AnimatedOG) to additionally apply the design doc's grpFade loop-out (the whole
// group fades 84-95%, holds 0, then restarts) — see lib/revealTiming.ts for both
// frame-math variants.
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

export const SynthaconReveal: React.FC<{size: number; brand: Brand; loop?: boolean}> = ({size, brand, loop}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {dashoffset, bottom, top, groupOpacity} = loop
    ? revealLoopTiming(frame, fps, brand.motion.tempo)
    : {...revealTiming(frame, fps, brand.motion.tempo), groupOpacity: 1};
  const stroke = brand.colors.ink;
  // Brand-driven per the PLAYBOOK's "Brand-driven effects" convention (glow is
  // brand.effects.glow, alphaHex the same helper LogoReveal/FilmGrade use) — NOT
  // the design doc's hardcoded `drop-shadow(0 0 7px rgba(160,144,220,.6))`. At
  // glow 0 (synthacon: no glow anywhere) there is NO filter at all, not a
  // drop-shadow with 0 alpha.
  const glowAlpha = brand.effects.glow;
  const filter = glowAlpha > 0 ? `drop-shadow(0 0 7px ${brand.colors.brand}${alphaHex(glowAlpha)})` : undefined;

  const content = (
    <>
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
    </>
  );

  return (
    <svg viewBox="0 0 400 400" width={size} height={size} fill="none" style={{filter}}>
      {loop ? <g style={{opacity: groupOpacity}}>{content}</g> : content}
    </svg>
  );
};
