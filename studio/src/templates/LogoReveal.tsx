import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {NobanMark} from '../brands/NobanMark';
import {PngSequence} from '../components/PngSequence';

export const logoRevealSchema = z.object({
  brandId: z.string(),
  sequence: z.string().nullable(),
  frameCount: z.number().int().positive(),
  cta: z.string(),
});

type Props = z.infer<typeof logoRevealSchema>;

export const LogoReveal: React.FC<Props> = ({sequence, frameCount, cta}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const wordmarkIn = spring({frame: frame - 66, fps, config: {damping: 200}});
  const ctaIn = interpolate(frame, [96, 110], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(55% 45% at 50% 40%, ${brand.colors.brand}2a, transparent 70%)`,
        }}
      />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 28}}>
        <div style={{width: 520, height: 520, filter: `drop-shadow(0 0 42px ${brand.colors.brand}66)`}}>
          {sequence ? (
            <PngSequence
              dir={sequence}
              frameCount={frameCount}
              mode="clamp"
              style={{width: '100%', height: '100%', display: 'block'}}
            />
          ) : (
            <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', position: 'relative'}}>
              <NobanMark size={420} color={brand.colors.brand} />
            </AbsoluteFill>
          )}
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: 104,
            color: brand.colors.ink,
            opacity: wordmarkIn,
            transform: `translateY(${(1 - wordmarkIn) * 30}px)`,
          }}
        >
          {brand.name}
        </div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 32,
            letterSpacing: '0.22em',
            color: brand.colors.profit,
            opacity: ctaIn,
          }}
        >
          {cta.toUpperCase()}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
