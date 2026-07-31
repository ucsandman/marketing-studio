import {describe, expect, it} from 'vitest';
import {launchTiming} from './launchTiming';

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
