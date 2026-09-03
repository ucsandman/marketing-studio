import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {alphaHex} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {brandSpring, entrance, entryScale} from '../../../lib/motion';
import {getMark} from '../../../brands/marks';
import {SHOTS} from '../timeline';
import {Plate, Timestamp} from '../ui';

// Shot 7 "wide" (film 960-1199, 240 frames — the last shot, so no tail). High
// and wide over the whole hall: dozens of orange lights moving along the aisles,
// and every few frames one of them freezes for a beat and releases, out of
// phase. HOLD 3 is not a beat here, it is the rhythm — the argument scaled from
// one agent to a fleet, which is the only claim the film makes about scale and
// it makes it by showing rather than saying.
//
// The plate runs its full 240 frames. "Holds static from frame 1140" in the spec
// is the LOCKUP being finished, not the hall stopping: freezing the plate would
// delete a quarter of the hero shot's stated content, and the film's ending is a
// hall that keeps working under a line of type, not a still.
//
// The lockup is deliberately SMALL and centred. The previous film ended on a
// lockup that swallowed the frame; this one sits over the world it is talking
// about. Every word is from out/dashclaw/marketing/brief.json — the line is
// hook.altHeadlines[0], the CTA is the brand url in the profit token, which is
// the one slot the lighter orange is reserved for.

const FROM = SHOTS[6].from;

/** Film frame 1140: everything in the lockup has settled by here. */
const SETTLED_AT = 180;

const MARK_IN = 108;
const WORDMARK_IN = 116;
const LINE_IN = 132;
const CTA_IN = 150;

// THE GROUND UNDER THE LOCKUP (2026-09-03, measured on the real wide plate).
// This hall is not dark where the type lands: the lockup's box on
// hall/wide/frame_0180.png measures p95 luminance 205 and p99 253 — the floor
// pools and the slit lights are as bright as #fafafa — and the rendered still
// at film 1180 lost "sensitive" and "you allow" into them outright.
//
// So the lockup gets a ground, and the ground is a BLOCK, not a scrim: no
// gradient, no blur, no vignette, no wash over the frame. It is sized by the
// lockup's own content (padding on the flex column, nothing hardcoded) so it
// stays the smallest rectangle that does the job, and it is the same flat dark
// surface language as the film's other ground — the inbox card and the ledger.
// At 0.82 the plate's p95 lands near 46 and its p99 near 60, under white ink.
const GROUND_ALPHA = 0.82;
const GROUND_IN = MARK_IN - 8;

const END_LINE = 'Nothing sensitive runs until you allow it.';

// A left-to-right mask wipe: glyph positions never move and the reveal edge
// stays hard, which is what keeps type on top of a moving plate from reading as
// a dissolve.
const wipeClip = (p: number): string => `inset(0 ${((1 - p) * 100).toFixed(3)}% 0 0)`;

export const Shot07Wide: React.FC<{brand: Brand; len: number; plates: boolean}> = ({
  brand,
  plates,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const Mark = getMark(brand.id);
  const ease = {easing: Easing.out(Easing.cubic)} as const;

  const mark = brandSpring(frame, fps, brand.motion, {delayFrames: MARK_IN});
  const markInk = entrance(frame, fps, brand.motion, {delayFrames: MARK_IN, durFrames: 14, ...ease});
  const wordmark = entrance(frame, fps, brand.motion, {delayFrames: WORDMARK_IN, durFrames: 16, ...ease});
  const line = entrance(frame, fps, brand.motion, {delayFrames: LINE_IN, durFrames: 18, ...ease});
  const cta = entrance(frame, fps, brand.motion, {delayFrames: CTA_IN, durFrames: 16, ...ease});
  const ground = entrance(frame, fps, brand.motion, {delayFrames: GROUND_IN, durFrames: 20, ...ease});

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <Plate brand={brand} mono={fonts.mono} shot="wide" available={plates} />

      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 26,
            padding: '46px 76px 50px',
            backgroundColor: `${brand.colors.bg}${alphaHex(ground * GROUND_ALPHA)}`,
          }}
        >
          <div style={{display: 'flex', alignItems: 'center', gap: 20, height: 84}}>
            <div
              style={{
                display: 'flex',
                opacity: markInk,
                transform: `scale(${entryScale(mark, brand.motion).toFixed(4)})`,
                transformOrigin: 'center center',
              }}
            >
              <Mark size={78} color={brand.colors.ink} />
            </div>
            <div
              style={{
                fontFamily: fonts.display,
                fontWeight: 700,
                fontSize: 70,
                letterSpacing: -2,
                lineHeight: 1,
                color: brand.colors.ink,
                clipPath: wipeClip(wordmark),
              }}
            >
              {brand.name}
            </div>
          </div>

          <div
            style={{
              fontFamily: fonts.mono,
              fontWeight: 500,
              fontSize: 34,
              letterSpacing: 1,
              lineHeight: 1.3,
              color: brand.colors.ink,
              opacity: line,
              transform: `translateY(${((1 - line) * 8).toFixed(2)}px)`,
            }}
          >
            {END_LINE}
          </div>

          <div
            style={{
              fontFamily: fonts.mono,
              fontWeight: 500,
              fontSize: 28,
              letterSpacing: 5,
              color: brand.colors.profit,
              opacity: cta,
              transform: `translateY(${((1 - cta) * 6).toFixed(2)}px)`,
            }}
          >
            {brand.url}
          </div>
        </div>
      </AbsoluteFill>

      {/* The clock keeps the finale in the same world as the opening, and stops
          on 1140 with the lockup: the last 60 frames change nothing but the
          hall itself. */}
      <Timestamp
        brand={brand}
        mono={fonts.mono}
        filmFrame={FROM + Math.min(frame, SETTLED_AT)}
      />
    </AbsoluteFill>
  );
};
