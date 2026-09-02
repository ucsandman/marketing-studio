import React from 'react';
import {Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {entrance} from '../../../lib/motion';

// A 3px solid ink rule that DRAWS across its container: the inner bar's width
// goes 0 -> 100%, never scaleX, so the ends stay hard-edged and the thickness
// never distorts.

export type RuleProps = {
  brand: Brand;
  delayFrames?: number;
  durFrames?: number;
  thickness?: number;
  color?: string;
  /** Container width; the bar draws across it. */
  width?: number | string;
  /** Draw from the right instead of the left. */
  from?: 'left' | 'right';
  style?: React.CSSProperties;
};

export const Rule: React.FC<RuleProps> = ({
  brand,
  delayFrames = 0,
  durFrames = 16,
  thickness = 3,
  color,
  width = '100%',
  from = 'left',
  style,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = entrance(frame, fps, brand.motion, {
    delayFrames,
    durFrames,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div style={{width, height: thickness, display: 'flex', justifyContent: from === 'left' ? 'flex-start' : 'flex-end', ...style}}>
      <div style={{width: `${(p * 100).toFixed(3)}%`, height: '100%', backgroundColor: color ?? brand.colors.ink}} />
    </div>
  );
};
