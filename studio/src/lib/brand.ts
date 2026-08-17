import {z} from 'zod';
import noban from '../../../brands/noban.json';
import dashclaw from '../../../brands/dashclaw.json';
import paperroute from '../../../brands/paperroute.json';
import magnetic from '../../../brands/magnetic.json';
import costclaw from '../../../brands/costclaw.json';
import sidetap from '../../../brands/sidetap.json';
import tenwords from '../../../brands/tenwords.json';

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
  // FilmGrade overlay intensities — the template-to-agency production-value pass.
  // Each layer is 0..1 (letterbox capped low) and skipped at 0. Defaults are
  // deliberately RESTRAINED (grain barely-there, gentle vignette, faint accent bloom,
  // no aberration, no letterbox); brands whose rules forbid a hero wash/glow
  // (paperroute One Green Rule, dashclaw orange-is-signal) zero their bloom.
  // `grainSize` is the feTurbulence baseFrequency AT 1080p; FilmGrade scales it by
  // frame height so an asset rendered at 1080p and 2160p carries the same visual
  // grain instead of a finer one at 4K. The default is the value grain was
  // hardcoded to, so a brand that omits it renders byte-identically at 1080p.
  // `halation` is the highlight bloom (see FilmGrade): unlike `bloom`, which is a
  // fixed radial gradient, halation samples the frame and glows wherever the
  // content is actually bright. It defaults to 0 — brands whose rules forbid a
  // hero wash (paperroute's One Green Rule, dashclaw's orange-is-signal) must
  // leave it there, since halation would bloom their accent by definition.
  // judge-motion warns above a `grain` of 0.4: grain is felt, not seen.
  grade: z
    .object({
      grain: z.number().min(0).max(1),
      grainSize: z.number().min(0.1).max(3).default(0.8),
      halation: z.number().min(0).max(1).default(0),
      vignette: z.number().min(0).max(1),
      bloom: z.number().min(0).max(1),
      aberration: z.number().min(0).max(1),
      letterbox: z.number().min(0).max(0.15),
    })
    .default({
      grain: 0.12,
      grainSize: 0.8,
      halation: 0,
      vignette: 0.18,
      bloom: 0.1,
      aberration: 0,
      letterbox: 0,
    }),
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
  // Which colors.* key templates use for small colored text (e.g. LogoReveal's
  // CTA line). Defaults to 'brand' — the legacy hardcoded behavior, so a brand
  // that omits this renders byte-identically. costclaw sets 'rare': its voice
  // forbids clay (colors.brand) from ever carrying text (graphic-only, and it
  // fails contrast on white), so colored text uses its umber tone instead.
  textAccent: z.enum(['brand', 'profit', 'safe', 'loss', 'info', 'rare']).default('brand'),
  // Progress-fill gradient tokens for FloatBar. Defaults reproduce the legacy
  // hardcoded brand->profit gradient, so a brand that omits this renders
  // byte-identically. tenwords sets safe->ink: its accent budget forbids the
  // pilcrow red on progress fills (red is the mark and small accents only).
  progressFill: z
    .object({
      from: z.enum(['brand', 'profit', 'safe', 'loss', 'info', 'rare', 'ink', 'ink2', 'line']),
      to: z.enum(['brand', 'profit', 'safe', 'loss', 'info', 'rare', 'ink', 'ink2', 'line']),
    })
    .default({from: 'brand', to: 'profit'}),
  voice: z.string().min(1),
  // How the brand's coined name is SPOKEN, when that differs from how it is
  // written. Whisper cannot transcribe a coined word it has never seen (measured:
  // "SideTap" -> "PsyTep"), so scripts/judge-audio.mjs primes the transcriber with
  // a short prose hint built from this field, and docs/ERRORS.md 2026-08-13
  // records that the SPOKEN word's casing is what recovers it — the lowercase
  // wordmark "sidetap" and title-case "Sidetap" both failed where "SideTap"
  // worked. Optional: brands whose name transcribes correctly omit it and
  // judge-audio falls back to `name`.
  //
  // Declared here because judge-audio already reads it off the raw JSON. Without
  // a schema entry it was unvalidated, undocumented, and silently dropped from
  // getBrand() by zod's default key stripping — a field the audio gate depends on
  // that the type system did not know existed.
  speechHint: z.string().min(1).optional(),
});

/** 0..1 alpha -> the two-digit hex suffix of an #rrggbbaa color. */
export const alphaHex = (a: number): string =>
  Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');

export type Brand = z.infer<typeof brandSchema>;

const registry: Record<string, unknown> = {noban, dashclaw, paperroute, magnetic, costclaw, sidetap, tenwords};

export const getBrand = (id: string): Brand => {
  const raw = registry[id];
  if (raw === undefined) {
    throw new Error(
      `Unknown brand "${id}". Available: ${Object.keys(registry).join(', ')}`,
    );
  }
  return brandSchema.parse(raw);
};
