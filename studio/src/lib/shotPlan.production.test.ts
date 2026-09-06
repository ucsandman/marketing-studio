import {describe, expect, it} from 'vitest';
import {launchTiming} from './launchTiming';
import {buildLaunchShotPlan} from './shotPlan';

describe('launch shot plan production invariants', () => {
  it('preserves a legacy demo longer than the directed source-trim ceiling', () => {
    const timing = launchTiming(90_000, 1);
    const plan = buildLaunchShotPlan({
      telemetryDurationMs: 90_000,
      featureCount: 1,
    });

    expect(plan.mode).toBe('legacy');
    expect(plan.timing).toEqual(timing);
    expect(plan.shots.find((shot) => shot.id === 'demo')?.len).toBe(timing.demo.len);
    expect(plan.total).toBe(timing.total);
  });

  it('preserves sub-24-frame legacy act overrides exactly', () => {
    const lengths = {logo: 8, hook: 12, features: [16], end: 20};
    const timing = launchTiming(null, 1, lengths);
    const plan = buildLaunchShotPlan({
      telemetryDurationMs: null,
      featureCount: 1,
      lengths,
    });

    expect(plan.mode).toBe('legacy');
    expect(plan.shots.map((shot) => shot.len)).toEqual([
      timing.logo.len,
      timing.hook.len,
      timing.demo.len,
      timing.features[0].len,
      timing.end.len,
    ]);
    expect(plan.total).toBe(timing.total);
  });

  it('rejects a directed duration that exceeds its real source bounds', () => {
    expect(() =>
      buildLaunchShotPlan({
        telemetryDurationMs: 1_000,
        featureCount: 0,
        direction: {preset: 'precision', reason: 'Bounded source proof.'},
        shots: [
          {
            id: 'trimmed-demo',
            source: {kind: 'demo', sourceStartFrame: 0, sourceEndFrame: 30},
            purpose: 'proof',
            durationFrames: 31,
            scale: 'close',
          },
        ],
      }),
    ).toThrow('requests 31 frames but only 30 source frames are available');
  });

  it('caps an open-ended demo trim against the frames remaining after its start', () => {
    expect(() =>
      buildLaunchShotPlan({
        telemetryDurationMs: 1_000,
        featureCount: 0,
        direction: {preset: 'precision', reason: 'Offset source proof.'},
        shots: [
          {
            id: 'late-demo',
            source: {kind: 'demo', sourceStartFrame: 20},
            purpose: 'proof',
            durationFrames: 24,
            scale: 'detail',
          },
        ],
      }),
    ).toThrow('fewer than 24 source frames available');
  });

  it('does not silently cap an unbounded authored shot at 1,800 frames', () => {
    const plan = buildLaunchShotPlan({
      telemetryDurationMs: null,
      featureCount: 0,
      direction: {preset: 'editorial', reason: 'Long-form authored hold.'},
      shots: [
        {
          id: 'long-hook',
          source: {kind: 'hook'},
          purpose: 'problem',
          durationFrames: 2_100,
          scale: 'medium',
        },
      ],
    });

    expect(plan.shots[0].len).toBe(2_100);
    expect(plan.total).toBe(2_100);
  });
});
