import {describe, expect, it} from 'vitest';
import {cursorAt, telemetrySchema, clicks, steps, focuses} from './telemetry';

const CLICKS = [
  {type: 'click' as const, t: 1000, x: 100, y: 100},
  {type: 'click' as const, t: 3000, x: 500, y: 300},
];
const VP = {width: 1440, height: 900};

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

  it('validates focus events and filters them', () => {
    const tel = telemetrySchema.parse({
      viewport: {width: 1600, height: 1000},
      durationMs: 5000,
      events: [{type: 'focus', t: 1200, x: 900, y: 500, w: 1100, h: 700}],
    });
    expect(focuses(tel)).toHaveLength(1);
    expect(focuses(tel)[0].w).toBe(1100);
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
  it('waits below the viewport before the first click, never on the copy', () => {
    expect(cursorAt(CLICKS, 0, VP).y).toBeGreaterThan(VP.height);
    // and it has arrived exactly on the first click by its time
    expect(cursorAt(CLICKS, 1000, VP)).toMatchObject({x: 100, y: 100});
  });

  it('rests at the previous point between clicks (before the approach window)', () => {
    // next click at 3000, approach starts at 2300
    expect(cursorAt(CLICKS, 2000, VP)).toMatchObject({x: 100, y: 100});
  });

  it('is between points mid-approach and lands exactly at the click time', () => {
    const mid = cursorAt(CLICKS, 2650, VP);
    expect(mid.x).toBeGreaterThan(100);
    expect(mid.x).toBeLessThan(500);
    expect(cursorAt(CLICKS, 3000, VP)).toMatchObject({x: 500, y: 300});
  });

  it('dwells on the last click, then eases back below the viewport', () => {
    expect(cursorAt(CLICKS, 3400, VP)).toMatchObject({x: 500, y: 300});
    expect(cursorAt(CLICKS, 4400, VP).y).toBeGreaterThan(VP.height);
  });

  it('presses briefly after a click, then releases', () => {
    expect(cursorAt(CLICKS, 1090, VP).press).toBe(1);
    expect(cursorAt(CLICKS, 1400, VP).press).toBe(0);
  });

  it('handles an empty click list', () => {
    expect(cursorAt([], 500, VP)).toEqual({x: 0, y: 0, press: 0});
  });

  it('still rests on the previous click when clicks are closer than the approach window', () => {
    const rapid = [
      {type: 'click' as const, t: 1000, x: 100, y: 100},
      {type: 'click' as const, t: 1300, x: 500, y: 300},
    ];
    // at the moment of the first click the cursor is exactly on it
    expect(cursorAt(rapid, 1000, VP)).toMatchObject({x: 100, y: 100});
    // and it lands exactly on the second click at its time
    expect(cursorAt(rapid, 1300, VP)).toMatchObject({x: 500, y: 300});
  });
});
