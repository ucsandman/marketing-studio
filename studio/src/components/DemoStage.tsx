import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile} from 'remotion';
import {getBrand} from '../lib/brand';
import type {Telemetry} from '../lib/telemetry';
import {clicks, focuses} from '../lib/telemetry';
import {cameraAt} from '../lib/camera';
import {DemoCursor} from './DemoCursor';
import {NobanMark} from '../brands/NobanMark';

export const DemoStage: React.FC<{
  video: string | null;
  telemetry: Telemetry | null;
  timeMs: number;
}> = ({video, telemetry, timeMs}) => {
  const brand = getBrand('noban');
  const vp = telemetry?.viewport ?? {width: 1600, height: 1000};
  const cam = cameraAt(telemetry ? focuses(telemetry) : [], timeMs, vp);
  const clickList = telemetry ? clicks(telemetry) : [];
  return (
    <div
      style={{
        width: vp.width,
        height: vp.height,
        borderRadius: 14,
        border: `1px solid ${brand.colors.line}`,
        background: brand.colors.surface,
        overflow: 'hidden',
        boxShadow: `0 40px 120px ${brand.colors.bg}`,
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
            <NobanMark size={120} color={brand.colors.line} />
          </AbsoluteFill>
        )}
        {telemetry ? <DemoCursor clickList={clickList} timeMs={timeMs} brand={brand} /> : null}
      </div>
    </div>
  );
};
