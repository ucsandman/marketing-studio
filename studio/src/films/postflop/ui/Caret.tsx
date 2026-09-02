import React from 'react';
import {useCurrentFrame} from 'remotion';

// Text caret for the rebuilt inputs. Blinks on a 15-frame duty cycle (0.5s on,
// 0.5s off @30fps) as a step function of the frame, so it is identical on every
// re-render and never depends on wall time.

export const CARET_PERIOD = 15;

export type CaretProps = {
  color: string;
  width?: number;
  height?: number;
  /** Shot-local frame the caret starts blinking from. */
  fromFrame?: number;
  style?: React.CSSProperties;
};

export const Caret: React.FC<CaretProps> = ({color, width = 3, height = 28, fromFrame = 0, style}) => {
  const frame = useCurrentFrame();
  const local = frame - fromFrame;
  const on = local >= 0 && Math.floor(local / CARET_PERIOD) % 2 === 0;
  return (
    <span
      style={{
        display: 'inline-block',
        width,
        height,
        backgroundColor: color,
        opacity: on ? 1 : 0,
        verticalAlign: 'text-bottom',
        ...style,
      }}
    />
  );
};
