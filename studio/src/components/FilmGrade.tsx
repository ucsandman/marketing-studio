import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';

// Production-value overlay rendered LAST inside each template root: halation,
// animated film grain, radial vignette, source-aware bloom, chromatic aberration,
// optional letterbox. Every layer is intensity 0..1 and is skipped entirely at 0,
// so a zeroed grade costs nothing. Intensities are meant to stay RESTRAINED — see
// the grade defaults in lib/brand.ts and each brand's stated rules (paperroute:
// no green bloom). judge-motion enforces the grain ceiling.
//
// WHY GRAIN NEEDS NO TONAL MASK: a colorist's rule is that real film grain is
// dense in the midtones and thin in shadows and highlights, and the obvious
// reading is that the grain layer wants a luminance mask. It does not — the
// `overlay` blend function is already identity at both ends of the base
// (overlay(0,x) === 0 and overlay(1,x) === 1) and has maximum effect at 0.5. The
// midtone weighting is inherent to the blend mode this layer already uses.
// An added mask would double-apply a curve that is already correct.
export const FilmGrade: React.FC<{
  grade: Brand['grade'];
  accent: string; // retained for call-site compatibility; bloom keeps source hue
}> = ({grade, accent: _accent}) => {
  void _accent;
  const frame = useCurrentFrame();
  const {durationInFrames, fps, height} = useVideoConfig();
  const id = React.useId();
  const {grain, grainSize, halation, vignette, bloom, aberration, letterbox} = grade;

  // Resolution-normalised sizes. Both grain and halation are stated at 1080p and
  // scaled by frame height, so the SAME asset rendered at 1080p and 2160p reads
  // identically instead of growing a finer grain and a tighter bloom at 4K.
  // feTurbulence's baseFrequency is in user-space px, so a constant frequency
  // means a constant PIXEL feature size — i.e. a smaller fraction of a taller
  // frame. Scaling inversely with height holds the visual size still.
  const REF_HEIGHT = 1080;
  const grainFreq = (grainSize * REF_HEIGHT) / height;
  const halationBlur = (height / REF_HEIGHT) * 14;
  const bloomBlur = (height / REF_HEIGHT) * 30;

  // Grain reseeds at 12Hz, not per frame: per-frame noise defeats inter-frame
  // compression (measured 9MB -> 85MB in the product-launch-motion case study)
  // and reads as electronic sizzle rather than film grain.
  // Seamless-loop rule (PLAYBOOK) still holds: the tick count wraps with a period
  // spanning the whole composition, so seed(0) === seed(durationInFrames) and
  // AnimatedOG's loop seam stays clean.
  const tick = Math.floor((frame / fps) * 12);
  const period = Math.max(1, Math.round((durationInFrames / fps) * 12));
  const seed = tick % period;

  return (
    <>
      {/* (f) halation — the one layer that knows WHERE the highlights are.
          `bloom` below is a fixed radial gradient: it glows the same spot whatever
          the frame contains. Real film halation blooms around whatever is actually
          bright, because light scatters back off the film base. backdrop-filter
          samples the composited content underneath, so:
            blur      spreads the light
            contrast  acts as a soft highlight threshold — it crushes the darks to
                      near-black, and screen-blending near-black adds nothing, so
                      only genuinely bright regions bloom
            saturate  keeps the scattered light tinted by its source, not white
          This renders FIRST in the stack so it samples the raw comp, before the
          vignette darkens the edges it would otherwise read as dark content. */}
      {halation > 0 ? (
        <AbsoluteFill
          style={{
            backdropFilter: `blur(${halationBlur.toFixed(2)}px) brightness(${(1 + halation * 0.18).toFixed(3)}) contrast(${(1 + halation * 1.9).toFixed(3)}) saturate(${(1 + halation * 0.35).toFixed(3)})`,
            WebkitBackdropFilter: `blur(${halationBlur.toFixed(2)}px) brightness(${(1 + halation * 0.18).toFixed(3)}) contrast(${(1 + halation * 1.9).toFixed(3)}) saturate(${(1 + halation * 0.35).toFixed(3)})`,
            mixBlendMode: 'screen',
            opacity: halation * 0.5,
          }}
        />
      ) : null}

      {/* (c) bloom — a broad, low-energy highlight spread. Like halation it
          samples the frame, so a bright subject moves the bloom and a dark
          frame stays dark. Screen blend is identity at white, preserving peak
          highlights instead of painting a fixed accent wash over them. */}
      {bloom > 0 ? (
        <AbsoluteFill
          style={{
            backdropFilter: `blur(${bloomBlur.toFixed(2)}px) brightness(${(1 + bloom * 0.08).toFixed(3)}) contrast(${(1 + bloom * 1.25).toFixed(3)}) saturate(${(1 + bloom * 0.12).toFixed(3)})`,
            WebkitBackdropFilter: `blur(${bloomBlur.toFixed(2)}px) brightness(${(1 + bloom * 0.08).toFixed(3)}) contrast(${(1 + bloom * 1.25).toFixed(3)}) saturate(${(1 + bloom * 0.12).toFixed(3)})`,
            mixBlendMode: 'screen',
            opacity: bloom * 0.22,
          }}
        />
      ) : null}

      {/* (b) vignette — transparent center darkening to the edges */}
      {vignette > 0 ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,${vignette}) 100%)`,
          }}
        />
      ) : null}

      {/* (d) chromatic aberration — two RGB-offset edge fringes, extremely subtle */}
      {aberration > 0 ? (
        <>
          <AbsoluteFill
            style={{
              transform: 'translateX(1px)',
              background: `radial-gradient(ellipse at center, transparent 62%, rgba(255,0,0,${aberration}) 100%)`,
              mixBlendMode: 'screen',
            }}
          />
          <AbsoluteFill
            style={{
              transform: 'translateX(-1px)',
              background: `radial-gradient(ellipse at center, transparent 62%, rgba(0,128,255,${aberration}) 100%)`,
              mixBlendMode: 'screen',
            }}
          />
        </>
      ) : null}

      {/* (a) animated grain — feTurbulence noise, reseeded per frame, overlay-blended */}
      {grain > 0 ? (
        <AbsoluteFill style={{mixBlendMode: 'overlay', opacity: grain}}>
          <svg width="100%" height="100%" style={{position: 'absolute', inset: 0}}>
            <filter id={id}>
              <feTurbulence
                type="fractalNoise"
                baseFrequency={grainFreq}
                numOctaves={2}
                seed={seed}
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter={`url(#${id})`} />
          </svg>
        </AbsoluteFill>
      ) : null}

      {/* (e) letterbox — top/bottom bars, height a fraction of the frame, default off */}
      {letterbox > 0 ? (
        <>
          <div
            style={{position: 'absolute', top: 0, left: 0, right: 0, height: `${letterbox * 100}%`, backgroundColor: '#000'}}
          />
          <div
            style={{position: 'absolute', bottom: 0, left: 0, right: 0, height: `${letterbox * 100}%`, backgroundColor: '#000'}}
          />
        </>
      ) : null}
    </>
  );
};
