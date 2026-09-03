import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {brandSpring, entrance, entryScale} from '../../../lib/motion';
import {controlPressScale} from '../../../components/StageCursor';
import {CURSOR_TIP, CursorGlyph, Rule, bowedPosition} from '../ui';
import type {CursorWaypoint} from '../ui';

// Shot 4 "intercept" (film 450-667, 218 frames incl. the 8-frame tail). The
// evidence ground: DashClaw's approvals inbox, REBUILT as native UI on the dark
// ground — never a screenshot, never a capture. The cut lands on the hold, so
// the world outside this card is stopped for the whole shot.
//
// The beat the whole film is built around happens here: a held action arrives,
// it is scored and bound, it waits, a person allows it, and the decision becomes
// a record. Everything is a pure function of the shot-local frame.
//
// ACCENT BUDGET (direction.md): orange appears exactly twice — the HELD chip and
// the card's own rule — plus the Allow button's focus rule when the cursor takes
// it. Red appears once, as the risk figure's high band, which is the product's
// own UI state and not a mood. Nothing else in the shot is coloured.
//
// Figures (risk 0.82, the bound hash, 00:00:04) are illustrative product UI
// values, recorded as such in DISCLOSURE.md; the brief carries no numeric proof
// points so the film asserts none.

const PANEL_W = 1240;
const PANEL_X = (1920 - PANEL_W) / 2;
const PANEL_Y = 190;
const PAD = 48;

const CARD_Y = PANEL_Y + 68;
const CARD_H = 540;
const CARD_BOTTOM = CARD_Y + CARD_H;

// Footer controls, in frame coordinates, so the cursor's last waypoint and the
// focus rule land on the button rather than on wherever flex happened to put it.
const BTN_H = 74;
const ALLOW_W = 214;
const DENY_W = 190;
const BTN_Y = CARD_BOTTOM - PAD - BTN_H;
const ALLOW_X = PANEL_X + PANEL_W - PAD - ALLOW_W;
const DENY_X = ALLOW_X - 24 - DENY_W;
const ALLOW_CX = ALLOW_X + ALLOW_W / 2;
const ALLOW_CY = BTN_Y + BTN_H / 2;

// Beats. CLICK_AT is film frame 600 (450 + 150), the frame the spec names.
//
// CARD_IN is 0, not 4 (2026-09-03, off the v1 sheet). The card's spring starts
// on the cut so it arrives DURING Film.tsx's 8-frame handover rather than after
// it: at 4 the frame at film 458 was the dark approvals ground carrying nothing
// but its header, a third of a second of near-empty picture immediately after
// the film's biggest beat. The named beats downstream (the click at 600, the
// flip, the row) are untouched.
const CARD_IN = 0;
const CARD_RULE_IN = 6;
const CHIP_IN = 18;
const AGENT_IN = 22;
const COMMAND_IN = 26;
const RISK_IN = 34;
const BAND_IN = 40;
const BOUND_IN = 38;
const FOOTER_RULE_IN = 44;
const DENY_IN = 50;
const ALLOW_IN = 54;
const TIMER_FROM = 20;
const CURSOR_IN = 96;
const FOCUS_IN = 138;
const CLICK_AT = 150;
const FLIP_AT = 156;
const ROW_IN = 162;
const ROW_FALL = 176;
const ROW_FALL_DUR = 24;

const CURSOR_PATH: CursorWaypoint[] = [
  {x: 1790, y: 1030, at: 0},
  {x: 1612, y: 858, at: CURSOR_IN + 34},
  // Lands inside the button but low and right of its label, so the glyph never
  // covers the word the button is trying to say.
  {x: ALLOW_CX + 62, y: ALLOW_CY + 18, at: CLICK_AT - 2},
];

const COMMAND = 'deploy --prod';
const BOUND_HASH = 'a3f19c4e2b7d8051';
const DECISION_ID = 'd-4f21';
const RISK = 0.82;

// A left-to-right mask wipe (brand.motion.textReveal): glyph positions never
// move and the reveal edge stays hard. The orange chip in particular must never
// cross the frame at partial opacity — half-strength #f97316 over #15171c is a
// wash, which is the one thing this brand's voice forbids outright.
const wipeClip = (p: number): string => `inset(0 ${((1 - p) * 100).toFixed(3)}% 0 0)`;

// One box, two faces. Sized for the LONGER word so the state flip changes the
// colour and the label and nothing else.
const CHIP_W = 186;
const CHIP_H = 44;

const chipFace: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: CHIP_W,
  height: CHIP_H,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 500,
  fontSize: 26,
  letterSpacing: 4,
  boxSizing: 'border-box',
};

/** A field label: the small letterspaced word above a value. */
const Label: React.FC<{brand: Brand; mono: string; text: string; opacity: number}> = ({
  brand,
  mono,
  text,
  opacity,
}) => (
  <div
    style={{
      fontFamily: mono,
      fontWeight: 500,
      fontSize: 20,
      letterSpacing: 4,
      color: brand.colors.ink3,
      opacity,
    }}
  >
    {text}
  </div>
);

export const Shot04Intercept: React.FC<{brand: Brand; len: number; plates: boolean}> = ({brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);

  const ease = {easing: Easing.out(Easing.cubic)} as const;
  const head = entrance(frame, fps, brand.motion, {delayFrames: 2, durFrames: 12, ...ease});
  const card = brandSpring(frame, fps, brand.motion, {delayFrames: CARD_IN});
  const chip = brandSpring(frame, fps, brand.motion, {delayFrames: CHIP_IN});
  const agent = entrance(frame, fps, brand.motion, {delayFrames: AGENT_IN, durFrames: 10, ...ease});
  const command = entrance(frame, fps, brand.motion, {delayFrames: COMMAND_IN, durFrames: 12, ...ease});
  const risk = entrance(frame, fps, brand.motion, {delayFrames: RISK_IN, durFrames: 10, ...ease});
  const band = entrance(frame, fps, brand.motion, {delayFrames: BAND_IN, durFrames: 18, ...ease});
  const bound = entrance(frame, fps, brand.motion, {delayFrames: BOUND_IN, durFrames: 10, ...ease});
  const deny = brandSpring(frame, fps, brand.motion, {delayFrames: DENY_IN});
  const allow = brandSpring(frame, fps, brand.motion, {delayFrames: ALLOW_IN});
  const cursorInk = entrance(frame, fps, brand.motion, {delayFrames: CURSOR_IN, durFrames: 10, ...ease});
  const flip = entrance(frame, fps, brand.motion, {delayFrames: FLIP_AT, durFrames: 5, ...ease});
  const row = brandSpring(frame, fps, brand.motion, {delayFrames: ROW_IN});

  // The card arrives from the right and settles. translateX only: a card that
  // also scales reads as a modal, and this is an item in a list.
  const cardX = (1 - card) * 480;

  // The waiting timer. LINEAR and whole-second, because an eased counter reads
  // as a value being animated and this one has to read as a machine reporting.
  // It stops on the click: after ALLOWED nothing is waiting any more.
  const waited = Math.min(
    4,
    Math.max(0, Math.floor((Math.min(frame, CLICK_AT) - TIMER_FROM) / fps)),
  );
  // Dims once the decision is made rather than disappearing — the record keeps
  // how long it waited.
  const waitDim = interpolate(frame, [FLIP_AT, FLIP_AT + 8], [1, 0.5], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const press = controlPressScale(frame, CLICK_AT);
  const cursor = bowedPosition(frame, CURSOR_PATH);

  // The born ledger row: it lands under the card, then slides down out of frame
  // — the action leaving the inbox and entering the record. It is fully gone by
  // frame 200, so 200..217 hands a completely static picture to shot 5.
  const fall = entrance(frame, fps, brand.motion, {
    delayFrames: ROW_FALL,
    durFrames: ROW_FALL_DUR,
    ...ease,
  });
  const rowY = CARD_BOTTOM + 24 + (1 - row) * 18 + fall * 380;

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {/* Surface chrome: what this screen is, and the route it is rebuilt from. */}
      <div
        style={{
          position: 'absolute',
          left: PANEL_X,
          top: PANEL_Y,
          width: PANEL_W,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          fontFamily: fonts.mono,
          fontWeight: 500,
          fontSize: 24,
          letterSpacing: 5,
          color: brand.colors.ink3,
          opacity: head,
          transform: `translateY(${((1 - head) * 8).toFixed(2)}px)`,
        }}
      >
        <span>INTERCEPT AND HOLD</span>
        <span>/approvals</span>
      </div>

      {/* The held-action card. */}
      <div
        style={{
          position: 'absolute',
          left: PANEL_X,
          top: CARD_Y,
          width: PANEL_W,
          height: CARD_H,
          backgroundColor: brand.colors.surface,
          borderLeft: `1px solid ${brand.colors.line}`,
          borderRight: `1px solid ${brand.colors.line}`,
          borderBottom: `1px solid ${brand.colors.line}`,
          boxSizing: 'border-box',
          opacity: card,
          transform: `translateX(${cardX.toFixed(2)}px)`,
        }}
      >
        {/* The held card's rule: the accent that says this one is stopped. */}
        <Rule
          brand={brand}
          delayFrames={CARD_RULE_IN}
          durFrames={16}
          thickness={3}
          color={brand.colors.brand}
          width={PANEL_W}
        />

        <div style={{padding: `${PAD - 4}px ${PAD}px 0`}}>
          {/* State row: the chip, who did it, and how long it has waited. */}
          <div style={{display: 'flex', alignItems: 'center', gap: 22, height: 48}}>
            <span
              style={{
                position: 'relative',
                display: 'inline-block',
                width: CHIP_W,
                height: CHIP_H,
                transform: `scale(${entryScale(chip, brand.motion).toFixed(4)})`,
                transformOrigin: 'left center',
              }}
            >
              <span style={{...chipFace, backgroundColor: brand.colors.brand, color: brand.colors.ink, fontFamily: fonts.mono, clipPath: wipeClip(chip)}}>
                HELD
              </span>
              {/* ALLOWED wipes OVER the held chip: both states stay full
                  strength, so orange never crossfades into surface grey. Both
                  faces are the SAME fixed box — a chip that resized as it
                  flipped would shove `agent-7` sideways on the one frame the
                  viewer is reading the state change. */}
              <span style={{...chipFace, backgroundColor: brand.colors.surface2, color: brand.colors.ink2, fontFamily: fonts.mono, clipPath: wipeClip(flip)}}>
                ALLOWED
              </span>
            </span>
            <span
              style={{
                fontFamily: fonts.mono,
                fontWeight: 500,
                fontSize: 26,
                letterSpacing: 2,
                color: brand.colors.ink3,
                opacity: agent,
              }}
            >
              agent-7
            </span>
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: fonts.mono,
                fontWeight: 500,
                fontSize: 28,
                letterSpacing: 2,
                fontVariantNumeric: 'tabular-nums',
                color: brand.colors.ink2,
                opacity: agent * waitDim,
              }}
            >
              {`waiting 00:00:0${waited}`}
            </span>
          </div>

          {/* The command itself: the biggest thing on screen, because the whole
              product claim is that the REAL command is what gets held. */}
          <div style={{marginTop: 34}}>
            <Label brand={brand} mono={fonts.mono} text="command" opacity={command} />
            <div
              style={{
                marginTop: 8,
                fontFamily: fonts.mono,
                fontWeight: 500,
                fontSize: 76,
                letterSpacing: -1,
                lineHeight: 1.1,
                color: brand.colors.ink,
                clipPath: wipeClip(command),
              }}
            >
              {COMMAND}
            </div>
          </div>

          {/* Scored and bound, side by side: the two things that make the hold
              defensible rather than a pause. */}
          <div style={{display: 'flex', alignItems: 'flex-start', gap: 90, marginTop: 40}}>
            <div style={{width: 560}}>
              <Label brand={brand} mono={fonts.mono} text="risk" opacity={risk} />
              <div
                style={{
                  marginTop: 6,
                  fontFamily: fonts.mono,
                  fontWeight: 500,
                  fontSize: 44,
                  letterSpacing: 1,
                  fontVariantNumeric: 'tabular-nums',
                  color: brand.colors.ink,
                  opacity: risk,
                }}
              >
                {RISK.toFixed(2)}
              </div>
              <div
                style={{
                  marginTop: 14,
                  width: 520,
                  height: 10,
                  backgroundColor: brand.colors.surface2,
                }}
              >
                <div
                  style={{
                    width: `${(band * RISK * 100).toFixed(2)}%`,
                    height: '100%',
                    backgroundColor: brand.colors.loss,
                  }}
                />
              </div>
            </div>
            <div>
              <Label brand={brand} mono={fonts.mono} text="bound to" opacity={bound} />
              <div
                style={{
                  marginTop: 6,
                  fontFamily: fonts.mono,
                  fontWeight: 500,
                  fontSize: 30,
                  letterSpacing: 2,
                  color: brand.colors.ink2,
                  opacity: bound,
                }}
              >
                {BOUND_HASH}
              </div>
            </div>
          </div>
        </div>

        {/* Footer: the decision. */}
        <div style={{position: 'absolute', left: PAD, right: PAD, bottom: PAD + BTN_H + 26}}>
          <Rule brand={brand} delayFrames={FOOTER_RULE_IN} durFrames={14} thickness={1} />
        </div>
      </div>

      {/* Buttons live OUTSIDE the card's transform so the cursor's frame
          coordinates and the focus rule stay exact while the card slides. They
          ride the same opacity and translate so they arrive with it. */}
      <div style={{position: 'absolute', inset: 0, opacity: card, transform: `translateX(${cardX.toFixed(2)}px)`}}>
        <div
          style={{
            position: 'absolute',
            left: DENY_X,
            top: BTN_Y,
            width: DENY_W,
            height: BTN_H,
            boxSizing: 'border-box',
            border: `1px solid ${brand.colors.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: fonts.mono,
            fontWeight: 500,
            fontSize: 28,
            letterSpacing: 4,
            color: brand.colors.ink2,
            opacity: deny,
            transform: `scale(${entryScale(deny, brand.motion).toFixed(4)})`,
          }}
        >
          Deny
        </div>
        <div
          style={{
            position: 'absolute',
            left: ALLOW_X,
            top: BTN_Y,
            width: ALLOW_W,
            height: BTN_H,
            backgroundColor: brand.colors.surface2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: fonts.mono,
            fontWeight: 500,
            fontSize: 28,
            letterSpacing: 4,
            color: brand.colors.ink,
            opacity: allow,
            transform: `scale(${(entryScale(allow, brand.motion) * press).toFixed(4)})`,
          }}
        >
          Allow
        </div>
        {/* The focus rule: the cursor arrives, the control takes focus, THEN it
            is clicked. A button that is pressed without ever being focused is
            the tell that nobody is really driving. */}
        <div style={{position: 'absolute', left: ALLOW_X, top: BTN_Y + BTN_H}}>
          <Rule
            brand={brand}
            delayFrames={FOCUS_IN}
            durFrames={10}
            thickness={3}
            color={brand.colors.brand}
            width={ALLOW_W}
          />
        </div>
      </div>

      {/* The record being born: the row exists the instant the decision does,
          and leaves the inbox downward, toward the ledger shot 6 opens on. */}
      <div
        style={{
          position: 'absolute',
          left: PANEL_X,
          top: rowY,
          width: PANEL_W,
          height: 84,
          boxSizing: 'border-box',
          backgroundColor: brand.colors.surface2,
          borderTop: `1px solid ${brand.colors.line}`,
          display: 'flex',
          alignItems: 'center',
          gap: 40,
          padding: `0 ${PAD}px`,
          fontFamily: fonts.mono,
          fontWeight: 500,
          fontSize: 28,
          letterSpacing: 2,
          color: brand.colors.ink2,
          opacity: row * (1 - fall * 0.35),
        }}
      >
        <span>{`agent-7 · ${COMMAND}`}</span>
        <span style={{marginLeft: 'auto', color: brand.colors.ink3}}>{DECISION_ID}</span>
      </div>

      <div
        style={{
          position: 'absolute',
          left: cursor.x - CURSOR_TIP.x,
          top: cursor.y - CURSOR_TIP.y,
          opacity: cursorInk,
        }}
      >
        <CursorGlyph scale={1.3} />
      </div>
    </AbsoluteFill>
  );
};
