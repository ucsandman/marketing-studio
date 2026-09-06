/* eslint-disable @remotion/non-pure-animation -- pure functions receive timeline time explicitly */
import type {FocusEvent} from './telemetry';

export type Viewport = {width: number; height: number};
export type CameraSubject = {x: number; y: number; w: number; h: number};
export type CameraState = {scale: number; originX: number; originY: number};
export type ShotScale = 'wide' | 'medium' | 'close' | 'detail';
export type CameraSafeInsets = {top: number; right: number; bottom: number; left: number};

export type CameraCue = {
  at: number;
  subject: CameraSubject;
  scale?: ShotScale;
  /** Time spent moving, in the same unit as `at`. */
  transition?: number;
  /** Minimum still hold after the move, in the same unit as `at`. */
  hold?: number;
};

export type CameraOptions = {
  scale?: ShotScale | 'auto';
  transition?: number;
  safe?: Partial<CameraSafeInsets>;
};

const SHOT_SCALE: Record<ShotScale, {fill: number; max: number}> = {
  wide: {fill: 0.74, max: 1.15},
  medium: {fill: 0.84, max: 1.35},
  // The legacy telemetry framing. Keeping these values makes an explicit close
  // shot identical to the previous one-scale camera.
  close: {fill: 0.92, max: 1.6},
  // A measured row/card around 30% of the stage width needs roughly 3x to read
  // as a true insert. Edge guards below still prevent this macro scale from
  // exposing pixels outside the captured plate.
  detail: {fill: 0.97, max: 3.4},
};

const ZERO_SAFE: CameraSafeInsets = {top: 0, right: 0, bottom: 0, left: 0};
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);
const smootherstep = (v: number): number => {
  const t = clamp(v, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const restCamera = (viewport: Viewport): CameraState => ({
  scale: 1,
  originX: viewport.width / 2,
  originY: viewport.height / 2,
});

/** Keep the authored subject entirely inside the source viewport. */
export const guardSubject = (subject: CameraSubject, viewport: Viewport): CameraSubject => {
  const w = clamp(finite(subject.w, viewport.width), 1, viewport.width);
  const h = clamp(finite(subject.h, viewport.height), 1, viewport.height);
  return {
    x: clamp(finite(subject.x, viewport.width / 2), w / 2, viewport.width - w / 2),
    y: clamp(finite(subject.y, viewport.height / 2), h / 2, viewport.height - h / 2),
    w,
    h,
  };
};

/** Pick a semantic scale from measured subject coverage. */
export const shotScaleFor = (subject: CameraSubject, viewport: Viewport): ShotScale => {
  const s = guardSubject(subject, viewport);
  const coverage = (s.w * s.h) / (viewport.width * viewport.height);
  if (coverage >= 0.55) return 'wide';
  if (coverage >= 0.28) return 'medium';
  if (coverage >= 0.12) return 'close';
  return 'detail';
};

/** Frame a real measured subject without exposing pixels outside the stage. */
export const frameSubject = (
  subject: CameraSubject,
  viewport: Viewport,
  shotScale: ShotScale = 'close',
  safeInput: Partial<CameraSafeInsets> = ZERO_SAFE,
): CameraState => {
  const s = guardSubject(subject, viewport);
  const safe = {...ZERO_SAFE, ...safeInput};
  const usableW = Math.max(1, viewport.width - safe.left - safe.right);
  const usableH = Math.max(1, viewport.height - safe.top - safe.bottom);
  const profile = SHOT_SCALE[shotScale];
  const scale = Math.min(
    profile.max,
    Math.max(1, profile.fill * Math.min(usableW / s.w, usableH / s.h)),
  );
  const halfW = viewport.width / scale / 2;
  const halfH = viewport.height / scale / 2;
  const safeCenterX = (safe.left + viewport.width - safe.right) / 2;
  const safeCenterY = (safe.top + viewport.height - safe.bottom) / 2;
  const desiredX = s.x - (safeCenterX - viewport.width / 2) / scale;
  const desiredY = s.y - (safeCenterY - viewport.height / 2) / scale;
  return {
    scale,
    originX: clamp(desiredX, halfW, viewport.width - halfW),
    originY: clamp(desiredY, halfH, viewport.height - halfH),
  };
};

/**
 * Deterministic C1-continuous choreography. Overlapping cues are delayed until
 * the preceding transition and authored hold finish, so an in-flight camera
 * can never teleport to a newly reconstructed start state.
 */
export const cameraAtCues = (
  cues: CameraCue[],
  now: number,
  viewport: Viewport,
  safe: Partial<CameraSafeInsets> = ZERO_SAFE,
): CameraState => {
  const rest = restCamera(viewport);
  if (cues.length === 0) return rest;
  let earliest = -Infinity;
  let from = rest;
  for (const cue of [...cues].sort((a, b) => a.at - b.at)) {
    const transition = Math.max(1, finite(cue.transition ?? 1, 1));
    const hold = Math.max(0, finite(cue.hold ?? 0, 0));
    const start = Math.max(finite(cue.at, earliest), earliest);
    const target = frameSubject(cue.subject, viewport, cue.scale ?? 'close', safe);
    if (now < start) return from;
    if (now < start + transition) {
      const p = smootherstep((now - start) / transition);
      return {
        scale: from.scale + (target.scale - from.scale) * p,
        originX: from.originX + (target.originX - from.originX) * p,
        originY: from.originY + (target.originY - from.originY) * p,
      };
    }
    from = target;
    earliest = start + transition + hold;
  }
  return from;
};

export const cameraAt = (
  focusList: FocusEvent[],
  tMs: number,
  viewport: Viewport,
  options: CameraOptions = {},
): CameraState => {
  const transition = options.transition ?? 900;
  return cameraAtCues(
    focusList.map((focus) => ({
      at: focus.t,
      subject: focus,
      scale: options.scale === 'auto' ? shotScaleFor(focus, viewport) : (options.scale ?? 'close'),
      transition,
    })),
    tMs,
    viewport,
    options.safe,
  );
};
