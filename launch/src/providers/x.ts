import { TwitterApi } from 'twitter-api-v2';
import type { Draft, PostResult } from '../types.js';
import {
  authError,
  emitPreview,
  httpStatusOf,
  rateLimitError,
  type PostOptions,
  type Provider,
  type ProviderStatus,
  type RequestPreview,
} from './types.js';

const REQUIRED_KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'] as const;

interface TweetPayload {
  text: string;
  reply?: { in_reply_to_tweet_id: string };
  media?: { media_ids: [string] };
}

/** The slice of TwitterApi the provider uses — injectable for tests. */
export interface XClientLike {
  v1: {
    /** Chunked media upload; resolves to the media_id string. longVideo for videos that may exceed 120s. */
    uploadMedia(file: string, options?: { longVideo?: boolean }): Promise<string>;
  };
  v2: {
    tweet(payload: TweetPayload): Promise<{ data: { id: string } }>;
    me(): Promise<{ data: { username: string } }>;
  };
}

export type XClientFactory = (env: NodeJS.ProcessEnv) => XClientLike;

const defaultFactory: XClientFactory = (env) =>
  new TwitterApi({
    appKey: env.X_API_KEY ?? '',
    appSecret: env.X_API_SECRET ?? '',
    accessToken: env.X_ACCESS_TOKEN ?? '',
    accessSecret: env.X_ACCESS_SECRET ?? '',
  });

export class XProvider implements Provider {
  readonly name = 'x' as const;
  readonly draftPlatform = 'x' as const;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly clientFactory: XClientFactory = defaultFactory,
  ) {}

  private missingKeys(): string[] {
    return REQUIRED_KEYS.filter((k) => !this.env[k]);
  }

  mode(): 'api' | 'blocked' {
    return this.missingKeys().length === 0 ? 'api' : 'blocked';
  }

  async ready(): Promise<ProviderStatus> {
    const missing = this.missingKeys();
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `missing keys: ${missing.join(', ')}`,
        fixHint: 'Create an app at developer.x.com, generate user-context keys, fill .env (see .env.example). Note: pay-per-use billing required since Feb 2026.',
      };
    }
    try {
      const me = await this.clientFactory(this.env).v2.me();
      return { ok: true, detail: `authenticated as @${me.data.username}` };
    } catch (err) {
      return {
        ok: false,
        detail: `auth check failed (${httpStatusOf(err) ?? 'network'})`,
        fixHint: authError('X', [...REQUIRED_KEYS]),
      };
    }
  }

  /** The exact request sequence a thread produces (used by dry-run). */
  previews(draft: Extract<Draft, { platform: 'x' }>): RequestPreview[] {
    const posts = [...draft.thread, ...(draft.replyWithLink ? [draft.replyWithLink] : [])];
    const seq: RequestPreview[] = posts.map((text, i) => ({
      method: 'POST',
      url: 'https://api.x.com/2/tweets',
      body: JSON.stringify(
        i === 0
          ? {
              text,
              ...(draft.media && draft.thread.length > 0
                ? { media: { media_ids: ['<media id from upload>'] } }
                : {}),
            }
          : { text, reply: { in_reply_to_tweet_id: `<id of post ${i}>` } },
      ),
    }));
    if (draft.media && draft.thread.length > 0) {
      seq.unshift({
        method: 'POST',
        url: 'https://upload.twitter.com/1.1/media/upload.json (chunked)',
        body: `<video upload: ${draft.media.videoPath}>`,
      });
    }
    return seq;
  }

  async post(draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    if (draft?.platform !== 'x') {
      return { platform: 'x', ok: false, error: `XProvider needs an x draft`, dryRun: opts.dryRun };
    }

    if (opts.dryRun) {
      for (const preview of this.previews(draft)) emitPreview(preview, opts);
      return { platform: 'x', ok: true, dryRun: true };
    }

    const client = this.clientFactory(this.env);
    const posts = [...draft.thread, ...(draft.replyWithLink ? [draft.replyWithLink] : [])];
    let firstId: string | undefined;
    let previousId: string | undefined;
    try {
      let mediaIds: [string] | undefined;
      if (draft.media && draft.thread.length > 0) {
        const mediaId = await client.v1.uploadMedia(draft.media.videoPath, { longVideo: true });
        mediaIds = [mediaId];
      }
      for (const text of posts) {
        const payload: TweetPayload = previousId
          ? { text, reply: { in_reply_to_tweet_id: previousId } }
          : { text, ...(mediaIds ? { media: { media_ids: mediaIds } } : {}) };
        const res = await client.v2.tweet(payload);
        previousId = res.data.id;
        firstId ??= res.data.id;
      }
      return {
        platform: 'x',
        ok: true,
        url: `https://x.com/i/status/${firstId}`,
        dryRun: false,
      };
    } catch (err) {
      const status = httpStatusOf(err);
      const error =
        status === 401
          ? authError('X', [...REQUIRED_KEYS])
          : status === 429
            ? rateLimitError('X')
            : `X post failed: ${err instanceof Error ? err.message : String(err)}`;
      return { platform: 'x', ok: false, error, dryRun: false };
    }
  }
}
