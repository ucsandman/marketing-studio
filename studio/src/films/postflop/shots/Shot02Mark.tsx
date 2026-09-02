import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {entrance, staggerDelay} from '../../../lib/motion';
import {getMark} from '../../../brands/marks';
import {Rule, Stamp} from '../ui';

// Shot 02 "mark" (84 frames). The lockup beat: the spade inks itself upward
// between two ink rules, the wordmark sets itself letter by letter (brand
// textReveal is maskWipe, so each glyph rises out of a clipped box rather than
// fading), the printed meta line resolves under the lower rule, and the film's
// first signature stamp — EXPLOITABILITY [measured] — snaps in last.
//
// Film.tsx owns the handover, so nothing here fades in or out at the shot
// boundary; everything is settled and static by local frame ~72.

const WORD = 'postflop';
const LOCKUP_WIDTH = 1320;
const MARK_SIZE = 300;
const WORD_SIZE = 256;

/** A single wordmark glyph rising out of its own clipped box. */
const Glyph: React.FC<{ch: string; p: number; size: number}> = ({ch, p, size}) => (
  <span
    style={{
      display: 'inline-block',
      overflow: 'hidden',
      lineHeight: 1,
      // descenders ('p') live below the baseline; the clip box has to include them
      paddingBottom: size * 0.28,
      marginBottom: -size * 0.28,
      verticalAlign: 'bottom',
    }}
  >
    <span style={{display: 'inline-block', lineHeight: 1, transform: `translateY(${((1 - p) * 132).toFixed(2)}%)`}}>
      {ch}
    </span>
  </span>
);

export const Shot02Mark: React.FC<{brand: Brand; len: number}> = ({brand, len}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const Mark = getMark(brand.id);

  const ramp = (delayFrames: number, durFrames: number): number =>
    entrance(frame, fps, brand.motion, {delayFrames, durFrames, easing: Easing.out(Easing.cubic)});

  // Continuous camera: a slow push that decelerates to rest well before the cut,
  // so the last frames of the shot are genuinely static.
  const dolly = ramp(2, len - 14);
  const markP = ramp(2, 14);
  const labelP = ramp(32, 14);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        color: brand.colors.ink,
      }}
    >
      <div
        style={{
          width: LOCKUP_WIDTH,
          display: 'flex',
          flexDirection: 'column',
          transform: `translateY(${(-10 * dolly).toFixed(2)}px) scale(${(1 + 0.028 * dolly).toFixed(4)})`,
        }}
      >
        <Rule brand={brand} delayFrames={2} durFrames={14} />

        <div style={{display: 'flex', alignItems: 'center', gap: 44, margin: '44px 0'}}>
          <div style={{clipPath: `inset(${((1 - markP) * 100).toFixed(2)}% 0% 0% 0%)`}}>
            <Mark size={MARK_SIZE} color={brand.colors.ink} />
          </div>
          <div
            style={{
              fontFamily: fonts.display,
              fontWeight: 700,
              fontSize: WORD_SIZE,
              letterSpacing: -10,
              lineHeight: 1,
              display: 'flex',
            }}
          >
            {WORD.split('').map((ch, i) => (
              <Glyph
                key={`${ch}-${i}`}
                ch={ch}
                size={WORD_SIZE}
                p={ramp(8 + staggerDelay(i, 2, brand.motion), 12)}
              />
            ))}
          </div>
        </div>

        <Rule brand={brand} delayFrames={26} durFrames={14} from="right" />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 20,
            fontFamily: fonts.mono,
            fontWeight: 500,
            fontSize: 27,
            letterSpacing: 3,
            color: brand.colors.ink2,
          }}
        >
          <span style={{opacity: ramp(46, 10)}}>ENGINE 0.1.0</span>
          <span style={{opacity: ramp(52, 10)}}>{brand.url}</span>
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 32, marginTop: 50}}>
          <span
            style={{
              fontFamily: fonts.mono,
              fontWeight: 500,
              fontSize: 44,
              letterSpacing: 7,
              clipPath: `inset(0% ${((1 - labelP) * 100).toFixed(2)}% 0% 0%)`,
            }}
          >
            EXPLOITABILITY
          </span>
          <Stamp brand={brand} mono={fonts.mono} text="[measured]" delayFrames={40} fontSize={40} padding="11px 24px" />
        </div>
      </div>
    </AbsoluteFill>
  );
};
