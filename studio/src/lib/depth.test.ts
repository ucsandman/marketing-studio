import {describe, expect, it} from 'vitest';
import {
  parallaxOffset,
  settleOn,
  offsetTransform,
  settleTransform,
} from './depth';
import {DEFAULT_MOTION, type Motion} from './motion';

const FPS = 30;

const withParallax = (parallax: number): Motion => ({...DEFAULT_MOTION, parallax});
const withSettle = (settle: number): Motion => ({...DEFAULT_MOTION, settle});

describe('parallaxOffset', () => {
  it('is exactly {0,0} at parallax 0 for every frame, layer, and seed', () => {
    const flat = withParallax(0);
    for (const frame of [0, 1, 37, 220, 999]) {
      for (const depth of [0, 0.25, 0.6, 1]) {
        for (const seed of ['a', 'b', 'synthacon:bg']) {
          const o = parallaxOffset(frame, FPS, depth, flat, seed);
          expect(o.x).toBe(0);
          expect(o.y).toBe(0);
        }
      }
    }
  });

  it('is deterministic: same inputs -> same output', () => {
    const m = withParallax(0.3);
    const a = parallaxOffset(123, FPS, 1, m, 'synthacon:bg');
    const b = parallaxOffset(123, FPS, 1, m, 'synthacon:bg');
    expect(a).toEqual(b);
  });

  it('different seeds decorrelate layers (not identical drift)', () => {
    const m = withParallax(0.3);
    const a = parallaxOffset(200, FPS, 1, m, 'synthacon:bg');
    const b = parallaxOffset(200, FPS, 1, m, 'synthacon:content');
    expect(a).not.toEqual(b);
  });

  it('amplitude scales with parallax and layer depth (background drifts more)', () => {
    // At a fixed frame the |offset| grows with both parallax and layerDepth. Use a
    // frame where the seeded sine is safely away from a zero crossing.
    const seed = 'synthacon:bg';
    const frame = 200;
    const strong = parallaxOffset(frame, FPS, 1, withParallax(0.5), seed);
    const weak = parallaxOffset(frame, FPS, 1, withParallax(0.25), seed);
    expect(Math.abs(strong.x)).toBeGreaterThan(Math.abs(weak.x));
    const far = parallaxOffset(frame, FPS, 1, withParallax(0.5), seed);
    const near = parallaxOffset(frame, FPS, 0.25, withParallax(0.5), seed);
    expect(Math.abs(far.x)).toBeGreaterThan(Math.abs(near.x));
  });

  it('drift is slow and smooth: tiny change frame-to-frame, bounded amplitude', () => {
    const m = withParallax(1); // worst case amplitude
    const seed = 'synthacon:bg';
    let prev = parallaxOffset(0, FPS, 1, m, seed);
    for (let f = 1; f <= 300; f++) {
      const cur = parallaxOffset(f, FPS, 1, m, seed);
      // one-frame step stays sub-pixel (period is tens of seconds)
      expect(Math.abs(cur.x - prev.x)).toBeLessThan(0.5);
      expect(Math.abs(cur.y - prev.y)).toBeLessThan(0.5);
      // amplitude never runs away
      expect(Math.abs(cur.x)).toBeLessThanOrEqual(22 + 1e-9);
      expect(Math.abs(cur.y)).toBeLessThanOrEqual(22 + 1e-9);
      prev = cur;
    }
  });
});

describe('settleOn', () => {
  it('is identity at settle 0 for every frame', () => {
    const flat = withSettle(0);
    for (const f of [100, 108, 120, 140, 200]) {
      expect(settleOn(f, 100, FPS, flat)).toEqual({x: 0, y: 0, scale: 1});
    }
  });

  it('is identity before the cut', () => {
    const m = withSettle(1);
    expect(settleOn(99, 100, FPS, m)).toEqual({x: 0, y: 0, scale: 1});
  });

  it('kicks on the cut frame (non-identity) at full settle', () => {
    const m = withSettle(1);
    const s = settleOn(100, 100, FPS, m);
    // peak displacement lands on the cut frame
    expect(Math.abs(s.x)).toBeGreaterThan(1);
    expect(s.scale).not.toBe(1);
  });

  it('decays to identity within 30 frames', () => {
    const m = withSettle(1);
    const s = settleOn(130, 100, FPS, m);
    expect(Math.abs(s.x)).toBeLessThan(0.1);
    expect(Math.abs(s.y)).toBeLessThan(0.1);
    expect(Math.abs(s.scale - 1)).toBeLessThan(0.0001);
  });

  it('is deterministic: same inputs -> same output', () => {
    const m = withSettle(0.5);
    expect(settleOn(105, 100, FPS, m)).toEqual(settleOn(105, 100, FPS, m));
  });

  it('amplitude scales with settle', () => {
    const strong = settleOn(103, 100, FPS, withSettle(0.9));
    const weak = settleOn(103, 100, FPS, withSettle(0.3));
    expect(Math.abs(strong.x)).toBeGreaterThan(Math.abs(weak.x));
  });
});

describe('transform builders', () => {
  it('offsetTransform is empty on a zero offset, populated otherwise', () => {
    expect(offsetTransform({x: 0, y: 0})).toBe('');
    expect(offsetTransform({x: 3, y: -2})).toBe('translate(3px, -2px)');
  });

  it('settleTransform is empty at identity, populated otherwise', () => {
    expect(settleTransform({x: 0, y: 0, scale: 1})).toBe('');
    expect(settleTransform({x: 2, y: 1, scale: 1.004})).toBe(
      'translate(2px, 1px) scale(1.004)',
    );
  });
});
