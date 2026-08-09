import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {alphaHex} from '../lib/brand';

// Production-value overlay rendered LAST inside each template root: animated film
// grain, radial vignette, accent bloom, chromatic aberration, optional letterbox.
// Every layer is intensity 0..1 and is skipped entirely at 0, so a zeroed grade
// costs nothing. Intensities are meant to stay RESTRAINED — see the grade defaults
// in lib/brand.ts and each brand's stated rules (paperroute: no green bloom).
export const FilmGrade: React.FC<{
  grade: Brand['grade'];
  accent: string; // bloom color: the brand's primary/accent token
}> = ({grade, accent}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const id = React.useId();
  const {grain, vignette, bloom, aberration, letterbox} = grade;

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
      {/* (c) bloom — soft accent glow, very low opacity, screen-blended */}
      {bloom > 0 ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(60% 50% at 50% 45%, ${accent}${alphaHex(bloom)}, transparent 70%)`,
            mixBlendMode: 'screen',
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
                baseFrequency="0.8"
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
