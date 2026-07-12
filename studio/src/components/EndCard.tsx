import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {markColorOf, type Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {brandSpring} from '../lib/motion';
import {getMark} from '../brands/marks';
import {getReveal} from '../brands/reveals';

// When a brand has a registered vector reveal (synthacon), EndCard plays its
// ONCE-mode draw-on instead of the static Mark. EndCard's tightest caller
// window is ProductDemo's fixed 60-frame/2s tail (ProductDemo.tsx: no
// telemetry -> durationInFrames - 60, and WITH telemetry the calculateMetadata
// override in Root.tsx keeps that same 60-frame tail). revealTiming's top
// terminal settles (draw+terminals fully done) at t=0.58 of its 2.8s base
// window == 48.72 frames at tempo 1. Requiring >=0.6s (18 frames) of held
// lockup after that leaves a 42-frame draw+settle budget:
//   48.72 / REVEAL_TEMPO_MULTIPLIER <= 60 - 18  =>  REVEAL_TEMPO_MULTIPLIER >= 1.16
// 1.2 clears that with ~0.65s of hold in the tightest window (ProductDemo) and
// comfortably more in SocialClip's 72-frame and LaunchVideo's 150-frame tails.
const REVEAL_TEMPO_MULTIPLIER = 1.2;

export const EndCard: React.FC<{cta: string; brand: Brand}> = ({cta, brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const s = brandSpring(frame, fps, brand.motion);
  const Mark = getMark(brand.id);
  const Reveal = getReveal(brand.id);
  const revealBrand: Brand = Reveal
    ? {...brand, motion: {...brand.motion, tempo: brand.motion.tempo * REVEAL_TEMPO_MULTIPLIER}}
    : brand;
  return (
    <AbsoluteFill
      style={{justifyContent: 'center', alignItems: 'center', gap: 32, opacity: s, transform: `scale(${0.96 + s * 0.04})`}}
    >
      {Reveal ? <Reveal size={110} brand={revealBrand} /> : <Mark size={110} color={markColorOf(brand)} />}
      <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 96, color: brand.colors.ink}}>
        {brand.name}
      </div>
      <div style={{fontFamily: fonts.mono, fontSize: 34, letterSpacing: '0.2em', color: brand.colors.profit}}>
        {cta.toUpperCase()}
      </div>
    </AbsoluteFill>
  );
};
