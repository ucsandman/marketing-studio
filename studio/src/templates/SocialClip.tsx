import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {FloatBar} from '../components/FloatBar';
import {EndCard} from '../components/EndCard';
import {Headline} from '../components/Headline';
import {FeaturePanel} from '../components/FeaturePanel';

export const socialClipSchema = z.object({
  brandId: z.string(),
  kicker: z.string(),
  headline: z.string(),
  lines: z.array(z.string()).min(1).max(4),
  screenshot: z.string().nullable(),
  cta: z.string(),
});

type Props = z.infer<typeof socialClipSchema>;

export const SocialClip: React.FC<Props> = ({brandId, kicker, headline, lines, screenshot, cta}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const brand = getBrand(brandId);
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
          <Headline kicker={kicker} headline={headline} brand={brand} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={78} durationInFrames={162}>
        <AbsoluteFill style={{opacity: fadeAt(78, 240)}}>
          <FeaturePanel screenshot={screenshot} lines={lines} brand={brand} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={228}>
        <EndCard cta={cta} brand={brand} />
      </Sequence>
      {/* progress float bar, pinned bottom */}
      <div style={{position: 'absolute', bottom: 48, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={frame / (durationInFrames - 1)} brand={brand} width={640} />
      </div>
    </AbsoluteFill>
  );
};
