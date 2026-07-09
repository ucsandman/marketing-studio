import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';

const easeOutExpo = Easing.out(Easing.exp);

export const Headline: React.FC<{kicker: string; headline: string; brand: Brand}> = ({kicker, headline, brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts();
  const words = headline.split(' ');
  const kickerIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: 'clamp',
    easing: easeOutExpo,
  });
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 36}}>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 30,
          letterSpacing: '0.35em',
          color: brand.colors.brand,
          opacity: kickerIn,
        }}
      >
        {kicker.toUpperCase()}
      </div>
      <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 28px', maxWidth: 1500}}>
        {words.map((w, i) => {
          const s = spring({frame: frame - 8 - i * 4, fps, config: {damping: 200}});
          return (
            <span
              key={i}
              style={{
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: 120,
                lineHeight: 1.08,
                color: brand.colors.ink,
                opacity: s,
                transform: `translateY(${(1 - s) * 40}px)`,
                display: 'inline-block',
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
