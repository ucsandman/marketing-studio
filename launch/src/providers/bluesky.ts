import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Draft, PostResult } from '../types.js';
import { MEDIA_LIMITS, probeVideo, type VideoProbe } from '../media-probe.js';
import {
  authError,
  emitPreview,
  httpStatusOf,
  rateLimitError,
  redactPreview,
  type PostOptions,
  type Provider,
  type ProviderStatus,
  type RequestPreview,
} from './types.js';

const REQUIRED_KEYS = ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'] as const;
const ENTRY_HOST = 'https://bsky.social';
const VIDEO_HOST = 'https://video.bsky.app';

export const MAX_GRAPHEMES = 300;
/**
 * Bluesky's own video ceiling — well under X's 512 MB. It lives in the shared
 * MEDIA_LIMITS table so `launch post`'s pre-flight and the dashboard badge see
 * the same number this provider enforces.
 */
export const MAX_VIDEO_BYTES = MEDIA_LIMITS.bluesky.maxBytes;
/** The kit only ever hands Bluesky the 16x9 social clip (build-postkit PLATFORM_MAP). */
const ASPECT_RATIO = { width: 1920, height: 1080 };

export const SETUP_STEPS =
  'Create an app password at bsky.app → Settings → App passwords (never the account password), then fill BLUESKY_HANDLE and BLUESKY_APP_PASSWORD in .env (see .env.example).';

function mb(n: number): string {
  return `${Math.round(n / (1024 * 1024))} MB`;
}

/** Bluesky counts graphemes, not code points: an emoji with a skin tone is one. */
export function graphemeCount(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
}

export interface LinkFacet {
  index: { byteStart: number; byteEnd: number };
  features: { $type: 'app.bsky.richtext.facet#link'; uri: string }[];
}

/** Bluesky renders links only where a facet says so, and the offsets are UTF-8 BYTES. */
export function linkFacets(text: string): LinkFacet[] {
  const facets: LinkFacet[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g)) {
    const byteStart = Buffer.byteLength(text.slice(0, m.index), 'utf8');
    facets.push({
      index: { byteStart, byteEnd: byteStart + Buffer.byteLength(m[0], 'utf8') },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }],
    });
  }
  return facets;
}

/** at://did:plc:xyz/app.bsky.feed.post/3kabc → https://bsky.app/profile/<handle>/post/3kabc */
export function postUrl(handle: string, atUri: string): string {
  return `https://bsky.app/profile/${handle}/post/${atUri.split('/').pop()}`;
}

/**
 * Bluesky is one post, not a thread, and it has no URL surcharge: the X hook
 * plus the link reply when both fit in 300 graphemes, otherwise the hook alone.
 */
export function blueskyText(draft: Extract<Draft, { platform: 'x' }>): string {
  const hook = draft.thread[0] ?? '';
  if (!draft.replyWithLink) return hook;
  const joined = `${hook}\n\n${draft.replyWithLink}`;
  return graphemeCount(joined) <= MAX_GRAPHEMES ? joined : hook;
}

interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

interface PostRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  facets?: LinkFacet[];
  embed?: {
    $type: 'app.bsky.embed.video';
    video: BlobRef;
    alt?: string;
    aspectRatio: { width: number; height: number };
  };
}

function buildRecord(options: {
  text: string;
  alt?: string;
  videoBlob?: BlobRef;
  createdAt: Date;
}): PostRecord {
  const record: PostRecord = {
    $type: 'app.bsky.feed.post',
    text: options.text,
    createdAt: options.createdAt.toISOString(),
  };
  const facets = linkFacets(options.text);
  if (facets.length > 0) record.facets = facets;
  if (options.videoBlob) {
    record.embed = {
      $type: 'app.bsky.embed.video',
      video: options.videoBlob,
      ...(options.alt ? { alt: options.alt } : {}),
      aspectRatio: ASPECT_RATIO,
    };
  }
  return record;
}

interface Session {
  did: string;
  handle?: string;
  accessJwt: string;
  didDoc?: { service?: { type: string; serviceEndpoint: string }[] };
}

/** The account's own PDS, which is where records are written (not the entry host). */
function pdsFromSession(session: Session): string {
  const svc = (session.didDoc?.service ?? []).find((s) => s.type === 'AtprotoPersonalDataServer');
  return svc?.serviceEndpoint ?? ENTRY_HOST;
}

interface XrpcOptions {
  method?: string;
  token?: string;
  query?: Record<string, string>;
  /** Binary bodies are video bytes; everything else is sent as JSON. */
  body?: Uint8Array<ArrayBuffer> | Record<string, unknown>;
  contentType?: string;
}

export interface BlueskyDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Injected by tests; the real default waits between video-job polls. */
  sleep?: (ms: number) => Promise<void>;
  probe?: (path: string) => Promise<VideoProbe>;
}

export class BlueskyProvider implements Provider {
  readonly name = 'bluesky' as const;
  /** Bluesky reuses the X draft: same short-form copy and same 16x9 clip the kit maps to X. */
  readonly draftPlatform = 'x' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly probe: (path: string) => Promise<VideoProbe>;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    deps: BlueskyDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.probe = deps.probe ?? probeVideo;
  }

  private missingKeys(): string[] {
    return REQUIRED_KEYS.filter((k) => !this.env[k]);
  }

  mode(): 'api' | 'blocked' {
    return this.missingKeys().length === 0 ? 'api' : 'blocked';
  }

  private async xrpc<T>(base: string, nsid: string, options: XrpcOptions = {}): Promise<T> {
    const url = new URL(`${base}/xrpc/${nsid}`);
    for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let payload: BodyInit | undefined;
    if (options.body instanceof Uint8Array) {
      headers['content-type'] = options.contentType ?? 'application/octet-stream';
      payload = options.body;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(options.body);
    }
    const res = await this.fetchImpl(url, { method: options.method ?? 'GET', headers, body: payload });
    const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!res.ok) {
      throw Object.assign(new Error(`${nsid} ${res.status}: ${json.message ?? json.error ?? res.statusText}`), {
        status: res.status,
      });
    }
    return json as T;
  }

  async ready(): Promise<ProviderStatus> {
    const missing = this.missingKeys();
    if (missing.length > 0) {
      return { ok: false, detail: `missing keys: ${missing.join(', ')}`, fixHint: SETUP_STEPS };
    }
    try {
      const session = await this.createSession();
      return { ok: true, detail: `authenticated as @${session.handle ?? this.env.BLUESKY_HANDLE}` };
    } catch (err) {
      return {
        ok: false,
        detail: `auth check failed (${httpStatusOf(err) ?? 'network'})`,
        fixHint: SETUP_STEPS,
      };
    }
  }

  private createSession(): Promise<Session> {
    return this.xrpc<Session>(ENTRY_HOST, 'com.atproto.server.createSession', {
      method: 'POST',
      body: { identifier: this.env.BLUESKY_HANDLE, password: this.env.BLUESKY_APP_PASSWORD },
    });
  }

  /** getServiceAuth → app.bsky.video.uploadVideo → poll getJobStatus until the blob lands. */
  private async uploadVideo(session: Session, pds: string, videoPath: string): Promise<BlobRef> {
    const bytes = await readFile(videoPath);
    const { token } = await this.xrpc<{ token: string }>(pds, 'com.atproto.server.getServiceAuth', {
      token: session.accessJwt,
      query: {
        aud: `did:web:${new URL(pds).host}`,
        lxm: 'com.atproto.repo.uploadBlob',
        exp: String(Math.floor(this.now().getTime() / 1000) + 30 * 60),
      },
    });

    interface Job {
      jobId: string;
      state?: string;
      error?: string;
      blob?: BlobRef;
    }
    let job = await this.xrpc<Job>(VIDEO_HOST, 'app.bsky.video.uploadVideo', {
      method: 'POST',
      token,
      query: { did: session.did, name: basename(videoPath) },
      body: new Uint8Array(bytes),
      contentType: 'video/mp4',
    });

    // Processing is async: poll until the job hands back the blob ref.
    const deadline = this.now().getTime() + 5 * 60 * 1000;
    while (!job.blob) {
      if (job.state === 'JOB_STATE_FAILED') throw new Error(`video processing failed: ${job.error ?? 'unknown'}`);
      if (this.now().getTime() > deadline) throw new Error('video processing timed out after 5 minutes');
      await this.sleep(2000);
      const status = await this.xrpc<{ jobStatus?: Job } & Job>(VIDEO_HOST, 'app.bsky.video.getJobStatus', {
        token,
        query: { jobId: job.jobId },
      });
      job = status.jobStatus ?? status;
    }
    return job.blob;
  }

  previews(draft: Extract<Draft, { platform: 'x' }>): RequestPreview[] {
    const seq: RequestPreview[] = [];
    if (draft.media) {
      seq.push({
        method: 'POST',
        url: `${VIDEO_HOST}/xrpc/app.bsky.video.uploadVideo`,
        body: `<video upload: ${draft.media.videoPath}>`,
      });
    }
    const record = buildRecord({
      text: blueskyText(draft),
      alt: draft.media?.altText,
      videoBlob: draft.media
        ? { $type: 'blob', ref: { $link: '<blob ref from uploadVideo>' }, mimeType: 'video/mp4', size: 0 }
        : undefined,
      createdAt: this.now(),
    });
    seq.push({
      method: 'POST',
      url: `${ENTRY_HOST}/xrpc/com.atproto.repo.createRecord`,
      body: `${JSON.stringify({ repo: '$BLUESKY_HANDLE', collection: 'app.bsky.feed.post', record })} (sent to the account's own PDS, resolved from the createSession didDoc)`,
    });
    return seq;
  }

  async post(draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    if (draft?.platform !== 'x') {
      return { platform: 'bluesky', ok: false, error: 'BlueskyProvider needs an x draft', dryRun: opts.dryRun };
    }

    const text = blueskyText(draft);
    const graphemes = graphemeCount(text);
    if (graphemes > MAX_GRAPHEMES) {
      return {
        platform: 'bluesky',
        ok: false,
        error: `Bluesky post is ${graphemes} graphemes; the limit is ${MAX_GRAPHEMES}. Shorten thread[0] in the x draft.`,
        dryRun: opts.dryRun,
      };
    }

    if (opts.dryRun) {
      for (const preview of this.previews(draft)) {
        emitPreview(redactPreview(preview, this.env, REQUIRED_KEYS), opts);
      }
      return { platform: 'bluesky', ok: true, dryRun: true };
    }

    // Pre-flight the video before a single request goes out: Bluesky's 100 MB cap
    // is stricter than the x cap `launch post` already checked.
    if (draft.media) {
      try {
        const { sizeBytes } = await this.probe(draft.media.videoPath);
        if (sizeBytes > MAX_VIDEO_BYTES) {
          return {
            platform: 'bluesky',
            ok: false,
            error: `video is ${mb(sizeBytes)}; Bluesky allows at most ${mb(MAX_VIDEO_BYTES)}`,
            dryRun: false,
          };
        }
      } catch (err) {
        return {
          platform: 'bluesky',
          ok: false,
          error: `Bluesky video pre-flight failed: ${err instanceof Error ? err.message : String(err)}`,
          dryRun: false,
        };
      }
    }

    try {
      const session = await this.createSession();
      const pds = pdsFromSession(session);
      const videoBlob = draft.media ? await this.uploadVideo(session, pds, draft.media.videoPath) : undefined;
      const record = buildRecord({
        text,
        alt: draft.media?.altText,
        videoBlob,
        createdAt: this.now(),
      });
      const created = await this.xrpc<{ uri: string }>(pds, 'com.atproto.repo.createRecord', {
        method: 'POST',
        token: session.accessJwt,
        body: { repo: session.did, collection: 'app.bsky.feed.post', record },
      });
      return {
        platform: 'bluesky',
        ok: true,
        url: postUrl(session.handle ?? this.env.BLUESKY_HANDLE ?? '', created.uri),
        dryRun: false,
      };
    } catch (err) {
      const status = httpStatusOf(err);
      const error =
        status === 401
          ? authError('Bluesky', [...REQUIRED_KEYS])
          : status === 429
            ? rateLimitError('Bluesky')
            : `Bluesky post failed: ${err instanceof Error ? err.message : String(err)}`;
      return { platform: 'bluesky', ok: false, error, dryRun: false };
    }
  }
}
