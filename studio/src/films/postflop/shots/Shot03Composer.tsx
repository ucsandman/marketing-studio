import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {brandSpring, entrance, entryScale} from '../../../lib/motion';
import {controlPressScale} from '../../../components/StageCursor';
import {CURSOR_TIP, Caret, CursorGlyph, Rule, bowedPosition} from '../ui';
import type {CursorWaypoint} from '../ui';

// Shot 3 "composer" — the rebuilt spot composer on paper. Everything here is a
// function of the shot-local frame: a rule draws, a mono line types itself under
// a blinking caret, three chips tick themselves off one at a time, a footer rule
// draws, a cursor bows in and presses SOLVE, and the button flips from ink to a
// yellow SOLVING block. The whole card is inside a gentle dolly that CLOSES
// before the last frame, so the shot hands a static frame to the next one.

const CARD_W = 1380;
const CARD_H = 560;
const CARD_X = (1920 - CARD_W) / 2;
const CARD_Y = 250;
const PAD = 44;

// Typed at ~3 chars/frame from TYPE_FROM. 63 characters -> settled by frame 31.
const SPOT = 'Kh 9s 4d 2c  |  200bb  |  OOP 3-bet pot  |  target 0.05% of pot';
const TYPE_FROM = 10;
const CHARS_PER_FRAME = 3;

// Three chips, laid out 3-up across the full card width so the card reads as
// dense product UI rather than a form with an empty right half.
const CHIPS = [
  {label: 'BOARD', value: 'Kh 9s 4d 2c'},
  {label: 'STACKS', value: '200bb'},
  {label: 'TARGET', value: '0.05% of pot'},
] as const;

const CHIP_IN = 40; // first chip lands here, the rest follow on CHIP_GAP
const CHIP_GAP = 8;
const CHIP_H = 132;
const CHIP_SPAN = 20;
const TICK_LAG = 8; // frames after a chip lands before its tick draws
const TICK_DUR = 8;

const FOOTER_H = 88;
const FOOTER_IN = 62;

// The button belongs to the footer, so it lands after the footer rule has drawn
// rather than floating alone in the card's bottom-right for thirty frames.
const BUTTON_IN = 70;
const CLICK_AT = 118;
const FLIP_AT = 124;

// The button, in unscaled frame coordinates — the dolly pushes toward it and the
// cursor's last waypoint lands on it. The footer bar is absolutely positioned so
// these stay exact instead of depending on how the flow above it measures.
const BUTTON_W = 300;
const BUTTON_H = FOOTER_H;
const BUTTON_CX = CARD_X + CARD_W - PAD - BUTTON_W / 2;
const BUTTON_CY = CARD_Y + CARD_H - PAD - FOOTER_H / 2;

const CURSOR_PATH: CursorWaypoint[] = [
  {x: 1806, y: 1044, at: 0},
  {x: 1602, y: 906, at: 100},
  // Lands inside the button but low-right of its label, so the glyph never
  // covers the word the button is trying to say.
  {x: BUTTON_CX + 108, y: BUTTON_CY + 16, at: CLICK_AT - 2},
];

// The checkmark inside a resolved chip: one polyline whose dash offset retreats,
// so the stroke draws itself rather than fading on.
const TICK_LEN = 28;

const Tick: React.FC<{brand: Brand; delayFrames: number}> = ({brand, delayFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = entrance(frame, fps, brand.motion, {
    delayFrames,
    durFrames: TICK_DUR,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <svg width={30} height={30} viewBox="0 0 30 30" style={{flexShrink: 0}}>
      <rect x={1.5} y={1.5} width={27} height={27} fill="none" stroke={brand.colors.ink} strokeWidth={2} />
      <polyline
        points="7,15 13,21 23,8"
        fill="none"
        stroke={brand.colors.ink}
        strokeWidth={3}
        strokeLinecap="square"
        strokeDasharray={TICK_LEN}
        strokeDashoffset={(TICK_LEN * (1 - p)).toFixed(2)}
      />
    </svg>
  );
};

const Chip: React.FC<{brand: Brand; mono: string; label: string; value: string; index: number}> = ({
  brand,
  mono,
  label,
  value,
  index,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const landed = CHIP_IN + index * CHIP_GAP;
  const p = brandSpring(frame, fps, brand.motion, {delayFrames: landed});
  return (
    <div
      style={{
        flex: 1,
        height: CHIP_H,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        border: `2px solid ${brand.colors.ink}`,
        padding: '22px 24px',
        fontFamily: mono,
        opacity: p,
        transform: `translateY(${((1 - p) * 14).toFixed(2)}px) scale(${entryScale(p, brand.motion).toFixed(4)})`,
        transformOrigin: 'left center',
      }}
    >
      <div style={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between'}}>
        <span style={{fontSize: 20, fontWeight: 500, letterSpacing: 3, color: brand.colors.ink2}}>{label}</span>
        <Tick brand={brand} delayFrames={landed + TICK_LAG} />
      </div>
      <span style={{fontSize: 36, fontWeight: 500, lineHeight: 1, color: brand.colors.ink}}>{value}</span>
    </div>
  );
};

export const Shot03Composer: React.FC<{brand: Brand; len: number}> = ({brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);

  // Gentle push toward the SOLVE button, running across the shot the way the
  // spec words it: it is still easing out under the press at 118 and the flip at
  // 124, and closes at 128. Everything has settled by 130, so the tail 130..149
  // is completely static and hands a still frame to the next shot.
  const dolly = interpolate(frame, [2, 128], [1, 1.04], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.quad),
  });

  const head = entrance(frame, fps, brand.motion, {
    delayFrames: 4,
    durFrames: 12,
    easing: Easing.out(Easing.cubic),
  });
  const fieldP = brandSpring(frame, fps, brand.motion, {delayFrames: 6});
  const typed = SPOT.slice(0, Math.max(0, Math.floor((frame - TYPE_FROM) * CHARS_PER_FRAME)));

  const metaP = entrance(frame, fps, brand.motion, {
    delayFrames: FOOTER_IN + 6,
    durFrames: 12,
    easing: Easing.out(Easing.cubic),
  });

  const buttonP = brandSpring(frame, fps, brand.motion, {delayFrames: BUTTON_IN});
  const press = controlPressScale(frame, CLICK_AT);
  const flip = entrance(frame, fps, brand.motion, {
    delayFrames: FLIP_AT,
    durFrames: 4,
    easing: Easing.out(Easing.cubic),
  });

  const cursorP = entrance(frame, fps, brand.motion, {
    delayFrames: 78,
    durFrames: 10,
    easing: Easing.out(Easing.cubic),
  });
  const cursor = bowedPosition(frame, CURSOR_PATH);

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill
        style={{
          transform: `scale(${dolly.toFixed(4)})`,
          transformOrigin: `${BUTTON_CX}px ${BUTTON_CY}px`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: CARD_X,
            top: CARD_Y,
            width: CARD_W,
            height: CARD_H,
            backgroundColor: brand.colors.surface,
          }}
        >
          <Rule brand={brand} delayFrames={2} durFrames={16} thickness={3} width={CARD_W} />

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              padding: `36px ${PAD}px 0`,
              fontFamily: fonts.mono,
              fontSize: 24,
              fontWeight: 500,
              letterSpacing: 4,
              color: brand.colors.ink2,
              opacity: head,
              transform: `translateY(${((1 - head) * 10).toFixed(2)}px)`,
            }}
          >
            <span>COMPOSE SPOT</span>
            <span>engine 0.1.0</span>
          </div>

          <div style={{padding: `30px ${PAD}px 0`}}>
            <div
              style={{
                border: `2px solid ${brand.colors.ink}`,
                padding: '26px 24px',
                display: 'flex',
                alignItems: 'center',
                opacity: fieldP,
                transform: `scale(${entryScale(fieldP, brand.motion).toFixed(4)})`,
                transformOrigin: 'left center',
              }}
            >
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 32,
                  fontWeight: 500,
                  lineHeight: 1.25,
                  color: brand.colors.ink,
                  whiteSpace: 'pre',
                }}
              >
                {typed}
              </span>
              {frame < FLIP_AT ? (
                <Caret color={brand.colors.ink} width={3} height={34} fromFrame={TYPE_FROM} style={{marginLeft: 4}} />
              ) : null}
            </div>
          </div>

          <div style={{display: 'flex', gap: CHIP_SPAN, padding: `28px ${PAD}px 0`}}>
            {CHIPS.map((chip, i) => (
              <Chip key={chip.label} brand={brand} mono={fonts.mono} label={chip.label} value={chip.value} index={i} />
            ))}
          </div>

          <div
            style={{
              position: 'absolute',
              left: PAD,
              right: PAD,
              bottom: PAD,
              height: FOOTER_H,
            }}
          >
            <Rule brand={brand} delayFrames={FOOTER_IN} durFrames={14} thickness={3} width={CARD_W - PAD * 2} />
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: FOOTER_H - 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 26,
                  fontWeight: 500,
                  letterSpacing: 1.5,
                  color: brand.colors.ink2,
                  opacity: metaP,
                  transform: `translateY(${((1 - metaP) * 8).toFixed(2)}px)`,
                }}
              >
                363 combos · node 0 · turn
              </span>

              <div
                style={{
                  position: 'relative',
                  width: BUTTON_W,
                  height: BUTTON_H,
                  opacity: buttonP,
                  transform: `scale(${(entryScale(buttonP, brand.motion) * press).toFixed(4)})`,
                  transformOrigin: 'center center',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: brand.colors.ink,
                    color: brand.colors.surface,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: fonts.mono,
                    fontSize: 34,
                    fontWeight: 700,
                    letterSpacing: 5,
                  }}
                >
                  SOLVE
                </div>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: brand.colors.brand,
                    color: brand.colors.ink,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: fonts.mono,
                    fontSize: 34,
                    fontWeight: 700,
                    letterSpacing: 5,
                    // Both states stay full strength and the yellow WIPES over
                    // the ink block (brand.motion.textReveal = 'maskWipe'). A
                    // crossfade blends #ffe000 into #101010 for a frame or two,
                    // which lands on screen as an olive wash — the one thing
                    // the brand never allows yellow to do.
                    clipPath: `inset(0% ${((1 - flip) * 100).toFixed(2)}% 0% 0%)`,
                  }}
                >
                  SOLVING
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: cursor.x - CURSOR_TIP.x,
            top: cursor.y - CURSOR_TIP.y,
            opacity: cursorP,
          }}
        >
          {/* filter:none is pinned here, not inherited: this brand has zero
              shadows and the raw stage glyph ships with a drop-shadow. */}
          <CursorGlyph scale={1.35} style={{filter: 'none'}} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
