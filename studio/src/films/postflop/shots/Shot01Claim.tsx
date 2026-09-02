import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {brandSpring, entryScale, staggerDelay} from '../../../lib/motion';
import {Rule} from '../ui';

// Shot 01 "claim" — kinetic type on paper. The claim sets itself word by word on
// a 3-frame stagger (each word its own spring: opacity, entry scale, a short
// rise off the baseline), then the 3px ink rule draws under the block from
// frame 50 to 66. Everything has settled by frame 66; 67..83 are static.
//
// Line breaks are hard, not wrapped, and the block is fit-content: the rule
// under it is exactly as wide as the longest line (~1270px, 66% of the 1920
// frame) instead of overhanging a fixed container.

const FONT_SIZE = 130;
const FIRST_WORD_FRAME = 3;
const STAGGER = 3;
const RULE_FRAME = 50;

const LINES: readonly (readonly string[])[] = [
  ['Your', 'solver', 'is', 'grading'],
  ['its', 'own', 'homework.'],
];

// Flat word index per line, so each word's stagger slot is a pure function of
// its position instead of a counter mutated during render.
const LINE_OFFSET: readonly number[] = LINES.reduce<number[]>(
  (acc, line, i) => [...acc, acc[i] + line.length],
  [0],
);

const Word: React.FC<{brand: Brand; text: string; index: number}> = ({brand, text, index}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = brandSpring(frame, fps, brand.motion, {
    delayFrames: FIRST_WORD_FRAME + staggerDelay(index, STAGGER, brand.motion),
  });
  const s = entryScale(p, brand.motion);
  const rise = ((1 - p) * 26).toFixed(2);
  return (
    <span
      style={{
        display: 'inline-block',
        opacity: p,
        transform: `translateY(${rise}px) scale(${s.toFixed(4)})`,
        transformOrigin: 'left bottom',
      }}
    >
      {text}
    </span>
  );
};

export const Shot01Claim: React.FC<{brand: Brand; len: number}> = ({brand, len}) => {
  void len;
  const fonts = loadBrandFonts(brand);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 36}}>
        <div
          style={{
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: FONT_SIZE,
            lineHeight: 1.06,
            letterSpacing: -3.5,
            color: brand.colors.ink,
          }}
        >
          {LINES.map((line, li) => (
            <div key={line.join(' ')} style={{whiteSpace: 'nowrap'}}>
              {line.map((word, i) => (
                <React.Fragment key={word}>
                  {i > 0 ? ' ' : null}
                  <Word brand={brand} text={word} index={LINE_OFFSET[li] + i} />
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
        <Rule brand={brand} delayFrames={RULE_FRAME} durFrames={16} thickness={3} />
      </div>
    </AbsoluteFill>
  );
};
