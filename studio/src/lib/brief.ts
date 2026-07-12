import {z} from 'zod';

// A Content Brief is the upstream source of truth for a product's launch copy.
// `scripts/derive-brief.mjs` gathers raw grounding into brief-inputs.json; the
// agent synthesizes that into out/<brand>/marketing/brief.json, which the props
// builders read. Every top-level field carries a sane default so a partial brief
// (or none) never breaks a downstream builder — mirror of how brand.ts stays
// smoke-green with an optional `effects` block on a clean clone.

const platformCopy = z.object({
  hook: z.string(),
  headline: z.string(),
});

export const briefSchema = z.object({
  // The one required field — a brief is always about a specific brand.
  brandId: z.string().min(1),
  // The headline plus alternates the agent can swap for A/B or platform fit.
  // `strategies` labels the hook category of each entry, index-aligned with
  // [headline, ...altHeadlines] (skills/marketing/references/hook-formulas.md:
  // curiosity|story|value|contrarian) — a hook A/B teaches nothing unless the
  // variants come from different categories, so the labels travel with them.
  hook: z
    .object({
      headline: z.string(),
      altHeadlines: z.array(z.string()),
      strategies: z.array(z.string()).default([]),
    })
    .default({headline: '', altHeadlines: [], strategies: []}),
  // Feature stories ranked best-first. `benefitLines` caps at 3 to match the
  // launch template's three-line FeaturePanel. `sourceRoute` records which
  // product route grounded the feature (null when it came from README/other).
  features: z
    .array(
      z.object({
        key: z.string(),
        heading: z.string(),
        benefitLines: z.array(z.string()).max(3),
        rationale: z.string(),
        sourceRoute: z.string().nullable(),
      }),
    )
    .default([]),
  positioning: z
    .object({
      differentiator: z.string(),
    })
    .nullable()
    .default(null),
  // Grounding sections below adapted from Corey Haines' marketingskills
  // `product-marketing` skill (github.com/coreyhaines31/marketingskills, MIT).
  // They exist so hooks/narration/social copy trace to real audience facts
  // instead of generic product praise; the storyboard renders them so the
  // approver can check the copy against its grounding.
  //
  // Who the copy speaks to and what the problem costs them; painPoints feed
  // hook/problem framing.
  audience: z
    .object({
      who: z.string(),
      painPoints: z.array(z.string()),
    })
    .nullable()
    .default(null),
  // Verbatim customer phrasing from the grounding (README issues, landing DOM,
  // reviews). Copy synthesis mirrors `use` and never emits `avoid`.
  customerLanguage: z
    .object({
      use: z.array(z.string()),
      avoid: z.array(z.string()),
    })
    .default({use: [], avoid: []}),
  // Top objections plus the response the copy should carry — objection
  // handling is a copy angle, not a FAQ dump.
  objections: z
    .array(
      z.object({
        objection: z.string(),
        response: z.string(),
      }),
    )
    .default([]),
  // JTBD Four Forces of switching: push (frustration with the current way),
  // pull (what attracts them here), habit (what keeps them stuck), anxiety
  // (what worries them about switching — CTA/end-card reassurance feeds on it).
  switchingForces: z
    .object({
      push: z.string(),
      pull: z.string(),
      habit: z.string(),
      anxiety: z.string(),
    })
    .nullable()
    .default(null),
  // Receipts for claims made in copy. `source` is REQUIRED and non-empty: an
  // unsourced number or quote is fabrication (trust + legal liability), a hard
  // stop — omit the proof point rather than invent a source.
  proofPoints: z
    .array(
      z.object({
        claim: z.string(),
        source: z.string().min(1),
      }),
    )
    .default([]),
  cta: z.string().default(''),
  // Voiceover lines keyed by launch act. `act` matches launchTiming.ts act
  // names as used by the audio manifest: `logo|hook|demo|feature-N|end`.
  narration: z
    .array(
      z.object({
        act: z.string(),
        text: z.string(),
      }),
    )
    .default([]),
  social: z
    .object({
      x: platformCopy.nullable(),
      linkedin: platformCopy.nullable(),
      vertical: platformCopy.nullable(),
    })
    .nullable()
    .default(null),
});

export type Brief = z.infer<typeof briefSchema>;
