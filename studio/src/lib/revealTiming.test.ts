import {describe, expect, it} from 'vitest';
import {loopCycleFrames, revealLoopTiming, revealTiming} from './revealTiming';

const FPS = 30;
// 2.8s base duration * 30fps at tempo 1 (see revealTiming.ts DURATION_S).
const WINDOW_FRAMES = 2.8 * FPS; // 84

describe('revealTiming', () => {
  it('starts fully undrawn and both terminals hidden at frame 0', () => {
    const s = revealTiming(0, FPS, 1);
    expect(s.dashoffset).toBe(100);
    expect(s.bottom).toEqual({scale: 0, opacity: 0});
    expect(s.top).toEqual({scale: 0, opacity: 0});
  });

  it('bottom terminal is fully popped in by t=0.09 (pops in first, as the draw starts)', () => {
    const s = revealTiming(0.09 * WINDOW_FRAMES, FPS, 1);
    expect(s.bottom.scale).toBeCloseTo(1, 5);
    expect(s.bottom.opacity).toBeCloseTo(1, 5);
  });

  it('top terminal stays fully hidden right up to t=0.44', () => {
    const s = revealTiming(0.44 * WINDOW_FRAMES, FPS, 1);
    expect(s.top.scale).toBeCloseTo(0, 5);
    expect(s.top.opacity).toBeCloseTo(0, 5);
  });

  it('stroke finishes drawing on at t=0.46', () => {
    const s = revealTiming(0.46 * WINDOW_FRAMES, FPS, 1);
    expect(s.dashoffset).toBeCloseTo(0, 5);
  });

  it('top terminal overshoots to 1.28 by t=0.52 ("click into place")', () => {
    const s = revealTiming(0.52 * WINDOW_FRAMES, FPS, 1);
    expect(s.top.scale).toBeCloseTo(1.28, 5);
    expect(s.top.opacity).toBeCloseTo(1, 5);
  });

  it('top terminal settles to 1 by t=0.58', () => {
    const s = revealTiming(0.58 * WINDOW_FRAMES, FPS, 1);
    expect(s.top.scale).toBeCloseTo(1, 5);
    expect(s.top.opacity).toBe(1);
  });

  it('plays once and holds: well past the window nothing re-hides or re-draws', () => {
    const held = revealTiming(WINDOW_FRAMES * 3, FPS, 1);
    expect(held.dashoffset).toBe(0);
    expect(held.bottom).toEqual({scale: 1, opacity: 1});
    expect(held.top).toEqual({scale: 1, opacity: 1});
    // identical to the state right at the end of the window
    expect(revealTiming(WINDOW_FRAMES, FPS, 1)).toEqual(held);
  });

  it('tempo scales the window (tempo 2 reaches the same t at half the frames), consistent with brandSpring/entrance', () => {
    const half = revealTiming(WINDOW_FRAMES / 2, FPS, 2);
    const full = revealTiming(WINDOW_FRAMES, FPS, 1);
    expect(half.dashoffset).toBeCloseTo(full.dashoffset, 5);
    expect(half.bottom.opacity).toBeCloseTo(full.bottom.opacity, 5);
    expect(half.top.scale).toBeCloseTo(full.top.scale, 5);

    const quarterWindowAtTempo2 = revealTiming(WINDOW_FRAMES * 0.23, FPS, 2); // t=0.46 at tempo 2
    const quarterWindowAtTempo1 = revealTiming(WINDOW_FRAMES * 0.46, FPS, 1); // t=0.46 at tempo 1
    expect(quarterWindowAtTempo2.dashoffset).toBeCloseTo(quarterWindowAtTempo1.dashoffset, 5);
  });
});

// Looping variant (AnimatedOG embeds) — design doc's grpFade keyframe: the whole
// group holds opacity 1 through t=0.84, fades to 0 by t=0.95, holds 0 to t=1.0,
// then the cycle wraps. Draw/terminal choreography is identical to the play-once
// window (revealTiming) within each cycle; only the added group opacity differs.
describe('revealLoopTiming', () => {
  const CYCLE_FRAMES = loopCycleFrames(FPS, 1); // 84 at tempo 1, same as WINDOW_FRAMES

  it('loopCycleFrames matches the play-once window length at tempo 1', () => {
    expect(CYCLE_FRAMES).toBe(WINDOW_FRAMES);
  });

  it('tempo scales the cycle length exactly like the play-once window', () => {
    expect(loopCycleFrames(FPS, 2)).toBe(Math.round(CYCLE_FRAMES / 2));
  });

  it('group opacity is fully visible through t=0.84 (draw+settle+hold, matching play-once state)', () => {
    const s = revealLoopTiming(0.84 * CYCLE_FRAMES, FPS, 1);
    expect(s.groupOpacity).toBeCloseTo(1, 5);
    expect(s.dashoffset).toBe(0);
    expect(s.top).toEqual({scale: 1, opacity: 1});
  });

  it('group opacity reaches 0 by t=0.95 (grpFade fade-out complete)', () => {
    const s = revealLoopTiming(0.95 * CYCLE_FRAMES, FPS, 1);
    expect(s.groupOpacity).toBeCloseTo(0, 5);
  });

  it('wraps seamlessly at the cycle boundary: frame 0 and frame cycleFrames produce identical, visually-empty state', () => {
    const start = revealLoopTiming(0, FPS, 1);
    const wrapped = revealLoopTiming(CYCLE_FRAMES, FPS, 1);
    expect(wrapped).toEqual(start);
    expect(start.dashoffset).toBe(100);
    expect(start.bottom).toEqual({scale: 0, opacity: 0});
    expect(start.groupOpacity).toBeCloseTo(1, 5); // visible group, but nothing drawn yet
  });

  it("does not affect play-once revealTiming (LogoReveal/EndCard): still holds fully drawn, no fade, well past one loop cycle", () => {
    const held = revealTiming(CYCLE_FRAMES * 5, FPS, 1);
    expect(held.dashoffset).toBe(0);
    expect(held.top).toEqual({scale: 1, opacity: 1});
    expect('groupOpacity' in held).toBe(false);
  });
});
