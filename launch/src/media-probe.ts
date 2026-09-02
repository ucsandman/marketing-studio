import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

/** Probe result for a video file the pipeline is about to upload. */
export interface VideoProbe {
  sizeBytes: number;
  durationSeconds: number;
}

/**
 * Verified platform caps for auto-attach video posting (checked 2026-07-11):
 * - X standard tier (no premium entitlement): 0.5s-140s, 512 MB.
 *   https://devcommunity.x.com/t/how-can-i-upload-videos-longer-than-140-seconds/130444
 * - LinkedIn feed video: 3s-15min; Videos API fileSizeBytes max 5 GB.
 *   https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api
 * - Bluesky (video.bsky.app): 100 MB, 3 min. Far stricter than X, and the
 *   Bluesky provider reuses the X draft -- so it needs its own row here, not a
 *   check buried in the provider's live path where no dry run ever reaches it.
 */
export type MediaPlatform = 'x' | 'linkedin' | 'bluesky';

export const MEDIA_LIMITS: Record<MediaPlatform, { minSeconds: number; maxSeconds: number; maxBytes: number }> = {
  x: { minSeconds: 0.5, maxSeconds: 140, maxBytes: 512 * 1024 * 1024 },
  linkedin: { minSeconds: 3, maxSeconds: 900, maxBytes: 5 * 1024 * 1024 * 1024 },
  bluesky: { minSeconds: 0.5, maxSeconds: 180, maxBytes: 100 * 1024 * 1024 },
};

/** True when this provider/platform name has a row in MEDIA_LIMITS. */
export function isMediaPlatform(name: string): name is MediaPlatform {
  return name in MEDIA_LIMITS;
}

// moov is metadata and should be tiny; anything bigger is a corrupt size field.
const MOOV_SIZE_CAP = 32 * 1024 * 1024;

function mb(n: number): string {
  return `${Math.round(n / (1024 * 1024))} MB`;
}

/** Human-readable cap violations; empty array means the video is postable. */
export function mediaProblems(platform: MediaPlatform, probe: VideoProbe): string[] {
  const limits = MEDIA_LIMITS[platform];
  const problems: string[] = [];
  const s = probe.durationSeconds;
  if (s < limits.minSeconds) {
    problems.push(`video is ${s.toFixed(1)}s; ${platform} requires at least ${limits.minSeconds}s`);
  }
  if (s > limits.maxSeconds) {
    problems.push(`video is ${s.toFixed(1)}s; ${platform} allows at most ${limits.maxSeconds}s`);
  }
  if (probe.sizeBytes > limits.maxBytes) {
    problems.push(`video is ${mb(probe.sizeBytes)}; ${platform} allows at most ${mb(limits.maxBytes)}`);
  }
  return problems;
}

async function readAt(fh: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  return buf.subarray(0, bytesRead);
}

function parseError(path: string): Error {
  return new Error(`could not read video duration from ${path} — not a valid MP4?`);
}

/** Scan the children of a box buffer for the first box of `type`; returns its body. */
function findChildBox(buf: Buffer, type: string): Buffer | null {
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off);
    const t = buf.toString('ascii', off + 4, off + 8);
    let headerSize = 8;
    if (size === 1) {
      if (off + 16 > buf.length) return null;
      size = Number(buf.readBigUInt64BE(off + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = buf.length - off;
    }
    if (size < headerSize || off + size > buf.length) return null;
    if (t === type) return buf.subarray(off + headerSize, off + size);
    off += size;
  }
  return null;
}

/**
 * duration/timescale from an mvhd body (version 0 or 1). Assumes
 * non-fragmented MP4 (the Remotion default): fragmented output carries
 * mvhd duration 0 (real duration lives in mvex/fragments) and is refused
 * as unparseable — a safe, visible refusal, revisit only if the animations
 * pipeline ever emits fragmented MP4.
 */
function mvhdDurationSeconds(body: Buffer): number | null {
  if (body.length < 20) return null;
  const version = body.readUInt8(0);
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (body.length < 32) return null;
    timescale = body.readUInt32BE(20);
    duration = Number(body.readBigUInt64BE(24));
  } else {
    timescale = body.readUInt32BE(12);
    duration = body.readUInt32BE(16);
  }
  if (!timescale || !duration) return null;
  return duration / timescale;
}

/**
 * Size via stat, duration via the MP4 moov/mvhd box. Pure JS, no external
 * binary — kit videos are always Remotion-rendered MP4s, so an MP4-only
 * parser is sufficient (see the design spec's codec non-goal).
 */
export async function probeVideo(path: string): Promise<VideoProbe> {
  const { size: sizeBytes } = await stat(path);
  const fh = await open(path, 'r');
  try {
    // Top-level box scan: moov commonly sits AFTER mdat in non-faststart files.
    let offset = 0;
    while (offset + 8 <= sizeBytes) {
      const header = await readAt(fh, offset, 16);
      if (header.length < 8) break;
      let size = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      let headerSize = 8;
      if (size === 1) {
        if (header.length < 16) break;
        const large = header.readBigUInt64BE(8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw parseError(path);
        size = Number(large);
        headerSize = 16;
      } else if (size === 0) {
        size = sizeBytes - offset;
      }
      if (size < headerSize) throw parseError(path);
      if (type === 'moov') {
        if (size > MOOV_SIZE_CAP) throw parseError(path);
        const moovBody = await readAt(fh, offset + headerSize, size - headerSize);
        const mvhdBody = findChildBox(moovBody, 'mvhd');
        const durationSeconds = mvhdBody ? mvhdDurationSeconds(mvhdBody) : null;
        if (durationSeconds === null) throw parseError(path);
        return { sizeBytes, durationSeconds };
      }
      offset += size;
    }
    throw parseError(path);
  } finally {
    await fh.close();
  }
}
