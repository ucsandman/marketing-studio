/* eslint-disable @remotion/non-pure-animation -- tests pass explicit timeline time */
import {describe, expect, it} from 'vitest';
import {cameraAtCues, frameSubject, guardSubject, shotScaleFor} from './camera';

const VP = {width: 1600, height: 1000};

describe('production camera framing', () => {
  it('guards authored subjects and never exposes the stage edge', () => {
    expect(guardSubject({x: -200, y: 1400, w: 3000, h: 40}, VP)).toEqual({
      x: 800,
      y: 980,
      w: 1600,
      h: 40,
    });
    const camera = frameSubject({x: 20, y: 20, w: 200, h: 100}, VP, 'detail');
    expect(camera.originX).toBeGreaterThanOrEqual(VP.width / camera.scale / 2);
    expect(camera.originY).toBeGreaterThanOrEqual(VP.height / camera.scale / 2);
  });

  it('gives measured coverage a real shot scale hierarchy', () => {
    expect(shotScaleFor({x: 800, y: 500, w: 1600, h: 1000}, VP)).toBe('wide');
    expect(shotScaleFor({x: 800, y: 500, w: 1100, h: 600}, VP)).toBe('medium');
    expect(shotScaleFor({x: 800, y: 500, w: 700, h: 400}, VP)).toBe('close');
    expect(shotScaleFor({x: 800, y: 500, w: 300, h: 180}, VP)).toBe('detail');
    expect(frameSubject({x: 800, y: 500, w: 519, h: 277}, VP, 'detail').scale).toBeGreaterThan(2.9);
  });

  it('honors focus holds and stays continuous when authored cues overlap', () => {
    const cues = [
      {at: 0, transition: 1000, hold: 500, scale: 'medium' as const, subject: {x: 900, y: 500, w: 800, h: 500}},
      {at: 500, transition: 500, scale: 'detail' as const, subject: {x: 300, y: 250, w: 300, h: 180}},
    ];
    const held = cameraAtCues(cues, 1499, VP);
    const boundary = cameraAtCues(cues, 1500, VP);
    const after = cameraAtCues(cues, 1501, VP);
    expect(held.scale).toBeCloseTo(boundary.scale, 8);
    expect(after.scale - boundary.scale).toBeLessThan(0.001);
    expect(after.originX - boundary.originX).toBeGreaterThan(-0.01);
  });
});
