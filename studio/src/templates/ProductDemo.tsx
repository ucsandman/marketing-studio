import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {alphaHex, getBrand} from '../lib/brand';
import {FloatBar} from '../components/FloatBar';
import {Caption} from '../components/Caption';
import {EndCard} from '../components/EndCard';
import {DemoStage} from '../components/DemoStage';
import {telemetrySchema, steps} from '../lib/telemetry';

export const productDemoSchema = z.object({
  brandId: z.string(),
  video: z.string().nullable(),
  cta: z.string(),
  telemetry: telemetrySchema.nullable(),
});

type Props = z.infer<typeof productDemoSchema>;

const STAGE_SCALE = 0.9; // 1600x1000 stage inside 1920x1080 with caption room

export const ProductDemo: React.FC<Props> = ({brandId, video, cta, telemetry}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const brand = getBrand(brandId);
  const timeMs = (frame / fps) * 1000;

  const stepList = telemetry ? steps(telemetry) : [];
  const activeStep = [...stepList].reverse().find((s) => s.t <= timeMs);
  const bodyFrames = telemetry
    ? Math.ceil((telemetry.durationMs / 1000) * fps)
    : durationInFrames - 60;

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 55% at 50% 32%, ${brand.colors.brand}${alphaHex(brand.effects.wash)}, transparent 72%)`,
        }}
      />
      <Sequence durationInFrames={bodyFrames}>
        {/* stage: viewport-sized panel, scaled to fit with caption room */}
        <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
          <div style={{transform: `scale(${STAGE_SCALE}) translateY(-28px)`}}>
            <DemoStage video={video} telemetry={telemetry} timeMs={timeMs} brand={brand} />
          </div>
          {activeStep ? (
            <div style={{position: 'absolute', bottom: 108}}>
              <Caption
                label={activeStep.label}
                brand={brand}
                enteredMsAgo={timeMs - activeStep.t}
              />
            </div>
          ) : null}
        </AbsoluteFill>
      </Sequence>
      <Sequence from={bodyFrames}>
        <EndCard cta={cta} brand={brand} />
      </Sequence>
      <div style={{position: 'absolute', bottom: 40, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={frame / (durationInFrames - 1)} brand={brand} width={640} />
      </div>
    </AbsoluteFill>
  );
};
