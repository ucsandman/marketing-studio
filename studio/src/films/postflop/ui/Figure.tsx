import React from 'react';
import {interpolate, useCurrentFrame} from 'remotion';

// A JetBrains Mono tabular figure that counts between two values over a frame
// window. LINEAR on purpose: an eased counter reads as a value being animated,
// a linear one reads as a machine reporting. tabular-nums keeps the glyph boxes
// fixed so the number never jitters horizontally while it runs.

export type FigureProps = {
  mono: string;
  from: number;
  to: number;
  delayFrames?: number;
  durFrames: number;
  /** Turns the raw value into the on-screen string, e.g. (v) => v.toFixed(4) + '%'. */
  format?: (value: number) => string;
  style?: React.CSSProperties;
};

export const Figure: React.FC<FigureProps> = ({
  mono,
  from,
  to,
  delayFrames = 0,
  durFrames,
  format = (v) => String(Math.round(v)),
  style,
}) => {
  const frame = useCurrentFrame();
  const value = interpolate(frame - delayFrames, [0, durFrames], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <span style={{fontFamily: mono, fontVariantNumeric: 'tabular-nums', fontWeight: 500, ...style}}>
      {format(value)}
    </span>
  );
};
