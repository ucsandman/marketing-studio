import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {alphaHex, getBrand, motionOverrideSchema} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {brandSpring, entrance} from '../lib/motion';
import {getMark} from '../brands/marks';
import {getReveal} from '../brands/reveals';
import {PngSequence} from '../components/PngSequence';
import {FilmGrade} from '../components/FilmGrade';

export const logoRevealSchema = z.object({
  brandId: z.string(),
  sequence: z.string().nullable(),
  frameCount: z.number().int().positive(),
  cta: z.string(),
  // Optional per-render motion-knob override (scripts/render-variants.mjs hero
  // takes). Nullable, defaults null, so a normal render/smoke is byte-identical to
  // the brand's own motion — same nullable-override pattern LaunchVideo's
  // formatWidth/formatHeight use.
  motionOverride: motionOverrideSchema.nullable().default(null),
});

type Props = z.infer<typeof logoRevealSchema>;

export const LogoReveal: React.FC<Props> = ({brandId, sequence, frameCount, cta, motionOverride}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const motion = motionOverride ? {...brand.motion, ...motionOverride} : brand.motion;
  const fonts = loadBrandFonts(brand);
  const Mark = getMark(brand.id);
  const Reveal = getReveal(brand.id);
  const wordmarkIn = brandSpring(frame, fps, motion, {delayFrames: 66});
  const ctaIn = entrance(frame, fps, motion, {delayFrames: 96, durFrames: 14});
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(55% 45% at 50% 40%, ${brand.colors.brand}${alphaHex(brand.effects.wash)}, transparent 70%)`,
        }}
      />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 28}}>
        <div style={{width: 520, height: 520, filter: `drop-shadow(0 0 42px ${brand.colors.brand}${alphaHex(brand.effects.glow)})`}}>
          {Reveal ? (
            <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', position: 'relative'}}>
              <Reveal size={420} brand={brand} />
            </AbsoluteFill>
          ) : sequence ? (
            <PngSequence
              dir={sequence}
              frameCount={frameCount}
              mode="clamp"
              style={{width: '100%', height: '100%', display: 'block'}}
            />
          ) : (
            <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', position: 'relative'}}>
              <Mark size={420} color={brand.colors.brand} />
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
            color: brand.colors.brand,
            opacity: ctaIn,
          }}
        >
          {cta.toUpperCase()}
        </div>
      </AbsoluteFill>
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
