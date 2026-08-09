import {describe, expect, it} from 'vitest';
import {formatFor} from './layout';
import {
  IN_FRAMES,
  K_MAX,
  K_MIN,
  STAGE,
  TAIL_FRAMES,
  caretOn,
  composerLayout,
  pulse,
  pushFits,
  resultsLayout,
  stageFit,
  stagedBeats,
  stagedRects,
  stagedSceneSchema,
  statusLayout,
  typedSlice,
} from './staged';
import type {ComposerConfig, ResultsConfig, StagedConfig, StatusConfig} from './staged';

const FPS = 30;

const results = (o: {rows?: number; highlightIndex?: number; stat?: boolean} = {}): ResultsConfig =>
  stagedSceneSchema.parse({
    kind: 'results',
    query: 'Search the workspace',
    chips: ['Recent'],
    countLabel: '4 matches',
    rows: Array.from({length: o.rows ?? 4}, (_, i) => ({
      primary: `Item ${i}`,
      secondary: 'Folder',
      meta: '1 kb',
      idleState: 'Pending',
      state: 'Ready',
    })),
    highlightIndex: o.highlightIndex ?? 0,
    stat: o.stat === false ? null : {value: '4', label: 'matches'},
  }) as ResultsConfig;

const composer = (steps = 3, query = 'Summarize the latest three reports'): ComposerConfig =>
  stagedSceneSchema.parse({
    kind: 'composer',
    placeholder: 'Ask for anything',
    query,
    submitLabel: 'Run',
    submittedLabel: 'Running',
    runTitle: 'Run steps',
    steps: Array.from({length: steps}, (_, j) => ({label: `Step ${j}`, meta: null})),
  }) as ComposerConfig;

const status = (states = 3, o: {action?: boolean; counter?: boolean} = {}): StatusConfig =>
  stagedSceneSchema.parse({
    kind: 'status',
    subject: {title: 'Batch nine', sub: 'Queued at 09:14', badge: 'B9'},
    states: Array.from({length: states}, (_, j) => ({label: `State ${j}`, meta: null})),
    counter: o.counter === false ? null : {value: '3', label: 'steps done'},
    action: o.action ? {label: 'Publish'} : null,
  }) as StatusConfig;

describe('stagedBeats ordering', () => {
  it('runs results in story order inside the act', () => {
    const b = stagedBeats(results(), 180, FPS);
    if (b.kind !== 'results') throw new Error('wrong kind');
    expect(IN_FRAMES).toBeLessThanOrEqual(b.sweep[0]);
    expect(b.sweep[0]).toBeLessThan(b.skeleton[0]);
    expect(b.skeleton[0]).toBeLessThan(b.resolve[0]);
    expect(b.resolve[0]).toBeLessThan(b.click);
    expect(b.click).toBeLessThan(b.cursorExit);
    expect(b.cursorExit).toBeLessThan(b.end);
  });

  it('runs composer type-then-submit-then-steps in order', () => {
    const b = stagedBeats(composer(), 180, FPS);
    if (b.kind !== 'composer') throw new Error('wrong kind');
    expect(IN_FRAMES).toBeLessThanOrEqual(b.cursorAppear);
    expect(b.cursorAppear).toBeLessThan(b.click1);
    expect(b.click1).toBeLessThan(b.typeStart);
    expect(b.typeStart).toBeLessThan(b.typeEnd);
    expect(b.typeEnd).toBeLessThan(b.click2);
    expect(b.click2).toBeLessThan(b.cursorExit);
    expect(b.cursorExit).toBeLessThan(b.stepAt[0]);
    expect(b.stepAt[b.stepAt.length - 1]).toBeLessThan(b.end);
  });

  it('runs status subject-then-states-then-counter in order', () => {
    const b = stagedBeats(status(), 150, FPS);
    if (b.kind !== 'status') throw new Error('wrong kind');
    expect(IN_FRAMES).toBeLessThanOrEqual(b.badgeAt);
    expect(b.badgeAt).toBeLessThan(b.titleAt);
    expect(b.titleAt).toBeLessThan(b.subAt);
    expect(b.subAt).toBeLessThan(b.stateAt[0]);
    expect(b.connectorAt[0]).toBeLessThan(b.stateAt[1]);
    expect(b.stateAt[2]).toBeLessThan(b.counterAt ?? 0);
    expect(b.counterAt ?? 0).toBeLessThan(b.end);
  });
});

describe('results resolve order', () => {
  it('resolves the highlighted row last and keeps the rest in index order', () => {
    const b = stagedBeats(results({rows: 5, highlightIndex: 1}), 200, FPS);
    if (b.kind !== 'results') throw new Error('wrong kind');
    const r = b.resolve;
    expect(Math.max(...r)).toBe(r[1]);
    const others = [r[0], r[2], r[3], r[4]];
    for (let i = 1; i < others.length; i++) {
      expect(others[i]).toBeGreaterThan(others[i - 1]);
    }
  });
});

describe('still tail and k clamp', () => {
  const cases: [StagedConfig, number][] = [
    [results(), 180],
    [composer(), 195],
    [status(), 140],
  ];
  it('leaves at least TAIL_FRAMES of static frames and keeps k in band', () => {
    for (const [cfg, len] of cases) {
      const b = stagedBeats(cfg, len, FPS);
      expect(b.end).toBeLessThanOrEqual(len - TAIL_FRAMES);
      expect(b.k).toBeGreaterThanOrEqual(K_MIN);
      expect(b.k).toBeLessThanOrEqual(K_MAX);
    }
  });
  it('settles the composer running-step growth before the still tail even when K_MIN clamps', () => {
    // regression: with K_MIN clamping a short act, stepAt[last] pins to the cap
    // while the doubled growth duration used to run 12 frames into the tail
    for (const len of [80, 90, 100, 120]) {
      for (const steps of [2, 4]) {
        const b = stagedBeats(composer(steps, 'Summarize the latest three report'), len, FPS);
        if (b.kind !== 'composer') throw new Error('wrong kind');
        expect(b.lastGrowthAt + b.lastGrowthDur).toBeLessThanOrEqual(len - TAIL_FRAMES);
        expect(b.lastGrowthDur).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('camera law', () => {
  it('settles the push before the cursor arrives, holds through the click, releases after', () => {
    const cases: [StagedConfig, number][] = [
      [results(), 180],
      [composer(), 195],
      [status(3, {action: true}), 165],
    ];
    for (const [cfg, len] of cases) {
      const b = stagedBeats(cfg, len, FPS);
      const push = b.push;
      const release = b.release;
      const click = b.kind === 'composer' ? b.click2 : b.click;
      const arrive = b.arrive[b.arrive.length - 1];
      if (push === null || release === null || click === null) throw new Error('expected a push');
      expect(push.at + push.dur).toBeLessThanOrEqual(arrive);
      // dead still from the settle through the click and its resolve
      expect(release.at).toBeGreaterThanOrEqual(click + 6);
      expect(push.at + push.dur).toBeLessThanOrEqual(click + 6);
      expect(release.at + release.dur).toBeLessThanOrEqual(len - TAIL_FRAMES);
    }
  });
});

describe('typedSlice determinism', () => {
  const q = 'Summarize the latest three reports';
  it('is empty before, complete at the end, monotone and repeatable', () => {
    expect(typedSlice(q, 10, 20, 36)).toBe('');
    expect(typedSlice(q, 20, 20, 36)).toBe('');
    expect(typedSlice(q, 56, 20, 36)).toBe(q);
    expect(typedSlice(q, 400, 20, 36)).toBe(q);
    let prev = 0;
    for (let f = 0; f <= 80; f++) {
      const s = typedSlice(q, f, 20, 36);
      expect(s.length).toBeGreaterThanOrEqual(prev);
      expect(s).toBe(typedSlice(q, f, 20, 36)); // a seek reproduces the frame
      expect(q.startsWith(s)).toBe(true);
      prev = s.length;
    }
  });
});

describe('caretOn', () => {
  it('is off at and after the end of typing and depends only on frame', () => {
    expect(caretOn(80, 38, 80, FPS)).toBe(false);
    expect(caretOn(120, 38, 80, FPS)).toBe(false);
    expect(caretOn(37, 38, 80, FPS)).toBe(false);
    expect(caretOn(38, 38, 80, FPS)).toBe(true);
    for (let f = 38; f < 80; f++) {
      expect(caretOn(f, 38, 80, FPS)).toBe(caretOn(f, 38, 80, FPS));
    }
  });
});

describe('layout containment', () => {
  const configs: StagedConfig[] = [
    ...[2, 3, 4, 5].map((n) => results({rows: n, highlightIndex: n - 1})),
    ...[2, 3, 4, 5].map((n) => results({rows: n, stat: false})),
    ...[2, 3, 4].map((m) => composer(m)),
    ...[2, 3, 4].map((p) => status(p)),
    ...[2, 3, 4].map((p) => status(p, {action: true, counter: false})),
  ];
  it('keeps every rect inside the 1600x900 stage', () => {
    for (const cfg of configs) {
      for (const r of stagedRects(cfg)) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(STAGE.w);
        expect(r.y + r.h).toBeLessThanOrEqual(STAGE.h);
      }
    }
  });

  it('never overlaps rows, steps or states', () => {
    for (const n of [2, 3, 4, 5]) {
      const rows = resultsLayout(results({rows: n})).rows;
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].h);
      }
    }
    for (const m of [2, 3, 4]) {
      const steps = composerLayout(composer(m)).steps;
      for (let j = 1; j < steps.length; j++) {
        expect(steps[j].y).toBeGreaterThanOrEqual(steps[j - 1].y + steps[j - 1].h);
      }
    }
    for (const p of [2, 3, 4]) {
      const states = statusLayout(status(p)).states;
      for (let j = 1; j < states.length; j++) {
        expect(states[j].y).toBeGreaterThanOrEqual(states[j - 1].y + states[j - 1].h);
      }
    }
  });
});

describe('push keep-out', () => {
  it('keeps the pushed content inside the frame and above the keep-out band', () => {
    const configs: StagedConfig[] = [
      results(),
      results({stat: false}),
      composer(),
      status(),
      status(3, {action: true}),
    ];
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
    ]) {
      const f = formatFor(w, h);
      const {fit, cx, cy, bottomLimit} = stageFit(f);
      for (const cfg of configs) {
        expect(pushFits(cfg, fit, cx, cy, bottomLimit, h, w)).toBe(true);
      }
    }
  });
});

describe('schema defaults', () => {
  it('parses a minimal config of each kind with the documented defaults', () => {
    const r = stagedSceneSchema.parse({
      kind: 'results',
      query: 'Search',
      rows: [
        {primary: 'A', idleState: 'Pending', state: 'Ready'},
        {primary: 'B', idleState: 'Pending', state: 'Ready'},
      ],
    });
    if (r.kind !== 'results') throw new Error('wrong kind');
    expect(r.highlightIndex).toBe(0);
    expect(r.chips).toEqual([]);
    expect(r.countLabel).toBeNull();
    expect(r.stat).toBeNull();
    expect(r.rows[0].secondary).toBe('');
    expect(r.rows[0].meta).toBeNull();

    const c = stagedSceneSchema.parse({
      kind: 'composer',
      placeholder: 'Ask',
      query: 'Do the thing',
      submitLabel: 'Run',
      steps: [{label: 'One'}, {label: 'Two'}],
    });
    if (c.kind !== 'composer') throw new Error('wrong kind');
    expect(c.submittedLabel).toBeNull();
    expect(c.runTitle).toBeNull();
    expect(c.steps[0].meta).toBeNull();

    const s = stagedSceneSchema.parse({
      kind: 'status',
      subject: {title: 'Batch', badge: 'B'},
      states: [{label: 'One'}, {label: 'Two'}],
    });
    if (s.kind !== 'status') throw new Error('wrong kind');
    expect(s.counter).toBeNull();
    expect(s.action).toBeNull();
    expect(s.subject.sub).toBeNull();
  });
});

describe('pulse', () => {
  it('starts and ends at exactly 1 and never exceeds 1.06', () => {
    expect(pulse(40, 40, 12)).toBe(1);
    expect(pulse(52, 40, 12)).toBeCloseTo(1, 10);
    expect(pulse(39, 40, 12)).toBe(1);
    expect(pulse(53, 40, 12)).toBe(1);
    for (let f = 30; f <= 60; f++) {
      expect(pulse(f, 40, 12)).toBeLessThanOrEqual(1.06);
      expect(pulse(f, 40, 12)).toBeGreaterThanOrEqual(1);
    }
  });
});
