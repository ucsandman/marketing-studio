import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';
import {smootherstep} from '../lib/motion';

export type FocusHold = {at: number; release: number};

// Rack focus (docs/product-launch-motion-adoption.md, Phase C): defocus a plane
// while the story is elsewhere, pull it back when attention returns. Blur and
// opacity travel together. The base style pins filter at blur(0px) — a numeric
// value — because animating from an implicit `none` jumps on the first frame.
export const RackFocus: React.FC<{
  at: number; // frames; defocus begins
  release: number; // frames; focus returns
  blur?: number; // px at full defocus
  dim?: number; // opacity at full defocus
  holds?: FocusHold[]; // additional content-authored focus windows
  children: React.ReactNode;
}> = ({at, release, blur = 2.6, dim = 0.55, holds = [], children}) => {
  const frame = useCurrentFrame();
  const IN = 13; // ~0.44s @30
  const OUT = 10; // ~0.34s @30
  const amount = (hold: FocusHold): number =>
    frame < hold.release
      ? interpolate(frame, [hold.at, hold.at + IN], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: smootherstep,
        })
      : interpolate(frame, [hold.release, hold.release + OUT], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: smootherstep,
        });
  // Focus remains authored by content beats. Click cues never enter this component.
  const p = Math.max(...[{at, release}, ...holds].map(amount));
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
