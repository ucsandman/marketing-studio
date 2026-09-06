import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile} from 'remotion';
import type {Brand} from '../lib/brand';
import type {Telemetry} from '../lib/telemetry';
import {clicks, focuses} from '../lib/telemetry';
import {cameraAt} from '../lib/camera';
import {DemoCursor} from './DemoCursor';
import {getMark} from '../brands/marks';

export const DemoStage: React.FC<{
  video: string | null;
  telemetry: Telemetry | null;
  timeMs: number;
  brand: Brand;
}> = ({video, telemetry, timeMs, brand}) => {
  const Mark = getMark(brand.id);
  const vp = telemetry?.viewport ?? {width: 1600, height: 1000};
  const cam = cameraAt(telemetry ? focuses(telemetry) : [], timeMs, vp, {scale: 'auto'});
  const clickList = telemetry ? clicks(telemetry) : [];
  return (
    <div
      style={{
        width: vp.width,
        height: vp.height,
        // `ctaStyle: 'block'` brands forbid radius and shadows on their plates (see
        // FeaturePanel); every other brand keeps the rounded, shadowed stage.
        borderRadius: brand.ctaStyle === 'block' ? 0 : 14,
        border: `1px solid ${brand.colors.line}`,
        background: brand.colors.surface,
        overflow: 'hidden',
        ...(brand.ctaStyle === 'block' ? null : {boxShadow: `0 40px 120px ${brand.colors.bg}`}),
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
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
            <Mark size={120} color={brand.colors.line} />
          </AbsoluteFill>
        )}
        {/* No clicks means nothing to point at (a CLI capture): rendering the
            cursor anyway parks it at the origin, in frame, forever. */}
        {clickList.length > 0 ? (
          <DemoCursor clickList={clickList} timeMs={timeMs} brand={brand} viewport={vp} />
        ) : null}
      </div>
    </div>
  );
};
