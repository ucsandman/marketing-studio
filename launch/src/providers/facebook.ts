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

const REQUIRED_KEYS = ['FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN'] as const;
const GRAPH = 'https://graph.facebook.com/v25.0';

export interface FacebookDeps {
  fetchImpl?: typeof fetch;
}

export class FacebookProvider implements Provider {
  readonly name = 'facebook' as const;
  readonly draftPlatform = 'facebook' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    deps: FacebookDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private missingKeys(): string[] {
    return REQUIRED_KEYS.filter((k) => !this.env[k]);
  }

  mode(): 'api' | 'blocked' {
    return this.missingKeys().length === 0 ? 'api' : 'blocked';
  }

  /**
   * Verifies the token is a PAGE token: /me with a page token resolves to the
   * page id; a user token resolves to the user's id instead. Posting with a
   * user token would publish to the user's profile (or fail) — a silent trap.
   */
  async ready(): Promise<ProviderStatus> {
    const missing = this.missingKeys();
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `missing keys: ${missing.join(', ')}`,
        fixHint:
          'Create an app at developers.facebook.com, grant pages_manage_posts, generate a PAGE access token for your page, fill .env. The app must be in LIVE mode or posts are invisible to the public.',
      };
    }
    try {
      const res = await this.fetchImpl(
        `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(this.env.FB_PAGE_ACCESS_TOKEN ?? '')}`,
      );
      if (res.status === 401 || res.status === 400) {
        return { ok: false, detail: 'token rejected', fixHint: authError('Facebook', [...REQUIRED_KEYS]) };
      }
      const me = (await res.json()) as { id?: string; name?: string };
      if (me.id !== this.env.FB_PAGE_ID) {
        return {
          ok: false,
          detail: `token resolves to "${me.name ?? me.id}" — a USER token, not the page token for FB_PAGE_ID`,
          fixHint:
            'Generate a PAGE access token: Graph API Explorer → your app → User token → grant pages_manage_posts → GET /me/accounts → use the page\'s access_token. Reminder: app must be LIVE for public posts.',
        };
      }
      return {
        ok: true,
        detail: `page token verified for "${me.name}" (reminder: app must be in LIVE mode for posts to be publicly visible)`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: `auth check failed: ${err instanceof Error ? err.message : String(err)}`,
        fixHint: authError('Facebook', [...REQUIRED_KEYS]),
      };
    }
  }

  previews(draft: Extract<Draft, { platform: 'facebook' }>): RequestPreview[] {
    const params = new URLSearchParams({ message: draft.message });
    if (draft.link) params.set('link', draft.link);
    params.set('access_token', '$FB_PAGE_ACCESS_TOKEN');
    return [
      {
        method: 'POST',
        url: `${GRAPH}/${this.env.FB_PAGE_ID ?? '$FB_PAGE_ID'}/feed`,
        body: params.toString(),
      },
    ];
  }

  async post(draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    if (draft?.platform !== 'facebook') {
      return { platform: 'facebook', ok: false, error: 'FacebookProvider needs a facebook draft', dryRun: opts.dryRun };
    }

    if (opts.dryRun) {
      for (const preview of this.previews(draft)) {
        emitPreview(redactPreview(preview, this.env, REQUIRED_KEYS), opts);
      }
      return { platform: 'facebook', ok: true, dryRun: true };
    }

    try {
      const params = new URLSearchParams({ message: draft.message });
      if (draft.link) params.set('link', draft.link);
      params.set('access_token', this.env.FB_PAGE_ACCESS_TOKEN ?? '');
      const res = await this.fetchImpl(`${GRAPH}/${this.env.FB_PAGE_ID}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      if (res.status === 401 || res.status === 400) {
        return { platform: 'facebook', ok: false, error: authError('Facebook', [...REQUIRED_KEYS]), dryRun: false };
      }
      if (res.status === 429) {
        return { platform: 'facebook', ok: false, error: rateLimitError('Facebook'), dryRun: false };
      }
      if (!res.ok) {
        return { platform: 'facebook', ok: false, error: `Facebook post failed: HTTP ${res.status}`, dryRun: false };
      }
      const json = (await res.json()) as { id?: string };
      return {
        platform: 'facebook',
        ok: true,
        url: json.id ? `https://www.facebook.com/${json.id}` : undefined,
        dryRun: false,
      };
    } catch (err) {
      return {
        platform: 'facebook',
        ok: false,
        error: `Facebook post failed: ${err instanceof Error ? err.message : String(err)}`,
        dryRun: false,
      };
    }
  }
}
