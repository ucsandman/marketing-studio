import {describe, expect, it} from 'vitest';
import {audioSchema, voWindows, duckedVolume, resolveSfxLayers, SFX_SRC, SFX_VOLUME} from './audioMix';
import type {SfxCue} from './sfxCues';

const TIMING = {
  logo: {from: 0, len: 150},
  hook: {from: 150, len: 186},
  demo: {from: 336, len: 504},
  features: [{from: 840, len: 180}, {from: 1020, len: 180}],
  end: {from: 1200, len: 150},
};

describe('audioSchema', () => {
  it('accepts a manifest and null music', () => {
    const m = audioSchema.parse({
      music: null,
      lines: [{act: 'hook', src: 'noban/audio/hook.mp3', durationMs: 3900, text: 'x'}],
    });
    expect(m.lines).toHaveLength(1);
  });

  it('leaves sfx undefined when the block is absent (byte-identical default)', () => {
    const m = audioSchema.parse({music: null, lines: []});
    expect(m.sfx).toBeUndefined();
  });

  it('accepts an optional sfx enable gate', () => {
    const m = audioSchema.parse({music: null, lines: [], sfx: {enabled: true}});
    expect(m.sfx).toEqual({enabled: true});
  });
});

describe('resolveSfxLayers', () => {
  const cues: SfxCue[] = [
    {kind: 'whoosh', frame: 150},
    {kind: 'tick', frame: 858},
    {kind: 'riser', frame: 1158},
  ];

  it('maps cues to src + volume layers when all files exist', () => {
    const layers = resolveSfxLayers(cues, () => true);
    expect(layers).toEqual([
      {src: SFX_SRC.whoosh, frame: 150, volume: SFX_VOLUME.whoosh},
      {src: SFX_SRC.tick, frame: 858, volume: SFX_VOLUME.tick},
      {src: SFX_SRC.riser, frame: 1158, volume: SFX_VOLUME.riser},
    ]);
  });

  it('drops cues whose file is missing (silent-skip rule)', () => {
    const layers = resolveSfxLayers(cues, (src) => src !== SFX_SRC.tick);
    expect(layers.map((l) => l.src)).toEqual([SFX_SRC.whoosh, SFX_SRC.riser]);
  });

  it('returns nothing when no files exist', () => {
    expect(resolveSfxLayers(cues, () => false)).toEqual([]);
  });

  it('ducks the tick under the transition cues', () => {
    expect(SFX_VOLUME.tick).toBeLessThan(SFX_VOLUME.whoosh);
  });
});

describe('voWindows', () => {
  it('maps act keys to frame windows with the 12-frame lead', () => {
    const w = voWindows(
      [
        {act: 'hook', src: 'a', durationMs: 4000, text: ''},
        {act: 'feature-1', src: 'b', durationMs: 3000, text: ''},
      ],
      TIMING,
    );
    expect(w[0]).toEqual({fromFrame: 162, toFrame: 282, src: 'a'}); // 150+12 .. +ceil(4*30)
    expect(w[1].fromFrame).toBe(1032);
  });

  it('clamps the ducking window to the act end', () => {
    const w = voWindows([{act: 'end', src: 'c', durationMs: 60000, text: ''}], TIMING);
    expect(w[0].toFrame).toBe(1350); // end.from + end.len
  });

  it('throws on unknown act keys', () => {
    expect(() => voWindows([{act: 'outro', src: 'd', durationMs: 1000, text: ''}], TIMING)).toThrow(/outro/);
  });
});

describe('duckedVolume', () => {
  const W = [{fromFrame: 300, toFrame: 400}];
  it('sits at base volume away from windows (after fade-in)', () => {
    expect(duckedVolume(200, W, 1350)).toBeCloseTo(0.35, 5);
  });
  it('ducks inside a window', () => {
    expect(duckedVolume(350, W, 1350)).toBeCloseTo(0.12, 5);
  });
  it('ramps linearly at the window edge', () => {
    const v = duckedVolume(296, W, 1350); // 4 frames into the 9-frame approach (300-9=291)
    expect(v).toBeLessThan(0.35);
    expect(v).toBeGreaterThan(0.12);
  });
  it('applies master fades at the ends', () => {
    expect(duckedVolume(0, [], 1350)).toBe(0);
    expect(duckedVolume(12, [], 1350)).toBeCloseTo(0.175, 3); // half of fade-in
    expect(duckedVolume(1349, [], 1350)).toBeCloseTo(0, 2);
  });
  it('is base volume with no windows mid-video', () => {
    expect(duckedVolume(700, [], 1350)).toBeCloseTo(0.35, 5);
  });
});
