import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {entrance} from '../lib/motion';
import {revealFragment, revealUnit} from '../lib/textReveal';
import {useFormat} from '../lib/layout';

const easeOutExpo = Easing.out(Easing.exp);

export const Headline: React.FC<{kicker: string; headline: string; brand: Brand; hideKicker?: boolean}> = ({
  kicker,
  headline,
  brand,
  hideKicker,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scale, width, safe} = useFormat();
  const fonts = loadBrandFonts(brand);
  const words = headline.split(' ');
  const preset = brand.motion.textReveal;
  const byChar = revealUnit(preset, headline) === 'char';
  const totalChars = words.reduce((n, w) => n + w.length, 0);
  // Global char index each word starts at, so the charStagger cascade runs
  // continuously across word boundaries (the inter-word gap is the flex gap below).
  const wordCharStart: number[] = [];
  words.reduce((acc, w, i) => {
    wordCharStart[i] = acc;
    return acc + w.length;
  }, 0);
  const wordStyle: React.CSSProperties = {
    fontFamily: fonts.display,
    fontWeight: 800,
    fontSize: Math.round(120 * scale),
    lineHeight: 1.08,
    color: brand.colors.ink,
    display: 'inline-block',
  };
  const kickerIn = entrance(frame, fps, brand.motion, {durFrames: 12, easing: easeOutExpo});
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: Math.round(36 * scale)}}>
      {hideKicker ? null : (
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: Math.round(30 * scale),
            letterSpacing: '0.35em',
            // textAccent token, not the raw brand color: a brand whose clay/accent is
            // graphic-only must not carry text in it. Defaults to 'brand', so every
            // other brand renders byte-identically.
            color: brand.colors[brand.textAccent],
            opacity: kickerIn,
          }}
        >
          {kicker.toUpperCase()}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: `0 ${Math.round(28 * scale)}px`,
          maxWidth: Math.min(1500, width - 2 * safe.left),
        }}
      >
        {words.map((w, i) => {
          if (!byChar) {
            const frag = revealFragment(preset, {frame, fps, motion: brand.motion, index: i, total: words.length, scale});
            return (
              <span key={i} style={{...wordStyle, ...frag}}>
                {w}
              </span>
            );
          }
          return (
            <span key={i} style={wordStyle}>
              {w.split('').map((ch, j) => {
                const frag = revealFragment(preset, {
                  frame,
                  fps,
                  motion: brand.motion,
                  index: wordCharStart[i] + j,
                  total: totalChars,
                  scale,
                });
                return (
                  <span key={j} style={{display: 'inline-block', ...frag}}>
                    {ch}
                  </span>
                );
              })}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
