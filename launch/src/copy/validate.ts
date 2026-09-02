import type { Draft, DraftPlatform } from '../types.js';

export interface RuleViolation {
  rule: string;
  platform: DraftPlatform;
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  errors: RuleViolation[];
  warnings: RuleViolation[];
}

export interface ValidateContext {
  /** From launch.config.json — email html must contain it. */
  productUrl?: string;
}

const PLACEHOLDER_RE = /\{\{[^}]*\}\}/;
const URL_RE = /https?:\/\/\S+/i;

/** Hard per-field character limits — single source for the validator and the UI. */
export const PLATFORM_LIMITS = {
  x: { post: 280, threadWarn: 8 },
  hackernews: { title: 80 },
  reddit: { title: 300 },
  producthunt: { tagline: 60 },
  email: { subject: 78 },
  sms: { gsmSeptets: 160 },
} as const;

// GSM-7 basic charset (counts 1) and extended charset (counts 2).
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€';

/** GSM-7 septet count: basic chars = 1, extended chars = 2, non-GSM chars = 2 (UCS-2 fallback risk). */
export function gsmLength(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) count += 1;
    else if (GSM_EXTENDED.includes(ch)) count += 2;
    else count += 2;
  }
  return count;
}

/** Walk every string field of a draft, calling visit(fieldPath, value). */
function walkStrings(value: unknown, path: string, visit: (field: string, text: string) => void): void {
  if (typeof value === 'string') {
    visit(path, value);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'platform' || k === 'status') continue;
      walkStrings(v, path ? `${path}.${k}` : k, visit);
    }
  }
}

/** Validate one draft against its platform's hard rules. */
export function validateDraft(draft: Draft, ctx: ValidateContext = {}): ValidationResult {
  const errors: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];
  const platform = draft.platform;

  const error = (rule: string, field: string, message: string): void => {
    errors.push({ rule, platform, field, severity: 'error', message });
  };
  const warning = (rule: string, field: string, message: string): void => {
    warnings.push({ rule, platform, field, severity: 'warning', message });
  };

  // Common: no unfilled {{placeholders}} anywhere.
  walkStrings(draft, '', (field, text) => {
    if (PLACEHOLDER_RE.test(text)) {
      error('unfilled-placeholder', field, `Unfilled {{placeholder}} remains in ${field}.`);
    }
  });

  switch (draft.platform) {
    case 'x': {
      draft.thread.forEach((post, i) => {
        if (post.length > PLATFORM_LIMITS.x.post) {
          error('x-post-length', `thread[${i}]`, `Post is ${post.length} chars (max ${PLATFORM_LIMITS.x.post}).`);
        }
      });
      if (draft.thread[0] && URL_RE.test(draft.thread[0])) {
        warning(
          'x-url-first-post',
          'thread[0]',
          'URL in the first post: X charges $0.20 per URL post (13x the $0.015 text rate) and ranks it lower — move the link to replyWithLink.',
        );
      }
      if (draft.thread.length > PLATFORM_LIMITS.x.threadWarn) {
        warning('x-thread-length', 'thread', `Thread has ${draft.thread.length} posts (>${PLATFORM_LIMITS.x.threadWarn} dilutes engagement).`);
      }
      break;
    }
    case 'hackernews': {
      if (!draft.title.startsWith('Show HN: ')) {
        error('hn-title-prefix', 'title', 'Show HN title must start with "Show HN: ".');
      }
      if (draft.title.length > PLATFORM_LIMITS.hackernews.title) {
        error('hn-title-length', 'title', `Title is ${draft.title.length} chars (max ${PLATFORM_LIMITS.hackernews.title}).`);
      }
      if (draft.url && !draft.makerComment) {
        error(
          'hn-maker-comment',
          'makerComment',
          'URL submissions must ship with a maker comment, posted immediately after submitting.',
        );
      }
      break;
    }
    case 'linkedin': {
      if (URL_RE.test(draft.body)) {
        warning(
          'linkedin-link-in-body',
          'body',
          'Link in the post body costs ~18.8% reach — move it to firstComment.',
        );
      }
      break;
    }
    case 'reddit': {
      draft.posts.forEach((post, i) => {
        if (!post.sub.trim()) {
          error('reddit-sub-required', `posts[${i}].sub`, 'Subreddit must be specified.');
        }
        if (post.title.length > PLATFORM_LIMITS.reddit.title) {
          error('reddit-title-length', `posts[${i}].title`, `Title is ${post.title.length} chars (max ${PLATFORM_LIMITS.reddit.title}).`);
        }
      });
      const bodies = draft.posts.map((p) => p.body.trim()).filter((b) => b.length > 0);
      if (new Set(bodies).size < bodies.length) {
        warning(
          'reddit-duplicate-body',
          'posts',
          'Identical body across multiple subs reads as cross-post spam (ban risk) — customize per sub.',
        );
      }
      break;
    }
    case 'producthunt': {
      if (draft.tagline.length > PLATFORM_LIMITS.producthunt.tagline) {
        error('ph-tagline-length', 'tagline', `Tagline is ${draft.tagline.length} chars (max ${PLATFORM_LIMITS.producthunt.tagline}).`);
      }
      if (draft.topics.length < 1 || draft.topics.length > 3) {
        error('ph-topics-count', 'topics', `Needs 1-3 topics (has ${draft.topics.length}).`);
      }
      break;
    }
    case 'email': {
      if (draft.subject.length > PLATFORM_LIMITS.email.subject) {
        error('email-subject-length', 'subject', `Subject is ${draft.subject.length} chars (max ${PLATFORM_LIMITS.email.subject}).`);
      }
      if (!/unsubscribe/i.test(draft.html)) {
        error('email-unsubscribe', 'html', 'Email HTML must contain an unsubscribe link.');
      }
      if (ctx.productUrl ? !draft.html.includes(ctx.productUrl) : !URL_RE.test(draft.html)) {
        error('email-product-link', 'html', 'Email HTML must contain the product link.');
      }
      break;
    }
    case 'sms': {
      const len = gsmLength(draft.body);
      if (len > PLATFORM_LIMITS.sms.gsmSeptets) {
        error('sms-gsm-length', 'body', `SMS is ${len} GSM-7 septets (max ${PLATFORM_LIMITS.sms.gsmSeptets}; extended chars count double).`);
      }
      break;
    }
    case 'facebook':
      break;
  }

  return { errors, warnings };
}
