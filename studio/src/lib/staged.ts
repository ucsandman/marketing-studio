import {interpolate} from 'remotion';
import {z} from 'zod';
import type {SafeInsets} from './layout';

// Staged native-UI scenes (docs/product-launch-motion-adoption.md, Phase C + the
// shot catalog's results-waterfall / composer / pipeline-tracker constructions).
// Everything a staged shot needs that is NOT a React node lives here: the props
// schema, the stage-local geometry, and the beat math. Two reasons for the split:
//   1. geometry and beats must be unit-testable without a React tree (the repo
//      already does this for launchTiming, captionTiming, camera, sfxCues);
//   2. the geometry must be the SINGLE source for both the drawn element and the
//      camera/cursor target that points at it. getBoundingClientRect lies under a
//      scaled or rotated ancestor (PLAYBOOK trap), so nothing is ever measured —
//      every rect the camera pushes toward or the cursor clicks is computed here.

const label = z.string().min(1).max(64);

export const resultsShotSchema = z.object({
  kind: z.literal('results'),
  query: label, // shown already typed in the bar
  chips: z.array(label).max(4).default([]),
  countLabel: z.string().max(32).nullable().default(null),
  rows: z
    .array(
      z.object({
        primary: label,
        secondary: z.string().max(96).default(''),
        meta: z.string().max(24).nullable().default(null), // right column, tabular-nums
        idleState: label, // pre-resolve pill text
        state: label, // resolved pill text
      }),
    )
    .min(2)
    .max(5),
  // resolves LAST, takes the accent, and is the click target
  highlightIndex: z.number().int().min(0).default(0),
  stat: z.object({value: label, label: label}).nullable().default(null),
});

export const composerShotSchema = z.object({
  kind: z.literal('composer'),
  placeholder: label,
  query: z.string().min(1).max(72), // typed by slice(); one line at field size
  submitLabel: label,
  submittedLabel: label.nullable().default(null), // null falls back to submitLabel
  runTitle: label.nullable().default(null),
  steps: z
    .array(
      z.object({
        label,
        meta: z.string().max(24).nullable().default(null),
      }),
    )
    .min(2)
    .max(4), // the LAST one is left running at the cut
});

export const statusShotSchema = z.object({
  kind: z.literal('status'),
  subject: z.object({title: label, sub: label.nullable().default(null), badge: label}),
  states: z
    .array(
      z.object({
        label,
        meta: z.string().max(24).nullable().default(null),
      }),
    )
    .min(2)
    .max(4),
  counter: z.object({value: label, label: label}).nullable().default(null),
  // when set: a cursor arrives and clicks it, and the LAST state completes on that click
  action: z.object({label}).nullable().default(null),
});

export const stagedSceneSchema = z.discriminatedUnion('kind', [
  resultsShotSchema,
  composerShotSchema,
  statusShotSchema,
]);

export type StagedConfig = z.infer<typeof stagedSceneSchema>;
export type ResultsConfig = z.infer<typeof resultsShotSchema>;
export type ComposerConfig = z.infer<typeof composerShotSchema>;
export type StatusConfig = z.infer<typeof statusShotSchema>;

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const STAGE = {w: 1600, h: 900} as const; // stage-local authoring space
export const IN_FRAMES = 12; // act fade-in; nothing is choreographed before this
export const TAIL_FRAMES = 15; // mandatory still tail (covers the 12f act fade-out)
export const K_MIN = 0.85;
export const K_MAX = 1.4;
export const KEEPOUT = 0.17; // bottom band owned by FloatBar + captions

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// nominal beat tables — the source of truth, in seconds measured from the end of
// the act fade-in. Every construction self-reports `endNominal`; the act stretches
// or compresses the table by k = clamp(window / nominal, K_MIN, K_MAX), so a long
// act ends in an intentional hold instead of sluggish motion and a short act stays
// readable.
// ---------------------------------------------------------------------------

export const RESULTS_NOMINAL = {
  sweep: 0.45,
  barLight: 0.5,
  skelFrom: 0.6,
  skelStep: 0.055,
  chipFrom: 0.75,
  chipStep: 0.04,
  resolveFrom: 1.25,
  resolveStep: 0.22,
  resolveDur: 0.3,
  clickLag: 0.55, // after the last resolve
  cursorAppearLead: 1.4,
  arriveLead: 0.1,
  cursorExitLag: 0.75,
  pushLead: 0.9,
  pushDur: 0.3,
  pushTo: 1.06,
  releaseLag: 0.6,
  releaseDur: 0.34,
  rackReleaseLag: 0.5,
  endLag: 0.95,
};

export const COMPOSER_NOMINAL = {
  cursorAppear: 0.35,
  arriveLead: 0.1,
  click1: 0.7,
  focusDur: 0.15,
  typeLead: 0.15,
  typePerChar: 0.028,
  typeMin: 0.6,
  typeMax: 1.6,
  click2Lag: 0.55,
  fillDur: 0.26,
  labelSwapP: 0.12,
  panelLag: 0.3,
  panelDur: 0.3,
  stepFrom: 0.55,
  stepStep: 0.3,
  stepDur: 0.22,
  runningArc: 0.62, // last step's determinate fill stops here
  cursorExitLag: 0.35,
  pushLead: 0.85,
  pushDur: 0.3,
  pushTo: 1.045,
  releaseLag: 0.95,
  releaseDur: 0.34,
  endLag: 0.55,
};

export const STATUS_NOMINAL = {
  badge: 0.3,
  title: 0.55,
  sub: 0.7,
  stateFrom: 0.95,
  stateStep: 0.4,
  stateDur: 0.22,
  connectorLead: 0.18,
  connectorDur: 0.16,
  counterLag: 0.25,
  pulseDur: 0.3,
  cursorAppearLead: 1.2,
  arriveLead: 0.1,
  cursorExitLag: 0.45,
  pushLead: 0.8,
  pushDur: 0.28,
  pushTo: 1.05,
  releaseLag: 0.55,
  releaseDur: 0.32,
  endLag: 0.55,
};

// ---------------------------------------------------------------------------
// beat math
// ---------------------------------------------------------------------------

export type PushMove = {at: number; dur: number; to: number};

type Scaler = {
  k: number;
  /** nominal seconds -> absolute act frame, never past the still tail */
  at: (s: number) => number;
  /** nominal seconds -> a frame COUNT (at least 1) */
  dur: (s: number) => number;
};

const scaler = (endNominal: number, len: number, fps: number): Scaler => {
  const window = len - IN_FRAMES - TAIL_FRAMES;
  const k = clamp(window / (endNominal * fps), K_MIN, K_MAX);
  const cap = len - TAIL_FRAMES;
  return {
    k,
    at: (s) => Math.min(IN_FRAMES + Math.round(s * k * fps), cap),
    dur: (s) => Math.max(1, Math.round(s * k * fps)),
  };
};

export type ResultsBeats = {
  kind: 'results';
  k: number;
  end: number;
  sweep: number[];
  barLight: number;
  skeleton: number[];
  skelStep: number;
  chip: number[];
  chipStep: number;
  resolve: number[];
  resolveDur: number;
  click: number;
  countAt: number;
  cursorAppear: number;
  arrive: number[];
  cursorExit: number;
  push: PushMove;
  release: PushMove;
  rack: {at: number; release: number};
};

export type ComposerBeats = {
  kind: 'composer';
  k: number;
  end: number;
  sweep: number[];
  cursorAppear: number;
  arrive: number[];
  cursorExit: number;
  click1: number;
  click2: number;
  focusDur: number;
  typeStart: number;
  typeEnd: number;
  typeDur: number;
  fillDur: number;
  panelAt: number;
  panelDur: number;
  stepAt: number[];
  stepDur: number;
  /** start/length of the deliberately-left-running last step's arc growth,
      scheduled so the arc SETTLES by the still tail: when the position clamp
      pins the last beat to the cap, the growth starts early instead of
      animating through the tail */
  lastGrowthAt: number;
  lastGrowthDur: number;
  runningArc: number;
  push: PushMove;
  release: PushMove;
};

export type StatusBeats = {
  kind: 'status';
  k: number;
  end: number;
  sweep: number[];
  badgeAt: number;
  titleAt: number;
  subAt: number;
  stateAt: number[];
  stateDur: number;
  connectorAt: number[];
  connectorDur: number;
  counterAt: number | null;
  pulseAt: number | null;
  pulseDur: number;
  click: number | null;
  cursorAppear: number | null;
  arrive: number[];
  cursorExit: number | null;
  push: PushMove | null;
  release: PushMove | null;
};

export type StagedBeats = ResultsBeats | ComposerBeats | StatusBeats;

const resultsBeats = (cfg: ResultsConfig, len: number, fps: number): ResultsBeats => {
  const N = RESULTS_NOMINAL;
  const n = cfg.rows.length;
  const h = Math.min(cfg.highlightIndex, n - 1);
  // the highlighted row resolves LAST; everyone else keeps index order
  const slot = (i: number): number => (i === h ? n - 1 : i < h ? i : i - 1);
  const lastResolveS = N.resolveFrom + N.resolveStep * (n - 1);
  const clickS = lastResolveS + N.clickLag;
  const s = scaler(clickS + N.endLag, len, fps);
  const skelStep = s.dur(N.skelStep);
  const chipStep = s.dur(N.chipStep);
  const skelFrom = s.at(N.skelFrom);
  const chipFrom = s.at(N.chipFrom);
  return {
    kind: 'results',
    k: s.k,
    end: s.at(clickS + N.endLag),
    sweep: [s.at(N.sweep)],
    barLight: s.at(N.barLight),
    skeleton: cfg.rows.map((_, i) => skelFrom + i * skelStep),
    skelStep,
    chip: cfg.chips.map((_, i) => chipFrom + i * chipStep),
    chipStep,
    resolve: cfg.rows.map((_, i) => s.at(N.resolveFrom + N.resolveStep * slot(i))),
    resolveDur: s.dur(N.resolveDur),
    click: s.at(clickS),
    countAt: s.at(lastResolveS),
    cursorAppear: s.at(clickS - N.cursorAppearLead),
    arrive: [s.at(clickS - N.arriveLead)],
    cursorExit: s.at(clickS + N.cursorExitLag),
    push: {at: s.at(clickS - N.pushLead), dur: s.dur(N.pushDur), to: N.pushTo},
    release: {at: s.at(clickS + N.releaseLag), dur: s.dur(N.releaseDur), to: 1},
    rack: {at: s.at(clickS - N.pushLead), release: s.at(clickS + N.rackReleaseLag)},
  };
};

const composerBeats = (cfg: ComposerConfig, len: number, fps: number): ComposerBeats => {
  const N = COMPOSER_NOMINAL;
  const m = cfg.steps.length;
  const typeStartS = N.click1 + N.typeLead;
  const typeDurS = clamp(N.typePerChar * cfg.query.length, N.typeMin, N.typeMax);
  const typeEndS = typeStartS + typeDurS;
  const click2S = typeEndS + N.click2Lag;
  const stepS = (j: number): number => click2S + N.stepFrom + N.stepStep * j;
  const s = scaler(stepS(m - 1) + N.endLag, len, fps);
  const typeStart = s.at(typeStartS);
  const typeEnd = s.at(typeEndS);
  const click2 = s.at(click2S);
  // When K_MIN clamps the scale, at() pins late beats to the cap but durations
  // are cap-blind: the last step's doubled growth would run into the still
  // tail. Start the growth early enough that it settles by len - TAIL_FRAMES.
  const lastGrowthDur = s.dur(N.stepDur) * 2;
  const lastGrowthAt = Math.max(
    IN_FRAMES + 1,
    Math.min(s.at(stepS(m - 1)), len - TAIL_FRAMES - lastGrowthDur),
  );
  return {
    kind: 'composer',
    k: s.k,
    end: s.at(stepS(m - 1) + N.endLag),
    sweep: [click2],
    cursorAppear: s.at(N.cursorAppear),
    arrive: [s.at(N.click1 - N.arriveLead), s.at(click2S - N.arriveLead)],
    cursorExit: s.at(click2S + N.cursorExitLag),
    click1: s.at(N.click1),
    click2,
    focusDur: s.dur(N.focusDur),
    typeStart,
    typeEnd,
    typeDur: Math.max(1, typeEnd - typeStart),
    fillDur: s.dur(N.fillDur),
    panelAt: s.at(click2S + N.panelLag),
    panelDur: s.dur(N.panelDur),
    stepAt: cfg.steps.map((_, j) => s.at(stepS(j))),
    stepDur: s.dur(N.stepDur),
    lastGrowthAt,
    lastGrowthDur,
    runningArc: N.runningArc,
    push: {at: s.at(click2S - N.pushLead), dur: s.dur(N.pushDur), to: N.pushTo},
    release: {at: s.at(click2S + N.releaseLag), dur: s.dur(N.releaseDur), to: 1},
  };
};

const statusBeats = (cfg: StatusConfig, len: number, fps: number): StatusBeats => {
  const N = STATUS_NOMINAL;
  const p = cfg.states.length;
  const stateS = (j: number): number => N.stateFrom + N.stateStep * j;
  const lastStateS = stateS(p - 1);
  const counterS = cfg.counter ? lastStateS + N.counterLag : null;
  const endNominal =
    counterS === null ? lastStateS + N.endLag : counterS + N.pulseDur + N.endLag;
  const s = scaler(endNominal, len, fps);
  const clickS = cfg.action ? lastStateS : null;
  const counterAt = counterS === null ? null : s.at(counterS);
  return {
    kind: 'status',
    k: s.k,
    end: s.at(endNominal),
    sweep: [counterAt ?? s.at(lastStateS)],
    badgeAt: s.at(N.badge),
    titleAt: s.at(N.title),
    subAt: s.at(N.sub),
    stateAt: cfg.states.map((_, j) => s.at(stateS(j))),
    stateDur: s.dur(N.stateDur),
    connectorAt: cfg.states
      .slice(0, p - 1)
      .map((_, j) => s.at(stateS(j + 1) - N.connectorLead)),
    connectorDur: s.dur(N.connectorDur),
    counterAt,
    pulseAt: counterAt,
    pulseDur: s.dur(N.pulseDur),
    click: clickS === null ? null : s.at(clickS),
    cursorAppear: clickS === null ? null : s.at(clickS - N.cursorAppearLead),
    arrive: clickS === null ? [] : [s.at(clickS - N.arriveLead)],
    cursorExit: clickS === null ? null : s.at(clickS + N.cursorExitLag),
    push:
      clickS === null
        ? null
        : {at: s.at(clickS - N.pushLead), dur: s.dur(N.pushDur), to: N.pushTo},
    release:
      clickS === null
        ? null
        : {at: s.at(clickS + N.releaseLag), dur: s.dur(N.releaseDur), to: 1},
  };
};

/** Absolute act frames for one staged construction, scaled to the act length. */
export const stagedBeats = (cfg: StagedConfig, len: number, fps: number): StagedBeats => {
  if (cfg.kind === 'results') return resultsBeats(cfg, len, fps);
  if (cfg.kind === 'composer') return composerBeats(cfg, len, fps);
  return statusBeats(cfg, len, fps);
};

// ---------------------------------------------------------------------------
// layout math (stage-local, never measured)
// ---------------------------------------------------------------------------

export type Rect = {x: number; y: number; w: number; h: number};

export const center = (r: Rect): {x: number; y: number} => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
});

export const originPct = (p: {x: number; y: number}): string =>
  `${((p.x / STAGE.w) * 100).toFixed(3)}% ${((p.y / STAGE.h) * 100).toFixed(3)}%`;

export type ResultsLayout = {
  card: Rect;
  bar: Rect;
  chipRow: Rect;
  rows: Rect[];
  rowState: Rect[];
  stat: Rect | null;
};

export const resultsLayout = (cfg: ResultsConfig): ResultsLayout => {
  const n = cfg.rows.length;
  const card: Rect = {x: 80, y: 70, w: cfg.stat ? 1120 : 1440, h: 760};
  const bar: Rect = {x: card.x + 40, y: card.y + 40, w: card.w - 80, h: 76};
  const chipRow: Rect = {x: card.x + 40, y: bar.y + bar.h + 28, w: card.w - 80, h: 44};
  const rowsTop = chipRow.y + chipRow.h + 30;
  const rowH = Math.min(112, Math.floor((card.y + card.h - 40 - rowsTop) / n));
  const rows: Rect[] = cfg.rows.map((_, i) => ({
    x: card.x + 28,
    y: rowsTop + i * rowH,
    w: card.w - 56,
    h: rowH - 12,
  }));
  const rowState: Rect[] = rows.map((r) => ({
    x: r.x + r.w - 190,
    y: r.y + (r.h - 52) / 2,
    w: 162,
    h: 52,
  }));
  return {card, bar, chipRow, rows, rowState, stat: cfg.stat ? {x: 1240, y: 260, w: 280, h: 260} : null};
};

export type ComposerLayout = {card: Rect; field: Rect; submit: Rect; panel: Rect; steps: Rect[]};

export const composerLayout = (cfg: ComposerConfig): ComposerLayout => {
  const card: Rect = {x: 200, y: 110, w: 1200, h: 250};
  const field: Rect = {x: card.x + 40, y: card.y + 90, w: card.w - 80 - 260, h: 84};
  const submit: Rect = {x: field.x + field.w + 28, y: field.y, w: 232, h: 84};
  // The panel is 400 tall for the 2-3 step cases the table was authored for; a
  // fourth step at the 88px pitch would hang past its bottom edge, so the plate
  // grows by exactly one pitch rather than clipping the step.
  const panel: Rect = {
    x: 200,
    y: 410,
    w: 1200,
    h: 400 + Math.max(0, (cfg.steps.length - 3) * 88),
  };
  const steps: Rect[] = cfg.steps.map((_, j) => ({
    x: panel.x + 36,
    y: panel.y + 110 + j * 88,
    w: panel.w - 72,
    h: 72,
  }));
  return {card, field, submit, panel, steps};
};

export type StatusLayout = {
  card: Rect;
  badge: Rect;
  states: Rect[];
  circles: Rect[];
  connectors: Rect[];
  action: Rect | null;
  counter: Rect | null;
};

export const statusLayout = (cfg: StatusConfig): StatusLayout => {
  const card: Rect = {x: 210, y: 90, w: 940, h: cfg.action ? 720 : 640};
  const badge: Rect = {x: card.x + 44, y: card.y + 44, w: 96, h: 96};
  const statesTop = card.y + 200;
  const states: Rect[] = cfg.states.map((_, j) => ({
    x: card.x + 44,
    y: statesTop + j * 110,
    w: card.w - 88,
    h: 76,
  }));
  const circles: Rect[] = states.map((s) => ({x: card.x + 60, y: s.y + 16, w: 44, h: 44}));
  const connectors: Rect[] = circles.slice(0, states.length - 1).map((c) => ({
    x: c.x + 20,
    y: c.y + c.h + 8,
    w: 4,
    h: 110 - 44 - 16,
  }));
  return {
    card,
    badge,
    states,
    circles,
    connectors,
    action: cfg.action
      ? {x: card.x + card.w - 44 - 240, y: card.y + card.h - 44 - 64, w: 240, h: 64}
      : null,
    counter: cfg.counter ? {x: 1210, y: 300, w: 300, h: 140} : null,
  };
};

/** Every rect a construction draws, in stage coordinates. */
export const stagedRects = (cfg: StagedConfig): Rect[] => {
  if (cfg.kind === 'results') {
    const l = resultsLayout(cfg);
    return [l.card, l.bar, l.chipRow, ...l.rows, ...l.rowState, ...(l.stat ? [l.stat] : [])];
  }
  if (cfg.kind === 'composer') {
    const l = composerLayout(cfg);
    return [l.card, l.field, l.submit, l.panel, ...l.steps];
  }
  const l = statusLayout(cfg);
  return [
    l.card,
    l.badge,
    ...l.states,
    ...l.circles,
    ...l.connectors,
    ...(l.action ? [l.action] : []),
    ...(l.counter ? [l.counter] : []),
  ];
};

/** Bounding box of everything a construction draws. */
export const contentRect = (cfg: StagedConfig): Rect => {
  const rects = stagedRects(cfg);
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return {x, y, w: right - x, h: bottom - y};
};

/**
 * Fit the fixed 1600x900 stage into the composition frame, above the bottom
 * keep-out band that FloatBar and captions own and below the heading band that
 * LaunchVideo's FeatureAct reserves. Static — it is applied on a third node ABOVE
 * the camera rig so it never shares a transform matrix with the dolly or the turn.
 */
export const stageFit = (f: {
  width: number;
  height: number;
  scale: number;
  safe: SafeInsets;
}): {fit: number; cx: number; cy: number; bottomLimit: number} => {
  const reserve =
    Math.max(Math.round(64 * f.scale), f.safe.top) +
    Math.round(56 * f.scale * 1.3) +
    Math.round(56 * f.scale); // FeatureAct heading band
  const bottomLimit = f.height - Math.max(f.safe.bottom, Math.round(KEEPOUT * f.height));
  const bandW = Math.max(1, f.width - f.safe.left - f.safe.right);
  const bandH = Math.max(1, bottomLimit - reserve);
  const fit = Math.min(bandW / STAGE.w, bandH / STAGE.h);
  return {fit, cx: f.safe.left + bandW / 2, cy: reserve + bandH / 2, bottomLimit};
};

/** Where an edge lands after a scale about `origin` (adoption doc push formula). */
export const pushedEdge = (edge: number, origin: number, scale: number): number =>
  edge + (edge - origin) * (scale - 1);

/** The dolly target for a construction: what the camera pushes toward, and how far. */
export const pushTarget = (
  cfg: StagedConfig,
): {to: number; origin: {x: number; y: number}} | null => {
  if (cfg.kind === 'results') {
    const l = resultsLayout(cfg);
    const h = Math.min(cfg.highlightIndex, cfg.rows.length - 1);
    return {to: RESULTS_NOMINAL.pushTo, origin: center(l.rowState[h])};
  }
  if (cfg.kind === 'composer') {
    return {to: COMPOSER_NOMINAL.pushTo, origin: center(composerLayout(cfg).submit)};
  }
  const l = statusLayout(cfg);
  if (!l.action) return null;
  return {to: STATUS_NOMINAL.pushTo, origin: center(l.action)};
};

/**
 * Does the construction's pushed content stay inside the frame and above the
 * keep-out band? Checked against the CONTENT bounding box, not the 1600x900 stage
 * box: the stage box is authored with padding and is fitted flush to the band, so
 * any push at all would drive its own (empty) edge past the limit.
 */
export const pushFits = (
  cfg: StagedConfig,
  fit: number,
  cx: number,
  cy: number,
  bottomLimit: number,
  height: number,
  width: number,
): boolean => {
  const push = pushTarget(cfg);
  const box = contentRect(cfg);
  const to = push ? push.to : 1;
  const origin = push ? push.origin : center(box);
  const left = pushedEdge(box.x, origin.x, to);
  const right = pushedEdge(box.x + box.w, origin.x, to);
  const top = pushedEdge(box.y, origin.y, to);
  const bottom = pushedEdge(box.y + box.h, origin.y, to);
  const sx = (v: number): number => cx + (v - STAGE.w / 2) * fit;
  const sy = (v: number): number => cy + (v - STAGE.h / 2) * fit;
  return (
    sx(left) >= 0 &&
    sx(right) <= width &&
    sy(top) >= 0 &&
    sy(bottom) <= bottomLimit &&
    sy(bottom) <= height
  );
};

// ---------------------------------------------------------------------------
// determinism helpers — no Math.random, no Date, no measurement API anywhere in
// the system, so any frame is reproducible from a seek.
// ---------------------------------------------------------------------------

export const typedSlice = (text: string, frame: number, from: number, dur: number): string => {
  if (dur <= 0) return frame >= from ? text : '';
  const i = Math.round(
    interpolate(frame, [from, from + dur], [0, text.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }), // linear, no easing
  );
  return text.slice(0, i);
};

export const caretOn = (frame: number, from: number, until: number, fps: number): boolean => {
  if (frame < from || frame >= until) return false;
  const period = Math.max(2, Math.round(fps * 1.06));
  return (frame - from) % period < period / 2; // deterministic square wave
};

export const smoothstep = (p: number): number => p * p * (3 - 2 * p);

export const skelWidths = (i: number): {primary: number; secondary: number} => ({
  primary: 54 + ((i * 17) % 18), // percent
  secondary: 28 + ((i * 11) % 12),
});

/** One-shot swell that starts and ends at exactly 1 (no residual scale). */
export const pulse = (frame: number, at: number, dur: number): number => {
  if (dur <= 0 || frame < at || frame > at + dur) return 1;
  return 1 + 0.06 * Math.sin(Math.PI * ((frame - at) / dur));
};
