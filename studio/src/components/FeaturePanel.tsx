import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';

export const FeaturePanel: React.FC<{
  screenshot: string | null;
  lines: string[];
  brand: Brand;
  zoom?: {from: number; to: number; origin: string};
}> = ({screenshot, lines, brand, zoom = {from: 1.5, to: 1.6, origin: '58% 30%'}}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const isPortrait = height > width;
  const fonts = loadBrandFonts(brand);
  const panelIn = spring({frame, fps, config: {damping: 200}});
  const zoomNow = interpolate(frame, [0, 170], [zoom.from, zoom.to]);
  return (
    <AbsoluteFill
      style={
        isPortrait
          ? {
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-start',
              padding: '220px 64px 64px',
              gap: 64,
            }
          : {flexDirection: 'row', alignItems: 'center', padding: 72, gap: 72}
      }
    >
      <div
        style={{
          flex: isPortrait ? 'none' : 1.4,
          width: isPortrait ? '100%' : undefined,
          aspectRatio: isPortrait ? '7/5' : undefined,
          borderRadius: 16,
          border: `1px solid ${brand.colors.line}`,
          background: brand.colors.surface,
          overflow: 'hidden',
          opacity: panelIn,
          transform: isPortrait
            ? `translateY(${(1 - panelIn) * 60}px) scale(${zoomNow})`
            : `translateY(${(1 - panelIn) * 60}px)`,
          boxShadow: `0 40px 120px ${brand.colors.bg}`,
        }}
      >
        {screenshot ? (
          <Img
            src={staticFile(screenshot)}
            style={
              isPortrait
                ? {width: '100%', height: '100%', objectFit: 'cover', objectPosition: zoom.origin, display: 'block'}
                : {width: '100%', display: 'block', transform: `scale(${zoomNow})`, transformOrigin: zoom.origin}
            }
          />
        ) : (
          <div style={{width: '100%', aspectRatio: isPortrait ? '7/5' : '16/10', background: brand.colors.surface2}} />
        )}
      </div>
      <div
        style={{
          flex: isPortrait ? 'none' : 1,
          width: isPortrait ? '100%' : undefined,
          display: 'flex',
          flexDirection: 'column',
          gap: isPortrait ? 48 : 40,
        }}
      >
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
              <div
                style={{
                  width: isPortrait ? 12 : 10,
                  height: isPortrait ? 12 : 10,
                  borderRadius: isPortrait ? 6 : 5,
                  background: brand.colors.brand,
                  marginTop: isPortrait ? 26 : 22,
                }}
              />
              <div
                style={{
                  fontFamily: fonts.body,
                  fontWeight: 600,
                  fontSize: isPortrait ? 46 : 40,
                  color: brand.colors.ink2,
                }}
              >
                {line}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
