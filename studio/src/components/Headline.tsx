import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import {alphaHex} from '../lib/brand';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {entrance} from '../lib/motion';
import {revealFragment, revealUnit} from '../lib/textReveal';
import {useFormat} from '../lib/layout';

const easeOutExpo = Easing.out(Easing.exp);

export const Headline: React.FC<{
  kicker: string;
  headline: string;
  brand: Brand;
  hideKicker?: boolean;
  // Content-fitted dark card behind the words, for callers that composite the
  // headline over busy footage (a wash/scrim alone still leaves text sitting on
  // top of whatever the footage shows there). Undefined/false -> byte-identical.
  scrim?: boolean;
  // Pins the block to a top band instead of dead center, for callers compositing
  // over footage whose own content (a screenshot, a UI panel) sits center-frame —
  // centering the headline there means it can only ever sit ON that content.
  // Undefined/false -> byte-identical (still centered).
  topAlign?: boolean;
  // Act-local reveal frame per headline word (lib/wordCues.alignWordCues). Absent, or
  // a null entry, falls back to the stagger cascade -> byte-identical.
  cueFrames?: (number | null)[];
  // A second beat set under the headline, in the SAME flex column so it cannot
  // collide with a two-line headline the way an absolutely-placed row would.
  // Undefined -> byte-identical (nothing rendered, no extra gap).
  footer?: React.ReactNode;
}> = ({kicker, headline, brand, hideKicker, scrim, topAlign, cueFrames, footer}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scale, width, height, safe} = useFormat();
  const fonts = loadBrandFonts(brand);
  // `ctaStyle: 'block'` brands forbid the accent from ever being TEXT on paper
  // (only a filled block with ink text — see EndCard/FeaturePanel/Caption/
  // MeasuredStamp). The eyebrow kicker is small mono text, so it must fall back
  // to an ink tone instead of textAccent. Defaults to 'text', so every other
  // brand's kicker renders byte-identically.
  const block = brand.ctaStyle === 'block';
  const words = headline.split(' ');
  const preset = brand.motion.textReveal;
  // Word cues are per WORD, so a cued headline reveals by word even on a
  // charStagger brand — a per-character cascade has nothing to lock to.
  const byChar = revealUnit(preset, headline) === 'char' && !cueFrames;
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
    <AbsoluteFill
      style={{
        justifyContent: topAlign ? 'flex-start' : 'center',
        alignItems: 'center',
        gap: Math.round(36 * scale),
        ...(topAlign ? {paddingTop: Math.round(height * 0.08)} : null),
      }}
    >
      {hideKicker ? null : (
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: Math.round(30 * scale),
            letterSpacing: '0.35em',
            // textAccent token, not the raw brand color: a brand whose clay/accent is
            // graphic-only must not carry text in it. Defaults to 'brand', so every
            // other brand renders byte-identically. A `ctaStyle: 'block'` brand goes
            // further: yellow never appears as text at all, so the kicker falls back
            // to ink2 regardless of textAccent (postflop's textAccent stays 'rare'
            // for other templates that still read it as text).
            color: block ? brand.colors.ink2 : brand.colors[brand.textAccent],
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
          // Wider cap when pinned to the top band: fewer, wider lines fit the
          // shallower band above the content below. Only raises the cap (never
          // narrows it), and on portrait the frame-width term is already the
          // binding constraint, so only a wide landscape frame is affected.
          maxWidth: Math.min(topAlign ? 1900 : 1500, width - 2 * safe.left),
          ...(scrim
            ? {
                background: `${brand.colors.bg}${alphaHex(0.88)}`,
                borderRadius: Math.round(16 * scale),
                padding: `${Math.round(20 * scale)}px ${Math.round(36 * scale)}px`,
              }
            : null),
        }}
      >
        {words.map((w, i) => {
          if (!byChar) {
            const frag = revealFragment(preset, {
              frame,
              fps,
              motion: brand.motion,
              index: i,
              total: words.length,
              scale,
              delayOverride: cueFrames?.[i] ?? null,
            });
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
      {footer ?? null}
    </AbsoluteFill>
  );
};
