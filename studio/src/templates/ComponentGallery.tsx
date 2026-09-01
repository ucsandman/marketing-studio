import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {NobanMark} from '../brands/NobanMark';
import {FloatBar} from '../components/FloatBar';
import {DemoCursor} from '../components/DemoCursor';
import {Caption} from '../components/Caption';
import {CameraRig} from '../components/CameraRig';
import {StageCursor, controlPressScale} from '../components/StageCursor';
import {RackFocus} from '../components/RackFocus';
import {SpecularSweep} from '../components/SpecularSweep';

const GALLERY_CLICKS = [
  {type: 'click' as const, t: 600, x: 120, y: 60},
  {type: 'click' as const, t: 1800, x: 520, y: 120},
  {type: 'click' as const, t: 2600, x: 300, y: 40},
];

export const ComponentGallery: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts(brand);
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1]);
  const timeMs = (frame / fps) * 1000;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.bg,
        color: brand.colors.ink,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 40,
      }}
    >
      <NobanMark size={96} color={brand.colors.brand} />
      <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 72}}>
        {brand.name}
      </div>
      <div style={{fontFamily: fonts.body, fontSize: 32, color: brand.colors.ink2}}>
        {brand.tagline}
      </div>
      <div style={{fontFamily: fonts.mono, fontSize: 24, color: brand.colors.profit}}>
        +$12.40 net spread
      </div>
      <FloatBar progress={progress} brand={brand} width={800} />
      {/* demo strip: cursor roaming a mock panel + a caption */}
      <div
        style={{
          position: 'relative',
          width: 640,
          height: 160,
          borderRadius: 12,
          border: `1px solid ${brand.colors.line}`,
          background: brand.colors.surface,
        }}
      >
        {/* viewport = this strip's own box, so cursorAt's off-stage park lands just
            below it (the real DemoStage passes the capture's viewport). */}
        <DemoCursor clickList={GALLERY_CLICKS} timeMs={timeMs} brand={brand} viewport={{width: 640, height: 160}} />
      </div>
      {/* staged shot: two-node camera rig + stage cursor click stack + rack focus + one sweep beat */}
      <div
        style={{
          position: 'relative',
          width: 640,
          height: 200,
          borderRadius: 12,
          border: `1px solid ${brand.colors.line}`,
          background: brand.colors.surface,
          overflow: 'hidden',
        }}
      >
        <CameraRig
          turn={{fromY: -7.2, toY: -1.3, fromX: 2.1, toX: 0.5, perspective: 2600, len: 90}}
          dollyOrigin="81.25% 65%"
          dolly={[
            {at: 30, dur: 8, to: 1.1},
            {at: 58, dur: 8, to: 1},
          ]}
        >
          <RackFocus at={35} release={62}>
            <div
              style={{
                position: 'absolute',
                left: 40,
                top: 46,
                fontFamily: fonts.mono,
                fontSize: 40,
                fontVariantNumeric: 'tabular-nums',
                color: brand.colors.brand,
              }}
            >
              14 comps
            </div>
          </RackFocus>
          <div
            style={{
              position: 'absolute',
              left: 445,
              top: 106,
              width: 150,
              height: 48,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: fonts.body,
              fontSize: 22,
              fontWeight: 700,
              color: frame >= 45 ? brand.colors.bg : brand.colors.ink,
              background: frame >= 45 ? brand.colors.brand : 'transparent',
              border: `1.5px solid ${brand.colors.brand}`,
              transform: `scale(${controlPressScale(frame, 45)})`,
            }}
          >
            Render
          </div>
          <StageCursor
            path={[
              {x: 140, y: 70, at: 0},
              {x: 520, y: 130, at: 42},
            ]}
            clicks={[{at: 45}]}
            brand={brand}
            appearAt={8}
            exitAt={78}
          />
        </CameraRig>
        <SpecularSweep beats={[12]} />
      </div>
      <Caption label="Synthetic cursor and captions" brand={brand} enteredMsAgo={timeMs - 300} />
    </AbsoluteFill>
  );
};
