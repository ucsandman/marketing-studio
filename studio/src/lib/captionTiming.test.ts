import {describe, expect, it} from 'vitest';
import {launchTiming} from './launchTiming';
import {
  captionCues,
  captionFontSize,
  sequentialCues,
  splitDisplayLines,
  cueAt,
} from './captionTiming';

const FPS = 30;
const VO_LEAD = 12; // mirrors audioMix.ts

describe('captionCues', () => {
  const t = launchTiming(null, 2); // demo falls back to 240 frames, 2 features

  it('starts each cue at act.from + VO_LEAD and runs the spoken length', () => {
    const cues = captionCues([{act: 'hook', text: 'hi', durationMs: 2000}], t, FPS);
    expect(cues).toHaveLength(1);
    expect(cues[0].fromFrame).toBe(t.hook.from + VO_LEAD);
    // 2000ms -> 60 frames, well inside the 186-frame hook act
    expect(cues[0].toFrame).toBe(t.hook.from + VO_LEAD + 60);
    expect(cues[0].text).toBe('hi');
  });

  it('clamps a cue that overruns its act to the act end', () => {
    const cues = captionCues([{act: 'end', text: 'bye', durationMs: 999999}], t, FPS);
    expect(cues[0].toFrame).toBe(t.end.from + t.end.len);
    expect(cues[0].toFrame).toBeGreaterThan(cues[0].fromFrame);
  });

  it('resolves feature-N acts and throws on an unknown act', () => {
    const cues = captionCues([{act: 'feature-1', text: 'x', durationMs: 1000}], t, FPS);
    expect(cues[0].fromFrame).toBe(t.features[1].from + VO_LEAD);
    expect(() => captionCues([{act: 'nope', text: 'x', durationMs: 1000}], t, FPS)).toThrow();
  });

  it('returns empty cues for an empty manifest', () => {
    expect(captionCues([], t, FPS)).toEqual([]);
  });
});

describe('splitDisplayLines', () => {
  it('leaves a short line as one line', () => {
    expect(splitDisplayLines('short line')).toEqual(['short line']);
  });

  it('splits a long line into two at a word boundary, first line within the cap', () => {
    const text = 'It finds the spread. You keep the profit. The guardrails keep you honest.';
    const out = splitDisplayLines(text, 42);
    expect(out).toHaveLength(2);
    expect(out[0].length).toBeLessThanOrEqual(42);
    expect(out.join(' ')).toBe(text); // no words dropped, split on a space
  });
});

describe('sequentialCues', () => {
  it('lays lines back-to-back and clamps to maxFrame', () => {
    const cues = sequentialCues(
      [
        {act: 'a', text: 'one', durationMs: 2000}, // 60 frames
        {act: 'b', text: 'two', durationMs: 2000}, // 60 frames -> clamped
      ],
      FPS,
      100,
    );
    expect(cues[0]).toMatchObject({fromFrame: 0, toFrame: 60, text: 'one'});
    expect(cues[1]).toMatchObject({fromFrame: 60, toFrame: 100, text: 'two'});
  });

  it('returns empty cues for empty input', () => {
    expect(sequentialCues([], FPS, 100)).toEqual([]);
  });
});

describe('cueAt', () => {
  it('finds the active cue and returns null outside every window', () => {
    const cues = [
      {text: 'a', fromFrame: 10, toFrame: 20},
      {text: 'b', fromFrame: 20, toFrame: 30},
    ];
    expect(cueAt(cues, 15)?.text).toBe('a');
    expect(cueAt(cues, 20)?.text).toBe('b'); // half-open window
    expect(cueAt(cues, 5)).toBeNull();
    expect(cueAt(cues, 30)).toBeNull();
  });
});

describe('captionFontSize', () => {
  it('stays byte-identical at the 1920x1080 master (52 * scale wins)', () => {
    expect(captionFontSize(1, 1080)).toBe(52);
  });

  it('floors the portrait/square export rows instead of shrinking to 29px', () => {
    // 1080x1920: scale 0.5625 -> 52*scale rounds to 29, ~1.5% of frame height.
    expect(captionFontSize(0.5625, 1920)).toBe(54);
  });
});
