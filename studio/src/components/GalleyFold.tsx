import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {brandSpring, entrance} from '../lib/motion';
import {useFormat} from '../lib/layout';

/**
 * THE FOLD — a hook act that performs the product's verb instead of asserting it.
 *
 * A real paragraph of page prose is set on the paper ground, then folds: the block
 * is cut down from the bottom (a galley being trimmed) while its text fades, and
 * the ten-word line that replaces it wipes in at the top behind a red pilcrow.
 * The headline sets underneath afterwards, so the claim arrives only after the
 * viewer has already watched it happen.
 *
 * Every beat is frame-driven and cue-able: `foldFrame` and `headlineFrame` are
 * act-local frames, normally word-locked to the narration (lib/wordCues) by the
 * caller, so the fold lands ON the spoken word.
 *
 * Opt-in only. LaunchVideo renders it in place of Headline when a brand passes
 * `hookFold`; every brand without it keeps the plain headline act untouched.
 */
export const GalleyFold: React.FC<{
  kicker: string;
  paragraph: string;
  folded: string;
  headline: string;
  brand: Brand;
  foldFrame: number;
  headlineFrame: number;
  /** Word rendered in the accent, per the brand's accent budget. Case-insensitive. */
  accentWord?: string;
}> = ({kicker, paragraph, folded, headline, brand, foldFrame, headlineFrame, accentWord}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scale} = useFormat();
  const fonts = loadBrandFonts(brand);

  const bodySize = Math.round(36 * scale);
  const bodyLine = Math.round(bodySize * 1.75);
  // Wide enough that the condensed ten-word line never wraps: the block collapses to
  // exactly ONE line height, so a wrapped second line would be clipped away.
  const columnWidth = Math.round(1380 * scale);
  // Generous, so a proof still never shows the source paragraph pre-clipped: the
  // fold must be the only thing that ever cuts it.
  const openHeight = bodyLine * 6;

  // The fold itself. brandSpring carries the brand's motion personality; tenwords
  // is contemplative and near-critically damped, so the block settles without bounce.
  const fold = brandSpring(frame, fps, brand.motion, {delayFrames: foldFrame});
  const blockHeight = interpolate(fold, [0, 1], [openHeight, bodyLine]);
  const paraOpacity = interpolate(fold, [0, 0.55], [1, 0], {extrapolateRight: 'clamp'});
  const foldedIn = interpolate(fold, [0.3, 0.85], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const kickerIn = entrance(frame, fps, brand.motion, {durFrames: 14});
  const paraIn = entrance(frame, fps, brand.motion, {delayFrames: 6, durFrames: 18});
  const headIn = brandSpring(frame, fps, brand.motion, {delayFrames: headlineFrame});
  // Hairline rule: a printed page's own divider, drawn on with the headline.
  const ruleIn = entrance(frame, fps, brand.motion, {delayFrames: headlineFrame, durFrames: 22});

  const pilcrowStyle: React.CSSProperties = {
    fontFamily: fonts.body,
    fontSize: bodySize,
    lineHeight: `${bodyLine}px`,
    color: brand.colors.brand,
    flex: 'none',
    width: Math.round(34 * scale),
  };

  const accent = accentWord?.toLowerCase();
  const strip = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div style={{width: columnWidth, display: 'flex', flexDirection: 'column'}}>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: Math.round(26 * scale),
            letterSpacing: '0.35em',
            color: brand.colors[brand.textAccent],
            opacity: kickerIn,
            marginBottom: Math.round(46 * scale),
          }}
        >
          {kicker.toUpperCase()}
        </div>

        {/* The galley: one block that gets cut down to a single line. */}
        <div style={{height: blockHeight, overflow: 'hidden', position: 'relative'}}>
          <div
            style={{
              display: 'flex',
              gap: 0,
              opacity: paraOpacity * paraIn,
            }}
          >
            <div style={pilcrowStyle} />
            <div
              style={{
                fontFamily: fonts.body,
                fontSize: bodySize,
                lineHeight: `${bodyLine}px`,
                color: brand.colors.ink2,
              }}
            >
              {paragraph}
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              display: 'flex',
              opacity: foldedIn,
            }}
          >
            <div style={pilcrowStyle}>&para;</div>
            <div
              style={{
                fontFamily: fonts.body,
                fontSize: bodySize,
                lineHeight: `${bodyLine}px`,
                color: brand.colors.ink,
                whiteSpace: 'nowrap',
              }}
            >
              {folded}
            </div>
          </div>
        </div>

        <div
          style={{
            height: 1,
            width: `${Math.round(ruleIn * 100)}%`,
            background: brand.colors.line,
            marginTop: Math.round(52 * scale),
          }}
        />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: `0 ${Math.round(22 * scale)}px`,
            marginTop: Math.round(44 * scale),
            opacity: headIn,
            transform: `translateY(${(1 - headIn) * 18 * scale}px)`,
          }}
        >
          {headline.split(' ').map((w, i) => (
            <span
              key={i}
              style={{
                fontFamily: fonts.display,
                fontWeight: 700,
                fontSize: Math.round(92 * scale),
                lineHeight: 1.1,
                color: accent && strip(w) === strip(accent) ? brand.colors.brand : brand.colors.ink,
              }}
            >
              {w}
            </span>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
