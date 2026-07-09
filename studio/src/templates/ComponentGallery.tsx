import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {NobanMark} from '../brands/NobanMark';
import {FloatBar} from '../components/FloatBar';
import {DemoCursor} from '../components/DemoCursor';
import {Caption} from '../components/Caption';

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
        <DemoCursor clickList={GALLERY_CLICKS} timeMs={timeMs} brand={brand} />
      </div>
      <Caption label="Synthetic cursor and captions" brand={brand} enteredMsAgo={timeMs - 300} />
    </AbsoluteFill>
  );
};
