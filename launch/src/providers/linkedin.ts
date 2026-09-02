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
import { readFile, stat } from 'node:fs/promises';

const REQUIRED_KEYS = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN'] as const;
const API = 'https://api.linkedin.com';
/** Documented default; override with LINKEDIN_VERSION in .env. */
const DEFAULT_VERSION = '202506';
const TOKEN_LIFETIME_DAYS = 60;
const WARN_AGE_DAYS = 55;

export const REAUTH_STEPS =
  `LinkedIn tokens expire after ${TOKEN_LIFETIME_DAYS} days with NO programmatic refresh for self-serve apps. Re-auth steps: ` +
  '(1) open https://www.linkedin.com/developers/apps → your app → Auth tab, ' +
  '(2) run the 3-legged OAuth flow (or the OAuth token generator tool) with scope w_member_social, ' +
  '(3) update LINKEDIN_ACCESS_TOKEN and LINKEDIN_TOKEN_ISSUED_AT (today, ISO date) in .env.';

export interface LinkedInDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Injected by tests; real default waits between video-status polls. */
  sleep?: (ms: number) => Promise<void>;
}

export class LinkedInProvider implements Provider {
  readonly name = 'linkedin' as const;
  readonly draftPlatform = 'linkedin' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    deps: LinkedInDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private missingKeys(): string[] {
    return REQUIRED_KEYS.filter((k) => !this.env[k]);
  }

  mode(): 'api' | 'blocked' {
    return this.missingKeys().length === 0 ? 'api' : 'blocked';
  }

  private version(): string {
    return this.env.LINKEDIN_VERSION ?? DEFAULT_VERSION;
  }

  /** Days since LINKEDIN_TOKEN_ISSUED_AT, or undefined when not set/unparseable. */
  private tokenAgeDays(): number | undefined {
    const issued = this.env.LINKEDIN_TOKEN_ISSUED_AT;
    if (!issued) return undefined;
    const t = Date.parse(issued);
    if (Number.isNaN(t)) return undefined;
    return (this.now().getTime() - t) / (24 * 60 * 60 * 1000);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.env.LINKEDIN_ACCESS_TOKEN}`,
      'LinkedIn-Version': this.version(),
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    };
  }

  async ready(): Promise<ProviderStatus> {
    const missing = this.missingKeys();
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `missing keys: ${missing.join(', ')}`,
        fixHint: `Create an app at linkedin.com/developers with w_member_social, fill .env. ${REAUTH_STEPS}`,
      };
    }

    const age = this.tokenAgeDays();
    if (age !== undefined && age > TOKEN_LIFETIME_DAYS) {
      return {
        ok: false,
        detail: `token EXPIRED (issued ${Math.floor(age)} days ago, lifetime ${TOKEN_LIFETIME_DAYS})`,
        fixHint: REAUTH_STEPS,
      };
    }

    try {
      const res = await this.fetchImpl(`${API}/v2/userinfo`, {
        headers: { Authorization: `Bearer ${this.env.LINKEDIN_ACCESS_TOKEN}` },
      });
      if (res.status === 401) {
        return { ok: false, detail: 'token rejected (401) — expired or revoked', fixHint: REAUTH_STEPS };
      }
      if (!res.ok) {
        return { ok: false, detail: `auth check failed: HTTP ${res.status}`, fixHint: REAUTH_STEPS };
      }
      const me = (await res.json()) as { name?: string };
      if (age !== undefined && age > WARN_AGE_DAYS) {
        return {
          ok: false,
          detail: `token works but is ${Math.floor(age)} days old — it dies at ${TOKEN_LIFETIME_DAYS} days, likely before/during your launch window`,
          fixHint: REAUTH_STEPS,
        };
      }
      return {
        ok: true,
        detail: `authenticated as ${me.name ?? 'member'}${age !== undefined ? ` (token age ${Math.floor(age)}d / ${TOKEN_LIFETIME_DAYS}d)` : ' (set LINKEDIN_TOKEN_ISSUED_AT to enable expiry warnings)'}`,
      };
    } catch (err) {
      return {
        ok: false,
        detail: `auth check failed: ${err instanceof Error ? err.message : String(err)}`,
        fixHint: REAUTH_STEPS,
      };
    }
  }

  private postBody(draft: Extract<Draft, { platform: 'linkedin' }>, videoUrn?: string): string {
    return JSON.stringify({
      author: this.env.LINKEDIN_PERSON_URN ?? '$LINKEDIN_PERSON_URN',
      commentary: draft.body,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(videoUrn
        ? { content: { media: { title: draft.media?.altText ?? 'Launch video', id: videoUrn } } }
        : {}),
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    });
  }

  /** initializeUpload → PUT parts (ETags) → finalizeUpload → returns the video URN. */
  private async uploadVideo(videoPath: string): Promise<string> {
    const fileSizeBytes = (await stat(videoPath)).size;
    const initRes = await this.fetchImpl(`${API}/rest/videos?action=initializeUpload`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: this.env.LINKEDIN_PERSON_URN,
          fileSizeBytes,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      }),
    });
    if (!initRes.ok) throw new Error(`video initializeUpload failed: HTTP ${initRes.status}`);
    const init = (await initRes.json()) as {
      value: {
        video: string;
        uploadToken: string;
        uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[];
      };
    };

    const file = await readFile(videoPath);
    const etags: string[] = [];
    for (const part of init.value.uploadInstructions) {
      const putRes = await this.fetchImpl(part.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(file.subarray(part.firstByte, part.lastByte + 1)),
      });
      if (!putRes.ok) throw new Error(`video part upload failed: HTTP ${putRes.status}`);
      const etag = putRes.headers.get('etag');
      if (!etag) throw new Error('video part upload returned no ETag');
      etags.push(etag);
    }

    const finRes = await this.fetchImpl(`${API}/rest/videos?action=finalizeUpload`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken, uploadedPartIds: etags },
      }),
    });
    if (!finRes.ok) throw new Error(`video finalizeUpload failed: HTTP ${finRes.status}`);
    return init.value.video;
  }

  /** LinkedIn processes async; the post is only valid once the video is AVAILABLE. */
  private async waitForVideoReady(videoUrn: string): Promise<void> {
    const MAX_ATTEMPTS = 60;
    const SLEEP_MS = 5000;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const res = await this.fetchImpl(`${API}/rest/videos/${encodeURIComponent(videoUrn)}`, {
        headers: this.headers(),
      });
      if (!res.ok) throw new Error(`video status check failed: HTTP ${res.status}`);
      const { status } = (await res.json()) as { status?: string };
      if (status === 'AVAILABLE') return;
      if (status === 'PROCESSING_FAILED') throw new Error('video processing failed on LinkedIn');
      await this.sleep(SLEEP_MS);
    }
    const minutes = Math.round((MAX_ATTEMPTS * SLEEP_MS) / 60000);
    throw new Error(`video not AVAILABLE after ${minutes} minutes of status checks — try again shortly`);
  }

  previews(draft: Extract<Draft, { platform: 'linkedin' }>): RequestPreview[] {
    const seq: RequestPreview[] = [
      {
        method: 'POST',
        url: `${API}/rest/posts`,
        body: `${this.postBody(draft, draft.media ? '<video urn from finalizeUpload>' : undefined)} (headers: LinkedIn-Version: ${this.version()}, X-Restli-Protocol-Version: 2.0.0, Authorization: Bearer $LINKEDIN_ACCESS_TOKEN)`,
      },
    ];
    if (draft.firstComment) {
      seq.push({
        method: 'POST',
        url: `${API}/rest/socialActions/<urn of created post>/comments`,
        body: JSON.stringify({
          actor: this.env.LINKEDIN_PERSON_URN ?? '$LINKEDIN_PERSON_URN',
          message: { text: draft.firstComment },
        }),
      });
    }
    if (draft.media) {
      seq.unshift(
        {
          method: 'POST',
          url: `${API}/rest/videos?action=initializeUpload`,
          body: JSON.stringify({
            initializeUploadRequest: {
              owner: '$LINKEDIN_PERSON_URN',
              fileSizeBytes: '<video size>',
              uploadCaptions: false,
              uploadThumbnail: false,
            },
          }),
        },
        { method: 'PUT', url: '<uploadUrl(s) from initializeUpload>', body: `<video bytes: ${draft.media.videoPath}>` },
        {
          method: 'POST',
          url: `${API}/rest/videos?action=finalizeUpload`,
          body: JSON.stringify({ finalizeUploadRequest: { video: '<video urn>', uploadToken: '', uploadedPartIds: ['<ETags from part uploads>'] } }),
        },
      );
    }
    return seq;
  }

  async post(draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    if (draft?.platform !== 'linkedin') {
      return { platform: 'linkedin', ok: false, error: 'LinkedInProvider needs a linkedin draft', dryRun: opts.dryRun };
    }

    if (opts.dryRun) {
      for (const preview of this.previews(draft)) {
        emitPreview(redactPreview(preview, this.env, [...REQUIRED_KEYS, 'LINKEDIN_VERSION']), opts);
      }
      return { platform: 'linkedin', ok: true, dryRun: true };
    }

    const age = this.tokenAgeDays();
    if (age !== undefined && age > TOKEN_LIFETIME_DAYS) {
      return { platform: 'linkedin', ok: false, error: `LinkedIn token expired. ${REAUTH_STEPS}`, dryRun: false };
    }

    let videoUrn: string | undefined;
    if (draft.media) {
      try {
        videoUrn = await this.uploadVideo(draft.media.videoPath);
        await this.waitForVideoReady(videoUrn);
      } catch (err) {
        return {
          platform: 'linkedin',
          ok: false,
          error: `LinkedIn video upload failed: ${err instanceof Error ? err.message : String(err)}`,
          dryRun: false,
        };
      }
    }

    try {
      const res = await this.fetchImpl(`${API}/rest/posts`, {
        method: 'POST',
        headers: this.headers(),
        body: this.postBody(draft, videoUrn),
      });
      if (res.status === 401) {
        return { platform: 'linkedin', ok: false, error: `LinkedIn auth failed (401) — token expired or revoked. ${REAUTH_STEPS}`, dryRun: false };
      }
      if (res.status === 429) {
        return { platform: 'linkedin', ok: false, error: rateLimitError('LinkedIn'), dryRun: false };
      }
      if (!res.ok) {
        return { platform: 'linkedin', ok: false, error: `LinkedIn post failed: HTTP ${res.status}`, dryRun: false };
      }
      const postUrn = res.headers.get('x-restli-id') ?? '';

      if (draft.firstComment && postUrn) {
        const commentRes = await this.fetchImpl(
          `${API}/rest/socialActions/${encodeURIComponent(postUrn)}/comments`,
          {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
              actor: this.env.LINKEDIN_PERSON_URN,
              message: { text: draft.firstComment },
            }),
          },
        );
        if (!commentRes.ok) {
          return {
            platform: 'linkedin',
            ok: true,
            url: `https://www.linkedin.com/feed/update/${postUrn}/`,
            error: `post published but first comment failed (HTTP ${commentRes.status}) — add the product link comment manually`,
            dryRun: false,
          };
        }
      }

      return {
        platform: 'linkedin',
        ok: true,
        url: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}/` : undefined,
        dryRun: false,
      };
    } catch (err) {
      return {
        platform: 'linkedin',
        ok: false,
        error: `LinkedIn post failed: ${err instanceof Error ? err.message : String(err)}`,
        dryRun: false,
      };
    }
  }
}
