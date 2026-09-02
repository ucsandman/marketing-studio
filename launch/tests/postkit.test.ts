import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPostKit, kitMediaFor, resolveInside } from '../src/postkit.js';
import { CorruptedStateError } from '../src/state.js';
import { PostKitManifestSchema } from '../src/types.js';

const MANIFEST = {
  version: 1,
  brand: 'noban',
  generatedAt: '2026-07-11T00:00:00.000Z',
  platforms: {
    x: {
      video: 'x/social-16x9.mp4',
      caption: 'x/caption.txt',
      alt: 'x/alt.txt',
      thumb: 'x/thumb.jpg',
      srt: null,
      vtt: null,
      note: 'Upload the video file directly to X.',
    },
    tiktok: {
      video: null,
      caption: 'tiktok/caption.txt',
      alt: 'tiktok/alt.txt',
      thumb: null,
      srt: null,
      vtt: null,
      note: 'Upload as a TikTok video post.',
    },
  },
};

async function kitDir(manifest: unknown, withVideo = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'postkit-'));
  await writeFile(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  if (withVideo) {
    await mkdir(join(dir, 'x'), { recursive: true });
    await writeFile(join(dir, 'x', 'social-16x9.mp4'), 'fake-video-bytes');
    await writeFile(join(dir, 'x', 'alt.txt'), 'noban launch video: profit alerts.\n');
  }
  return dir;
}

describe('loadPostKit', () => {
  it('loads and validates a manifest', async () => {
    const dir = await kitDir(MANIFEST);
    const kit = await loadPostKit(dir);
    expect(kit.manifest.brand).toBe('noban');
    expect(kit.manifest.platforms.x?.video).toBe('x/social-16x9.mp4');
  });

  it('throws a plain Error naming the path when manifest.json is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'postkit-'));
    await expect(loadPostKit(dir)).rejects.toThrow(/manifest\.json/);
  });

  it('throws CorruptedStateError on invalid JSON', async () => {
    const dir = await kitDir('{not json', false);
    await expect(loadPostKit(dir)).rejects.toBeInstanceOf(CorruptedStateError);
  });

  it('throws CorruptedStateError on schema mismatch', async () => {
    const dir = await kitDir({ version: 2, brand: 'x' }, false);
    await expect(loadPostKit(dir)).rejects.toBeInstanceOf(CorruptedStateError);
  });
});

describe('kitMediaFor', () => {
  it('returns absolute video path and alt text for a platform with video', async () => {
    const dir = await kitDir(MANIFEST);
    const kit = await loadPostKit(dir);
    const media = await kitMediaFor(kit, 'x');
    expect(media?.videoPath).toBe(join(dir, 'x', 'social-16x9.mp4'));
    expect(media?.altText).toBe('noban launch video: profit alerts.');
  });

  it('returns undefined when the kit has no video for the platform', async () => {
    const dir = await kitDir(MANIFEST);
    const kit = await loadPostKit(dir);
    // linkedin absent from the manifest entirely
    expect(await kitMediaFor(kit, 'linkedin')).toBeUndefined();
  });

  it('throws when the manifest promises a video that is missing on disk', async () => {
    const dir = await kitDir(MANIFEST, false);
    const kit = await loadPostKit(dir);
    await expect(kitMediaFor(kit, 'x')).rejects.toThrow(/missing/);
  });

  it('rejects a manifest video path that escapes the kit directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'postkit-'));
    const manifest = {
      version: 1,
      brand: 'evil',
      generatedAt: '2026-07-11T00:00:00.000Z',
      platforms: {
        x: {
          video: '../outside.mp4',
          caption: null,
          alt: null,
          thumb: null,
          srt: null,
          vtt: null,
          note: 'n',
        },
      },
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const kit = await loadPostKit(dir);
    await expect(kitMediaFor(kit, 'x')).rejects.toThrow(/escapes/);
  });
});

describe('resolveInside', () => {
  it('resolves a relative path inside root', () => {
    const root = resolve(tmpdir(), 'postkit-resolve-root');
    expect(resolveInside(root, 'x/video.mp4')).toBe(join(root, 'x', 'video.mp4'));
  });

  it('allows the exact root path', () => {
    const root = resolve(tmpdir(), 'postkit-resolve-root');
    expect(resolveInside(root, '.')).toBe(root);
  });

  it('rejects a relative path that escapes root via ..', () => {
    const root = resolve(tmpdir(), 'postkit-resolve-root');
    expect(() => resolveInside(root, '../outside.mp4')).toThrow(/escapes/);
  });

  it('rejects an absolute rel path that lands outside root', () => {
    const root = resolve(tmpdir(), 'postkit-resolve-root');
    const outside = process.platform === 'win32' ? `C:${sep}Windows${sep}System32${sep}evil.dll` : '/etc/passwd';
    expect(() => resolveInside(root, outside)).toThrow(/escapes/);
  });
});

describe('golden manifest fixture (cross-repo contract)', () => {
  it('parses the real animations-emitted manifest', async () => {
    // Regenerate this fixture from `node scripts/build-postkit.mjs <brand>` in the
    // animations repo (C:/Projects/animations) whenever the postkit manifest contract changes.
    const raw = await readFile(join(import.meta.dirname, 'fixtures', 'postkit-manifest.golden.json'), 'utf8');
    const parsed = PostKitManifestSchema.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
  });
});
