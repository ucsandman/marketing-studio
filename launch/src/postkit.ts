import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { CorruptedStateError } from './state.js';
import { PostKitManifestSchema, type DraftMedia, type PostKitManifest } from './types.js';

/** A loaded, validated post kit. The manifest is the entire interface to the animations repo. */
export interface LoadedPostKit {
  /** Absolute kit root (the directory containing manifest.json). */
  dir: string;
  manifest: PostKitManifest;
}

/** Resolve rel against root, refusing any path that escapes root. */
export function resolveInside(root: string, rel: string): string {
  const p = resolve(root, rel);
  const base = root.endsWith(sep) ? root : root + sep;
  if (p !== root && !p.startsWith(base)) {
    throw new Error(`Post kit manifest path escapes the kit directory: ${rel}`);
  }
  return p;
}

export function manifestPath(kitDir: string): string {
  return join(kitDir, 'manifest.json');
}

export async function loadPostKit(kitDir: string): Promise<LoadedPostKit> {
  const dir = resolve(kitDir);
  const filePath = manifestPath(dir);
  if (!existsSync(filePath)) {
    throw new Error(
      `No post kit manifest at ${filePath} — run \`node scripts/build-postkit.mjs <brand>\` in the animations repo, or clear postkitDir.`,
    );
  }
  const raw = await readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CorruptedStateError(filePath, err);
  }
  const result = PostKitManifestSchema.safeParse(parsed);
  if (!result.success) throw new CorruptedStateError(filePath, result.error);
  return { dir, manifest: result.data };
}

/**
 * Media the kit provides for an auto-attach platform. undefined when the kit
 * has no video for it (partial kit — a text-only post is correct then).
 * Throws when the manifest promises a video missing on disk: a post must be
 * refused rather than silently degraded to text-only.
 */
export async function kitMediaFor(
  kit: LoadedPostKit,
  platform: 'x' | 'linkedin',
): Promise<DraftMedia | undefined> {
  const entry = kit.manifest.platforms[platform];
  if (!entry?.video) return undefined;
  const videoPath = resolveInside(kit.dir, entry.video);
  if (!existsSync(videoPath)) {
    throw new Error(
      `Post kit manifest promises ${entry.video} for ${platform} but the file is missing at ${videoPath} — re-run render-matrix.mjs and build-postkit.mjs.`,
    );
  }
  let altText: string | undefined;
  if (entry.alt) {
    const altPath = resolveInside(kit.dir, entry.alt);
    if (existsSync(altPath)) altText = (await readFile(altPath, 'utf8')).trim();
  }
  return { videoPath, ...(altText ? { altText } : {}) };
}
