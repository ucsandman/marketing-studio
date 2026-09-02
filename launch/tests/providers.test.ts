import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runPost } from '../src/commands/post.js';
import { XProvider, type XClientLike } from '../src/providers/x.js';
import { RedditProvider } from '../src/providers/reddit.js';
import { HackerNewsProvider } from '../src/providers/hackernews.js';
import { ProductHuntProvider } from '../src/providers/producthunt.js';
import { BlueskyProvider, graphemeCount, linkFacets } from '../src/providers/bluesky.js';
import { YouTubeProvider, cleanTitle } from '../src/providers/youtube.js';
import { LaunchStore } from '../src/state.js';
import { PlatformSchema, type Draft } from '../src/types.js';
import type { RequestPreview } from '../src/providers/types.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'demo-app');

const X_ENV = {
  X_API_KEY: 'k',
  X_API_SECRET: 's',
  X_ACCESS_TOKEN: 't',
  X_ACCESS_SECRET: 'ts',
} as NodeJS.ProcessEnv;

const REDDIT_ENV = {
  REDDIT_CLIENT_ID: 'cid',
  REDDIT_CLIENT_SECRET: 'cs',
  REDDIT_USERNAME: 'user',
  REDDIT_PASSWORD: 'pw',
  REDDIT_USER_AGENT: 'launch-engine-test/0.1',
} as NodeJS.ProcessEnv;

const xDraft: Draft = {
  platform: 'x',
  status: 'filled',
  thread: ['Hook post', 'Value post'],
  replyWithLink: 'Try it → https://demoapp.io',
};

const redditDraft: Draft = {
  platform: 'reddit',
  status: 'filled',
  posts: [
    { sub: 'SideProject', title: 'I built DemoApp', body: 'Story A' },
    { sub: 'IMadeThis', title: 'DemoApp is live', body: 'Story B' },
  ],
};

function fakeXClient(behavior?: { failWith?: number }): { client: XClientLike; calls: unknown[] } {
  const calls: unknown[] = [];
  let id = 100;
  const client: XClientLike = {
    v2: {
      async tweet(payload) {
        calls.push(payload);
        if (behavior?.failWith) {
          throw Object.assign(new Error(`HTTP ${behavior.failWith}`), { code: behavior.failWith });
        }
        return { data: { id: String(++id) } };
      },
      async me() {
        return { data: { username: 'demomaker' } };
      },
    },
  };
  return { client, calls };
}

interface RecordedCall {
  url: string;
  method: string;
}

function fakeRedditFetch(behavior?: {
  tokenStatus?: number;
  submitStatus?: number;
}): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.includes('access_token')) {
      if (behavior?.tokenStatus && behavior.tokenStatus !== 200) {
        return new Response('denied', { status: behavior.tokenStatus });
      }
      return Response.json({ access_token: 'tok' });
    }
    if (url.includes('/about/rules.json')) {
      return Response.json({ rules: [{ short_name: 'No spam' }] });
    }
    if (url.includes('/api/submit')) {
      if (behavior?.submitStatus && behavior.submitStatus !== 200) {
        return new Response('nope', { status: behavior.submitStatus });
      }
      return Response.json({ json: { data: { url: 'https://reddit.com/r/SideProject/abc' } } });
    }
    if (url.includes('/api/v1/me')) {
      return Response.json({ name: 'demomaker' });
    }
    throw new Error(`No route for ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('XProvider', () => {
  it('mode() is blocked when env keys are missing, with setup hint from ready()', async () => {
    const provider = new XProvider({} as NodeJS.ProcessEnv);
    expect(provider.mode()).toBe('blocked');
    const status = await provider.ready();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('X_API_KEY');
  });

  it('posts a thread with reply chaining and returns the first tweet URL', async () => {
    const { client, calls } = fakeXClient();
    const provider = new XProvider(X_ENV, () => client);
    const result = await provider.post(xDraft, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://x.com/i/status/101');
    expect(calls).toHaveLength(3); // 2 thread posts + link reply
    expect(calls[1]).toMatchObject({ reply: { in_reply_to_tweet_id: '101' } });
    expect(calls[2]).toMatchObject({ reply: { in_reply_to_tweet_id: '102' } });
  });

  it('maps 401 to an actionable auth error naming the env keys', async () => {
    const { client } = fakeXClient({ failWith: 401 });
    const provider = new XProvider(X_ENV, () => client);
    const result = await provider.post(xDraft, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('X_API_KEY');
  });

  it('maps 429 to a rate-limit error and does not retry', async () => {
    const { client, calls } = fakeXClient({ failWith: 429 });
    const provider = new XProvider(X_ENV, () => client);
    const result = await provider.post(xDraft, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('429');
    expect(calls).toHaveLength(1); // no retry storm
  });

  it('dry-run prints payloads and never constructs a client', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const provider = new XProvider(X_ENV, () => {
      throw new Error('client must not be constructed in dry-run');
    });
    const result = await provider.post(xDraft, { dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).toContain('POST https://api.x.com/2/tweets');
    expect(printed).toContain('Hook post');
    log.mockRestore();
  });
});

describe('RedditProvider', () => {
  it('fetches each sub’s rules before submitting to it (hard ordering)', async () => {
    const { fetchImpl, calls } = fakeRedditFetch();
    const provider = new RedditProvider(REDDIT_ENV, { fetchImpl, staggerMs: 0 });
    const result = await provider.post(redditDraft, { dryRun: false });
    expect(result.ok).toBe(true);
    const urls = calls.map((c) => c.url);
    const ruleIdx1 = urls.findIndex((u) => u.includes('/r/SideProject/about/rules.json'));
    const submitIdxs = calls
      .map((c, i) => (c.url.includes('/api/submit') ? i : -1))
      .filter((i) => i >= 0);
    const ruleIdx2 = urls.findIndex((u) => u.includes('/r/IMadeThis/about/rules.json'));
    expect(ruleIdx1).toBeGreaterThan(-1);
    expect(ruleIdx2).toBeGreaterThan(-1);
    expect(ruleIdx1).toBeLessThan(submitIdxs[0]!);
    expect(ruleIdx2).toBeLessThan(submitIdxs[1]!);
    expect(ruleIdx2).toBeGreaterThan(submitIdxs[0]!); // per-sub: rules → submit → rules → submit
  });

  it('maps token 401 to an actionable auth error naming the env keys', async () => {
    const { fetchImpl } = fakeRedditFetch({ tokenStatus: 401 });
    const provider = new RedditProvider(REDDIT_ENV, { fetchImpl, staggerMs: 0 });
    const result = await provider.post(redditDraft, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('REDDIT_CLIENT_ID');
  });

  it('maps submit 429 to a rate-limit error without retrying', async () => {
    const { fetchImpl, calls } = fakeRedditFetch({ submitStatus: 429 });
    const provider = new RedditProvider(REDDIT_ENV, { fetchImpl, staggerMs: 0 });
    const result = await provider.post(redditDraft, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('429');
    expect(calls.filter((c) => c.url.includes('/api/submit'))).toHaveLength(1);
  });

  it('dry-run prints the request sequence without any network call', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { fetchImpl, calls } = fakeRedditFetch();
    const provider = new RedditProvider(REDDIT_ENV, { fetchImpl, staggerMs: 0 });
    const result = await provider.post(redditDraft, { dryRun: true });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).toContain('POST https://www.reddit.com/api/v1/access_token');
    expect(printed).toContain('$REDDIT_PASSWORD'); // env referenced by NAME, value never printed
    expect(printed).not.toContain('pw');
    log.mockRestore();
  });

  it('mode() is blocked when env keys are missing', () => {
    expect(new RedditProvider({} as NodeJS.ProcessEnv).mode()).toBe('blocked');
  });
});

describe('runPost', () => {
  let target: string;
  let store: LaunchStore;

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'launch-post-test-'));
    await cp(FIXTURE, target, {
      recursive: true,
      filter: (src) => !src.includes('.launch'),
    });
    await runInit(target, { domain: 'demoapp.io', price: '$9/mo', force: true });
    store = new LaunchStore(target);
    await store.saveDraft(xDraft);
    await store.saveDraft(redditDraft);
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it('--all skips blocked providers with a summary and exits 0', async () => {
    const providers = [new XProvider({} as NodeJS.ProcessEnv), new RedditProvider({} as NodeJS.ProcessEnv)];
    const result = await runPost(target, { all: true }, { providers });
    expect(result.exitCode).toBe(0);
    expect(result.messages.join('\n')).toContain('x: SKIPPED (blocked');
    expect(result.messages.join('\n')).toContain('reddit: SKIPPED (blocked');
  });

  it('explicit --platform on a blocked provider exits 1 with setup hint', async () => {
    const providers = [new XProvider({} as NodeJS.ProcessEnv)];
    const result = await runPost(target, { platform: 'x' }, { providers });
    expect(result.exitCode).toBe(1);
    const text = result.messages.join('\n');
    expect(text).toContain('blocked');
    expect(text).toContain('developer.x.com');
  });

  it('assist platform post opens the page but never writes the ledger', async () => {
    const hnDraft: Draft = {
      platform: 'hackernews',
      status: 'filled',
      title: 'Show HN: DemoApp – uptime monitoring & alerts (for solo devs)',
      url: 'https://demoapp.io/?ref=hn',
      makerComment: 'Maker here — built this after my own site died overnight.',
    };
    await store.saveDraft(hnDraft);
    const providers = [new HackerNewsProvider(process.env, { open: async () => {}, copy: async () => {} })];

    const result = await runPost(target, { platform: 'hackernews', assist: true, dryRun: false }, { providers });
    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('assist-opened');
    expect(result.messages.join('\n')).toContain('ASSIST OPENED');
    expect(await store.has('hackernews:demoapp.io')).toBe(false);

    // Re-running is allowed (no bogus idempotency skip) until the human confirms.
    const again = await runPost(target, { platform: 'hackernews', assist: true, dryRun: false }, { providers });
    expect(again.results[0]?.outcome).toBe('assist-opened');
  });

  // F1/REG-3: the dry-run-by-default flip must not swallow --assist. Assist
  // publishes nothing on its own (a human clicks submit), so gating it behind
  // --live buys zero safety and breaks the one flow that exists for its side effect.
  it('--assist alone opens the page and copies the comment (the dry-run default must not swallow it)', async () => {
    const hnDraft: Draft = {
      platform: 'hackernews',
      status: 'filled',
      title: 'Show HN: DemoApp - uptime monitoring & alerts (for solo devs)',
      url: 'https://demoapp.io/?ref=hn',
      makerComment: 'Maker here - built this after my own site died overnight.',
    };
    await store.saveDraft(hnDraft);
    const opened: string[] = [];
    const copied: string[] = [];
    const providers = [
      new HackerNewsProvider(process.env, {
        open: async (url: string) => {
          opened.push(url);
        },
        copy: async (text: string) => {
          copied.push(text);
        },
      }),
    ];

    const result = await runPost(target, { platform: 'hackernews', assist: true }, { providers });
    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('assist-opened');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain('news.ycombinator.com/submitlink');
    expect(copied).toEqual([hnDraft.makerComment]);
  });

  it('--assist --dry-run still previews: an explicit --dry-run beats the assist default', async () => {
    await store.saveDraft({
      platform: 'hackernews',
      status: 'filled',
      title: 'Show HN: DemoApp - uptime monitoring & alerts (for solo devs)',
      url: 'https://demoapp.io/?ref=hn',
      makerComment: 'Maker here.',
    });
    const opened: string[] = [];
    const providers = [
      new HackerNewsProvider(process.env, {
        open: async (url: string) => {
          opened.push(url);
        },
        copy: async () => {},
      }),
    ];
    const result = await runPost(target, { platform: 'hackernews', assist: true, dryRun: true }, { providers });
    expect(result.results[0]?.outcome).toBe('dry-run');
    expect(opened).toEqual([]);
  });

  it('--assist alone writes the Product Hunt kit and opens the submit page', async () => {
    await store.saveDraft({
      platform: 'producthunt',
      status: 'filled',
      tagline: 'Uptime monitoring for solo devs',
      description: 'DemoApp watches your sites and texts you the second one goes down.',
      topics: ['developer-tools'],
      firstComment: 'Maker here.',
    });
    const opened: string[] = [];
    const providers = [
      new ProductHuntProvider(process.env, {
        open: async (url: string) => {
          opened.push(url);
        },
        copy: async () => {},
      }),
    ];
    const result = await runPost(target, { platform: 'producthunt', assist: true }, { providers });
    expect(result.results[0]?.outcome).toBe('assist-opened');
    expect(opened).toEqual(['https://www.producthunt.com/posts/new']);
    expect(existsSync(join(store.outDir, 'producthunt-kit.md'))).toBe(true);
  });

  // F9: YouTube reuses the linkedin draft. A text-only launch must not turn the
  // whole --all run non-zero just because the three YOUTUBE_* keys happen to be set.
  it('--all skips a media-required provider whose draft carries no video, and still exits 0', async () => {
    await store.saveDraft({
      platform: 'linkedin',
      status: 'filled',
      body: 'We shipped DemoApp today. Here is what broke and what we learned.',
      firstComment: 'https://demoapp.io',
    });
    const providers = [
      new YouTubeProvider({
        YOUTUBE_CLIENT_ID: 'cid',
        YOUTUBE_CLIENT_SECRET: 'cs',
        YOUTUBE_REFRESH_TOKEN: 'rt',
      } as NodeJS.ProcessEnv),
    ];
    const result = await runPost(target, { all: true, live: true }, { providers });
    expect(result.exitCode).toBe(0);
    expect(result.results[0]?.outcome).toBe('skipped-no-media');
    expect(result.messages.join('|')).toContain('youtube: SKIPPED (no video');
  });

  it('--mark-posted records the confirmed manual submission; later runs skip via ledger', async () => {
    const providers = [new HackerNewsProvider(process.env, { open: async () => {}, copy: async () => {} })];

    const marked = await runPost(
      target,
      { platform: 'hackernews', markPosted: 'https://news.ycombinator.com/item?id=123' },
      { providers },
    );
    expect(marked.exitCode).toBe(0);
    expect(marked.results[0]).toMatchObject({ outcome: 'posted', url: 'https://news.ycombinator.com/item?id=123' });
    expect(await store.has('hackernews:demoapp.io')).toBe(true);

    const second = await runPost(target, { platform: 'hackernews', assist: true }, { providers });
    expect(second.results[0]?.outcome).toBe('skipped-ledger');

    const remarked = await runPost(
      target,
      { platform: 'hackernews', markPosted: 'https://news.ycombinator.com/item?id=123' },
      { providers },
    );
    expect(remarked.exitCode).toBe(0);
    expect(remarked.results[0]?.outcome).toBe('skipped-ledger');
  });

  it('--mark-posted without --platform is an error', async () => {
    const result = await runPost(target, { all: true, markPosted: 'https://example.com' }, { providers: [] });
    expect(result.exitCode).toBe(1);
    expect(result.messages[0]).toContain('--mark-posted requires --platform');
  });

  it('successful post writes the ledger; second run skips via ledger', async () => {
    const { client } = fakeXClient();
    const providers = [new XProvider(X_ENV, () => client)];

    const first = await runPost(target, { platform: 'x', dryRun: false }, { providers });
    expect(first.exitCode).toBe(0);
    expect(first.messages.join('\n')).toContain('x: POSTED https://x.com/i/status/');
    expect(await store.has('x:demoapp.io')).toBe(true);

    const second = await runPost(target, { platform: 'x' }, { providers });
    expect(second.exitCode).toBe(0);
    expect(second.messages.join('\n')).toContain('x: SKIPPED (already posted — ledger key x:demoapp.io)');
  });

  it('no flags at all defaults to dry-run — never calls the live provider', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { client, calls } = fakeXClient();
    const providers = [new XProvider(X_ENV, () => client)];
    const result = await runPost(target, { platform: 'x' }, { providers });
    expect(calls).toHaveLength(0);
    expect(result.results[0]?.outcome).toBe('dry-run');
    expect(await store.has('x:demoapp.io')).toBe(false);
    log.mockRestore();
  });

  it('dry-run writes nothing to the ledger', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const providers = [new XProvider(X_ENV, () => fakeXClient().client)];
    const result = await runPost(target, { platform: 'x', dryRun: true }, { providers });
    expect(result.exitCode).toBe(0);
    expect(await store.has('x:demoapp.io')).toBe(false);
    log.mockRestore();
  });

  it('refuses to post a draft that fails validation', async () => {
    await store.saveDraft({ platform: 'x', status: 'draft', thread: ['{{unfilled}}'] });
    const providers = [new XProvider(X_ENV, () => fakeXClient().client)];
    const result = await runPost(target, { platform: 'x' }, { providers });
    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('REFUSED');
    expect(result.messages.join('\n')).toContain('unfilled-placeholder');
  });
});

describe('platform coverage', () => {
  it('the platform enum accepts the ported studio publishers', () => {
    expect(PlatformSchema.safeParse('bluesky').success).toBe(true);
    expect(PlatformSchema.safeParse('youtube').success).toBe(true);
  });
});

const BSKY_ENV = {
  BLUESKY_HANDLE: 'brand.bsky.social',
  BLUESKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop',
} as NodeJS.ProcessEnv;

const YT_ENV = {
  YOUTUBE_CLIENT_ID: 'cid',
  YOUTUBE_CLIENT_SECRET: 'csecret',
  YOUTUBE_REFRESH_TOKEN: 'rtok',
} as NodeJS.ProcessEnv;

/** A real 8-byte file on disk: the live paths read the video before uploading it. */
async function videoFile(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const path = join(dir, 'social-16x9.mp4');
  await writeFile(path, 'bytes123');
  return path;
}

function fakeBskyFetch(): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
  bodies: Record<string, unknown>;
} {
  const calls: RecordedCall[] = [];
  const bodies: Record<string, unknown> = {};
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.includes('com.atproto.server.createSession')) {
      return Response.json({
        did: 'did:plc:abc',
        handle: 'brand.bsky.social',
        accessJwt: 'jwt',
        didDoc: { service: [{ type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] },
      });
    }
    if (url.includes('com.atproto.server.getServiceAuth')) return Response.json({ token: 'svc-jwt' });
    if (url.includes('app.bsky.video.uploadVideo')) {
      return Response.json({ jobId: 'job-1', state: 'JOB_STATE_PROCESSING' });
    }
    if (url.includes('app.bsky.video.getJobStatus')) {
      return Response.json({
        jobStatus: {
          jobId: 'job-1',
          state: 'JOB_STATE_COMPLETED',
          blob: { $type: 'blob', ref: { $link: 'bafyvideo' }, mimeType: 'video/mp4', size: 8 },
        },
      });
    }
    if (url.includes('com.atproto.repo.createRecord')) {
      bodies.createRecord = JSON.parse(String(init?.body));
      return Response.json({ uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz' });
    }
    throw new Error(`No route for ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls, bodies };
}

describe('BlueskyProvider', () => {
  it('mode() is blocked when env keys are missing, with setup hint from ready()', async () => {
    const provider = new BlueskyProvider({} as NodeJS.ProcessEnv);
    expect(provider.mode()).toBe('blocked');
    const status = await provider.ready();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('BLUESKY_APP_PASSWORD');
    expect(status.fixHint).toContain('App passwords');
  });

  it('counts graphemes the way Bluesky does and marks links with UTF-8 byte offsets', () => {
    expect(graphemeCount('hi 👍🏽')).toBe(4);
    const text = 'café → https://demoapp.io/x, then https://a.b/c.';
    const facets = linkFacets(text);
    expect(facets).toHaveLength(2);
    expect(facets[0]?.features[0]?.uri).toBe('https://demoapp.io/x');
    const start = Buffer.byteLength('café → ', 'utf8');
    expect(facets[0]?.index).toEqual({ byteStart: start, byteEnd: start + 'https://demoapp.io/x'.length });
    expect(linkFacets('no links here')).toEqual([]);
  });

  it('dry run previews the record and the video upload without touching the network', async () => {
    const { fetchImpl, calls } = fakeBskyFetch();
    const provider = new BlueskyProvider(BSKY_ENV, { fetchImpl });
    const previews: RequestPreview[] = [];
    const result = await provider.post(
      { ...xDraft, media: { videoPath: 'C:/fake/social-16x9.mp4' } },
      { dryRun: true, onPreview: (p) => previews.push(p) },
    );
    expect(result).toMatchObject({ platform: 'bluesky', ok: true, dryRun: true });
    expect(calls).toHaveLength(0);
    expect(previews.map((p) => p.url)).toEqual([
      'https://video.bsky.app/xrpc/app.bsky.video.uploadVideo',
      'https://bsky.social/xrpc/com.atproto.repo.createRecord',
    ]);
    expect(previews[1]?.body).toContain('app.bsky.embed.video');
    expect(previews.map((p) => p.body ?? '').join('\n')).not.toContain('abcd-efgh-ijkl-mnop');
  });

  it('uploads the video, waits for the processing job, then creates the post record', async () => {
    const { fetchImpl, calls, bodies } = fakeBskyFetch();
    const provider = new BlueskyProvider(BSKY_ENV, {
      fetchImpl,
      sleep: async () => {},
      probe: async () => ({ sizeBytes: 8, durationSeconds: 12 }),
    });
    const videoPath = await videoFile('bsky-media-');
    const result = await provider.post(
      { ...xDraft, media: { videoPath, altText: 'Terminal running the audit.' } },
      { dryRun: false },
    );
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://bsky.app/profile/brand.bsky.social/post/3kxyz');
    expect(calls.map((c) => c.url.replace(/^https:\/\/[^/]+\/xrpc\//, '').replace(/exp=\d+/, 'exp=N'))).toEqual([
      'com.atproto.server.createSession',
      'com.atproto.server.getServiceAuth?aud=did%3Aweb%3Apds.example&lxm=com.atproto.repo.uploadBlob&exp=N',
      'app.bsky.video.uploadVideo?did=did%3Aplc%3Aabc&name=social-16x9.mp4',
      'app.bsky.video.getJobStatus?jobId=job-1',
      'com.atproto.repo.createRecord',
    ]);
    const record = (bodies.createRecord as { record: { text: string; embed: { alt: string; video: unknown } } }).record;
    expect(record.text).toBe('Hook post\n\nTry it → https://demoapp.io');
    expect(record.embed.alt).toBe('Terminal running the audit.');
    expect(record.embed.video).toMatchObject({ ref: { $link: 'bafyvideo' } });
  });

  it('refuses a video over the 100 MB cap before any network call', async () => {
    const { fetchImpl, calls } = fakeBskyFetch();
    const provider = new BlueskyProvider(BSKY_ENV, {
      fetchImpl,
      probe: async () => ({ sizeBytes: 120 * 1024 * 1024, durationSeconds: 30 }),
    });
    const result = await provider.post({ ...xDraft, media: { videoPath: 'C:/fake/big.mp4' } }, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('100 MB');
    expect(calls).toHaveLength(0);
  });

  it('refuses text over 300 graphemes before any network call', async () => {
    const { fetchImpl, calls } = fakeBskyFetch();
    const provider = new BlueskyProvider(BSKY_ENV, { fetchImpl });
    const long: Draft = { platform: 'x', status: 'filled', thread: ['x'.repeat(301)] };
    const result = await provider.post(long, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('301 graphemes');
    expect(calls).toHaveLength(0);
  });
});

const liDraft: Draft = {
  platform: 'linkedin',
  status: 'filled',
  body: 'Why I built DemoApp, and what it taught me.',
  firstComment: 'Try DemoApp: https://demoapp.io',
};

function fakeYtFetch(behavior?: { tokenStatus?: number }): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
  bodies: Record<string, unknown>;
} {
  const calls: RecordedCall[] = [];
  const bodies: Record<string, unknown> = {};
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.includes('oauth2.googleapis.com/token')) {
      if (behavior?.tokenStatus && behavior.tokenStatus !== 200) {
        return Response.json({ error: 'invalid_grant' }, { status: behavior.tokenStatus });
      }
      return Response.json({ access_token: 'access-tok' });
    }
    if (url.includes('uploadType=resumable')) {
      bodies.resource = JSON.parse(String(init?.body));
      return new Response(null, { status: 200, headers: { location: 'https://upload.example/session-1' } });
    }
    if (url === 'https://upload.example/session-1') return Response.json({ id: 'vid123' });
    throw new Error(`No route for ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls, bodies };
}

describe('YouTubeProvider', () => {
  it('mode() is blocked when env keys are missing, with setup hint from ready()', async () => {
    const provider = new YouTubeProvider({} as NodeJS.ProcessEnv);
    expect(provider.mode()).toBe('blocked');
    const status = await provider.ready();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('YOUTUBE_REFRESH_TOKEN');
    expect(status.fixHint).toContain('youtube.upload');
  });

  it('cleanTitle strips angle brackets, collapses whitespace and caps at 100', () => {
    expect(cleanTitle('  Nothing <sensitive>  runs ')).toBe('Nothing sensitive runs');
    const long = cleanTitle('x'.repeat(140));
    expect(long).toHaveLength(100);
    expect(long.endsWith('…')).toBe(true);
  });

  it('dry run previews the resumable upload without touching the network', async () => {
    const { fetchImpl, calls } = fakeYtFetch();
    const provider = new YouTubeProvider(YT_ENV, { fetchImpl });
    const previews: RequestPreview[] = [];
    const result = await provider.post(
      { ...liDraft, media: { videoPath: 'C:/fake/launch-16x9.mp4', altText: 'DemoApp launch' } },
      { dryRun: true, onPreview: (p) => previews.push(p) },
    );
    expect(result).toMatchObject({ platform: 'youtube', ok: true, dryRun: true });
    expect(calls).toHaveLength(0);
    expect(previews).toHaveLength(2);
    expect(previews[0]?.url).toContain('uploadType=resumable');
    expect(previews[0]?.body).toContain('"title":"DemoApp launch"');
    expect(previews[0]?.body).toContain('"privacyStatus":"private"');
    expect(previews[1]?.method).toBe('PUT');
    expect(previews.map((p) => p.body ?? '').join('\n')).not.toContain('rtok');
  });

  it('refreshes the token, opens a resumable session and PUTs the video', async () => {
    const { fetchImpl, calls, bodies } = fakeYtFetch();
    const provider = new YouTubeProvider(YT_ENV, { fetchImpl });
    const videoPath = await videoFile('yt-media-');
    const result = await provider.post({ ...liDraft, media: { videoPath, altText: 'DemoApp launch' } }, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://youtu.be/vid123');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://oauth2.googleapis.com/token',
      'POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      'PUT https://upload.example/session-1',
    ]);
    expect(bodies.resource).toMatchObject({
      snippet: {
        title: 'DemoApp launch',
        description: 'Why I built DemoApp, and what it taught me.\n\nTry DemoApp: https://demoapp.io',
      },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    });
  });

  it('refuses a draft with no video — YouTube has nothing to upload', async () => {
    const { fetchImpl, calls } = fakeYtFetch();
    const provider = new YouTubeProvider(YT_ENV, { fetchImpl });
    const result = await provider.post(liDraft, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no video');
    expect(calls).toHaveLength(0);
  });

  it('maps a rejected refresh token to an actionable auth error', async () => {
    const { fetchImpl } = fakeYtFetch({ tokenStatus: 400 });
    const provider = new YouTubeProvider(YT_ENV, { fetchImpl });
    const videoPath = await videoFile('yt-auth-');
    const result = await provider.post({ ...liDraft, media: { videoPath } }, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('YOUTUBE_REFRESH_TOKEN');
  });
});
