import {z} from 'zod';

const clickEvent = z.object({
  type: z.literal('click'),
  t: z.number().nonnegative(),
  x: z.number(),
  y: z.number(),
});

const stepEvent = z.object({
  type: z.literal('step'),
  t: z.number().nonnegative(),
  label: z.string().min(1),
});

// x,y = center of the region of interest; w,h = its size in viewport px
const focusEvent = z.object({
  type: z.literal('focus'),
  t: z.number().nonnegative(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});

export const telemetrySchema = z.object({
  viewport: z.object({width: z.number().positive(), height: z.number().positive()}),
  durationMs: z.number().positive(),
  events: z.array(z.discriminatedUnion('type', [clickEvent, stepEvent, focusEvent])),
});

export type Telemetry = z.infer<typeof telemetrySchema>;
export type ClickEvent = z.infer<typeof clickEvent>;
export type StepEvent = z.infer<typeof stepEvent>;
export type FocusEvent = z.infer<typeof focusEvent>;

export const clicks = (tel: Telemetry): ClickEvent[] =>
  tel.events.filter((e): e is ClickEvent => e.type === 'click');

export const steps = (tel: Telemetry): StepEvent[] =>
  tel.events.filter((e): e is StepEvent => e.type === 'step');

export const focuses = (tel: Telemetry): FocusEvent[] =>
  tel.events.filter((e): e is FocusEvent => e.type === 'focus');

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

const APPROACH_MS = 700; // cursor travel time into a click
const PRESS_MS = 180; // press indicator duration after a click
const DWELL_MS = 600; // beat left on the target after a click before leaving

export const cursorAt = (
  clickList: ClickEvent[],
  tMs: number,
  viewport: {width: number; height: number},
): {x: number; y: number; press: number} => {
  if (clickList.length === 0) return {x: 0, y: 0, press: 0};
  const press = clickList.some((c) => tMs >= c.t && tMs - c.t < PRESS_MS) ? 1 : 0;

  // Off-stage park. camera.clampOrigin never lets the frame see past the
  // viewport, so a point below it is out of shot at every scale. The cursor
  // waits there instead of squatting on the copy through the beats it has
  // nothing to do with — a pointer parked on a word during a static hold reads
  // as a rendering fault, not as a resting cursor. Offset in x so it arcs in
  // rather than rising on a dead vertical line.
  const rest = {t: 0, x: clickList[0].x - 140, y: viewport.height + 80};

  // index of the last click at or before tMs (-1 if before all clicks)
  let i = -1;
  while (i + 1 < clickList.length && clickList[i + 1].t <= tMs) i++;

  const from = i < 0 ? rest : clickList[i];
  const next = clickList[i + 1];
  if (!next) {
    // past the last click: dwell on it, then ease back off stage
    const t = (tMs - from.t - DWELL_MS) / APPROACH_MS;
    if (t <= 0) return {x: from.x, y: from.y, press};
    const p = easeInOutCubic(Math.min(1, t));
    return {x: from.x + (rest.x - from.x) * p, y: from.y + (rest.y - from.y) * p, press};
  }

  const approachStart = Math.max(next.t - APPROACH_MS, from.t);
  if (tMs < approachStart) return {x: from.x, y: from.y, press};

  const span = next.t - approachStart;
  // x and y run different eases (and x lands slightly early) so the travel path
  // bows — identical single-ease axes produce the straight-line "fake cursor"
  // tell. Both axes still arrive exactly at next.t, so click sync is unchanged.
  const t = span > 0 ? (tMs - approachStart) / span : 1;
  const px = easeInOutCubic(Math.min(1, t / 0.83));
  const py = easeInOutQuad(t);
  return {
    x: from.x + (next.x - from.x) * px,
    y: from.y + (next.y - from.y) * py,
    press,
  };
};
