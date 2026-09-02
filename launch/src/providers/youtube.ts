import { readFile, stat } from 'node:fs/promises';
import type { Draft, PostResult } from '../types.js';
import {
  emitPreview,
  rateLimitError,
  redactPreview,
  type PostOptions,
  type Provider,
  type ProviderStatus,
  type RequestPreview,
} from './types.js';

const REQUIRED_KEYS = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'] as const;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
/** Science & Technology. */
const CATEGORY_ID = '28';

export const MAX_TITLE = 100;
export const MAX_DESCRIPTION = 5000;

const PRIVACY_VALUES = ['private', 'unlisted', 'public'] as const;
type Privacy = (typeof PRIVACY_VALUES)[number];

export const AUTH_STEPS =
  'Create a Desktop-app OAuth client in Google Cloud Console (APIs & Services → Credentials) with the YouTube Data API v3 enabled and the https://www.googleapis.com/auth/youtube.upload scope, ' +
  'run the one-time consent flow (`node scripts/publish-youtube.mjs --auth` in the animations repo), then put the client id, client secret and the refresh token it prints into YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN in .env.';

/** YouTube rejects '<' and '>' in titles and hard-caps at 100 characters. */
export function cleanTitle(title: string): string {
  const t = title.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1).trimEnd()}…` : t;
}

interface VideoResource {
  snippet: { title: string; description: string; categoryId: string };
  status: { privacyStatus: Privacy; selfDeclaredMadeForKids: boolean };
}

export interface YouTubeDeps {
  fetchImpl?: typeof fetch;
}

export class YouTubeProvider implements Provider {
  readonly name = 'youtube' as const;
  /** YouTube reuses the LinkedIn draft: same launch-16x9 video and same long-form copy. */
  readonly draftPlatform = 'linkedin' as const;
  /** Nothing to upload without a video — `launch post` skips instead of failing the run. */
  readonly requiresMedia = true;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    deps: YouTubeDeps = {},
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
   * Uploads land PRIVATE unless YOUTUBE_PRIVACY says otherwise: a launch video
   * should be watched once on the channel before anyone else can see it.
   */
  private privacy(): Privacy | undefined {
    const value = this.env.YOUTUBE_PRIVACY ?? 'private';
    return (PRIVACY_VALUES as readonly string[]).includes(value) ? (value as Privacy) : undefined;
  }

  private resource(draft: Extract<Draft, { platform: 'linkedin' }>, privacy: Privacy): VideoResource {
    // altText doubles as the video title (same convention as the LinkedIn post);
    // the body's first line is the fallback when the kit shipped no alt text.
    const title = draft.media?.altText ?? (draft.body.split('\n')[0] ?? '');
    // No first-comment dance here — YouTube descriptions carry links without penalty.
    const description = [draft.body, draft.firstComment].filter(Boolean).join('\n\n');
    return {
      snippet: { title: cleanTitle(title), description: description.slice(0, MAX_DESCRIPTION), categoryId: CATEGORY_ID },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    };
  }

  /** Exchange the stored refresh token for a short-lived access token. */
  private async accessToken(): Promise<string> {
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: this.env.YOUTUBE_REFRESH_TOKEN ?? '',
        client_id: this.env.YOUTUBE_CLIENT_ID ?? '',
        client_secret: this.env.YOUTUBE_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      throw new Error(
        `YouTube token refresh failed (HTTP ${res.status}) — YOUTUBE_REFRESH_TOKEN is expired or revoked. ${AUTH_STEPS}`,
      );
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error('YouTube token endpoint returned no access_token');
    return json.access_token;
  }

  async ready(): Promise<ProviderStatus> {
    const missing = this.missingKeys();
    if (missing.length > 0) {
      return { ok: false, detail: `missing keys: ${missing.join(', ')}`, fixHint: AUTH_STEPS };
    }
    try {
      await this.accessToken();
      return { ok: true, detail: `refresh token accepted (uploads land as ${this.privacy() ?? 'private'})` };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        fixHint: AUTH_STEPS,
      };
    }
  }

  previews(draft: Extract<Draft, { platform: 'linkedin' }>, privacy: Privacy): RequestPreview[] {
    return [
      {
        method: 'POST',
        url: UPLOAD_URL,
        body: `${JSON.stringify(this.resource(draft, privacy))} (headers: Authorization: Bearer <access token from $YOUTUBE_REFRESH_TOKEN>, x-upload-content-type: video/mp4, x-upload-content-length: <video size>)`,
      },
      {
        method: 'PUT',
        url: '<resumable session url from the Location header>',
        body: `<video bytes: ${draft.media?.videoPath}>`,
      },
    ];
  }

  async post(draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    if (draft?.platform !== 'linkedin') {
      return { platform: 'youtube', ok: false, error: 'YouTubeProvider needs a linkedin draft', dryRun: opts.dryRun };
    }
    if (!draft.media) {
      return {
        platform: 'youtube',
        ok: false,
        error: 'YouTube has no video to upload — the linkedin draft carries no media and the post kit supplied none.',
        dryRun: opts.dryRun,
      };
    }
    const privacy = this.privacy();
    if (!privacy) {
      return {
        platform: 'youtube',
        ok: false,
        error: `YOUTUBE_PRIVACY must be one of ${PRIVACY_VALUES.join('|')}.`,
        dryRun: opts.dryRun,
      };
    }

    if (opts.dryRun) {
      for (const preview of this.previews(draft, privacy)) {
        emitPreview(redactPreview(preview, this.env, REQUIRED_KEYS), opts);
      }
      return { platform: 'youtube', ok: true, dryRun: true };
    }

    try {
      // Size first (the session header needs it), bytes only at PUT time — a
      // launch video should not sit in memory across the auth round-trip.
      const { size } = await stat(draft.media.videoPath);
      const token = await this.accessToken();
      const start = await this.fetchImpl(UPLOAD_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': 'video/mp4',
          'x-upload-content-length': String(size),
        },
        body: JSON.stringify(this.resource(draft, privacy)),
      });
      if (start.status === 429) {
        return { platform: 'youtube', ok: false, error: rateLimitError('YouTube'), dryRun: false };
      }
      if (!start.ok) {
        return {
          platform: 'youtube',
          ok: false,
          error: `YouTube upload session failed: HTTP ${start.status} (a 403 here is usually the 1600-unit daily quota).`,
          dryRun: false,
        };
      }
      const session = start.headers.get('location');
      if (!session) {
        return { platform: 'youtube', ok: false, error: 'YouTube upload session returned no Location header', dryRun: false };
      }

      const put = await this.fetchImpl(session, {
        method: 'PUT',
        headers: { 'content-type': 'video/mp4' },
        body: new Uint8Array(await readFile(draft.media.videoPath)),
      });
      const json = (await put.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!put.ok) {
        return {
          platform: 'youtube',
          ok: false,
          error: `YouTube upload failed: HTTP ${put.status}${json.error?.message ? ` — ${json.error.message}` : ''}`,
          dryRun: false,
        };
      }
      return { platform: 'youtube', ok: true, url: `https://youtu.be/${json.id}`, dryRun: false };
    } catch (err) {
      return {
        platform: 'youtube',
        ok: false,
        error: `YouTube upload failed: ${err instanceof Error ? err.message : String(err)}`,
        dryRun: false,
      };
    }
  }
}
