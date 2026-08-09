import React from 'react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';

// Rack focus (docs/product-launch-motion-adoption.md, Phase C): defocus a plane
// while the story is elsewhere, pull it back when attention returns. Blur and
// opacity travel together. The base style pins filter at blur(0px) — a numeric
// value — because animating from an implicit `none` jumps on the first frame.
export const RackFocus: React.FC<{
  at: number; // frames; defocus begins
  release: number; // frames; focus returns
  blur?: number; // px at full defocus
  dim?: number; // opacity at full defocus
  children: React.ReactNode;
}> = ({at, release, blur = 2.6, dim = 0.55, children}) => {
  const frame = useCurrentFrame();
  const IN = 13; // ~0.44s @30
  const OUT = 10; // ~0.34s @30
  const p =
    frame < release
      ? interpolate(frame, [at, at + IN], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.inOut(Easing.quad),
        })
      : interpolate(frame, [release, release + OUT], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.inOut(Easing.quad),
        });
  return (
    <div
      style={{
        filter: `blur(${blur * p}px)`,
        opacity: 1 - (1 - dim) * p,
      }}
    >
      {children}
    </div>
  );
};
