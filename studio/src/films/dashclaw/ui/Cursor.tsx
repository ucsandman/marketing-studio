import {Easing, interpolate} from 'remotion';
import React from 'react';
import {CURSOR_TIP, CursorGlyph as RawCursorGlyph} from '../../../components/StageCursor';

// The film draws its own cursor rather than mounting <StageCursor>, because the
// stage cursor's click stack paints an accent bloom and an accent ring — and on
// this brand orange is a SIGNAL, never a wash or a glow field. A bloom around the
// pointer would spend the film's entire accent budget on a decoration. So the kit
// re-exports the GLYPH plus the travel math, and the shot composes the press
// feedback it wants out of the button's own focus rule and controlPressScale.
//
// bowedPosition is the same trick StageCursor uses and the #1 tell it exists to
// kill: x and y run different eases over different windows, so the path bows
// instead of running a dead straight line between waypoints.

export {CURSOR_TIP};

/**
 * The stage glyph with its drop-shadow off. The shadow is tuned for light product
 * UI; over this film's near-black ground it is invisible at best and a smudge at
 * worst, and the white glyph already carries its own contrast.
 */
export const CursorGlyph: React.FC<{scale?: number; style?: React.CSSProperties}> = ({
  scale = 1,
  style,
}) => <RawCursorGlyph scale={scale} style={{filter: 'none', ...style}} />;

export type CursorWaypoint = {x: number; y: number; at: number};

/** Frames a move takes; a waypoint's `at` is the ARRIVAL frame, travel starts earlier. */
export const CURSOR_TRAVEL = 9;

/** x finishes early, y takes the whole window — that difference is the bow. */
const X_PORTION = 0.83;

/**
 * Cursor tip position at a shot-local frame. `waypoints[0]` is the rest position
 * the cursor starts at and is never traveled to; every later waypoint is arrived
 * at by its `at` frame.
 */
export const bowedPosition = (
  frame: number,
  waypoints: CursorWaypoint[],
): {x: number; y: number} => {
  if (waypoints.length === 0) return {x: 0, y: 0};
  let i = 0;
  while (i + 1 < waypoints.length && waypoints[i + 1].at - CURSOR_TRAVEL <= frame) i++;
  const to = waypoints[i];
  if (i === 0 || frame >= to.at) return {x: to.x, y: to.y};
  const from = waypoints[i - 1];
  const start = to.at - CURSOR_TRAVEL;
  const px = interpolate(frame, [start, start + CURSOR_TRAVEL * X_PORTION], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const py = interpolate(frame, [start, to.at], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.quad),
  });
  return {x: from.x + (to.x - from.x) * px, y: from.y + (to.y - from.y) * py};
};
