import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUiServer, type UiServer } from '../src/ui/server.js';
import { registerReadRoutes } from '../src/ui/routes-read.js';
import { RecentsStore } from '../src/recents.js';
import { runInit } from '../src/commands/init.js';
import { runCopy } from '../src/commands/copy.js';
import { runResearch } from '../src/commands/research.js';
import { buildProviders } from '../src/providers/index.js';
import { GscProvider } from '../src/providers/gsc.js';
import type { Provider } from '../src/providers/types.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'demo-app');
// Not secrets — short fixture values for the test server and env.
const TOKEN = 'fixture-tok';
const SENTINEL = 'SENTINEL_ENV_VALUE_XYZ_9000';

// Partial creds per provider: sentinel values present in env, but every
// provider stays `blocked` on its missing-keys check — zero network calls.
const SENTINEL_ENV = {
  X_API_KEY: SENTINEL,
  FB_PAGE_ACCESS_TOKEN: SENTINEL,
  LINKEDIN_ACCESS_TOKEN: SENTINEL,
  REDDIT_CLIENT_ID: SENTINEL,
} as NodeJS.ProcessEnv;

// GSC gets FULL sentinel creds plus a failing injected tokenProvider whose
// error message embeds the env value — the regression case for the gsc.ts
// redaction (doctor must swap values for $KEY names, never echo them).
function buildMockedProviders(): Provider[] {
  const gsc = new GscProvider(
    { GOOGLE_APPLICATION_CREDENTIALS: SENTINEL, GSC_SITE_URL: SENTINEL } as NodeJS.ProcessEnv,
    {
      tokenProvider: () =>
        Promise.reject(new Error(`ENOENT: no such file or directory, open '${SENTINEL}'`)),
    },
  );
  return [...buildProviders(SENTINEL_ENV).filter((p) => p.name !== 'google'), gsc];
}

let base: string;
let target: string;
let bare: string;
let fsDir: string;
let recents: RecentsStore;
let ui: UiServer;

async function api(path: string): Promise<{ status: number; text: string; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${ui.port}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as unknown };
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'launch-ui-recents-'));
  bare = await mkdtemp(join(tmpdir(), 'launch-ui-bare-'));
  fsDir = await mkdtemp(join(tmpdir(), 'launch-ui-fs-'));
  await mkdir(join(fsDir, 'sub-dir'));
  await writeFile(join(fsDir, 'a-file.txt'), 'file contents must never appear in /api/fs');

  target = await mkdtemp(join(tmpdir(), 'launch-ui-target-'));
  await cp(FIXTURE, target, { recursive: true, filter: (src) => !src.includes('.launch') });
  await runInit(target, { domain: 'demoapp.io', price: '$9/mo', force: true });
  await runCopy(target, { scaffold: true });
  await runResearch(target, { offline: true });

  recents = new RecentsStore(base);
  await recents.touch({ dir: target, name: 'demo-app', domain: 'demoapp.io' });
  await recents.touch({ dir: bare, name: 'bare-project' });

  ui = createUiServer({ port: 0, token: TOKEN, webRoot: join(base, 'no-webroot') });
  registerReadRoutes(ui, { recents, env: SENTINEL_ENV, providers: buildMockedProviders() });
  await ui.listen();
}, 30_000);

afterAll(async () => {
  await ui.close();
  for (const dir of [base, target, bare, fsDir]) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('GET /api/meta/platforms', () => {
  it('exposes draft platforms, limits, and the assist-only list', async () => {
    const { status, body } = await api('/api/meta/platforms');
    expect(status).toBe(200);
    const data = (body as {
      data: { draftPlatforms: string[]; limits: { x: { post: number } }; assistOnly: string[] };
    }).data;
    expect(data.draftPlatforms).toContain('hackernews');
    expect(data.limits.x.post).toBe(280);
    expect(data.assistOnly).toEqual(['hackernews', 'producthunt']);
  });
});

describe('GET /api/products', () => {
  it('round-trips the recents registry with initialized annotations', async () => {
    const { status, body } = await api('/api/products');
    expect(status).toBe(200);
    const { targets } = (body as { data: { targets: { dir: string; name: string; initialized: boolean }[] } }).data;
    const byName = Object.fromEntries(targets.map((t) => [t.name, t]));
    expect(byName['demo-app']?.initialized).toBe(true);
    expect(byName['demo-app']?.dir).toBe(target);
    expect(byName['bare-project']?.initialized).toBe(false);
  });

  it('prunes entries whose directory no longer exists', async () => {
    const ghost = await mkdtemp(join(tmpdir(), 'launch-ui-ghost-'));
    await recents.touch({ dir: ghost, name: 'ghost-project' });
    await rm(ghost, { recursive: true, force: true });
    const { body } = await api('/api/products');
    const { targets } = (body as { data: { targets: { name: string }[] } }).data;
    expect(targets.map((t) => t.name)).not.toContain('ghost-project');
  });

  it('corrupted recents.json returns a structured error naming the file path, not a crash', async () => {
    const corruptBase = await mkdtemp(join(tmpdir(), 'launch-ui-corrupt-'));
    const corruptStore = new RecentsStore(corruptBase);
    await mkdir(dirname(corruptStore.filePath), { recursive: true });
    await writeFile(corruptStore.filePath, '{ this is not json', 'utf8');
    const server2 = createUiServer({ port: 0, token: TOKEN, webRoot: join(corruptBase, 'nope') });
    registerReadRoutes(server2, { recents: corruptStore, env: SENTINEL_ENV });
    await server2.listen();
    try {
      const res = await fetch(`http://127.0.0.1:${server2.port}/api/products`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain('recents.json');
    } finally {
      await server2.close();
      await rm(corruptBase, { recursive: true, force: true });
    }
  });
});

describe('GET /api/fs', () => {
  it('returns directories only — file entries and contents never appear', async () => {
    const { status, text, body } = await api(`/api/fs?path=${encodeURIComponent(fsDir)}`);
    expect(status).toBe(200);
    const data = (body as { data: { path: string; parent: string | null; entries: { name: string }[] } }).data;
    expect(data.entries.map((e) => e.name)).toEqual(['sub-dir']);
    expect(text).not.toContain('a-file.txt');
    expect(text).not.toContain('file contents must never appear');
    expect(data.parent).toBe(dirname(fsDir));
  });

  it('with no path returns filesystem roots (drive roots on win32)', async () => {
    const { status, body } = await api('/api/fs');
    expect(status).toBe(200);
    const { entries } = (body as { data: { entries: { name: string; path: string }[] } }).data;
    expect(entries.length).toBeGreaterThan(0);
    if (process.platform === 'win32') {
      for (const entry of entries) expect(entry.path).toMatch(/^[A-Z]:\\$/);
    } else {
      expect(entries[0]?.path).toBe('/');
    }
  });

  it('non-existent path returns a 400 structured error', async () => {
    const ghostPath = join(fsDir, 'does-not-exist');
    const { status, body } = await api(`/api/fs?path=${encodeURIComponent(ghostPath)}`);
    expect(status).toBe(400);
    expect((body as { ok: boolean }).ok).toBe(false);
  });

  it('relative path returns a 400 structured error', async () => {
    const { status, body } = await api('/api/fs?path=relative%2Fpath');
    expect(status).toBe(400);
    expect((body as { ok: boolean }).ok).toBe(false);
  });
});

describe('GET /api/target', () => {
  it('returns the parsed launch config for an initialized dir', async () => {
    const { status, body } = await api(`/api/target?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    const data = (body as { data: { initialized: boolean; config: { domain: string }; scan: unknown } }).data;
    expect(data.initialized).toBe(true);
    expect(data.config.domain).toBe('demoapp.io');
    expect(data.scan).toBeDefined();
  });

  it('returns initialized: false (not an error) for an uninitialized dir', async () => {
    const { status, body } = await api(`/api/target?dir=${encodeURIComponent(bare)}`);
    expect(status).toBe(200);
    const data = (body as { data: { initialized: boolean; scan: unknown } }).data;
    expect(data.initialized).toBe(false);
    expect(data.scan).toBeDefined();
  });

  it('missing dir param returns 400', async () => {
    const { status } = await api('/api/target');
    expect(status).toBe(400);
  });
});

describe('GET /api/target/status', () => {
  it('returns the runStatus report as JSON', async () => {
    const { status, body } = await api(`/api/target/status?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    const data = (body as { data: { exitCode: number; messages: string[] } }).data;
    expect(data.exitCode).toBe(0);
    expect(data.messages.join('\n')).toContain('launch status');
  });
});

describe('GET /api/target/doctor', () => {
  it('reports per-provider readiness', async () => {
    const { status, body } = await api('/api/target/doctor');
    expect(status).toBe(200);
    const data = (body as { data: { rows: { provider: string; mode: string; detail: string }[] } }).data;
    expect(data.rows.length).toBe(9);
    for (const row of data.rows) {
      expect(row.provider).toBeTruthy();
      expect(['api', 'assist', 'blocked']).toContain(row.mode);
    }
    // The gsc failure detail must carry the $KEY name, not the env value.
    const google = data.rows.find((r) => r.provider === 'google');
    expect(google?.detail).toContain('$GOOGLE_APPLICATION_CREDENTIALS');
  });
});

describe('GET /api/target/briefs', () => {
  it('returns stored briefs with freshness meta for an initialized target', async () => {
    const { status, body } = await api(`/api/target/briefs?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    const data = (body as {
      data: { initialized: boolean; briefs: { platform: string; content: string; stale: boolean }[] };
    }).data;
    expect(data.initialized).toBe(true);
    expect(data.briefs.length).toBeGreaterThan(0);
    const x = data.briefs.find((b) => b.platform === 'x');
    expect(x?.content).toContain('launch brief');
    expect(x?.stale).toBe(false);
  });

  it('returns a structured empty response for an uninitialized target', async () => {
    const { status, body } = await api(`/api/target/briefs?dir=${encodeURIComponent(bare)}`);
    expect(status).toBe(200);
    expect((body as { data: { initialized: boolean; briefs: unknown[] } }).data).toEqual({
      initialized: false,
      briefs: [],
    });
  });
});

describe('GET /api/target/drafts', () => {
  it('returns stored drafts with validateDraft results attached', async () => {
    const { status, body } = await api(`/api/target/drafts?dir=${encodeURIComponent(target)}`);
    expect(status).toBe(200);
    const data = (body as {
      data: {
        initialized: boolean;
        drafts: { platform: string; draft: unknown; validation: { errors: { rule: string }[] } }[];
      };
    }).data;
    expect(data.initialized).toBe(true);
    expect(data.drafts.length).toBeGreaterThan(0);
    // Scaffolded drafts carry {{placeholders}} → the validator must flag them.
    const allErrors = data.drafts.flatMap((d) => d.validation.errors.map((e) => e.rule));
    expect(allErrors).toContain('unfilled-placeholder');
  });

  it('returns a structured empty response for an uninitialized target', async () => {
    const { status, body } = await api(`/api/target/drafts?dir=${encodeURIComponent(bare)}`);
    expect(status).toBe(200);
    expect((body as { data: { initialized: boolean; drafts: unknown[] } }).data).toEqual({
      initialized: false,
      drafts: [],
    });
  });
});

describe('security: env value leakage', () => {
  it('sentinel env value appears in no read endpoint response body', async () => {
    const paths = [
      '/api/products',
      '/api/fs',
      `/api/fs?path=${encodeURIComponent(fsDir)}`,
      `/api/target?dir=${encodeURIComponent(target)}`,
      `/api/target/status?dir=${encodeURIComponent(target)}`,
      '/api/target/doctor',
      `/api/target/briefs?dir=${encodeURIComponent(target)}`,
      `/api/target/drafts?dir=${encodeURIComponent(target)}`,
    ];
    for (const path of paths) {
      const { text } = await api(path);
      expect(text, `${path} must not leak env values`).not.toContain(SENTINEL);
    }
  });
});
