import {z} from 'zod';
import synthacon from '../../../brands/synthacon.json';

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'expected #rrggbb hex color');

// Extracted so takes-based variant scripts (scripts/render-variants.mjs) can build
// a partial per-render override without duplicating the field list; brandSchema's
// `motion` field below still carries the brand-wide default.
const motionSchema = z.object({
  tempo: z.number().min(0.5).max(2),
  exuberance: z.number().min(0).max(1),
  stagger: z.number().min(0).max(1),
  overshoot: z.number().min(0).max(1),
  parallax: z.number().min(0).max(1).default(0),
  settle: z.number().min(0).max(1).default(0),
  textReveal: z.enum(['spring', 'maskWipe', 'blurIn', 'charStagger']).default('spring'),
});

/** Partial motion knobs a template's `motionOverride` prop merges over brand.motion
 * (see LogoReveal/LaunchVideo schemas) — the render-variants hero-take mechanism.
 * Only motion may vary per-take; brand colors are never overridable (voice rules). */
export const motionOverrideSchema = motionSchema.partial();

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
  // Which color TOKEN templates hand the brand mark component (getMark/getReveal
  // consumers): 'brand' (the accent hue, default — reproduces every existing
  // brand's output byte-identically) or 'ink' for a brand whose voice forbids a
  // colored mark (synthacon: the S renders in ink/white, never violet). Resolve
  // with markColorOf() below rather than reading brand.colors.brand directly.
  light: z
    .object({bg: hex, ink: hex, brand: hex, outlineVariant: hex})
    .optional(),
  markColor: z.enum(['brand', 'ink']).default('brand'),
  fonts: z.object({
    display: z.string().min(1),
    body: z.string().min(1),
    mono: z.string().min(1),
  }),
  // How loudly the brand mark is allowed to bloom. `wash` is the alpha of the
  // radial backdrop behind the mark, `glow` the alpha of its drop-shadow. A brand
  // whose rules forbid a hero wash or glow (synthacon: no glow on any asset) sets
  // them low or 0. Defaults reproduce the values these were hardcoded to.
  effects: z
    .object({
      wash: z.number().min(0).max(1),
      glow: z.number().min(0).max(1),
    })
    .default({wash: 0.165, glow: 0.4}),
  // FilmGrade overlay intensities — the template-to-agency production-value pass.
  // Each layer is 0..1 (letterbox capped low) and skipped at 0. Defaults are
  // deliberately RESTRAINED (grain barely-there, gentle vignette, faint accent bloom,
  // no aberration, no letterbox); a brand whose rules forbid an accent bloom
  // (synthacon: violet/white/black only, no glow, no bloom) zeroes it.
  grade: z
    .object({
      grain: z.number().min(0).max(1),
      vignette: z.number().min(0).max(1),
      bloom: z.number().min(0).max(1),
      aberration: z.number().min(0).max(1),
      letterbox: z.number().min(0).max(0.15),
    })
    .default({grain: 0.12, vignette: 0.18, bloom: 0.1, aberration: 0, letterbox: 0}),
  // Per-brand motion personality — retunes ALL entrance choreography (springs,
  // eased reveals, inter-element stagger) without ever moving a rest position, so
  // one knob per brand keeps a terse/mechanical brand terse and lets a lively one
  // spring. `tempo` is a duration multiplier for entrances/transitions (>1 brisker);
  // `exuberance` maps to spring bounciness (0 = critically-damped/no overshoot,
  // 1 = visibly bouncy); `stagger` scales inter-element delays; `overshoot` scales
  // how far a bouncy entrance travels past its rest point. `parallax` (0 = flat)
  // scales the slow depth-layer drift that gives flat comps believable depth, and
  // `settle` (0 = hard cut) scales the overshoot-and-settle kicker applied right
  // after each act cut so cuts land like a real operator, not a linear ease. BOTH
  // default to 0 so a brand that omits them renders byte-identically to a flat cut;
  // the math lives in lib/motion.ts + lib/depth.ts and templates consume it via
  // `brand.motion`. `textReveal` picks the per-brand headline entrance preset
  // (lib/textReveal.ts); it DEFAULTS to 'spring', the extracted legacy word math, so
  // a brand that omits it renders byte-identically.
  motion: motionSchema.default({
    tempo: 1,
    exuberance: 0.35,
    stagger: 0.5,
    overshoot: 0.25,
    parallax: 0,
    settle: 0,
    textReveal: 'spring',
  }),
  voice: z.string().min(1),
});

/** 0..1 alpha -> the two-digit hex suffix of an #rrggbbaa color. */
export const alphaHex = (a: number): string =>
  Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');

export type Brand = z.infer<typeof brandSchema>;

/** The resolved hex a template should hand a brand's mark component, per
 * brand.markColor. Every getMark/getReveal call site routes through this
 * instead of reading brand.colors.brand directly. */
export const markColorOf = (brand: Brand): string =>
  brand.markColor === 'ink' ? brand.colors.ink : brand.colors.brand;

const registry: Record<string, unknown> = {synthacon};

export const getBrand = (id: string): Brand => {
  const raw = registry[id];
  if (raw === undefined) {
    throw new Error(
      `Unknown brand "${id}". Available: ${Object.keys(registry).join(', ')}`,
    );
  }
  return brandSchema.parse(raw);
};
