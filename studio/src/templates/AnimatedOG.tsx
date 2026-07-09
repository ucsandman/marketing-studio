import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {getMark} from '../brands/marks';
import {FloatBar} from '../components/FloatBar';
import {BackgroundLoop} from '../components/BackgroundLoop';

export const animatedOgSchema = z.object({
  brandId: z.string(),
  tagline: z.string(),
  cta: z.string(),
  heroImage: z.string().nullable(),
  loopSequence: z.string().nullable(),
  loopFrames: z.number().int().positive(),
});

type Props = z.infer<typeof animatedOgSchema>;

export const AnimatedOG: React.FC<Props> = ({brandId, tagline, cta, heroImage, loopSequence, loopFrames}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadBrandFonts(brand);
  const Mark = getMark(brand.id);
  const cycle = frame / durationInFrames; // 0..1, and frame N == frame 0 on loop
  // triangular ping-pong: 0 -> 1 -> 0 across the loop, continuous at the seam
  const barProgress = cycle < 0.5 ? cycle * 2 : 2 - cycle * 2;
  // one full sine cycle: periodic glow breath
  const glow = 0.75 + 0.25 * Math.sin(2 * Math.PI * cycle);
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <BackgroundLoop dir={loopSequence} frameCount={loopFrames} brand={brand} opacity={0.6} />
      {heroImage ? (
        <Img
          src={staticFile(heroImage)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.35,
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 60% at 50% 40%, ${brand.colors.brand}30, transparent 72%)`,
          opacity: glow,
        }}
      />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 18}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
          <Mark size={84} color={brand.colors.brand} />
          <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 88, color: brand.colors.ink}}>
            {brand.name}
          </div>
        </div>
        <div style={{fontFamily: fonts.body, fontSize: 30, color: brand.colors.ink2}}>{tagline}</div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 22,
            letterSpacing: '0.22em',
            color: brand.colors.profit,
            marginTop: 6,
          }}
        >
          {cta.toUpperCase()}
        </div>
      </AbsoluteFill>
      <div style={{position: 'absolute', bottom: 36, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={barProgress} brand={brand} width={480} />
      </div>
    </AbsoluteFill>
  );
};
