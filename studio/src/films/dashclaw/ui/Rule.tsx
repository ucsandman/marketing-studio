import React from 'react';
import {Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {entrance} from '../../../lib/motion';

// A thin rule that DRAWS across its container: the inner bar's width goes
// 0 -> 100%, never scaleX, so the ends stay hard-edged and the thickness never
// distorts.
//
// Defaults to the brand's line token because most rules in this film are hall
// chrome. The two that carry the accent — the rule under the rack glyph and the
// chain linking a ledger row to its decision id — pass `color` explicitly, which
// keeps orange an argued decision at the call site instead of a default.

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
  durFrames = 14,
  thickness = 2,
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
    <div
      style={{
        width,
        height: thickness,
        display: 'flex',
        justifyContent: from === 'left' ? 'flex-start' : 'flex-end',
        ...style,
      }}
    >
      <div
        style={{
          width: `${(p * 100).toFixed(3)}%`,
          height: '100%',
          backgroundColor: color ?? brand.colors.line,
        }}
      />
    </div>
  );
};
