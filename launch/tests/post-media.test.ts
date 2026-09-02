import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runPost } from '../src/commands/post.js';
import { probeVideo } from '../src/media-probe.js';
import { LaunchStore } from '../src/state.js';
import type { Draft, PostResult } from '../src/types.js';
import type { PostOptions, Provider } from '../src/providers/types.js';
import { syntheticMp4 } from './helpers/mp4.js';

// Pass-through by default; one test below swaps in an over-size probe so a
// 200 MB clip can be exercised without writing 200 MB to disk.
vi.mock('../src/media-probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/media-probe.js')>();
  return { ...actual, probeVideo: vi.fn(actual.probeVideo) };
});

function captureProvider(name: 'x' | 'linkedin') {
  const seen: Draft[] = [];
  const provider: Provider = {
    name,
    draftPlatform: name,
    mode: () => 'api',
    ready: async () => ({ ok: true, detail: 'test' }),
    post: async (draft: Draft | undefined, opts: PostOptions): Promise<PostResult> => {
      if (draft) seen.push(draft);
      return { platform: name, ok: true, url: 'https://example.com/1', dryRun: opts.dryRun };
    },
  };
  return { provider, seen };
}

async function target(postkit: { manifest?: unknown; video?: boolean } | null): Promise<{ dir: string; kitDir?: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'post-media-'));
  const store = new LaunchStore(dir);
  let kitDir: string | undefined;
  if (postkit) {
    kitDir = await mkdtemp(join(tmpdir(), 'kit-'));
    if (postkit.manifest !== undefined) {
      await writeFile(join(kitDir, 'manifest.json'), JSON.stringify(postkit.manifest));
    }
    if (postkit.video) {
      await mkdir(join(kitDir, 'x'), { recursive: true });
      await writeFile(join(kitDir, 'x', 'social-16x9.mp4'), syntheticMp4({ durationSeconds: 60 }));
      await writeFile(join(kitDir, 'x', 'alt.txt'), 'alt line\n');
    }
  }
  await store.saveConfig({
    name: 'Test',
    tagline: 'A test',
    description: 'A test product',
    domain: 'test.gg',
    productUrl: 'https://test.gg',
    pricing: 'free',
    stack: [],
    ...(kitDir ? { postkitDir: kitDir } : {}),
  });
  await store.saveDraft({
    platform: 'x',
    status: 'validated',
    thread: ['A launch post with no links in it'],
    replyWithLink: 'Details: https://test.gg',
  });
  return { dir, kitDir };
}

const KIT_MANIFEST = {
  version: 1,
  brand: 'test',
  generatedAt: '2026-07-11T00:00:00.000Z',
  platforms: {
    x: { video: 'x/social-16x9.mp4', caption: 'x/caption.txt', alt: 'x/alt.txt', thumb: null, srt: null, vtt: null, note: 'n' },
  },
};

describe('runPost post kit media', () => {
  it('injects kit media into the draft for x when postkitDir is configured', async () => {
    const { dir, kitDir } = await target({ manifest: KIT_MANIFEST, video: true });
    const { provider, seen } = captureProvider('x');
    const result = await runPost(dir, { platform: 'x' }, { providers: [provider] });
    expect(result.exitCode).toBe(0);
    const draft = seen[0] as Extract<Draft, { platform: 'x' }>;
    expect(draft.media?.videoPath).toBe(join(kitDir!, 'x', 'social-16x9.mp4'));
    expect(draft.media?.altText).toBe('alt line');
  });

  it('REFUSES with refused-media when the manifest promises a missing video', async () => {
    const { dir } = await target({ manifest: KIT_MANIFEST, video: false });
    const { provider, seen } = captureProvider('x');
    const result = await runPost(dir, { platform: 'x' }, { providers: [provider] });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]?.outcome).toBe('refused-media');
    expect(seen).toHaveLength(0); // provider never called
  });

  it('REFUSES with refused-media when postkitDir has no manifest', async () => {
    const { dir } = await target({ video: false });
    const { provider, seen } = captureProvider('x');
    const result = await runPost(dir, { platform: 'x' }, { providers: [provider] });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]?.outcome).toBe('refused-media');
    expect(seen).toHaveLength(0);
  });

  it('posts text-only when the kit simply has no video for the platform', async () => {
    const manifest = { ...KIT_MANIFEST, platforms: { x: { ...KIT_MANIFEST.platforms.x, video: null } } };
    const { dir } = await target({ manifest, video: false });
    const { provider, seen } = captureProvider('x');
    const result = await runPost(dir, { platform: 'x' }, { providers: [provider] });
    expect(result.exitCode).toBe(0);
    expect((seen[0] as Extract<Draft, { platform: 'x' }>).media).toBeUndefined();
  });

  it('posts text-only when no postkitDir is configured (unchanged behavior)', async () => {
    const { dir } = await target(null);
    const { provider, seen } = captureProvider('x');
    const result = await runPost(dir, { platform: 'x' }, { providers: [provider] });
    expect(result.exitCode).toBe(0);
    expect((seen[0] as Extract<Draft, { platform: 'x' }>).media).toBeUndefined();
  });

  // Over-size is covered at the unit level in Task 1's `mediaProblems` tests —
  // writing a >512 MB fixture is not worth the test-suite cost.
  it('REFUSES an over-duration video before calling the provider', async () => {
    const { dir, kitDir } = await target({ manifest: KIT_MANIFEST, video: true });
    await writeFile(join(kitDir!, 'x', 'social-16x9.mp4'), syntheticMp4({ durationSeconds: 200 }));
    const { provider, seen } = captureProvider('x');
    const result = await runPost(dir, { platform: 'x' }, { providers: [provider] });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]?.outcome).toBe('refused-media');
    expect(result.results[0]?.error).toMatch(/200.*140/);
    expect(seen).toHaveLength(0);
  });

  it('REFUSES an unparseable video file', async () => {
    const { dir, kitDir } = await target({ manifest: KIT_MANIFEST, video: true });
    await writeFile(join(kitDir!, 'x', 'social-16x9.mp4'), 'not an mp4');
    const { provider, seen } = captureProvider('x');
    const result = await runPost(dir, { platform: 'x' }, { providers: [provider] });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]?.outcome).toBe('refused-media');
    expect(seen).toHaveLength(0);
  });

  it('refuses identically under --dry-run (bad kits surface in preview)', async () => {
    const { dir, kitDir } = await target({ manifest: KIT_MANIFEST, video: true });
    await writeFile(join(kitDir!, 'x', 'social-16x9.mp4'), syntheticMp4({ durationSeconds: 200 }));
    const { provider, seen } = captureProvider('x');
    const result = await runPost(dir, { platform: 'x', dryRun: true }, { providers: [provider] });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]?.outcome).toBe('refused-media');
    expect(seen).toHaveLength(0);
  });

  it('REFUSES an over-duration linkedin video supplied directly on the draft (non-kit path)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'post-media-li-'));
    const videoPath = join(dir, 'launch-16x9.mp4');
    await writeFile(videoPath, syntheticMp4({ durationSeconds: 1000 }));
    const store = new LaunchStore(dir);
    await store.saveConfig({
      name: 'Test',
      tagline: 'A test',
      description: 'A test product',
      domain: 'test.gg',
      productUrl: 'https://test.gg',
      pricing: 'free',
      stack: [],
    });
    await store.saveDraft({
      platform: 'linkedin',
      status: 'validated',
      body: 'Launch day post.',
      media: { videoPath },
    });
    const { provider, seen } = captureProvider('linkedin');
    const result = await runPost(dir, { platform: 'linkedin' }, { providers: [provider] });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]?.outcome).toBe('refused-media');
    expect(result.results[0]?.error).toMatch(/1000.*900/);
    expect(seen).toHaveLength(0);
  });

  // F6: the pre-flight was keyed on draft.platform, and BlueskyProvider reuses the
  // 'x' draft — so a 100-512 MB clip passed the x cap and only blew up mid-live-run.
  it('REFUSES a clip over the bluesky cap even though the draft it reuses is an x draft', async () => {
    const { dir } = await target({ manifest: KIT_MANIFEST, video: true });
    vi.mocked(probeVideo).mockResolvedValueOnce({ sizeBytes: 200 * 1024 * 1024, durationSeconds: 60 });
    const seen: Draft[] = [];
    const provider: Provider = {
      name: 'bluesky',
      draftPlatform: 'x',
      mode: () => 'api',
      ready: async () => ({ ok: true, detail: 'test' }),
      post: async (draft: Draft | undefined, opts: PostOptions): Promise<PostResult> => {
        if (draft) seen.push(draft);
        return { platform: 'bluesky', ok: true, dryRun: opts.dryRun };
      },
    };
    const result = await runPost(dir, { platform: 'bluesky', dryRun: true }, { providers: [provider] });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]?.outcome).toBe('refused-media');
    expect(result.results[0]?.error).toMatch(/200 MB.*100 MB/);
    expect(seen).toHaveLength(0);
  });

  it('passes a within-caps video through unchanged', async () => {
    const { dir } = await target({ manifest: KIT_MANIFEST, video: true });
    const { provider, seen } = captureProvider('x');
    const result = await runPost(dir, { platform: 'x' }, { providers: [provider] });
    expect(result.exitCode).toBe(0);
    expect((seen[0] as Extract<Draft, { platform: 'x' }>).media?.videoPath).toBeTruthy();
  });
});
