import {describe, expect, it} from 'vitest';
import {
  brandSpring,
  entrance,
  staggerDelay,
  DEFAULT_MOTION,
  DURATION_MS,
  ENTRY_SCALE,
  STAGGER_MS,
  BEAT_CEILING_MS,
  entryScale,
  msFrames,
  staggerMsDelay,
  staggerEffectiveMs,
  type Motion,
} from './motion';

const FPS = 30;

// Sample a spring across a long-enough window that even the bounciest config settles.
const sample = (motion: Motion, opts: {delayFrames?: number} = {}, frames = 240): number[] =>
  Array.from({length: frames}, (_, f) => brandSpring(f, FPS, motion, opts));

const withExuberance = (exuberance: number): Motion => ({...DEFAULT_MOTION, exuberance});

describe('brandSpring', () => {
  it('starts at 0 and settles to 1 (rest position never changes)', () => {
    for (const e of [0, 0.15, 0.35, 0.5, 1]) {
      const s = sample(withExuberance(e));
      expect(s[0]).toBe(0);
      expect(s[s.length - 1]).toBeCloseTo(1, 3);
    }
  });

  it('exuberance 0 is critically damped: no overshoot past the rest point', () => {
    const s = sample(withExuberance(0));
    const peak = Math.max(...s);
    // an overdamped/critically-damped spring approaches 1 monotonically from below
    expect(peak).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('exuberance 1 is visibly bouncy: overshoots past the rest point', () => {
    const s = sample(withExuberance(1));
    const peak = Math.max(...s);
    // meaningfully past 1, not floating-point noise
    expect(peak).toBeGreaterThan(1.02);
  });

  it('the default (omitted) motion block does not overshoot — matches prior smooth feel', () => {
    const s = sample(DEFAULT_MOTION);
    expect(Math.max(...s)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('tempo 2 completes in half the frames: f_tempo2(t) == f_tempo1(2t)', () => {
    const base = withExuberance(0.2);
    for (const f of [3, 5, 8, 12, 20]) {
      const fast = brandSpring(f, FPS, {...base, tempo: 2});
      const slow = brandSpring(2 * f, FPS, {...base, tempo: 1});
      expect(fast).toBeCloseTo(slow, 6);
    }
  });

  it('delayFrames shifts the start without changing the curve', () => {
    const m = withExuberance(0.35);
    const undelayed = brandSpring(10, FPS, m);
    const delayed = brandSpring(30, FPS, m, {delayFrames: 20});
    expect(delayed).toBeCloseTo(undelayed, 6);
  });
});

describe('entrance', () => {
  it('is 0 at its start frame and clamps to 1 after its duration', () => {
    expect(entrance(0, FPS, DEFAULT_MOTION, {durFrames: 12})).toBe(0);
    expect(entrance(50, FPS, DEFAULT_MOTION, {durFrames: 12})).toBe(1);
  });

  it('tempo 2 completes an entrance in half the frames', () => {
    const dur = 12;
    // tempo 1 hits 1 exactly at frame `dur`; tempo 2 hits it at frame dur/2.
    expect(entrance(dur, FPS, DEFAULT_MOTION, {durFrames: dur})).toBe(1);
    expect(entrance(dur / 2, FPS, {...DEFAULT_MOTION, tempo: 2}, {durFrames: dur})).toBe(1);
    expect(entrance(dur / 2 - 1, FPS, {...DEFAULT_MOTION, tempo: 2}, {durFrames: dur})).toBeLessThan(1);
  });

  it('respects delayFrames', () => {
    expect(entrance(96, FPS, DEFAULT_MOTION, {delayFrames: 96, durFrames: 14})).toBe(0);
    expect(entrance(110, FPS, DEFAULT_MOTION, {delayFrames: 96, durFrames: 14})).toBe(1);
  });
});

describe('staggerDelay', () => {
  it('is an identity multiplier at the default stagger (preserves i*base cadence)', () => {
    expect(staggerDelay(0, 10, DEFAULT_MOTION)).toBe(0);
    expect(staggerDelay(3, 10, DEFAULT_MOTION)).toBe(30);
  });

  it('widens with higher stagger and collapses to 0 at stagger 0', () => {
    expect(staggerDelay(2, 10, {...DEFAULT_MOTION, stagger: 1})).toBe(40);
    expect(staggerDelay(2, 10, {...DEFAULT_MOTION, stagger: 0})).toBe(0);
  });
});

describe('msFrames', () => {
  it('converts a stated duration to frames at tempo 1', () => {
    expect(msFrames(200, FPS, DEFAULT_MOTION)).toBe(6); // 0.2s * 30fps
    expect(msFrames(1000, FPS, DEFAULT_MOTION)).toBe(30);
  });

  it('spends fewer frames on the same duration as tempo rises', () => {
    // Matches the brandSpring/entrance convention (elapsed frames * tempo).
    expect(msFrames(400, FPS, {...DEFAULT_MOTION, tempo: 2})).toBe(6);
    expect(msFrames(400, FPS, {...DEFAULT_MOTION, tempo: 0.5})).toBe(24);
  });

  it('never returns 0 frames (a 0-length interpolate range divides by zero)', () => {
    expect(msFrames(1, FPS, DEFAULT_MOTION)).toBe(1);
    expect(msFrames(0, FPS, {...DEFAULT_MOTION, tempo: 2})).toBe(1);
  });
});

describe('entryScale', () => {
  it('settles exactly at 1 so rest positions never move', () => {
    for (const e of [0, 0.35, 1]) {
      expect(entryScale(1, {...DEFAULT_MOTION, exuberance: e})).toBe(1);
    }
  });

  it('never starts at 0 — it starts inside the safe band', () => {
    const [lo, hi] = ENTRY_SCALE;
    for (const e of [0, 0.15, 0.5, 1]) {
      const start = entryScale(0, {...DEFAULT_MOTION, exuberance: e});
      expect(start).toBeGreaterThanOrEqual(lo);
      expect(start).toBeLessThanOrEqual(hi);
    }
  });

  it('travels further for a more exuberant brand', () => {
    expect(entryScale(0, {...DEFAULT_MOTION, exuberance: 0})).toBeCloseTo(ENTRY_SCALE[1], 6);
    expect(entryScale(0, {...DEFAULT_MOTION, exuberance: 1})).toBeCloseTo(ENTRY_SCALE[0], 6);
  });

  it('clamps out-of-range progress instead of overshooting the rest position', () => {
    expect(entryScale(2, DEFAULT_MOTION)).toBe(1);
    expect(entryScale(-1, DEFAULT_MOTION)).toBe(entryScale(0, DEFAULT_MOTION));
  });
});

describe('stagger in milliseconds', () => {
  it('staggerMsDelay is 0 for the first item and grows linearly', () => {
    expect(staggerMsDelay(0, 60, FPS, DEFAULT_MOTION)).toBe(0);
    expect(staggerMsDelay(2, 100, FPS, DEFAULT_MOTION)).toBe(6); // 2 * 0.1s * 30fps
  });

  it('staggerEffectiveMs inverts staggerDelay for one step', () => {
    const baseFrames = 2;
    const gapFrames = staggerDelay(1, baseFrames, DEFAULT_MOTION);
    expect(staggerEffectiveMs(baseFrames, FPS, DEFAULT_MOTION)).toBeCloseTo(
      (gapFrames * 1000) / FPS,
      6,
    );
  });

  it('the repo default cadence lands inside the perceptible band', () => {
    // 2 base frames at 30fps with the default stagger multiplier == 66.7ms.
    const ms = staggerEffectiveMs(2, FPS, DEFAULT_MOTION);
    expect(ms).toBeGreaterThanOrEqual(STAGGER_MS[0]);
    expect(ms).toBeLessThanOrEqual(STAGGER_MS[1]);
  });
});

describe('duration standards', () => {
  it('every band is ordered and sits under the single-beat ceiling except panel', () => {
    for (const [name, [lo, hi]] of Object.entries(DURATION_MS)) {
      expect(hi).toBeGreaterThan(lo);
      if (name !== 'panel') expect(hi).toBeLessThanOrEqual(BEAT_CEILING_MS);
    }
  });
});
