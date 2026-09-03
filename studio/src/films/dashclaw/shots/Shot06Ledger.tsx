import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {brandSpring, entrance, staggerDelay} from '../../../lib/motion';
import {Caption, Rule} from '../ui';

// Shot 6 "ledger" (film 810-967, 158 frames incl. the 8-frame handover tail). The
// second evidence ground: DashClaw's decisions ledger, REBUILT as native UI on
// the dark ground — same discipline as shot 4's approvals inbox, never a
// screenshot, never a capture.
//
// The argument this shot carries alone: the row shot 4 just produced is not a
// bare log line, it is CHAINED to the decision that released it. Everything is a
// pure function of the shot-local frame, and every beat is settled well before
// frame 130 so shot 7 wipes over a completely static picture.
//
// ACCENT BUDGET (direction.md): orange appears exactly once — the chain rule
// linking row 1's action cell to its decision id. Green appears exactly once —
// row 1's verified tick plus the word itself. Nothing else in the shot is
// coloured.
//
// Figures (spend, risk, decision ids) are illustrative product UI values,
// recorded as such in DISCLOSURE.md; the brief carries no numeric proof points
// so the film asserts none.

const PANEL_W = 1240;
const PANEL_X = (1920 - PANEL_W) / 2;
const PANEL_Y = 190;
const PAD = 48;

// Table geometry, laid out downward from the panel top the same way shot 4 lays
// its card downward from PANEL_Y — every row position is a constant, never a
// flow measurement, so the chain rule below can target an exact cell.
const HEADER_Y = PANEL_Y + 70;
const HEADER_RULE_Y = HEADER_Y + 34;
const ROWS_Y = HEADER_RULE_Y + 14;
// 130, not 108: read off the shot-6 contact sheet against shot 4's. At 108 the
// table closed at y=672 and left the bottom third of the frame dead, while the
// inbox card next door runs to 798 — cutting between two views of one product
// that occupy visibly different amounts of the frame reads as two different
// screens. 130 lands the caption at 775 and gives the rows the air their type
// size wants.
const ROW_H = 130;
const TABLE_BOTTOM = ROWS_Y + ROW_H * 3;
const CAPTION_Y = TABLE_BOTTOM + 40;

// Beats. staggerDelay(i, ROW_STAGGER, motion) waterfalls the three rows in
// top-to-bottom off ROW_IN; at this brand's stagger token row 1 lands ~frame 16.
const HEAD_IN = 2;
const HEADER_IN = 6;
const ROW_IN = 16;
const ROW_STAGGER = 5;
// A few frames after row 1 lands, not after it fully settles — the same short
// lag shot 4 uses between its card arriving and the card's own accent rule.
const CHAIN_IN = ROW_IN + 10;
const CHAIN_DUR = 18;
// The tick draws once the chain has finished — the row reads as verified only
// after it is shown to be bound to its decision.
const TICK_IN = CHAIN_IN + CHAIN_DUR + 4;
const CAPTION_IN = 60;

type Col = {key: string; label: string; width: number};

const COLS: Col[] = [
  {key: 'action', label: 'agent · action', width: 500},
  {key: 'decision', label: 'decision', width: 180},
  {key: 'spend', label: 'spend', width: 150},
  {key: 'risk', label: 'risk', width: 130},
  {key: 'outcome', label: 'outcome', width: 184},
];

type RowData = {
  action: string;
  decision: string;
  spend: string;
  risk: string;
  outcome: 'verified' | 'recorded';
};

// Row 1 is the exact action shot 4 just allowed: same agent, same command, same
// decision id it was bound to there.
const ROWS: RowData[] = [
  {action: 'agent-7 · deploy --prod', decision: 'd-4f21', spend: '$0.00', risk: '0.82', outcome: 'verified'},
  {action: 'agent-7 · write s3://releases', decision: 'd-4f19', spend: '$0.02', risk: '0.41', outcome: 'recorded'},
  {action: 'agent-3 · rotate api key', decision: 'd-4f17', spend: '$0.00', risk: '0.63', outcome: 'recorded'},
];

/** One typographic cell: a column's label or a row's figure, same shape either way. */
const Cell: React.FC<{
  mono: string;
  text: string;
  width: number;
  fontSize: number;
  letterSpacing: number;
  color: string;
  tabular?: boolean;
}> = ({mono, text, width, fontSize, letterSpacing, color, tabular}) => (
  <div
    style={{
      width,
      flexShrink: 0,
      fontFamily: mono,
      fontWeight: 500,
      fontSize,
      letterSpacing,
      color,
      fontVariantNumeric: tabular ? 'tabular-nums' : undefined,
    }}
  >
    {text}
  </div>
);

// The verified checkmark: one polyline whose dash offset retreats, so the
// stroke draws itself. Adapted from postflop's Shot03Composer Tick, stroked in
// the brand's safe green with the surrounding square dropped — this is a status
// glyph inline with a word, not a chip.
const TICK_LEN = 28;

const VerifiedTick: React.FC<{brand: Brand; delayFrames: number}> = ({brand, delayFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = entrance(frame, fps, brand.motion, {
    delayFrames,
    durFrames: 10,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <svg width={22} height={22} viewBox="0 0 30 30" style={{flexShrink: 0}}>
      <polyline
        points="7,15 13,21 23,8"
        fill="none"
        stroke={brand.colors.safe}
        strokeWidth={3}
        strokeLinecap="square"
        strokeDasharray={TICK_LEN}
        strokeDashoffset={(TICK_LEN * (1 - p)).toFixed(2)}
      />
    </svg>
  );
};

/** One ledger row: a brandSpring waterfall entrance, opacity plus a small
 * downward-to-rest translateY, a 1px bottom border, tabular-nums throughout. */
const LedgerRow: React.FC<{brand: Brand; mono: string; data: RowData; index: number; top: number}> = ({
  brand,
  mono,
  data,
  index,
  top,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const delay = ROW_IN + staggerDelay(index, ROW_STAGGER, brand.motion);
  const p = brandSpring(frame, fps, brand.motion, {delayFrames: delay});
  const verified = data.outcome === 'verified';
  return (
    <div
      style={{
        position: 'absolute',
        left: PANEL_X,
        top,
        width: PANEL_W,
        height: ROW_H,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${PAD}px`,
        borderBottom: `1px solid ${brand.colors.line}`,
        opacity: p,
        transform: `translateY(${((1 - p) * -14).toFixed(2)}px)`,
      }}
    >
      <Cell mono={mono} text={data.action} width={COLS[0].width} fontSize={24} letterSpacing={2} color={brand.colors.ink} />
      <Cell mono={mono} text={data.decision} width={COLS[1].width} fontSize={28} letterSpacing={2} color={brand.colors.ink2} tabular />
      <Cell mono={mono} text={data.spend} width={COLS[2].width} fontSize={28} letterSpacing={2} color={brand.colors.ink2} tabular />
      <Cell mono={mono} text={data.risk} width={COLS[3].width} fontSize={28} letterSpacing={2} color={brand.colors.ink2} tabular />
      <div style={{width: COLS[4].width, display: 'flex', alignItems: 'center'}}>
        {/* Fixed glyph slot, not a conditional flex gap: "verified" and
            "recorded" start at the same x whether or not a row has a tick. */}
        <div style={{width: 32, display: 'flex', alignItems: 'center', flexShrink: 0}}>
          {verified && <VerifiedTick brand={brand} delayFrames={TICK_IN} />}
        </div>
        <span
          style={{
            fontFamily: mono,
            fontWeight: 500,
            fontSize: 24,
            letterSpacing: 2,
            color: verified ? brand.colors.safe : brand.colors.ink3,
          }}
        >
          {data.outcome}
        </span>
      </div>
    </div>
  );
};

export const Shot06Ledger: React.FC<{brand: Brand; len: number; plates: boolean}> = ({brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);

  const ease = {easing: Easing.out(Easing.cubic)} as const;
  const head = entrance(frame, fps, brand.motion, {delayFrames: HEAD_IN, durFrames: 12, ...ease});
  const header = entrance(frame, fps, brand.motion, {delayFrames: HEADER_IN, durFrames: 12, ...ease});

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {/* Surface chrome: what this screen is, and the route it is rebuilt from —
          same shape and constants as shot 4's chrome row. */}
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
        <span>RECORDED AND VERIFIED</span>
        <span>/decisions</span>
      </div>

      {/* Column header row. */}
      <div
        style={{
          position: 'absolute',
          left: PANEL_X,
          top: HEADER_Y,
          width: PANEL_W,
          display: 'flex',
          padding: `0 ${PAD}px`,
          boxSizing: 'border-box',
          opacity: header,
        }}
      >
        {COLS.map((col) => (
          <Cell
            key={col.key}
            mono={fonts.mono}
            text={col.label}
            width={col.width}
            fontSize={20}
            letterSpacing={4}
            color={brand.colors.ink3}
          />
        ))}
      </div>
      <div style={{position: 'absolute', left: PANEL_X + PAD, top: HEADER_RULE_Y, width: PANEL_W - PAD * 2}}>
        <Rule brand={brand} delayFrames={HEADER_IN} durFrames={14} thickness={1} />
      </div>

      {/* The three governed actions, waterfalling top to bottom. */}
      {ROWS.map((row, index) => (
        <LedgerRow key={row.decision} brand={brand} mono={fonts.mono} data={row} index={index} top={ROWS_Y + index * ROW_H} />
      ))}

      {/* THE CHAIN: the shot's single argument. A thin orange rule drawing under
          row 1's action cell into its decision id — the row is chained to the
          decision that released it, not just logged beside it. Lives as a
          frame-coordinate sibling of the row, NOT nested inside it: nested, it
          would inherit the row's partial entrance opacity, and half-strength
          #f97316 over the surface is the wash this brand's voice forbids
          outright (same reason shot 4's buttons live outside its card). */}
      {/* ROWS_Y + 87, not + 74: ROW_H grew to 130, so row 1's content centres
          lower and the rule has to follow it to stay ~8px under the baseline. */}
      <div style={{position: 'absolute', left: PANEL_X + PAD, top: ROWS_Y + 87, width: COLS[0].width + 120}}>
        <Rule brand={brand} delayFrames={CHAIN_IN} durFrames={CHAIN_DUR} thickness={2} color={brand.colors.brand} />
      </div>

      {/* PANEL_X + PAD, not PANEL_X: every row's text starts inside the table's
          own padding, and on the contact sheet the caption sat 48px left of the
          column it is describing. */}
      <div style={{position: 'absolute', left: PANEL_X + PAD, top: CAPTION_Y, width: PANEL_W - PAD * 2}}>
        <Caption brand={brand} mono={fonts.mono} text="chained to the decision that allowed it" delayFrames={CAPTION_IN} />
      </div>
    </AbsoluteFill>
  );
};
