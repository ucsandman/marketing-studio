import {describe, expect, it} from 'vitest';
import {cursorAt, telemetrySchema, clicks, steps} from './telemetry';

const CLICKS = [
  {type: 'click' as const, t: 1000, x: 100, y: 100},
  {type: 'click' as const, t: 3000, x: 500, y: 300},
];

describe('telemetrySchema', () => {
  it('validates a well-formed telemetry object and filters helpers work', () => {
    const tel = telemetrySchema.parse({
      viewport: {width: 1600, height: 1000},
      durationMs: 5000,
      events: [
        {type: 'step', t: 0, label: 'intro'},
        {type: 'click', t: 1000, x: 100, y: 100},
      ],
    });
    expect(clicks(tel)).toHaveLength(1);
    expect(steps(tel)[0].label).toBe('intro');
  });

  it('rejects unknown event types', () => {
    expect(() =>
      telemetrySchema.parse({
        viewport: {width: 1, height: 1},
        durationMs: 1,
        events: [{type: 'scroll', t: 0}],
      }),
    ).toThrow();
  });
});

describe('cursorAt', () => {
  it('rests at the first click point before any click', () => {
    expect(cursorAt(CLICKS, 0)).toMatchObject({x: 100, y: 100, press: 0});
  });

  it('rests at the previous point between clicks (before the approach window)', () => {
    // next click at 3000, approach starts at 2300
    expect(cursorAt(CLICKS, 2000)).toMatchObject({x: 100, y: 100});
  });

  it('is between points mid-approach and lands exactly at the click time', () => {
    const mid = cursorAt(CLICKS, 2650);
    expect(mid.x).toBeGreaterThan(100);
    expect(mid.x).toBeLessThan(500);
    expect(cursorAt(CLICKS, 3000)).toMatchObject({x: 500, y: 300});
  });

  it('presses briefly after a click, then releases', () => {
    expect(cursorAt(CLICKS, 1090).press).toBe(1);
    expect(cursorAt(CLICKS, 1400).press).toBe(0);
  });

  it('handles an empty click list', () => {
    expect(cursorAt([], 500)).toEqual({x: 0, y: 0, press: 0});
  });

  it('still rests on the previous click when clicks are closer than the approach window', () => {
    const rapid = [
      {type: 'click' as const, t: 1000, x: 100, y: 100},
      {type: 'click' as const, t: 1300, x: 500, y: 300},
    ];
    // at the moment of the first click the cursor is exactly on it
    expect(cursorAt(rapid, 1000)).toMatchObject({x: 100, y: 100});
    // and it lands exactly on the second click at its time
    expect(cursorAt(rapid, 1300)).toMatchObject({x: 500, y: 300});
  });
});
