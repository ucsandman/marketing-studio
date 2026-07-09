import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {NobanMark} from '../brands/NobanMark';
import {FloatBar} from '../components/FloatBar';
import {DemoCursor} from '../components/DemoCursor';
import {Caption} from '../components/Caption';
import {EndCard} from '../components/EndCard';
import {telemetrySchema, clicks, steps, focuses} from '../lib/telemetry';
import {cameraAt} from '../lib/camera';

export const productDemoSchema = z.object({
  brandId: z.string(),
  video: z.string().nullable(),
  cta: z.string(),
  telemetry: telemetrySchema.nullable(),
});

type Props = z.infer<typeof productDemoSchema>;

const STAGE_SCALE = 0.9; // 1600x1000 stage inside 1920x1080 with caption room

export const ProductDemo: React.FC<Props> = ({video, cta, telemetry}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const brand = getBrand('noban');
  const timeMs = (frame / fps) * 1000;

  const clickList = telemetry ? clicks(telemetry) : [];
  const stepList = telemetry ? steps(telemetry) : [];
  const activeStep = [...stepList].reverse().find((s) => s.t <= timeMs);
  const vp = telemetry?.viewport ?? {width: 1600, height: 1000};
  const cam = cameraAt(telemetry ? focuses(telemetry) : [], timeMs, vp);
  const bodyFrames = telemetry
    ? Math.ceil((telemetry.durationMs / 1000) * fps)
    : durationInFrames - 60;

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 55% at 50% 32%, ${brand.colors.brand}30, transparent 72%)`,
        }}
      />
      <Sequence durationInFrames={bodyFrames}>
        {/* stage: viewport-sized panel, scaled to fit with caption room */}
        <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
          <div
            style={{
              width: vp.width,
              height: vp.height,
              transform: `scale(${STAGE_SCALE}) translateY(-28px)`,
              borderRadius: 14,
              border: `1px solid ${brand.colors.line}`,
              background: brand.colors.surface,
              overflow: 'hidden',
              boxShadow: `0 40px 120px ${brand.colors.bg}`,
              position: 'relative',
            }}
          >
            {/* camera: zooms video and cursor together */}
            <div
              style={{
                width: '100%',
                height: '100%',
                // scale about the stage center, then shift so the camera's
                // focus center (originX/Y, clamped in camera.ts) sits centered
                transform: `scale(${cam.scale}) translate(${vp.width / 2 - cam.originX}px, ${vp.height / 2 - cam.originY}px)`,
                position: 'relative',
              }}
            >
              {video ? (
                <OffthreadVideo
                  src={staticFile(video)}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    filter: 'brightness(1.12) contrast(1.03)',
                  }}
                  muted
                />
              ) : (
                <AbsoluteFill
                  style={{background: brand.colors.surface2, justifyContent: 'center', alignItems: 'center'}}
                >
                  <NobanMark size={120} color={brand.colors.line} />
                </AbsoluteFill>
              )}
              {telemetry ? (
                <DemoCursor clickList={clickList} timeMs={timeMs} brand={brand} />
              ) : null}
            </div>
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
        <EndCard cta={cta} />
      </Sequence>
      <div style={{position: 'absolute', bottom: 40, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={frame / (durationInFrames - 1)} brand={brand} width={640} />
      </div>
    </AbsoluteFill>
  );
};
