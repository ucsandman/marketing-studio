import React from 'react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';

// Specular sweep (docs/product-launch-motion-adoption.md, Phase C): a soft light
// band crossing the frame at NAMED story beats — thesis, proof, CTA. Never on a
// timer or loop; a sweep on a timer is a screensaver. The element is skewed and
// the gradient stays at 90 degrees inside it — an angled gradient on a tall box
// produces mismatched stop heights at the edges (a hard diagonal seam).
export const SpecularSweep: React.FC<{
  beats: number[]; // frames at which a pass starts
  dur?: number; // frames per pass
  peak?: number; // gradient peak alpha
  skew?: number; // deg
}> = ({beats, dur = 24, peak = 0.11, skew = -14}) => {
  const frame = useCurrentFrame();
  const beat = beats.find((b) => frame >= b && frame <= b + dur);
  if (beat === undefined) return null;
  const x = interpolate(frame, [beat, beat + dur], [-140, 260], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const fadeIn = interpolate(frame, [beat, beat + 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });
  const fadeOut = interpolate(frame, [beat + dur - 6, beat + dur], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          top: '-24%',
          left: 0,
          height: '148%', // skewed corners never enter the canvas
          width: '40%',
          transform: `translateX(${x}%) skewX(${skew}deg)`,
          background: `linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,${peak}) 50%, rgba(255,255,255,0))`,
          opacity: fadeIn * fadeOut,
        }}
      />
    </div>
  );
};
