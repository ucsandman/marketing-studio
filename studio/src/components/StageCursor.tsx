import React from 'react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';
import type {Brand} from '../lib/brand';
import {pointerPhaseAt, pressScaleAt, smootherstep} from '../lib/motion';

// Choreographed cursor for staged UI shots (docs/product-launch-motion-adoption.md,
// Phase C). Unlike DemoCursor (telemetry-driven overlay for captured demos), this
// cursor is a directed stage prop: waypoints say where it ARRIVES and when — a
// click lands on its cued frame, travel starts earlier. It must render INSIDE the
// CameraRig stage node or it drifts off target during turns and pushes.

export type CursorWaypoint = {x: number; y: number; at: number}; // arrive by frame `at`
export type CursorClickCue = {at: number}; // frames; cursor must be at rest here

// Travel window before arrival. x and y run different eases AND different
// durations so the path bows — straight-line travel is the #1 fake-cursor tell.
const TRAVEL = 9; // frames (~0.3s @30)
const X_PORTION = 0.83; // x finishes early; y takes the whole window
const ANTICIPATION_PX = 8; // brief pull-back before a committed move
const ANTICIPATION_FRAMES = 2;

// Glyph: 44x54 at scale 1 (life-size ~32px vanishes into saturated controls).
// White fill + heavy dark stroke + deep shadow survives light AND dark UI.
// The TIP sits at (6, 3) inside the box — position by the tip, not the corner.
export const CURSOR_TIP = {x: 6, y: 3};

export const CursorGlyph: React.FC<{scale?: number; style?: React.CSSProperties}> = ({scale = 1, style}) => (
  <svg
    viewBox="0 0 24 30"
    width={44 * scale}
    height={54 * scale}
    style={{display: 'block', filter: 'drop-shadow(0 6px 16px rgba(16,14,25,0.42))', ...style}}
  >
    <path
      d="M3.4 1.6 L3.4 25.4 L9.7 19.4 L13.7 29.2 L17.9 27.3 L14 17.7 L21.9 17.1 Z"
      fill="#FFFFFF"
      stroke="rgba(16,14,25,0.8)"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

// Press dip for the CLICKED CONTROL: a cursor pressing a static button is
// uncanny. Multiply the control's scale by this around each click frame.
export const controlPressScale = (frame: number, clickFrame: number): number => {
  return pressScaleAt(frame, clickFrame, {press: 3, release: 9, depth: 0.06});
};

const positionAt = (path: CursorWaypoint[], frame: number): {x: number; y: number} => {
  if (path.length === 0) return {x: 0, y: 0};
  // i = last waypoint whose travel window has started; path[0] is the initial
  // rest position and is never traveled to.
  let i = 0;
  while (i + 1 < path.length && path[i + 1].at - TRAVEL <= frame) i++;
  const to = path[i];
  const from = path[Math.max(0, i - 1)];
  const atRest = i === 0 || frame >= to.at;
  if (atRest) {
    const next = path[i + 1];
    if (next) {
      const depart = next.at - TRAVEL;
      const dt = frame - (depart - ANTICIPATION_FRAMES);
      if (dt >= 0) {
        const d = Math.hypot(next.x - to.x, next.y - to.y) || 1;
        const p = interpolate(dt, [0, ANTICIPATION_FRAMES], [0, 1], {
          extrapolateRight: 'clamp',
          easing: Easing.out(Easing.quad),
        });
        return {
          x: to.x - ((next.x - to.x) / d) * ANTICIPATION_PX * p,
          y: to.y - ((next.y - to.y) / d) * ANTICIPATION_PX * p,
        };
      }
    }
    return {x: to.x, y: to.y};
  }
  const start = to.at - TRAVEL;
  const px = interpolate(frame, [start, start + TRAVEL * X_PORTION], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const py = interpolate(frame, [start, to.at], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.quad),
  });
  return {x: from.x + (to.x - from.x) * px, y: from.y + (to.y - from.y) * py};
};

export const StageCursor: React.FC<{
  path: CursorWaypoint[];
  clicks?: CursorClickCue[];
  brand: Brand;
  appearAt?: number; // fade in start
  exitAt?: number | null; // fade out when its work is done — never park it
  emphasis?: 'none' | 'ring' | 'glow';
}> = ({path, clicks = [], brand, appearAt = 0, exitAt = null, emphasis = 'ring'}) => {
  const frame = useCurrentFrame();
  const {x, y} = positionAt(path, frame);
  const appear = interpolate(frame, [appearAt, appearAt + 5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exit =
    exitAt === null
      ? 1
      : interpolate(frame, [exitAt, exitAt + 6], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

  const cueTimes = clicks.map((click) => click.at);
  const activeCue = [...cueTimes].reverse().find((cue) => cue <= frame);
  const press =
    activeCue === undefined
      ? 1
      : pressScaleAt(frame, activeCue, {press: 2, release: 8, depth: 0.14});
  const phase = pointerPhaseAt(cueTimes, frame, {approach: TRAVEL, hover: 3, press: 2, release: 8});

  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      {clicks.map((c, key) => {
        const dt = frame - c.at;
        if (dt < -3 || dt > 13) return null;
        const clickPosition = positionAt(path, c.at);
        const bloomOpacity =
          dt < 0
            ? interpolate(dt, [-3, 0], [0, 1], {easing: Easing.out(Easing.quad)})
            : interpolate(dt, [0, 10], [1, 0], {
                extrapolateRight: 'clamp',
                easing: Easing.out(Easing.quad),
              });
        const bloomScale =
          dt < 0
            ? interpolate(dt, [-3, 0], [0.3, 0.62], {easing: Easing.out(Easing.quad)})
            : interpolate(dt, [0, 10], [0.62, 1.15], {
                extrapolateRight: 'clamp',
                easing: Easing.out(Easing.quad),
              });
        const ringP = smootherstep(Math.max(0, dt) / 13);
        return (
          <React.Fragment key={key}>
            {emphasis === 'glow' ? (
              <div
                style={{
                  position: 'absolute',
                  left: clickPosition.x - 74,
                  top: clickPosition.y - 74,
                  width: 148,
                  height: 148,
                  borderRadius: '50%',
                  background: `radial-gradient(circle, ${brand.colors.brand}55, transparent 70%)`,
                  opacity: bloomOpacity,
                  transform: `scale(${bloomScale})`,
                }}
              />
            ) : null}
            {dt >= 0 && emphasis !== 'none' ? (
              <div
                style={{
                  position: 'absolute',
                  left: clickPosition.x - 52,
                  top: clickPosition.y - 52,
                  width: 104,
                  height: 104,
                  borderRadius: '50%',
                  border: `2.5px solid ${brand.colors.brand}`,
                  opacity: 0.75 * (1 - ringP),
                  transform: `scale(${0.34 + 1.16 * ringP})`,
                }}
              />
            ) : null}
          </React.Fragment>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: x - CURSOR_TIP.x,
          top: y - CURSOR_TIP.y,
          opacity: appear * exit,
          transform: `scale(${press})`,
          transformOrigin: '14% 6%', // the tip — press scales about the touch point
        }}
        data-cursor-phase={phase}
      >
        <CursorGlyph />
      </div>
    </div>
  );
};
