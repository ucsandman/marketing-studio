import { describe, expect, it } from 'vitest';
import { XProvider, type XClientLike } from '../src/providers/x.js';
import { LinkedInProvider } from '../src/providers/linkedin.js';
import type { Draft } from '../src/types.js';
import type { RequestPreview } from '../src/providers/types.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV = {
  X_API_KEY: 'k',
  X_API_SECRET: 's',
  X_ACCESS_TOKEN: 't',
  X_ACCESS_SECRET: 'ts',
} as NodeJS.ProcessEnv;

const DRAFT: Extract<Draft, { platform: 'x' }> = {
  platform: 'x',
  status: 'validated',
  thread: ['First post', 'Second post'],
  replyWithLink: 'Link: see reply',
  media: { videoPath: 'C:/fake/social-16x9.mp4', altText: 'noban launch video.' },
};

function fakeClient() {
  const uploads: { file: string; options?: { longVideo?: boolean } }[] = [];
  const tweets: { text: string; reply?: { in_reply_to_tweet_id: string }; media?: { media_ids: string[] } }[] = [];
  let id = 0;
  const client: XClientLike = {
    v1: {
      uploadMedia: async (file, options) => {
        uploads.push({ file, options });
        return 'media-123';
      },
    },
    v2: {
      tweet: async (payload) => {
        tweets.push(payload);
        id += 1;
        return { data: { id: String(id) } };
      },
      me: async () => ({ data: { username: 'tester' } }),
    },
  };
  return { client, uploads, tweets };
}

describe('XProvider media', () => {
  it('uploads the video once and attaches it to the FIRST thread post only', async () => {
    const { client, uploads, tweets } = fakeClient();
    const provider = new XProvider(ENV, () => client);
    const result = await provider.post(DRAFT, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(uploads).toEqual([{ file: 'C:/fake/social-16x9.mp4', options: { longVideo: true } }]);
    expect(tweets[0]?.media).toEqual({ media_ids: ['media-123'] });
    expect(tweets[1]?.media).toBeUndefined();
    expect(tweets[2]?.media).toBeUndefined();
  });

  it('dry run previews the upload and sends nothing', async () => {
    const { client, uploads, tweets } = fakeClient();
    const provider = new XProvider(ENV, () => client);
    const previews: RequestPreview[] = [];
    const result = await provider.post(DRAFT, { dryRun: true, onPreview: (p) => previews.push(p) });
    expect(result.ok).toBe(true);
    expect(uploads).toHaveLength(0);
    expect(tweets).toHaveLength(0);
    expect(previews[0]?.url).toContain('media/upload');
    expect(previews[1]?.body).toContain('media_ids');
  });

  it('posts text-only when the draft has no media (unchanged behavior)', async () => {
    const { client, uploads, tweets } = fakeClient();
    const provider = new XProvider(ENV, () => client);
    const { media: _media, ...textOnly } = DRAFT;
    const result = await provider.post(textOnly as Draft, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(uploads).toHaveLength(0);
    expect(tweets[0]?.media).toBeUndefined();
  });

  it('never attaches media to the link reply when the thread is empty', async () => {
    const { client, uploads, tweets } = fakeClient();
    const provider = new XProvider(ENV, () => client);
    const emptyThreadDraft: Extract<Draft, { platform: 'x' }> = {
      ...DRAFT,
      thread: [],
    };
    const result = await provider.post(emptyThreadDraft, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(uploads).toHaveLength(0);
    expect(tweets).toHaveLength(1);
    expect(tweets[0]?.media).toBeUndefined();
  });
});

const LI_ENV = {
  LINKEDIN_ACCESS_TOKEN: 'tok',
  LINKEDIN_PERSON_URN: 'urn:li:person:abc',
} as NodeJS.ProcessEnv;

function fakeLinkedIn(videoStatus: string[] = ['AVAILABLE']) {
  const calls: { url: string; method: string; body?: string }[] = [];
  let statusIdx = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : init?.body ? '<bytes>' : undefined });
    if (url.includes('action=initializeUpload')) {
      return new Response(
        JSON.stringify({
          value: {
            video: 'urn:li:video:V1',
            uploadToken: '',
            uploadInstructions: [{ uploadUrl: 'https://up.example/part1', firstByte: 0, lastByte: 4 }],
          },
        }),
        { status: 200 },
      );
    }
    if (url.startsWith('https://up.example/')) {
      return new Response(null, { status: 200, headers: { ETag: 'etag-1' } });
    }
    if (url.includes('action=finalizeUpload')) return new Response('{}', { status: 200 });
    if (url.includes('/rest/videos/')) {
      const status = videoStatus[Math.min(statusIdx, videoStatus.length - 1)];
      statusIdx += 1;
      return new Response(JSON.stringify({ status }), { status: 200 });
    }
    if (url.endsWith('/rest/posts')) {
      return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:99' } });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('LinkedInProvider media', () => {
  async function videoFile(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'li-media-'));
    const path = join(dir, 'launch-16x9.mp4');
    await writeFile(path, 'bytes');
    return path;
  }

  it('initializes, uploads parts, finalizes, waits for AVAILABLE, and posts with content.media', async () => {
    const { fetchImpl, calls } = fakeLinkedIn(['PROCESSING', 'AVAILABLE']);
    const provider = new LinkedInProvider(LI_ENV, { fetchImpl, sleep: async () => {} });
    const draft: Draft = {
      platform: 'linkedin',
      status: 'validated',
      body: 'Launch day.',
      media: { videoPath: await videoFile(), altText: 'noban launch video.' },
    };
    const result = await provider.post(draft, { dryRun: false });
    expect(result.ok).toBe(true);
    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.includes('action=initializeUpload'))).toBe(true);
    expect(urls.some((u) => u.startsWith('https://up.example/'))).toBe(true);
    expect(urls.some((u) => u.includes('action=finalizeUpload'))).toBe(true);
    const postCall = calls.find((c) => c.url.endsWith('/rest/posts'));
    expect(postCall?.body).toContain('"id":"urn:li:video:V1"');
    expect(postCall?.body).toContain('"title":"noban launch video."');
  });

  it('fails loudly when video processing fails, without creating the post', async () => {
    const { fetchImpl, calls } = fakeLinkedIn(['PROCESSING_FAILED']);
    const provider = new LinkedInProvider(LI_ENV, { fetchImpl, sleep: async () => {} });
    const draft: Draft = {
      platform: 'linkedin',
      status: 'validated',
      body: 'Launch day.',
      media: { videoPath: await videoFile() },
    };
    const result = await provider.post(draft, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(calls.some((c) => c.url.endsWith('/rest/posts') && c.method === 'POST')).toBe(false);
  });

  it('dry run previews the upload sequence and sends nothing', async () => {
    const { fetchImpl, calls } = fakeLinkedIn();
    const provider = new LinkedInProvider(LI_ENV, { fetchImpl, sleep: async () => {} });
    const previews: RequestPreview[] = [];
    const draft: Draft = {
      platform: 'linkedin',
      status: 'validated',
      body: 'Launch day.',
      media: { videoPath: 'C:/fake/launch-16x9.mp4' },
    };
    const result = await provider.post(draft, { dryRun: true, onPreview: (p) => previews.push(p) });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
    expect(previews.some((p) => p.url.includes('initializeUpload'))).toBe(true);
  });

  it('uploads multiple parts to their own URLs and orders finalize ETags by instruction order', async () => {
    const calls: { url: string; method: string }[] = [];
    const etagByUrl: Record<string, string> = {
      'https://up.example/part1': 'etag-1',
      'https://up.example/part2': 'etag-2',
    };
    let finalizeBody: string | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.includes('action=initializeUpload')) {
        return new Response(
          JSON.stringify({
            value: {
              video: 'urn:li:video:V2',
              uploadToken: '',
              uploadInstructions: [
                { uploadUrl: 'https://up.example/part1', firstByte: 0, lastByte: 3 },
                { uploadUrl: 'https://up.example/part2', firstByte: 4, lastByte: 7 },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (url in etagByUrl) {
        return new Response(null, { status: 200, headers: { ETag: etagByUrl[url] } });
      }
      if (url.includes('action=finalizeUpload')) {
        finalizeBody = typeof init?.body === 'string' ? init.body : undefined;
        return new Response('{}', { status: 200 });
      }
      if (url.includes('/rest/videos/')) {
        return new Response(JSON.stringify({ status: 'AVAILABLE' }), { status: 200 });
      }
      if (url.endsWith('/rest/posts')) {
        return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:100' } });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const provider = new LinkedInProvider(LI_ENV, { fetchImpl, sleep: async () => {} });
    const dir = await mkdtemp(join(tmpdir(), 'li-media-multi-'));
    const path = join(dir, 'launch-16x9.mp4');
    await writeFile(path, 'abcdefgh');
    const draft: Draft = {
      platform: 'linkedin',
      status: 'validated',
      body: 'Launch day.',
      media: { videoPath: path },
    };
    const result = await provider.post(draft, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(calls.filter((c) => c.url === 'https://up.example/part1' && c.method === 'PUT')).toHaveLength(1);
    expect(calls.filter((c) => c.url === 'https://up.example/part2' && c.method === 'PUT')).toHaveLength(1);
    expect(finalizeBody).toBeDefined();
    const parsed = JSON.parse(finalizeBody as string) as {
      finalizeUploadRequest: { uploadedPartIds: string[] };
    };
    expect(parsed.finalizeUploadRequest.uploadedPartIds).toEqual(['etag-1', 'etag-2']);
  });
});
