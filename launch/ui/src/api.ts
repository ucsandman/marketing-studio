/**
 * API client. The server hands the browser a single-use `?token=` on launch;
 * we store it in sessionStorage, scrub it from the address bar, and attach it
 * to every request as X-Launch-Token.
 */

const TOKEN_KEY = 'launch-ui-token';

function bootstrapToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    url.searchParams.delete('token');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

export const token = bootstrapToken();

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fields?: FieldError[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'X-Launch-Token': token ?? '',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let envelope: { ok: boolean; data?: unknown; error?: string; fields?: FieldError[] };
  try {
    envelope = (await res.json()) as typeof envelope;
  } catch {
    throw new ApiError(`Server returned a non-JSON response (HTTP ${res.status})`, res.status);
  }
  if (!envelope.ok) {
    if (res.status === 403) {
      // Per-run token no longer valid (server restarted) — let the shell react.
      window.dispatchEvent(new CustomEvent('launch:unauthorized'));
    }
    throw new ApiError(envelope.error ?? `HTTP ${res.status}`, res.status, envelope.fields);
  }
  return envelope.data as T;
}

// ---- response shapes (mirror the zod-validated server) ----------------------

export interface HealthInfo {
  name: string;
  version: string;
}

export interface RecentTarget {
  dir: string;
  name: string;
  domain?: string;
  lastOpened: string;
  initialized: boolean;
}

export interface FsEntry {
  name: string;
  path: string;
}

export interface FsListing {
  path: string | null;
  parent: string | null;
  entries: FsEntry[];
}

export interface LaunchConfigView {
  name: string;
  tagline: string;
  description: string;
  domain: string;
  productUrl: string;
  pricing: string;
  audience?: string;
  stack: string[];
  repoUrl?: string;
  emailFrom?: string;
  postkitDir?: string;
}

export interface TargetInfo {
  initialized: boolean;
  config?: LaunchConfigView;
  scan: {
    scanned: Partial<LaunchConfigView>;
    missing: string[];
  };
}

export interface DoctorRow {
  provider: string;
  mode: 'api' | 'assist' | 'blocked';
  detail: string;
  fixHint?: string;
}

export interface DoctorReport {
  exitCode: number;
  rows: DoctorRow[];
  messages: string[];
}

export interface PlatformMeta {
  draftPlatforms: readonly string[];
  limits: {
    x: { post: number; threadWarn: number };
    hackernews: { title: number };
    reddit: { title: number };
    producthunt: { tagline: number };
    email: { subject: number };
    sms: { gsmSeptets: number };
  };
  assistOnly: string[];
}

// ---- drafts ------------------------------------------------------------------

export interface XDraft {
  platform: 'x';
  status: string;
  thread: string[];
  replyWithLink?: string;
}
export interface FacebookDraft {
  platform: 'facebook';
  status: string;
  message: string;
  link?: string;
}
export interface LinkedInDraft {
  platform: 'linkedin';
  status: string;
  body: string;
  firstComment?: string;
}
export interface RedditDraft {
  platform: 'reddit';
  status: string;
  posts: { sub: string; title: string; body: string }[];
}
export interface HackerNewsDraft {
  platform: 'hackernews';
  status: string;
  title: string;
  url: string;
  makerComment?: string;
}
export interface ProductHuntDraft {
  platform: 'producthunt';
  status: string;
  tagline: string;
  description: string;
  topics: string[];
  firstComment?: string;
  galleryNotes?: string;
}
export interface EmailDraft {
  platform: 'email';
  status: string;
  subject: string;
  html: string;
  text: string;
}
export interface SmsDraft {
  platform: 'sms';
  status: string;
  body: string;
}

export type AnyDraft =
  | XDraft
  | FacebookDraft
  | LinkedInDraft
  | RedditDraft
  | HackerNewsDraft
  | ProductHuntDraft
  | EmailDraft
  | SmsDraft;

export interface RuleViolation {
  rule: string;
  platform: string;
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface DraftsView {
  initialized: boolean;
  drafts: {
    platform: string;
    draft: AnyDraft;
    validation: { errors: RuleViolation[]; warnings: RuleViolation[] };
  }[];
}

// ---- briefs / status ------------------------------------------------------------

export interface BriefEntry {
  platform: string;
  content: string;
  meta: { platform: string; fetchedAt: string; degraded: boolean; sources: string[] } | null;
  stale: boolean;
}

export interface BriefsView {
  initialized: boolean;
  briefs: BriefEntry[];
}

export interface StatusView {
  exitCode: number;
  messages: string[];
  posted: { platform: string; postedAt: string; url?: string }[];
  drafts: { platform: string; status: string }[];
  briefs: { platform: string; state: 'fresh' | 'stale' | 'missing' }[];
  remaining: string[];
}

// ---- post kit -----------------------------------------------------------------

export interface PostKitPlatformView {
  platform: string;
  autoAttach: boolean;
  folder: string;
  note: string;
  video: { file: string; missing: boolean; sizeBytes: number | null } | null;
  caption: string | null;
  thumbDataUri: string | null;
  check: { ok: boolean; durationSeconds: number | null; problems: string[] } | null;
}

export interface PostKitView {
  initialized: boolean;
  configured: boolean;
  dir?: string;
  brand?: string;
  generatedAt?: string;
  manifestError?: string;
  platforms: PostKitPlatformView[];
}
