import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUiServer, type UiServer } from '../src/ui/server.js';
import { registerReadRoutes } from '../src/ui/routes-read.js';
import { registerActionRoutes } from '../src/ui/routes-actions.js';
import { LaunchStore } from '../src/state.js';
import { RecentsStore } from '../src/recents.js';
import type { LaunchConfig } from '../src/types.js';
import { syntheticMp4 } from './helpers/mp4.js';

// Not a secret — a short fixture value.
const TOKEN = 'fixture-tok';

const KIT_MANIFEST = {
  version: 1,
  brand: 'test',
  generatedAt: '2026-07-11T00:00:00.000Z',
  platforms: {
    x: {
      video: 'x/social-16x9.mp4',
      caption: 'x/caption.txt',
      alt: 'x/alt.txt',
      thumb: 'x/thumb.jpg',
      srt: null,
      vtt: null,
      note: 'Upload directly to X.',
    },
    tiktok: {
      video: null,
      caption: 'tiktok/caption.txt',
      alt: 'tiktok/alt.txt',
      thumb: null,
      srt: null,
      vtt: null,
      note: 'Manual upload.',
    },
  },
};

const BASE_CONFIG: Omit<LaunchConfig, 'postkitDir'> = {
  name: 'demo',
  tagline: 'demo tagline',
  description: 'demo description',
  domain: 'demoapp.io',
  productUrl: 'https://demoapp.io',
  pricing: '$9/mo',
  stack: [],
};

let base: string;
let ui: UiServer;
const cleanupDirs: string[] = [];

/** Builds an initialized target dir; optionally with postkitDir set in its config. */
async function makeTarget(postkitDir?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'launch-ui-postkit-target-'));
  cleanupDirs.push(dir);
  const store = new LaunchStore(dir);
  await store.saveConfig({ ...BASE_CONFIG, ...(postkitDir ? { postkitDir } : {}) });
  return dir;
}

/** Builds a valid post kit dir: manifest.json + the x/ and tiktok/ assets it references. */
async function makeValidKitDir(videoBytes: Buffer | string = 'fake video bytes'): Promise<string> {
  const kitDir = await mkdtemp(join(tmpdir(), 'launch-ui-postkit-kit-'));
  cleanupDirs.push(kitDir);
  await mkdir(join(kitDir, 'x'), { recursive: true });
  await mkdir(join(kitDir, 'tiktok'), { recursive: true });
  await writeFile(join(kitDir, 'manifest.json'), JSON.stringify(KIT_MANIFEST), 'utf8');
  await writeFile(join(kitDir, 'x', 'social-16x9.mp4'), videoBytes);
  await writeFile(join(kitDir, 'x', 'caption.txt'), 'caption text');
  await writeFile(join(kitDir, 'x', 'thumb.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  await writeFile(join(kitDir, 'tiktok', 'caption.txt'), 'tiktok caption');
  return kitDir;
}

/** Builds a kit dir whose manifest.json is corrupt JSON. */
async function makeCorruptKitDir(): Promise<string> {
  const kitDir = await mkdtemp(join(tmpdir(), 'launch-ui-postkit-corrupt-'));
  cleanupDirs.push(kitDir);
  await writeFile(join(kitDir, 'manifest.json'), '{bad', 'utf8');
  return kitDir;
}

/** Builds a kit dir whose manifest has a thumb path that escapes the kit directory. */
async function makeTraversalThumbKitDir(): Promise<string> {
  const kitDir = await mkdtemp(join(tmpdir(), 'launch-ui-postkit-traversal-thumb-'));
  cleanupDirs.push(kitDir);
  await mkdir(join(kitDir, 'x'), { recursive: true });
  const manifest = {
    version: 1,
    brand: 'test',
    generatedAt: '2026-07-11T00:00:00.000Z',
    platforms: {
      x: {
        video: 'x/social-16x9.mp4',
        caption: 'x/caption.txt',
        alt: 'x/alt.txt',
        thumb: '../../x.jpg',
        srt: null,
        vtt: null,
        note: 'Upload directly to X.',
      },
    },
  };
  await writeFile(join(kitDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  await writeFile(join(kitDir, 'x', 'social-16x9.mp4'), 'fake video bytes');
  await writeFile(join(kitDir, 'x', 'caption.txt'), 'caption text');
  return kitDir;
}

/** Builds a kit dir whose manifest has a platforms key that escapes the kit directory when opened. */
async function makeTraversalPlatformKitDir(): Promise<string> {
  const kitDir = await mkdtemp(join(tmpdir(), 'launch-ui-postkit-traversal-platform-'));
  cleanupDirs.push(kitDir);
  const manifest = {
    version: 1,
    brand: 'test',
    generatedAt: '2026-07-11T00:00:00.000Z',
    platforms: {
      '../..': {
        video: null,
        caption: null,
        alt: null,
        thumb: null,
        srt: null,
        vtt: null,
        note: 'hostile key',
      },
    },
  };
  await writeFile(join(kitDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return kitDir;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: { ok: boolean; data?: unknown; error?: string; fields?: unknown } }> {
  const res = await fetch(`http://127.0.0.1:${ui.port}${path}`, {
    method,
    headers: {
      'X-Launch-Token': TOKEN,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as { ok: boolean; data?: unknown; error?: string; fields?: unknown } };
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'launch-ui-postkit-base-'));
  ui = createUiServer({ port: 0, token: TOKEN, webRoot: join(base, 'no-webroot') });
  registerReadRoutes(ui, { recents: new RecentsStore(base), env: {} as NodeJS.ProcessEnv, providers: [] });
  registerActionRoutes(ui, { recents: new RecentsStore(base), env: {} as NodeJS.ProcessEnv, providers: [] });
  await ui.listen();
}, 30_000);

afterAll(async () => {
  await ui.close();
  for (const dir of [base, ...cleanupDirs]) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('GET /api/target/postkit', () => {
  it('returns configured:false when no postkitDir in config', async () => {
    const target = await makeTarget();
    const { status, body } = await api('GET', `/api/target/postkit?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    expect(body.data).toEqual({ initialized: true, configured: false, platforms: [] });
  });

  it('returns per-platform status with autoAttach flags and thumb data URI', async () => {
    const kitDir = await makeValidKitDir();
    const target = await makeTarget(kitDir);
    const { status, body } = await api('GET', `/api/target/postkit?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    const data = body.data as {
      initialized: boolean;
      configured: boolean;
      platforms: {
        platform: string;
        autoAttach: boolean;
        video: { file: string; missing: boolean } | null;
        caption: string | null;
        thumbDataUri: string | null;
      }[];
    };
    expect(data.initialized).toBe(true);
    expect(data.configured).toBe(true);
    const byPlatform = Object.fromEntries(data.platforms.map((p) => [p.platform, p]));

    expect(byPlatform.x?.autoAttach).toBe(true);
    expect(byPlatform.x?.video?.file).toBe('x/social-16x9.mp4');
    expect(byPlatform.x?.video?.missing).toBe(false);
    expect(byPlatform.x?.caption).toBe('caption text');
    expect(byPlatform.x?.thumbDataUri?.startsWith('data:image/jpeg;base64,')).toBe(true);

    expect(byPlatform.tiktok?.autoAttach).toBe(false);
    expect(byPlatform.tiktok?.video).toBeNull();
  });

  it('reports manifestError instead of failing when the manifest is corrupt', async () => {
    const kitDir = await makeCorruptKitDir();
    const target = await makeTarget(kitDir);
    const { status, body } = await api('GET', `/api/target/postkit?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    const data = body.data as { manifestError?: string; platforms: unknown[] };
    expect(data.manifestError).toBeTruthy();
    expect(data.platforms).toEqual([]);
  });

  it('degrades a manifest thumb path that escapes the kit dir to null, not file bytes or a 500', async () => {
    const kitDir = await makeTraversalThumbKitDir();
    const target = await makeTarget(kitDir);
    const { status, body } = await api('GET', `/api/target/postkit?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    const data = body.data as { platforms: { platform: string; thumbDataUri: string | null }[] };
    const x = data.platforms.find((p) => p.platform === 'x');
    expect(x).toBeTruthy();
    expect(x?.thumbDataUri).toBeNull();
  });

  it('reports check.ok with duration for a within-caps kit video', async () => {
    const kitDir = await makeValidKitDir(syntheticMp4({ durationSeconds: 60 }));
    const target = await makeTarget(kitDir);
    const { status, body } = await api('GET', `/api/target/postkit?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    const data = body.data as {
      platforms: { platform: string; check: { ok: boolean; durationSeconds: number | null; problems: string[] } | null }[];
    };
    const x = data.platforms.find((p) => p.platform === 'x');
    expect(x?.check).toEqual({ ok: true, durationSeconds: 60, problems: [] });
    const tiktok = data.platforms.find((p) => p.platform === 'tiktok');
    expect(tiktok?.check).toBeNull();
  });

  it('reports check.ok false with problems for an over-duration video', async () => {
    const kitDir = await makeValidKitDir(syntheticMp4({ durationSeconds: 200 }));
    const target = await makeTarget(kitDir);
    const { status, body } = await api('GET', `/api/target/postkit?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    const data = body.data as {
      platforms: { platform: string; check: { ok: boolean; durationSeconds: number | null; problems: string[] } | null }[];
    };
    const x = data.platforms.find((p) => p.platform === 'x');
    expect(x?.check?.ok).toBe(false);
    expect(x?.check?.problems[0]).toMatch(/200.*140/);
  });
});

describe('PUT /api/target/config/postkit', () => {
  it('validates the kit before saving and persists postkitDir', async () => {
    const kitDir = await makeValidKitDir();
    const target = await makeTarget();
    const { status } = await api('PUT', '/api/target/config/postkit', { dir: target, postkitDir: kitDir });
    expect(status).toBe(200);
    const config = await new LaunchStore(target).loadConfig();
    expect(config.postkitDir).toBe(resolve(kitDir));
  });

  it('rejects a dir without a manifest with a 400 field error', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'launch-ui-postkit-empty-'));
    cleanupDirs.push(emptyDir);
    const target = await makeTarget();
    const { status, body } = await api('PUT', '/api/target/config/postkit', { dir: target, postkitDir: emptyDir });
    expect(status).toBe(400);
    expect(body.error).toContain('manifest.json');
    const config = await new LaunchStore(target).loadConfig();
    expect(config.postkitDir).toBeUndefined();
  });

  it('clears postkitDir when null', async () => {
    const kitDir = await makeValidKitDir();
    const target = await makeTarget(kitDir);
    const { status } = await api('PUT', '/api/target/config/postkit', { dir: target, postkitDir: null });
    expect(status).toBe(200);
    const config = await new LaunchStore(target).loadConfig();
    expect(config.postkitDir).toBeUndefined();
  });
});

describe('POST /api/target/postkit/open', () => {
  it('invokes the injected opener with the platform folder path', async () => {
    const opened: string[] = [];
    const openServer = createUiServer({ port: 0, token: TOKEN, webRoot: join(base, 'no-webroot-open') });
    registerActionRoutes(openServer, {
      recents: new RecentsStore(base),
      openPath: (p) => opened.push(p),
    });
    await openServer.listen();
    try {
      const kitDir = await makeValidKitDir();
      const target = await makeTarget(kitDir);
      const res = await fetch(`http://127.0.0.1:${openServer.port}/api/target/postkit/open`, {
        method: 'POST',
        headers: { 'X-Launch-Token': TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: target, platform: 'x' }),
      });
      const responseBody = (await res.json()) as { ok: boolean; data: { opened: string } };
      expect(res.status).toBe(200);
      expect(responseBody.data.opened).toBe(join(resolve(kitDir), 'x'));
      expect(opened).toEqual([join(resolve(kitDir), 'x')]);
    } finally {
      await openServer.close();
    }
  });

  it('rejects a manifest platforms key that would escape the kit directory with a 400', async () => {
    const kitDir = await makeTraversalPlatformKitDir();
    const target = await makeTarget(kitDir);
    const { status, body } = await api('POST', '/api/target/postkit/open', { dir: target, platform: '../..' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/escapes/);
  });
});
