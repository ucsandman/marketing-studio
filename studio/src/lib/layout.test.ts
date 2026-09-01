import {describe, expect, it} from 'vitest';
import {formatFor, plateFit} from './layout';

describe('formatFor bucketing', () => {
  it('maps each exact social size to its aspect + orientation', () => {
    expect(formatFor(1920, 1080).aspect).toBe('16:9');
    expect(formatFor(1920, 1080).orientation).toBe('landscape');
    expect(formatFor(1080, 1080).aspect).toBe('1:1');
    expect(formatFor(1080, 1080).orientation).toBe('square');
    expect(formatFor(1080, 1350).aspect).toBe('4:5');
    expect(formatFor(1080, 1350).orientation).toBe('portrait');
    expect(formatFor(1080, 1920).aspect).toBe('9:16');
    expect(formatFor(1080, 1920).orientation).toBe('portrait');
  });

  it('snaps off-grid sizes to the nearest bucket', () => {
    expect(formatFor(1280, 720).aspect).toBe('16:9');
    expect(formatFor(1200, 630).aspect).toBe('16:9');
    expect(formatFor(1000, 1000).aspect).toBe('1:1');
    expect(formatFor(1200, 1500).aspect).toBe('4:5'); // exactly 4:5
    expect(formatFor(720, 1280).aspect).toBe('9:16');
  });
});

describe('formatFor scale', () => {
  it('is 1 at the picture-lock master size', () => {
    expect(formatFor(1920, 1080).scale).toBe(1);
  });

  it('is min(w/1920, h/1080) for smaller formats', () => {
    expect(formatFor(1080, 1920).scale).toBeCloseTo(0.5625, 5); // 1080/1920
    expect(formatFor(1080, 1080).scale).toBeCloseTo(0.5625, 5);
    expect(formatFor(1080, 1350).scale).toBeCloseTo(0.5625, 5);
  });
});

describe('formatFor safe insets', () => {
  it('reserves generous top/bottom for portrait platform chrome', () => {
    const p = formatFor(1080, 1920).safe;
    expect(p.top).toBe(192); // 0.10 * 1920
    expect(p.bottom).toBe(288); // 0.15 * 1920
    expect(p.left).toBe(65); // 0.06 * 1080
    expect(p.right).toBe(65);
  });

  it('keeps 4:5 and square insets between landscape and full portrait', () => {
    const s = formatFor(1080, 1080).safe;
    expect(s.top).toBe(86); // 0.08 * 1080
    expect(s.bottom).toBe(108); // 0.10 * 1080
    const f = formatFor(1080, 1350).safe;
    expect(f.top).toBe(122); // round(0.09 * 1350)
    expect(f.bottom).toBe(176); // round(0.13 * 1350)
  });

  it('stays tight enough at 16:9 to preserve the templates old pinned offsets', () => {
    // Regression guard: templates pin chrome with max(base*scale, safe.X).
    // At the master these must fall through to the original base pixels, so the
    // landscape insets must not exceed the smallest base offset they floor.
    const {safe} = formatFor(1920, 1080);
    expect(safe.top).toBe(54); // 0.05 * 1080
    expect(safe.bottom).toBe(32); // 0.03 * 1080
    expect(safe.left).toBe(77); // round(0.04 * 1920)
    expect(safe.top).toBeLessThanOrEqual(64); // FeatureAct heading top base
    expect(safe.bottom).toBeLessThanOrEqual(40); // LaunchVideo FloatBar bottom base
  });
});

describe('plateFit', () => {
  it('keeps cover on landscape and square; contain only on portrait', () => {
    // Every capture in the repo is 16:10 (1440x900 / 1600x1000): contain into a
    // 16:9 frame pillarboxes it, cover into a 9:16 frame slices on-screen text.
    expect(plateFit(formatFor(1920, 1080).orientation)).toBe('cover');
    expect(plateFit(formatFor(1080, 1080).orientation)).toBe('cover');
    expect(plateFit(formatFor(1080, 1350).orientation)).toBe('contain');
    expect(plateFit(formatFor(1080, 1920).orientation)).toBe('contain');
  });
});
