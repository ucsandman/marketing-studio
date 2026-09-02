import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {brandSpring, entrance, entryScale} from '../../../lib/motion';
import {getMark} from '../../../brands/marks';
import {Rule, Stamp} from '../ui';

// Shot 8 "end" (102 frames). Kinetic type — MEASURED. / NEVER / ASSERTED., one
// word per 6 frames, each replacing the last — then the end lockup assembles:
// spade + wordmark, a rule, the yellow CTA block, the url. The last element
// (the closing rule) finishes drawing on frame 71; 71..101 is the end card's
// deliberate 1s hold — the only long hold in the film.

const BLOCK_WIDTH = 1300;

const WORDS = [
  {text: 'MEASURED.', from: 2, until: 8},
  {text: 'NEVER', from: 8, until: 14},
  {text: 'ASSERTED.', from: 14, until: 23},
] as const;

const KineticWord: React.FC<{
  brand: Brand;
  family: string;
  text: string;
  from: number;
  until: number;
}> = ({brand, family, text, from, until}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // The spring owns the travel, a fast ramp owns the ink: this brand is
  // overdamped (exuberance 0.2), so a spring-driven opacity would still be grey
  // by the time a 6-frame word is replaced.
  const p = brandSpring(frame, fps, brand.motion, {delayFrames: from});
  const ink = entrance(frame, fps, brand.motion, {
    delayFrames: from,
    durFrames: 3,
    easing: Easing.out(Easing.cubic),
  });
  const out = entrance(frame, fps, brand.motion, {
    delayFrames: until,
    durFrames: 4,
    easing: Easing.out(Easing.cubic),
  });
  const opacity = ink * (1 - out);
  if (opacity <= 0.002) {
    return null;
  }
  const lift = (1 - p) * 26 - out * 64;
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <div
        style={{
          fontFamily: family,
          fontWeight: 700,
          fontSize: 215,
          letterSpacing: -7,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          color: brand.colors.ink,
          opacity,
          transform: `translateY(${lift.toFixed(2)}px) scale(${entryScale(p, brand.motion).toFixed(4)})`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

// A left-to-right mask wipe (brand.motion.textReveal) as a clip, so glyph
// positions never move and the reveal edge stays hard.
const wipeClip = (p: number): string => `inset(0 ${((1 - p) * 100).toFixed(3)}% 0 0)`;

export const Shot08End: React.FC<{brand: Brand; len: number}> = ({brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const Mark = getMark(brand.id);

  // 26, not 27: ASSERTED.'s 4-frame out lands on 27, so starting the mark a
  // frame earlier hands the ink straight over instead of leaving f27 empty.
  const mark = brandSpring(frame, fps, brand.motion, {delayFrames: 26});
  const markInk = entrance(frame, fps, brand.motion, {
    delayFrames: 26,
    durFrames: 6,
    easing: Easing.out(Easing.cubic),
  });
  const wordmark = entrance(frame, fps, brand.motion, {
    delayFrames: 31,
    durFrames: 14,
    easing: Easing.out(Easing.cubic),
  });
  // The CTA block is the film's biggest patch of #ffe000, and Stamp's spring
  // fades it in — a half-lit yellow rectangle on bone paper is exactly the
  // "wash" the brand forbids. Override the opacity to 1 and reveal it with the
  // brand's own maskWipe instead, so the block is either full-strength or not
  // there. The spring still owns the scale and the settle drop.
  const stamp = entrance(frame, fps, brand.motion, {
    delayFrames: 45,
    durFrames: 9,
    easing: Easing.out(Easing.cubic),
  });
  const url = entrance(frame, fps, brand.motion, {
    delayFrames: 53,
    durFrames: 12,
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {WORDS.map((w) => (
        <KineticWord key={w.text} brand={brand} family={fonts.display} {...w} />
      ))}

      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div
          style={{
            width: BLOCK_WIDTH,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 30,
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 34, height: 164}}>
            <div
              style={{
                display: 'flex',
                opacity: markInk,
                transform: `scale(${entryScale(mark, brand.motion).toFixed(4)})`,
                transformOrigin: 'center bottom',
              }}
            >
              <Mark size={156} color={brand.colors.ink} />
            </div>
            <div
              style={{
                fontFamily: fonts.display,
                fontWeight: 700,
                fontSize: 150,
                letterSpacing: -8,
                lineHeight: 1,
                color: brand.colors.ink,
                clipPath: wipeClip(wordmark),
              }}
            >
              postflop
            </div>
          </div>

          <Rule brand={brand} delayFrames={37} durFrames={16} thickness={3} width={BLOCK_WIDTH} />

          <Stamp
            brand={brand}
            mono={fonts.mono}
            text="Solve your first spot in the browser."
            delayFrames={45}
            fontSize={52}
            padding="20px 34px"
            style={{opacity: 1, clipPath: wipeClip(stamp)}}
          />

          <div
            style={{
              fontFamily: fonts.mono,
              fontWeight: 500,
              fontSize: 38,
              letterSpacing: 3,
              color: brand.colors.ink,
              clipPath: wipeClip(url),
            }}
          >
            {brand.url}
          </div>

          <Rule
            brand={brand}
            delayFrames={59}
            durFrames={12}
            thickness={3}
            width={BLOCK_WIDTH}
            from="right"
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
