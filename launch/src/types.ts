import { z } from 'zod';

/** Platforms the engine can distribute to. */
export const PLATFORMS = [
  'x',
  'bluesky',
  'facebook',
  'linkedin',
  'youtube',
  'reddit',
  'hackernews',
  'producthunt',
  'google',
  'email-sms',
] as const;

export const PlatformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof PlatformSchema>;

// ---------------------------------------------------------------------------
// LaunchConfig — written by `launch init`, read by every other command
// ---------------------------------------------------------------------------

export const LaunchConfigSchema = z.object({
  name: z.string().min(1),
  tagline: z.string().min(1),
  description: z.string().min(1),
  domain: z.string().min(1),
  productUrl: z.string().url(),
  pricing: z.string().min(1),
  /** Optional: not inferable from a target repo; provided via --audience or skill. */
  audience: z.string().min(1).optional(),
  stack: z.array(z.string()).default([]),
  repoUrl: z.string().url().optional(),
  /** From-address for launch emails; defaults to launch@<domain>. */
  emailFrom: z.string().email().optional(),
  /** Absolute path to an animations post kit (out/<brand>/postkit). Drafts own copy; the kit contributes media. */
  postkitDir: z.string().min(1).optional(),
});

export type LaunchConfig = z.infer<typeof LaunchConfigSchema>;

// ---------------------------------------------------------------------------
// PostKit — manifest.json written by the animations repo's build-postkit.mjs
// ---------------------------------------------------------------------------

/** One platform folder in a post kit. Paths relative to the kit root; null = not assembled. */
export const PostKitPlatformEntrySchema = z.object({
  video: z.string().nullable(),
  caption: z.string().nullable(),
  alt: z.string().nullable(),
  thumb: z.string().nullable(),
  srt: z.string().nullable(),
  vtt: z.string().nullable(),
  note: z.string(),
});
export type PostKitPlatformEntry = z.infer<typeof PostKitPlatformEntrySchema>;

export const PostKitManifestSchema = z.object({
  version: z.literal(1),
  brand: z.string().min(1),
  generatedAt: z.string().datetime(),
  platforms: z.record(PostKitPlatformEntrySchema),
});
export type PostKitManifest = z.infer<typeof PostKitManifestSchema>;

/** Video attached to a post. videoPath is absolute by the time a provider sees it. */
export const DraftMediaSchema = z.object({
  videoPath: z.string().min(1),
  altText: z.string().optional(),
});
export type DraftMedia = z.infer<typeof DraftMediaSchema>;

// ---------------------------------------------------------------------------
// Draft — one per platform, scaffolded then filled then validated then posted
// ---------------------------------------------------------------------------

export const DraftStatusSchema = z.enum([
  'draft',
  'filled',
  'validated',
  'posted',
  'skipped',
]);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

const draftBase = {
  status: DraftStatusSchema,
};

/** Platforms that carry a copy draft (google is GSC-only; email-sms splits in two). */
export const DRAFT_PLATFORMS = [
  'x',
  'facebook',
  'linkedin',
  'reddit',
  'hackernews',
  'producthunt',
  'email',
  'sms',
] as const;

export const DraftPlatformSchema = z.enum(DRAFT_PLATFORMS);
export type DraftPlatform = z.infer<typeof DraftPlatformSchema>;

export const XDraftSchema = z.object({
  ...draftBase,
  platform: z.literal('x'),
  /** Thread: one string per post, in order. First post must NOT contain the URL. */
  thread: z.array(z.string()),
  /** Reply posted under the thread carrying the product link ($0.20 URL surcharge contained here). */
  replyWithLink: z.string().optional(),
  /** Video attached to the FIRST thread post. Filled from the post kit at post time when absent. */
  media: DraftMediaSchema.optional(),
});

export const FacebookDraftSchema = z.object({
  ...draftBase,
  platform: z.literal('facebook'),
  message: z.string(),
  link: z.string().optional(),
});

export const LinkedInDraftSchema = z.object({
  ...draftBase,
  platform: z.literal('linkedin'),
  body: z.string(),
  /** Product link goes in the first comment, not the body. */
  firstComment: z.string().optional(),
  /** Video attached to the post. altText doubles as the LinkedIn video title. */
  media: DraftMediaSchema.optional(),
});

export const RedditDraftSchema = z.object({
  ...draftBase,
  platform: z.literal('reddit'),
  posts: z.array(
    z.object({
      sub: z.string(),
      title: z.string(),
      body: z.string(),
    }),
  ),
});

export const HackerNewsDraftSchema = z.object({
  ...draftBase,
  platform: z.literal('hackernews'),
  title: z.string(),
  url: z.string(),
  makerComment: z.string().optional(),
});

export const ProductHuntDraftSchema = z.object({
  ...draftBase,
  platform: z.literal('producthunt'),
  tagline: z.string(),
  description: z.string(),
  topics: z.array(z.string()),
  firstComment: z.string().optional(),
  galleryNotes: z.string().optional(),
});

export const EmailDraftSchema = z.object({
  ...draftBase,
  platform: z.literal('email'),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export const SmsDraftSchema = z.object({
  ...draftBase,
  platform: z.literal('sms'),
  body: z.string(),
});

export const DraftSchema = z.discriminatedUnion('platform', [
  XDraftSchema,
  FacebookDraftSchema,
  LinkedInDraftSchema,
  RedditDraftSchema,
  HackerNewsDraftSchema,
  ProductHuntDraftSchema,
  EmailDraftSchema,
  SmsDraftSchema,
]);

export type Draft = z.infer<typeof DraftSchema>;

// ---------------------------------------------------------------------------
// PostResult — outcome of one provider post attempt
// ---------------------------------------------------------------------------

export const PostResultSchema = z.object({
  platform: PlatformSchema,
  ok: z.boolean(),
  url: z.string().optional(),
  error: z.string().optional(),
  dryRun: z.boolean(),
  // Assist-only flows (HN/PH) open a submit page but the human clicks submit —
  // success here must NOT be recorded in the ledger as posted.
  assisted: z.boolean().optional(),
});

export type PostResult = z.infer<typeof PostResultSchema>;

// ---------------------------------------------------------------------------
// ResearchBrief metadata — header of each .launch/research/<platform>.md
// ---------------------------------------------------------------------------

export const ResearchBriefMetaSchema = z.object({
  platform: PlatformSchema,
  fetchedAt: z.string().datetime(),
  degraded: z.boolean().default(false),
  sources: z.array(z.string()).default([]),
});

export type ResearchBriefMeta = z.infer<typeof ResearchBriefMetaSchema>;

// ---------------------------------------------------------------------------
// Contacts — user-supplied lists in <target>/.launch/contacts.json
// ---------------------------------------------------------------------------

export const EmailContactSchema = z.object({
  address: z.string().email(),
  name: z.string().optional(),
  /** Hard rule: only consent === true contacts are ever messaged. */
  consent: z.boolean(),
});

export const SmsContactSchema = z.object({
  number: z.string().min(1),
  name: z.string().optional(),
  consent: z.boolean(),
});

export const ContactsSchema = z.object({
  email: z.array(EmailContactSchema).default([]),
  sms: z.array(SmsContactSchema).default([]),
});

export type Contacts = z.infer<typeof ContactsSchema>;

// ---------------------------------------------------------------------------
// LedgerEntry — append-only record of completed posts (idempotency)
// ---------------------------------------------------------------------------

export const LedgerEntrySchema = z.object({
  platform: PlatformSchema,
  idempotencyKey: z.string().min(1),
  postedAt: z.string().datetime(),
  url: z.string().optional(),
  /**
   * The publication this row replaced (a `--force` repost). Present only on
   * reposts; keeps the previous url/postedAt recoverable, since `--mark-posted`
   * refuses a key that is already in the ledger.
   */
  supersedes: z
    .object({
      url: z.string().optional(),
      postedAt: z.string().datetime(),
    })
    .optional(),
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

// ---------------------------------------------------------------------------
// RecentsFile — dashboard's recently-opened targets at ~/.launch-engine/recents.json
// ---------------------------------------------------------------------------

export const RecentsEntrySchema = z.object({
  /** Absolute path to the target project directory. */
  dir: z.string().min(1),
  name: z.string().min(1),
  domain: z.string().optional(),
  lastOpened: z.string().datetime(),
});

export type RecentsEntry = z.infer<typeof RecentsEntrySchema>;

export const RecentsFileSchema = z.object({
  version: z.literal(1),
  targets: z.array(RecentsEntrySchema).default([]),
});

export type RecentsFile = z.infer<typeof RecentsFileSchema>;
