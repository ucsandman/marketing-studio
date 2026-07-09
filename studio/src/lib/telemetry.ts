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

export const telemetrySchema = z.object({
  viewport: z.object({width: z.number().positive(), height: z.number().positive()}),
  durationMs: z.number().positive(),
  events: z.array(z.discriminatedUnion('type', [clickEvent, stepEvent])),
});

export type Telemetry = z.infer<typeof telemetrySchema>;
export type ClickEvent = z.infer<typeof clickEvent>;
export type StepEvent = z.infer<typeof stepEvent>;

export const clicks = (tel: Telemetry): ClickEvent[] =>
  tel.events.filter((e): e is ClickEvent => e.type === 'click');

export const steps = (tel: Telemetry): StepEvent[] =>
  tel.events.filter((e): e is StepEvent => e.type === 'step');

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

const APPROACH_MS = 700; // cursor travel time into a click
const PRESS_MS = 180; // press indicator duration after a click

export const cursorAt = (
  clickList: ClickEvent[],
  tMs: number,
): {x: number; y: number; press: number} => {
  if (clickList.length === 0) return {x: 0, y: 0, press: 0};
  const press = clickList.some((c) => tMs >= c.t && tMs - c.t < PRESS_MS) ? 1 : 0;

  // index of the last click at or before tMs (-1 if before all clicks)
  let i = -1;
  while (i + 1 < clickList.length && clickList[i + 1].t <= tMs) i++;

  const from = clickList[Math.max(i, 0)];
  const next = clickList[i + 1];
  if (!next) return {x: from.x, y: from.y, press};

  const approachStart = Math.max(next.t - APPROACH_MS, from.t);
  if (tMs < approachStart) return {x: from.x, y: from.y, press};

  const span = next.t - approachStart;
  const p = span > 0 ? easeInOutCubic((tMs - approachStart) / span) : 1;
  return {
    x: from.x + (next.x - from.x) * p,
    y: from.y + (next.y - from.y) * p,
    press,
  };
};
