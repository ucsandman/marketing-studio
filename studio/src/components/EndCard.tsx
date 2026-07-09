import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {getMark} from '../brands/marks';

export const EndCard: React.FC<{cta: string; brand: Brand}> = ({cta, brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const s = spring({frame, fps, config: {damping: 200}});
  const Mark = getMark(brand.id);
  return (
    <AbsoluteFill
      style={{justifyContent: 'center', alignItems: 'center', gap: 32, opacity: s, transform: `scale(${0.96 + s * 0.04})`}}
    >
      <Mark size={110} color={brand.colors.brand} />
      <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 96, color: brand.colors.ink}}>
        {brand.name}
      </div>
      <div style={{fontFamily: fonts.mono, fontSize: 34, letterSpacing: '0.2em', color: brand.colors.profit}}>
        {cta.toUpperCase()}
      </div>
    </AbsoluteFill>
  );
};
