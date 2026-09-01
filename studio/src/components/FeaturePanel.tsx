import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {brandSpring, staggerDelay} from '../lib/motion';

export const FeaturePanel: React.FC<{
  screenshot: string | null;
  lines: string[];
  brand: Brand;
  zoom?: {from: number; to: number; origin: string};
  portraitScreenshot?: string;
  // Act-local reveal frame per benefit line (lib/wordCues.alignPhraseCues). Absent,
  // or a null entry, keeps the 15 + stagger(i,10) cascade -> byte-identical.
  cueFrames?: (number | null)[];
}> = ({
  screenshot,
  lines,
  brand,
  zoom = {from: 1.5, to: 1.6, origin: '58% 30%'},
  portraitScreenshot,
  cueFrames,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const isPortrait = height > width;
  // `ctaStyle: 'block'` is a brand declaring its accent is only ever a filled block
  // carrying ink text (see EndCard). For such a brand the bullet marker cannot be an
  // accent-coloured dot, and on a paper ground a small dot in a bright accent is also
  // near-invisible; it becomes a square ink marker, and the plate loses its radius
  // and drop shadow, which those brands forbid too. Defaults to 'text', so every
  // other brand's panel is byte-identical.
  const block = brand.ctaStyle === 'block';
  const fonts = loadBrandFonts(brand);
  const panelIn = brandSpring(frame, fps, brand.motion);
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
          borderRadius: block ? 0 : 16,
          border: `1px solid ${brand.colors.line}`,
          background: brand.colors.surface,
          overflow: 'hidden',
          opacity: panelIn,
          transform: isPortrait
            ? `translateY(${(1 - panelIn) * 60}px) scale(${zoomNow})`
            : `translateY(${(1 - panelIn) * 60}px)`,
          ...(block ? null : {boxShadow: `0 40px 120px ${brand.colors.bg}`}),
        }}
      >
        {screenshot ? (
          <Img
            src={staticFile(isPortrait ? (portraitScreenshot ?? screenshot) : screenshot)}
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
          const s = brandSpring(frame, fps, brand.motion, {
            delayFrames: cueFrames?.[i] ?? 15 + staggerDelay(i, 10, brand.motion),
          });
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
                  borderRadius: block ? 0 : isPortrait ? 6 : 5,
                  background: block ? brand.colors.ink : brand.colors.brand,
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
