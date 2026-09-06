import {describe, expect, it} from 'vitest';
import {pointerPhaseAt, pressScaleAt, smootherstep} from './motion';

describe('production interaction motion', () => {
  it('uses a zero-slope bounded transition', () => {
    expect(smootherstep(-1)).toBe(0);
    expect(smootherstep(2)).toBe(1);
    expect(smootherstep(0.001)).toBeLessThan(0.000001);
    expect(1 - smootherstep(0.999)).toBeLessThan(0.000001);
  });

  it('moves through approach, hover, press, release from the real click time', () => {
    const options = {approach: 700, hover: 120, press: 70, release: 130};
    expect(pointerPhaseAt([1000], 100, options)).toBe('idle');
    expect(pointerPhaseAt([1000], 500, options)).toBe('approach');
    expect(pointerPhaseAt([1000], 950, options)).toBe('hover');
    expect(pointerPhaseAt([1000], 1020, options)).toBe('press');
    expect(pointerPhaseAt([1000], 1120, options)).toBe('release');
  });

  it('presses and releases without a scale discontinuity or overshoot', () => {
    const opts = {press: 70, release: 130, depth: 0.14};
    expect(pressScaleAt(999, 1000, opts)).toBe(1);
    expect(pressScaleAt(1000, 1000, opts)).toBe(1);
    expect(pressScaleAt(1070, 1000, opts)).toBeCloseTo(0.86, 8);
    expect(pressScaleAt(1200, 1000, opts)).toBe(1);
  });
});
