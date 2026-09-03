import React from 'react';
import type {Brand} from '../../../lib/brand';
import {HOLD_FRAME, RELEASE_FRAME} from '../timeline';

// The hall's clock: mono, tabular, bottom-left, ink3, on from the first frame.
// It is the only thing on screen in shot 1 besides the plate, and it is the
// film's proof that THE HOLD is a stop rather than a cut — it counts, it stops
// dead at 03:12:14 on frame 390, and it resumes when the world does.
//
// It never eases and never fades. A clock that animates reads as a graphic; this
// one has to read as a machine reporting, so it is a pure step function of the
// film frame (floor to whole seconds) and identical on every re-render.

/** 03:11:58 in seconds past midnight — the film's first frame. */
export const CLOCK_BASE = 11518;

/** Clock seconds the film covers before the hold. */
const CLOCK_SPAN = 16;

// SPEC RECONCILIATION: film-spec.md's shot-1 row says the count runs
// 03:11:58 -> 03:12:03 (real time over 150 frames) and its shot-3 row says it
// stops at 03:12:14 on frame 390 (16 seconds over 13). Both cannot be linear.
// 03:12:14 wins: it is the value frozen on screen for 60+ frames and it is the
// figure the brief restates. The clock therefore runs ~23% fast, which is
// invisible, still passes through 03:12:03 inside shot 1, and reads 03:12:04 at
// frame 150 instead of 03:12:03.
const CLOCK_RATE = CLOCK_SPAN / HOLD_FRAME;

/** Clock value, in seconds past midnight, at an ABSOLUTE film frame. */
export const clockSeconds = (filmFrame: number): number => {
  if (filmFrame <= HOLD_FRAME) return CLOCK_BASE + Math.max(0, filmFrame) * CLOCK_RATE;
  // Frozen through the hold AND through the inbox: the world is stopped for the
  // whole time the interface is deciding, which is the point of the shot.
  if (filmFrame < RELEASE_FRAME) return CLOCK_BASE + CLOCK_SPAN;
  return CLOCK_BASE + CLOCK_SPAN + (filmFrame - RELEASE_FRAME) * CLOCK_RATE;
};

const pad = (v: number): string => String(v).padStart(2, '0');

export const formatClock = (seconds: number): string => {
  const s = Math.floor(seconds);
  return `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

export type TimestampProps = {
  brand: Brand;
  mono: string;
  /** ABSOLUTE film frame; a shot passes `from + Math.min(local, freezeAt)`. */
  filmFrame: number;
  style?: React.CSSProperties;
};

export const Timestamp: React.FC<TimestampProps> = ({brand, mono, filmFrame, style}) => (
  <span
    style={{
      position: 'absolute',
      left: 76,
      bottom: 66,
      fontFamily: mono,
      fontWeight: 500,
      fontSize: 30,
      letterSpacing: 4,
      fontVariantNumeric: 'tabular-nums',
      color: brand.colors.ink3,
      ...style,
    }}
  >
    {formatClock(clockSeconds(filmFrame))}
  </span>
);
