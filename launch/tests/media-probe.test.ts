import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEDIA_LIMITS, mediaProblems, probeVideo } from '../src/media-probe.js';
import { MAX_VIDEO_BYTES } from '../src/providers/bluesky.js';
import { syntheticMp4 } from './helpers/mp4.js';

async function tmpVideo(content: Buffer | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'probe-'));
  const path = join(dir, 'clip.mp4');
  await writeFile(path, content);
  return path;
}

describe('probeVideo', () => {
  it('reads duration and size from an mvhd v0 file (moov after mdat)', async () => {
    const bytes = syntheticMp4({ durationSeconds: 12.5 });
    const path = await tmpVideo(bytes);
    const probe = await probeVideo(path);
    expect(probe.durationSeconds).toBeCloseTo(12.5, 3);
    expect(probe.sizeBytes).toBe(bytes.length);
  });

  it('reads duration from an mvhd v1 file', async () => {
    const path = await tmpVideo(syntheticMp4({ durationSeconds: 61, version: 1 }));
    const probe = await probeVideo(path);
    expect(probe.durationSeconds).toBeCloseTo(61, 3);
  });

  it('rejects a non-MP4 file with a clear message', async () => {
    const path = await tmpVideo('this is not a video');
    await expect(probeVideo(path)).rejects.toThrow(/not a valid MP4/);
  });

  it('rejects a missing file', async () => {
    await expect(probeVideo(join(tmpdir(), 'does-not-exist.mp4'))).rejects.toThrow();
  });
});

describe('mediaProblems', () => {
  it('passes a normal launch clip on both platforms', () => {
    const probe = { sizeBytes: 24 * 1024 * 1024, durationSeconds: 60 };
    expect(mediaProblems('x', probe)).toEqual([]);
    expect(mediaProblems('linkedin', probe)).toEqual([]);
  });

  it('flags over-duration for x beyond the 140s cap', () => {
    const problems = mediaProblems('x', { sizeBytes: 1024, durationSeconds: 187 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/187.*140/);
  });

  it('flags under-duration for linkedin below 3s', () => {
    const problems = mediaProblems('linkedin', { sizeBytes: 1024, durationSeconds: 2 });
    expect(problems[0]).toMatch(/at least 3/);
  });

  it('flags over-size for x above 512 MB', () => {
    const problems = mediaProblems('x', { sizeBytes: 600 * 1024 * 1024, durationSeconds: 60 });
    expect(problems[0]).toMatch(/512/);
  });

  it('reports duration and size problems together', () => {
    const problems = mediaProblems('x', { sizeBytes: 600 * 1024 * 1024, durationSeconds: 200 });
    expect(problems).toHaveLength(2);
  });

  it('limits match the verified platform caps', () => {
    expect(MEDIA_LIMITS.x).toEqual({ minSeconds: 0.5, maxSeconds: 140, maxBytes: 512 * 1024 * 1024 });
    expect(MEDIA_LIMITS.linkedin).toEqual({ minSeconds: 3, maxSeconds: 900, maxBytes: 5 * 1024 * 1024 * 1024 });
  });

  // F6: Bluesky's 100 MB ceiling was enforced only inside the provider's live
  // path, so every dry run and the dashboard badge called a 200 MB clip postable.
  it('carries bluesky in the shared limit table so dry runs see the 100 MB cap', () => {
    expect(MEDIA_LIMITS.bluesky.maxBytes).toBe(100 * 1024 * 1024);
    expect(MEDIA_LIMITS.bluesky.maxBytes).toBe(MAX_VIDEO_BYTES);
  });

  it('flags a clip that is legal for x but over the bluesky cap', () => {
    const probe = { sizeBytes: 200 * 1024 * 1024, durationSeconds: 60 };
    expect(mediaProblems('x', probe)).toEqual([]);
    const problems = mediaProblems('bluesky', probe);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/200 MB.*bluesky.*100 MB/);
  });
});
