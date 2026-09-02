import type { Draft, PostResult } from '../types.js';
import {
  authError,
  emitPreview,
  rateLimitError,
  redactPreview,
  type PostOptions,
  type Provider,
  type ProviderStatus,
  type RequestPreview,
} from './types.js';

const REQUIRED_KEYS = [
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'REDDIT_USERNAME',
  'REDDIT_PASSWORD',
  'REDDIT_USER_AGENT',
] as const;

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';

export interface RedditDeps {
  fetchImpl?: typeof fetch;
  /** Delay between sub submissions (ms). Spam protection — 0 in tests. */
  staggerMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class RedditProvider implements Provider {
  readonly name = 'reddit' as const;
  readonly draftPlatform = 'reddit' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly staggerMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    deps: RedditDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.staggerMs = deps.staggerMs ?? 5_000;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  private missingKeys(): string[] {
    return REQUIRED_KEYS.filter((k) => !this.env[k]);
  }

  mode(): 'api' | 'blocked' {
    return this.missingKeys().length === 0 ? 'api' : 'blocked';
  }

  /** Password-grant token, fetched fresh each run (1h lifetime). */
  private async getToken(): Promise<string> {
    const basic = Buffer.from(
      `${this.env.REDDIT_CLIENT_ID}:${this.env.REDDIT_CLIENT_SECRET}`,
    ).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'password',
      username: this.env.REDDIT_USERNAME ?? '',
      password: this.env.REDDIT_PASSWORD ?? '',
    });
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.env.REDDIT_USER_AGENT ?? '',
      },
      body,
    });
    if (res.status === 401) throw Object.assign(new Error('reddit token 401'), { status: 401 });
    if (!res.ok) throw Object.assign(new Error(`reddit token HTTP ${res.status}`), { status: res.status });
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('reddit token response missing access_token');
    return json.access_token;
  }

  async ready(): Promise<ProviderStatus> {
    const missing = this.missingKeys();
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `missing keys: ${missing.join(', ')}`,
        fixHint: 'Create a script app at reddit.com/prefs/apps, fill .env (see .env.example). Use an aged account with karma.',
      };
    }
    try {
      const token = await this.getToken();
      const res = await this.fetchImpl(`${API_BASE}/api/v1/me`, {
        headers: this.authHeaders(token),
      });
      if (!res.ok) throw Object.assign(new Error(`me HTTP ${res.status}`), { status: res.status });
      const me = (await res.json()) as { name?: string };
      return { ok: true, detail: `authenticated as u/${me.name ?? 'unknown'}` };
    } catch {
      return {
        ok: false,
        detail: 'auth check failed',
        fixHint: authError('Reddit', [...REQUIRED_KEYS]),
      };
    }
  }

  private authHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'User-Agent': this.env.REDDIT_USER_AGENT ?? '',
    };
  }

  /** The exact request sequence (used by dry-run). Env values shown as $KEY references. */
  previews(draft: Extract<Draft, { platform: 'reddit' }>): RequestPreview[] {
    const seq: RequestPreview[] = [
      {
        method: 'POST',
        url: TOKEN_URL,
        body: 'grant_type=password&username=$REDDIT_USERNAME&password=$REDDIT_PASSWORD (Basic $REDDIT_CLIENT_ID:$REDDIT_CLIENT_SECRET)',
      },
    ];
    for (const post of draft.posts) {
      seq.push({ method: 'GET', url: `${API_BASE}/r/${post.sub}/about/rules.json` });
      seq.push({
        method: 'POST',
        url: `${API_BASE}/api/submit`,
        body: new URLSearchParams({ sr: post.sub, kind: 'self', title: post.title, text: post.body }).toString(),
      });
    }
    return seq;
  }

  async post(draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    if (draft?.platform !== 'reddit') {
      return { platform: 'reddit', ok: false, error: `RedditProvider needs a reddit draft`, dryRun: opts.dryRun };
    }

    if (opts.dryRun) {
      for (const preview of this.previews(draft)) {
        emitPreview(redactPreview(preview, this.env, REQUIRED_KEYS), opts);
      }
      return { platform: 'reddit', ok: true, dryRun: true };
    }

    try {
      const token = await this.getToken();
      let firstUrl: string | undefined;
      for (const [i, post] of draft.posts.entries()) {
        if (i > 0 && this.staggerMs > 0) await this.sleep(this.staggerMs);

        // Hard ordering: live rules fetch for this sub before its submit, same run.
        const rulesRes = await this.fetchImpl(`${API_BASE}/r/${post.sub}/about/rules.json`, {
          headers: this.authHeaders(token),
        });
        if (!rulesRes.ok) {
          throw Object.assign(new Error(`r/${post.sub} rules fetch HTTP ${rulesRes.status}`), {
            status: rulesRes.status,
          });
        }

        const submitRes = await this.fetchImpl(`${API_BASE}/api/submit`, {
          method: 'POST',
          headers: { ...this.authHeaders(token), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ sr: post.sub, kind: 'self', title: post.title, text: post.body }),
        });
        if (submitRes.status === 429) throw Object.assign(new Error('submit 429'), { status: 429 });
        if (!submitRes.ok) {
          throw Object.assign(new Error(`r/${post.sub} submit HTTP ${submitRes.status}`), {
            status: submitRes.status,
          });
        }
        const json = (await submitRes.json()) as { json?: { data?: { url?: string } } };
        firstUrl ??= json.json?.data?.url;
      }
      return { platform: 'reddit', ok: true, url: firstUrl, dryRun: false };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const error =
        status === 401
          ? authError('Reddit', [...REQUIRED_KEYS])
          : status === 429
            ? rateLimitError('Reddit')
            : `Reddit post failed: ${err instanceof Error ? err.message : String(err)}`;
      return { platform: 'reddit', ok: false, error, dryRun: false };
    }
  }
}
