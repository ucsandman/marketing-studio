import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {NobanMark} from '../brands/NobanMark';
import {FloatBar} from '../components/FloatBar';

export const socialClipSchema = z.object({
  brandId: z.string(),
  kicker: z.string(),
  headline: z.string(),
  lines: z.array(z.string()).min(1).max(4),
  screenshot: z.string().nullable(),
  cta: z.string(),
});

type Props = z.infer<typeof socialClipSchema>;

const easeOutExpo = Easing.out(Easing.exp);

const Headline: React.FC<{kicker: string; headline: string}> = ({kicker, headline}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
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

const Feature: React.FC<{screenshot: string | null; lines: string[]}> = ({screenshot, lines}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const panelIn = spring({frame, fps, config: {damping: 200}});
  const zoom = interpolate(frame, [0, 170], [1.5, 1.6]);
  return (
    <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', padding: 72, gap: 72}}>
      <div
        style={{
          flex: 1.4,
          borderRadius: 16,
          border: `1px solid ${brand.colors.line}`,
          background: brand.colors.surface,
          overflow: 'hidden',
          opacity: panelIn,
          transform: `translateY(${(1 - panelIn) * 60}px)`,
          boxShadow: `0 40px 120px ${brand.colors.bg}`,
        }}
      >
        {screenshot ? (
          <Img
            src={staticFile(screenshot)}
            style={{width: '100%', display: 'block', transform: `scale(${zoom})`, transformOrigin: '58% 30%'}}
          />
        ) : (
          <div style={{width: '100%', aspectRatio: '16/10', background: brand.colors.surface2}} />
        )}
      </div>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 40}}>
        {lines.map((line, i) => {
          const s = spring({frame: frame - 15 - i * 10, fps, config: {damping: 200}});
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 20,
                opacity: s,
                transform: `translateX(${(1 - s) * 40}px)`,
              }}
            >
              <div style={{width: 10, height: 10, borderRadius: 5, background: brand.colors.brand, marginTop: 22}} />
              <div style={{fontFamily: fonts.body, fontWeight: 600, fontSize: 40, color: brand.colors.ink2}}>
                {line}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{cta: string}> = ({cta}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const s = spring({frame, fps, config: {damping: 200}});
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        gap: 32,
        opacity: s,
        transform: `scale(${0.96 + s * 0.04})`,
      }}
    >
      <NobanMark size={110} color={brand.colors.brand} />
      <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 96, color: brand.colors.ink}}>
        {brand.name}
      </div>
      <div style={{fontFamily: fonts.mono, fontSize: 34, letterSpacing: '0.2em', color: brand.colors.profit}}>
        {cta.toUpperCase()}
      </div>
    </AbsoluteFill>
  );
};

export const SocialClip: React.FC<Props> = ({kicker, headline, lines, screenshot, cta}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const brand = getBrand('noban');
  const fadeAt = (start: number, end: number) =>
    interpolate(frame, [start, start + 12, end - 12, end], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {/* violet glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 50% at 50% 35%, ${brand.colors.brand}22, transparent 70%)`,
        }}
      />
      <Sequence durationInFrames={90}>
        <AbsoluteFill style={{opacity: fadeAt(0, 90)}}>
          <Headline kicker={kicker} headline={headline} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={78} durationInFrames={162}>
        <AbsoluteFill style={{opacity: fadeAt(78, 240)}}>
          <Feature screenshot={screenshot} lines={lines} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={228}>
        <EndCard cta={cta} />
      </Sequence>
      {/* progress float bar, pinned bottom */}
      <div style={{position: 'absolute', bottom: 48, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={frame / (durationInFrames - 1)} brand={brand} width={640} />
      </div>
    </AbsoluteFill>
  );
};
