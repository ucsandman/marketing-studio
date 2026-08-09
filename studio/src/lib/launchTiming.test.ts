import {describe, expect, it} from 'vitest';
import {launchTiming, voActLen, voTimingFrom, VO_LEAD, VO_PAD} from './launchTiming';

describe('launchTiming', () => {
  it('lays out sequential acts with no gaps', () => {
    const t = launchTiming(16000, 2);
    expect(t.logo).toEqual({from: 0, len: 150});
    expect(t.hook).toEqual({from: 150, len: 186});
    expect(t.demo.from).toBe(336);
    expect(t.demo.len).toBe(Math.ceil((16000 / 1000) * 30) + 24); // 504
    expect(t.features[0].from).toBe(336 + 504);
    expect(t.features[1].from).toBe(336 + 504 + 180);
    expect(t.end.from).toBe(336 + 504 + 360);
    expect(t.total).toBe(336 + 504 + 360 + 150);
  });

  it('falls back to a fixed demo act without telemetry', () => {
    const t = launchTiming(null, 0);
    expect(t.demo.len).toBe(240);
    expect(t.features).toHaveLength(0);
    expect(t.end.from).toBe(336 + 240);
  });

  it('stays inside the spec 30-90s range for the real inputs', () => {
    const t = launchTiming(16108, 2);
    expect(t.total / 30).toBeGreaterThanOrEqual(30);
    expect(t.total / 30).toBeLessThanOrEqual(90);
  });

  it('treats an absent or empty override as the default layout', () => {
    const base = launchTiming(16000, 2);
    expect(launchTiming(16000, 2, null)).toEqual(base);
    expect(launchTiming(16000, 2, {})).toEqual(base);
  });

  it('widens only the overridden acts and keeps the acts contiguous', () => {
    const t = launchTiming(16000, 3, {logo: 150, hook: 225, features: [230, 210, 285], end: 190});
    expect(t.logo).toEqual({from: 0, len: 150});
    expect(t.hook).toEqual({from: 150, len: 225});
    expect(t.demo).toEqual({from: 375, len: 504});
    expect(t.features.map((a) => a.len)).toEqual([230, 210, 285]);
    expect(t.features[0].from).toBe(879);
    expect(t.features[1].from).toBe(879 + 230);
    expect(t.features[2].from).toBe(879 + 230 + 210);
    expect(t.end).toEqual({from: 879 + 230 + 210 + 285, len: 190});
    expect(t.total).toBe(150 + 225 + 504 + 230 + 210 + 285 + 190);
  });

  it('falls back to FEATURE_LEN for features the override does not cover', () => {
    const t = launchTiming(null, 3, {features: [240]});
    expect(t.features.map((a) => a.len)).toEqual([240, 180, 180]);
  });

  it('applies a demoTail override to the telemetry-derived demo act only', () => {
    expect(launchTiming(16000, 0, {demoTail: 0}).demo.len).toBe(480);
    expect(launchTiming(null, 0, {demoTail: 0}).demo.len).toBe(240);
  });
});

// The byte-identity gate: absent VO timing must reproduce the pre-Phase-B layout
// exactly, for every input shape the repo actually ships.
describe('launchTiming without VO timing', () => {
  it('is deep-equal to the three-argument call', () => {
    expect(launchTiming(16000, 2, null, null)).toEqual(launchTiming(16000, 2));
    expect(
      launchTiming(16000, 3, {logo: 150, hook: 225, features: [230, 210, 285], end: 190}, null),
    ).toEqual(launchTiming(16000, 3, {logo: 150, hook: 225, features: [230, 210, 285], end: 190}));
    expect(launchTiming(null, 0, {demoTail: 0}, null)).toEqual(launchTiming(null, 0, {demoTail: 0}));
  });

  it("keeps noban's 1350-frame lock", () => {
    expect(launchTiming(16000, 2, null, null).total).toBe(1350);
  });
});

describe('voTimingFrom', () => {
  const withWords = [
    {act: 'hook', durationMs: 4000, words: [{w: 'a', startMs: 0, endMs: 100}]},
    {act: 'end', durationMs: 3000, words: [{w: 'b', startMs: 0, endMs: 100}]},
  ];

  it('returns null with no lines at all', () => {
    expect(voTimingFrom(null, 2)).toBeNull();
    expect(voTimingFrom([], 2)).toBeNull();
  });

  it('returns null when no line carries words (the activation gate)', () => {
    expect(voTimingFrom([{act: 'hook', durationMs: 4000}], 2)).toBeNull();
  });

  it('returns null when force is false, even with words', () => {
    expect(voTimingFrom(withWords, 2, {force: false})).toBeNull();
  });

  it('engages on force true without any words', () => {
    const vo = voTimingFrom([{act: 'hook', durationMs: 4000}], 0, {force: true});
    expect(vo?.hook).toBe(4000);
  });

  it('maps measured durations per act and nulls the acts with no line', () => {
    const vo = voTimingFrom(withWords, 2);
    expect(vo).toEqual({
      logo: null,
      hook: 4000,
      demo: null,
      features: [null, null],
      end: 3000,
    });
  });

  it('carries an explicit padFrames through and omits it otherwise', () => {
    expect(voTimingFrom(withWords, 0, {padFrames: 0})?.padFrames).toBe(0);
    expect(voTimingFrom(withWords, 0)).not.toHaveProperty('padFrames');
  });
});

describe('voActLen', () => {
  it('is lead-in + spoken frames + tail hold', () => {
    expect(voActLen(4000)).toBe(VO_LEAD + 120 + VO_PAD);
    expect(voActLen(4000)).toBe(144);
  });

  it('ceils a partial frame', () => {
    expect(voActLen(4001)).toBe(145);
  });

  it('honors a pad override', () => {
    expect(voActLen(4000, 0)).toBe(132);
  });
});

describe('launchTiming with VO timing', () => {
  const lines = [
    {act: 'hook', durationMs: 4000, words: [{w: 'a', startMs: 0, endMs: 100}]},
    {act: 'end', durationMs: 3000},
  ];

  it('derives the acts that have a measured line and keeps constants elsewhere', () => {
    const t = launchTiming(16000, 2, null, voTimingFrom(lines, 2));
    expect(t.hook.len).toBe(144);
    expect(t.end.len).toBe(voActLen(3000));
    expect(t.end.len).toBe(114);
    expect(t.logo.len).toBe(150); // no VO line for logo -> shared constant
    expect(t.features.map((a) => a.len)).toEqual([180, 180]);
    // contiguous, and the total is the sum
    expect(t.hook.from).toBe(t.logo.from + t.logo.len);
    expect(t.end.from).toBe(t.features[1].from + t.features[1].len);
    expect(t.total).toBe(150 + 144 + 504 + 180 + 180 + 114);
  });

  it('lets an explicit actLengths override beat the measured VO', () => {
    expect(launchTiming(16000, 2, {hook: 225}, {hook: 4000}).hook.len).toBe(225);
  });

  it('takes the max for demo: telemetry wins when it is longer', () => {
    expect(launchTiming(16000, 0, null, {demo: 2000}).demo.len).toBe(504);
  });

  it('widens demo when the narration is longer than the recording', () => {
    expect(launchTiming(1000, 0, null, {demo: 20000}).demo.len).toBe(voActLen(20000));
    expect(launchTiming(1000, 0, null, {demo: 20000}).demo.len).toBe(624);
  });

  it('applies a padFrames override to every derived act', () => {
    expect(launchTiming(16000, 0, null, {hook: 4000, padFrames: 0}).hook.len).toBe(132);
  });

  it('keeps a VO-driven costclaw-shaped film inside the 30-90s band', () => {
    const vo = {
      logo: 3200,
      hook: 6400,
      demo: 12000,
      features: [6800, 5600, 7400],
      end: 5200,
    };
    const t = launchTiming(16108, 3, null, vo);
    expect(t.total / 30).toBeGreaterThanOrEqual(30);
    expect(t.total / 30).toBeLessThanOrEqual(90);
  });
});
