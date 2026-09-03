import {describe, expect, it} from 'vitest';
import {
  SCROLL_SLACK_LINES,
  SESSION_LAYOUT,
  sayHoldFrames,
  sessionMetrics,
  sessionTiming,
  wrappedLines,
  type SessionBeat,
} from './sessionTiming';

const FPS = 30;

const script = (): SessionBeat[] => [
  {kind: 'prompt', text: '/marketing sidetap'},
  {kind: 'say', text: 'Reading the brand from the repo.'},
  {kind: 'think', verb: 'Onboarding', frames: 50},
  {
    kind: 'tool',
    tool: 'Read',
    server: null,
    arg: 'src/app/globals.css',
    pendingText: 'Reading...',
    doneText: '13 brand tokens and two fonts',
    frames: 30,
    status: 'success',
    expandable: true,
  },
  {
    kind: 'tool',
    tool: 'check_domain_availability',
    server: 'offlocal',
    arg: 'sidetap.io',
    pendingText: 'Checking...',
    doneText: 'Available. Purchase waits for your approval',
    frames: 30,
    status: 'hold',
    expandable: false,
  },
  {kind: 'say', text: 'Dry run complete. Nothing has left this machine.'},
];

describe('sessionTiming', () => {
  it('walks the timeline forward with no beat starting before the one ahead of it finished', () => {
    const t = sessionTiming(FPS, script(), {endHoldFrames: 75});
    expect(t.beats).toHaveLength(6);
    for (const b of t.beats) {
      expect(b.done).toBeGreaterThanOrEqual(b.start);
    }
    for (let i = 1; i < t.beats.length; i += 1) {
      expect(t.beats[i].start).toBeGreaterThanOrEqual(t.beats[i - 1].done);
    }
    expect(t.beats[0].start).toBe(30);
  });

  it('gives every pause its own seed', () => {
    const seeds: string[] = [];
    for (const b of sessionTiming(FPS, script(), {endHoldFrames: 75}).beats) seeds.push(...b.seeds);
    expect(seeds.length).toBeGreaterThan(0);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('ends at the last beat plus the end-card hold, which is where the end card starts', () => {
    const t = sessionTiming(FPS, script(), {endHoldFrames: 75});
    const last = t.beats[t.beats.length - 1];
    expect(t.endCardFrom).toBe(last.done);
    expect(t.durationInFrames).toBe(last.done + 75);
  });

  it('shifts every later beat by exactly the frames one beat gained', () => {
    const base = sessionTiming(FPS, script(), {endHoldFrames: 75});
    const longer = script();
    const spinner = longer[2];
    if (spinner.kind !== 'think') throw new Error('beat 2 is the spinner');
    spinner.frames += 17;
    const t = sessionTiming(FPS, longer, {endHoldFrames: 75});
    // everything before the edit is untouched
    for (let i = 0; i <= 2; i += 1) {
      expect(t.beats[i].start).toBe(base.beats[i].start);
    }
    // everything after it moves by exactly 17
    for (let i = 3; i < base.beats.length; i += 1) {
      expect(t.beats[i].start - base.beats[i].start).toBe(17);
      expect(t.beats[i].done - base.beats[i].done).toBe(17);
    }
    expect(t.durationInFrames - base.durationInFrames).toBe(17);
  });

  it('submits a prompt after typing it, and only then puts the row in the transcript', () => {
    const t = sessionTiming(FPS, script(), {endHoldFrames: 75});
    const prompt = t.beats[0];
    expect(prompt.done).toBeGreaterThan(prompt.start);
    expect(prompt.appearAt).toBe(prompt.done);
    // every other beat joins the transcript the frame it starts
    expect(t.beats[1].appearAt).toBe(t.beats[1].start);
  });

  it('spends no transcript row and no pause on a spinner: the next beat takes its slot', () => {
    const t = sessionTiming(FPS, script(), {endHoldFrames: 75});
    const think = t.beats[2];
    expect(think.height).toBe(0);
    expect(think.done - think.start).toBe(50);
    expect(t.beats[3].start).toBe(think.done);
  });

  it('holds an assistant line at a skim rate, floored and ceilinged', () => {
    expect(sayHoldFrames('Done.', FPS)).toBe(36); // floor, 1.2s
    expect(sayHoldFrames(new Array(40).fill('word').join(' '), FPS)).toBe(120); // ceiling, 4s
    expect(sayHoldFrames('one two three four five six seven eight', FPS)).toBe(60); // 8 words
  });

  it('wraps greedily on spaces and hard-breaks a token longer than the line', () => {
    expect(wrappedLines('abcd efgh', 9)).toBe(1);
    expect(wrappedLines('abcd efgh', 4)).toBe(2);
    expect(wrappedLines('', 40)).toBe(1);
    // a 40-char path with nowhere to break occupies ceil(40/10) lines
    expect(wrappedLines('x'.repeat(40), 10)).toBe(4);
    expect(wrappedLines(`ok ${'x'.repeat(25)}`, 10)).toBe(4); // 'ok', then 3 broken
  });

  it('parks the newest line three lines above the bottom when the buffer overflows', () => {
    const m = sessionMetrics(SESSION_LAYOUT);
    // a welcome box that already fills the window forces the very first beat to scroll
    const t = sessionTiming(FPS, script(), {endHoldFrames: 75, welcomeHeight: m.viewportHeight});
    expect(t.scrollStages.length).toBeGreaterThan(0);
    const first = t.scrollStages[0];
    const firstScrolled = t.beats.find((b) => b.height > 0);
    if (!firstScrolled) throw new Error('no beat has height');
    const contentBottom = m.viewportHeight + m.blockGap + firstScrolled.height + m.blockGap;
    expect(first.offset).toBe(
      Math.round(contentBottom - m.viewportHeight + SCROLL_SLACK_LINES * m.toolLine),
    );
    expect(first.from).toBe(firstScrolled.appearAt - 8);
    expect(first.to).toBe(firstScrolled.appearAt + 10);
    // stages never overlap, so the interpolate input range stays ascending
    for (let i = 1; i < t.scrollStages.length; i += 1) {
      expect(t.scrollStages[i].from).toBeGreaterThan(t.scrollStages[i - 1].to);
      expect(t.scrollStages[i].offset).toBeGreaterThan(t.scrollStages[i - 1].offset);
    }
    expect(t.scrollFrames).toHaveLength(t.scrollStages.length * 2);
    expect(t.scrollOffsets[0]).toBe(0);
  });

  it('still hands interpolate two usable points when nothing overflows', () => {
    const t = sessionTiming(FPS, [{kind: 'say', text: 'One line.'}], {endHoldFrames: 75});
    expect(t.scrollStages).toEqual([]);
    expect(t.scrollFrames).toEqual([0, 1]);
    expect(t.scrollOffsets).toEqual([0, 0]);
  });

  it('blurs the composer on the closing assistant line', () => {
    const t = sessionTiming(FPS, script(), {endHoldFrames: 75});
    expect(t.composer.focusFrom).toBe(t.beats[0].start - 8);
    expect(t.composer.focusUntil).toBe(t.beats[t.beats.length - 1].start);
  });
});
