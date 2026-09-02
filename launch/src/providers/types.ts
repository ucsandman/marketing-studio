import type { Draft, DraftPlatform, PostResult, Platform } from '../types.js';

export type ProviderMode = 'api' | 'assist' | 'blocked';

export interface ProviderStatus {
  ok: boolean;
  /** Human-readable status, e.g. "authenticated as @user" or "missing keys: X_API_KEY". */
  detail: string;
  /** Actionable setup/fix instructions when not ok. Names env KEYS, never values. */
  fixHint?: string;
}

export interface PostOptions {
  dryRun: boolean;
  /** From launch.config.json — used by draft-less providers (GSC sitemap/inspection). */
  productUrl?: string;
  /** Assist mode: open prefilled URLs in the browser + copy companion text to clipboard. */
  assist?: boolean;
  /** <target>/.launch/out — where assisted providers write artifacts (PH kit). */
  outDir?: string;
  /** <target>/.launch/research — assisted providers may pull live findings into artifacts. */
  researchDir?: string;
  /** Capture dry-run previews as data instead of printing them (UI endpoints). */
  onPreview?: (preview: RequestPreview) => void;
}

/** A dry-run request preview: exactly what would be sent, nothing sent. */
export interface RequestPreview {
  method: string;
  url: string;
  body?: string;
}

export function formatPreview(p: RequestPreview): string {
  return `${p.method} ${p.url}${p.body ? `\n  body: ${p.body}` : ''}`;
}

/** Swap any env VALUE occurrence for its $KEY name — previews/output never carry values. */
export function redactEnvValues(
  text: string,
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string {
  let out = text;
  for (const key of keys) {
    const value = env[key];
    if (value) out = out.split(value).join(`$${key}`);
  }
  return out;
}

export function redactPreview(
  preview: RequestPreview,
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): RequestPreview {
  return {
    method: preview.method,
    url: redactEnvValues(preview.url, env, keys),
    body: preview.body === undefined ? undefined : redactEnvValues(preview.body, env, keys),
  };
}

/** Dry-run preview sink: captured by the UI via onPreview, printed for the CLI. */
export function emitPreview(preview: RequestPreview, opts: PostOptions): void {
  if (opts.onPreview) opts.onPreview(preview);
  else console.log(formatPreview(preview));
}

export interface Provider {
  readonly name: Platform;
  /** Which draft this provider posts; undefined for draft-less providers (GSC). */
  readonly draftPlatform?: DraftPlatform;
  /**
   * This provider can ONLY publish video (YouTube). `launch post --all` skips it
   * when the draft carries no media instead of failing the whole run: a
   * text-only launch must not exit non-zero just because its OAuth keys are set.
   */
  readonly requiresMedia?: boolean;
  /** Sync, from env-key presence: 'api' (can post), 'assist' (no write API), 'blocked' (missing creds). */
  mode(): ProviderMode;
  /** Cheap authenticated call proving the credentials work (used by `launch doctor`). */
  ready(): Promise<ProviderStatus>;
  /** Post the draft. dryRun prints exact request payloads and sends nothing. */
  post(draft: Draft | undefined, opts: PostOptions): Promise<PostResult>;
}

/** Read an HTTP status code off an unknown error (twitter-api-v2 uses .code, fetch wrappers .status). */
export function httpStatusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { code?: unknown; status?: unknown };
  if (typeof e.code === 'number') return e.code;
  if (typeof e.status === 'number') return e.status;
  return undefined;
}

/** Standard error strings: actionable, name env keys, never log values, never auto-retry. */
export function authError(platform: string, keys: string[]): string {
  return `${platform} authentication failed (401). Check ${keys.join(', ')} in .env — see .env.example for how to obtain them.`;
}

export function rateLimitError(platform: string): string {
  return `${platform} rate limit hit (429). Wait and re-run — the engine never auto-retries posts (a duplicate launch post is worse than a delayed one).`;
}
