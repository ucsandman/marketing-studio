import React from 'react';
import {Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {entrance} from '../../../lib/motion';

// A single small mono line, ink3, that arrives once and stays. Used for the
// hall's `agent-7 · unattended` label and the ledger's
// `chained to the decision that allowed it`.
//
// This is NOT the studio's captions strip and must never grow into one: the
// direction forbids a caption track, a kicker and a FloatBar outright. It is one
// line of type that the world is allowed to carry, so it has no ground, no
// background plate and no exit — it fades up over ~14 frames with a short rise
// and then holds, which is what lets a shot hand a static frame to the next.

export type CaptionProps = {
  brand: Brand;
  mono: string;
  text: string;
  delayFrames?: number;
  durFrames?: number;
  fontSize?: number;
  letterSpacing?: number;
  color?: string;
  /** Pixels the line rises through as it arrives. */
  rise?: number;
  style?: React.CSSProperties;
};

export const Caption: React.FC<CaptionProps> = ({
  brand,
  mono,
  text,
  delayFrames = 0,
  durFrames = 14,
  fontSize = 28,
  letterSpacing = 3,
  color,
  rise = 8,
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
    <span
      style={{
        fontFamily: mono,
        fontWeight: 500,
        fontSize,
        letterSpacing,
        lineHeight: 1.3,
        color: color ?? brand.colors.ink3,
        opacity: p,
        transform: `translateY(${((1 - p) * rise).toFixed(2)}px)`,
        ...style,
      }}
    >
      {text}
    </span>
  );
};
