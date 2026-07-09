import {z} from 'zod';
import noban from '../../../brands/noban.json';
import dashclaw from '../../../brands/dashclaw.json';

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'expected #rrggbb hex color');

export const brandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().min(1),
  url: z.string().min(1),
  colors: z.object({
    bg: hex,
    surface: hex,
    surface2: hex,
    line: hex,
    ink: hex,
    ink2: hex,
    ink3: hex,
    brand: hex,
    profit: hex,
    safe: hex,
    loss: hex,
    info: hex,
    rare: hex,
  }),
  fonts: z.object({
    display: z.string().min(1),
    body: z.string().min(1),
    mono: z.string().min(1),
  }),
  // How loudly the brand mark is allowed to bloom. `wash` is the alpha of the
  // radial backdrop behind the mark, `glow` the alpha of its drop-shadow. Brands
  // whose rules forbid a hero wash (dashclaw: orange is signal, never decoration)
  // set wash to 0. Defaults reproduce the values these were hardcoded to.
  effects: z
    .object({
      wash: z.number().min(0).max(1),
      glow: z.number().min(0).max(1),
    })
    .default({wash: 0.165, glow: 0.4}),
  voice: z.string().min(1),
});

/** 0..1 alpha -> the two-digit hex suffix of an #rrggbbaa color. */
export const alphaHex = (a: number): string =>
  Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');

export type Brand = z.infer<typeof brandSchema>;

const registry: Record<string, unknown> = {noban, dashclaw};

export const getBrand = (id: string): Brand => {
  const raw = registry[id];
  if (raw === undefined) {
    throw new Error(
      `Unknown brand "${id}". Available: ${Object.keys(registry).join(', ')}`,
    );
  }
  return brandSchema.parse(raw);
};
