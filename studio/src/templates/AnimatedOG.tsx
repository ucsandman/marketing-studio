import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {alphaHex, brandSchema, getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {getMark} from '../brands/marks';
import {FloatBar} from '../components/FloatBar';
import {BackgroundLoop} from '../components/BackgroundLoop';
import {FilmGrade} from '../components/FilmGrade';

export const animatedOgSchema = z.object({
  brandId: z.string(),
  tagline: z.string(),
  cta: z.string(),
  // Optional runnable command shown under the CTA (mono, verbatim, never
  // uppercased — a shell command is case sensitive, so uppercasing it would
  // print something that does not run). Absent for brands with no command,
  // which keeps their OG frame byte-identical. Mirrors EndCard's `command` prop.
  command: z.string().nullable().default(null),
  heroImage: z.string().nullable(),
  loopSequence: z.string().nullable(),
  loopFrames: z.number().int().positive(),
  showFloatBar: z.boolean().optional(),
  // Teaser lane (2026-09-01): a company with no registry entry supplies its brand
  // inline and a logo image stands in for a registered mark component. All three
  // default so every existing render stays byte-identical.
  brandOverride: brandSchema.nullable().default(null),
  logoImage: z.string().nullable().default(null),
  showName: z.boolean().default(true),
});

type Props = z.infer<typeof animatedOgSchema>;

export const AnimatedOG: React.FC<Props> = ({
  brandId,
  tagline,
  cta,
  command,
  heroImage,
  loopSequence,
  loopFrames,
  showFloatBar,
  brandOverride,
  logoImage,
  showName,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  // Parse the override here as well: CLI props do not pass through zod defaults.
  const brand = brandOverride ? brandSchema.parse(brandOverride) : getBrand(brandId);
  const fonts = loadBrandFonts(brand);
  const logo = logoImage ?? null;
  const nameShown = showName !== false;
  const Mark = logo ? null : getMark(brand.id);
  // `ctaStyle: 'block'` is a brand declaring that its accent is only ever a
  // filled block carrying ink text -- never accent-coloured type or a
  // coloured glyph (same contract EndCard/LogoReveal already read). Every
  // other brand defaults to 'text', so their OG frame stays byte-identical.
  const block = brand.ctaStyle === 'block';
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
          background: `radial-gradient(70% 60% at 50% 40%, ${brand.colors.brand}${alphaHex(brand.effects.wash)}, transparent 72%)`,
          opacity: glow,
        }}
      />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 18}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
          {logo ? (
            <Img
              src={staticFile(logo)}
              style={{
                height: nameShown ? 84 : 132,
                maxWidth: nameShown ? 320 : 640,
                objectFit: 'contain',
              }}
            />
          ) : Mark ? (
            <Mark size={84} color={block ? brand.colors.ink : brand.colors.brand} />
          ) : null}
          {nameShown ? (
            <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 88, color: brand.colors.ink}}>
              {brand.name}
            </div>
          ) : null}
        </div>
        <div style={{fontFamily: fonts.body, fontSize: 30, color: brand.colors.ink2}}>{tagline}</div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 22,
            letterSpacing: '0.22em',
            ...(block
              ? {backgroundColor: brand.colors.brand, color: brand.colors.ink, padding: '8px 20px'}
              : {color: brand.colors.profit}),
            marginTop: 6,
            maxWidth: '90%',
            textAlign: 'center',
          }}
        >
          {cta.toUpperCase()}
        </div>
        {command ? (
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 22,
              color: brand.colors.ink2,
              background: brand.colors.surface2,
              border: `1px solid ${brand.colors.line}`,
              borderRadius: 10,
              padding: '10px 20px',
              marginTop: 4,
            }}
          >
            {command}
          </div>
        ) : null}
      </AbsoluteFill>
      {showFloatBar !== false ? (
        <div style={{position: 'absolute', bottom: 36, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
          <FloatBar progress={barProgress} brand={brand} width={480} />
        </div>
      ) : null}
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
