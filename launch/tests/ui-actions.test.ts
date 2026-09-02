import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createUiServer, type UiServer } from '../src/ui/server.js';
import { registerActionRoutes } from '../src/ui/routes-actions.js';
import { RecentsStore } from '../src/recents.js';
import { LaunchStore } from '../src/state.js';
import { runInit } from '../src/commands/init.js';
import { FacebookProvider } from '../src/providers/facebook.js';
import { GscProvider } from '../src/providers/gsc.js';
import { HackerNewsProvider } from '../src/providers/hackernews.js';
import type { PostOptions, Provider, ProviderStatus } from '../src/providers/types.js';
import type { Draft, PostResult } from '../src/types.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'demo-app');
// Not secrets — short fixture values for the test server and env.
const TOKEN = 'fixture-tok';
const SENTINEL = 'SENTINEL_ENV_VALUE_XYZ_9000';
const DOMAIN = 'demoapp.io';

/** Records every provider interaction; never touches the network. */
class FakeProvider implements Provider {
  readonly name = 'x' as const;
  readonly draftPlatform = 'x' as const;
  postCalls: PostOptions[] = [];
  readyCalls = 0;

  constructor(
    private readonly blocked = false,
    private readonly readyStatus: ProviderStatus = { ok: true, detail: 'fake ready' },
  ) {}

  mode(): 'api' | 'blocked' {
    return this.blocked ? 'blocked' : 'api';
  }

  ready(): Promise<ProviderStatus> {
    this.readyCalls += 1;
    return Promise.resolve(this.readyStatus);
  }

  post(_draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    this.postCalls.push(opts);
    if (opts.dryRun) {
      opts.onPreview?.({ method: 'POST', url: 'https://api.example/post', body: '{"text":"hi"}' });
      return Promise.resolve({ platform: 'x', ok: true, dryRun: true });
    }
    return Promise.resolve({ platform: 'x', ok: true, url: 'https://x.com/i/status/42', dryRun: false });
  }
}

const VALID_X_DRAFT: Draft = {
  platform: 'x',
  status: 'filled',
  thread: ['Launching demo-app today! No URL here.'],
  replyWithLink: 'Try it: https://demoapp.io',
};

async function makeTarget(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'launch-ui-actions-'));
  await cp(FIXTURE, dir, { recursive: true, filter: (src) => !src.includes('.launch') });
  return dir;
}

interface Boot {
  ui: UiServer;
  recents: RecentsStore;
  fake: FakeProvider;
  api: (method: string, path: string, body?: unknown) => Promise<{ status: number; text: string; body: unknown }>;
}

const cleanups: (() => Promise<void>)[] = [];

async function boot(opts: { providers?: Provider[]; fake?: FakeProvider } = {}): Promise<Boot> {
  const base = await mkdtemp(join(tmpdir(), 'launch-ui-actions-base-'));
  const recents = new RecentsStore(base);
  const fake = opts.fake ?? new FakeProvider();
  const ui = createUiServer({ port: 0, token: TOKEN, webRoot: join(base, 'no-webroot') });
  registerActionRoutes(ui, { recents, providers: opts.providers ?? [fake], env: {} as NodeJS.ProcessEnv });
  await ui.listen();
  cleanups.push(async () => {
    await ui.close();
    await rm(base, { recursive: true, force: true });
  });
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${ui.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as unknown };
  };
  return { ui, recents, fake, api };
}

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

describe('POST /api/target/init', () => {
  it('creates .launch/ from a form payload and adds the target to recents', async () => {
    const { api, recents } = await boot();
    const dir = await makeTarget();
    try {
      const { status, body } = await api('POST', '/api/target/init', {
        dir,
        domain: DOMAIN,
        price: '$9/mo',
      });
      expect(status).toBe(200);
      const data = (body as { data: { config: { domain: string } } }).data;
      expect(data.config.domain).toBe(DOMAIN);
      expect(existsSync(join(dir, '.launch', 'launch.config.json'))).toBe(true);
      const file = await recents.load();
      expect(file.targets.map((t) => t.dir)).toContain(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('initializes a bare folder (no README/package.json) from form fields alone', async () => {
    const { api } = await boot();
    const dir = await mkdtemp(join(tmpdir(), 'launch-ui-bare-init-'));
    try {
      const { status, body } = await api('POST', '/api/target/init', {
        dir,
        name: 'bare-product',
        tagline: 'Launches from nothing',
        description: 'A product folder with no scannable metadata at all.',
        domain: 'bareproduct.io',
        price: 'free',
      });
      expect(status).toBe(200);
      const data = (body as { data: { config: { description: string; productUrl: string } } }).data;
      expect(data.config.description).toBe('A product folder with no scannable metadata at all.');
      expect(data.config.productUrl).toBe('https://bareproduct.io');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('invalid payload returns 400 listing field errors', async () => {
    const { api } = await boot();
    const { status, body } = await api('POST', '/api/target/init', { dir: 123, force: 'yes' });
    expect(status).toBe(400);
    const err = body as { ok: boolean; fields: { field: string; message: string }[] };
    expect(err.ok).toBe(false);
    const fields = err.fields.map((f) => f.field);
    expect(fields).toContain('dir');
    expect(fields).toContain('force');
  });
});

describe('PUT /api/target/drafts/:platform', () => {
  it('persists the draft and returns rule violations (hn-title-prefix)', async () => {
    const { api } = await boot();
    const dir = await makeTarget();
    try {
      await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
      const draft = {
        platform: 'hackernews',
        status: 'filled',
        title: 'demo-app: my cool launch', // missing "Show HN: " prefix
        url: 'https://demoapp.io',
        makerComment: 'I built this.',
      };
      const { status, body } = await api('PUT', '/api/target/drafts/hackernews', { dir, draft });
      expect(status).toBe(200);
      const data = (body as { data: { saved: boolean; violations: { rule: string }[] } }).data;
      expect(data.saved).toBe(true);
      expect(data.violations.map((v) => v.rule)).toContain('hn-title-prefix');
      // Persisted even with violations — matches CLI editing flow.
      const stored = await new LaunchStore(dir).loadDraft('hackernews');
      expect(stored?.platform).toBe('hackernews');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a draft whose platform does not match the URL', async () => {
    const { api } = await boot();
    const dir = await makeTarget();
    try {
      await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
      const { status } = await api('PUT', '/api/target/drafts/facebook', {
        dir,
        draft: VALID_X_DRAFT,
      });
      expect(status).toBe(400);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/target/post — gates', () => {
  it('without matching confirm returns 400 and makes zero provider/network calls', async () => {
    const { api, fake } = await boot();
    const dir = await makeTarget();
    try {
      await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
      await new LaunchStore(dir).saveDraft(VALID_X_DRAFT);
      const { status, body } = await api('POST', '/api/target/post', {
        dir,
        platform: 'x',
        confirm: 'wrong-domain.io',
      });
      expect(status).toBe(400);
      expect((body as { error: string }).error).toContain('confirm');
      expect(fake.postCalls).toHaveLength(0);
      expect(fake.readyCalls).toBe(0);
      // Nothing reached the ledger either.
      expect(await new LaunchStore(dir).loadLedger()).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('for a platform already in the ledger returns skipped with zero network calls', async () => {
    const { api, fake } = await boot();
    const dir = await makeTarget();
    try {
      await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
      const store = new LaunchStore(dir);
      await store.saveDraft(VALID_X_DRAFT);
      await store.appendLedger({
        platform: 'x',
        idempotencyKey: `x:${DOMAIN}`,
        postedAt: '2026-06-12T15:00:00.000Z',
        url: 'https://x.com/i/status/1',
      });
      const { status, body } = await api('POST', '/api/target/post', {
        dir,
        platform: 'x',
        confirm: DOMAIN,
      });
      expect(status).toBe(200);
      const data = (body as { data: { skipped: string } }).data;
      expect(data.skipped).toBe('already-posted');
      expect(fake.postCalls).toHaveLength(0);
      expect(await store.loadLedger()).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('with missing creds returns a structured auth error naming key NAMES only', async () => {
    const blocked = new FakeProvider(true, {
      ok: false,
      detail: 'missing keys: X_API_KEY, X_API_SECRET',
      fixHint: 'Create an app at developer.x.com, fill .env.',
    });
    const { api } = await boot({ fake: blocked });
    const dir = await makeTarget();
    try {
      await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
      await new LaunchStore(dir).saveDraft(VALID_X_DRAFT);
      const { status, body } = await api('POST', '/api/target/post', {
        dir,
        platform: 'x',
        confirm: DOMAIN,
      });
      expect(status).toBe(400);
      const err = (body as { error: string }).error;
      expect(err).toContain('X_API_KEY');
      expect(err).not.toContain(SENTINEL);
      expect(blocked.postCalls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('posts live with matching confirm and appends to the ledger', async () => {
    const { api, fake } = await boot();
    const dir = await makeTarget();
    try {
      await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
      const store = new LaunchStore(dir);
      await store.saveDraft(VALID_X_DRAFT);
      const { status, body } = await api('POST', '/api/target/post', {
        dir,
        platform: 'x',
        confirm: DOMAIN,
      });
      expect(status).toBe(200);
      const data = (body as { data: { posted: boolean; url: string } }).data;
      expect(data.posted).toBe(true);
      expect(data.url).toBe('https://x.com/i/status/42');
      expect(fake.postCalls).toHaveLength(1);
      expect(fake.postCalls[0]?.dryRun).toBe(false);
      const ledger = await store.loadLedger();
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.idempotencyKey).toBe(`x:${DOMAIN}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/target/preview', () => {
  it('returns $KEY_NAME request previews and never the sentinel env value', async () => {
    // Distinct values per key, or redaction can't tell which $KEY a hit belongs to.
    const sentinelEnv = {
      FB_PAGE_ID: `${SENTINEL}_PAGE`,
      FB_PAGE_ACCESS_TOKEN: `${SENTINEL}_FBTOK`,
      GOOGLE_APPLICATION_CREDENTIALS: `${SENTINEL}_CRED`,
      GSC_SITE_URL: `${SENTINEL}_SITE`,
    } as NodeJS.ProcessEnv;
    const providers: Provider[] = [new FacebookProvider(sentinelEnv), new GscProvider(sentinelEnv)];
    const { api } = await boot({ providers });
    const dir = await makeTarget();
    try {
      await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
      await new LaunchStore(dir).saveDraft({
        platform: 'facebook',
        status: 'filled',
        message: 'demo-app launches today!',
        link: 'https://demoapp.io',
      });
      const { status, text, body } = await api('POST', '/api/target/preview', {
        dir,
        platforms: ['facebook', 'google'],
      });
      expect(status).toBe(200);
      const data = (body as {
        data: { results: { platform: string; outcome: string; previews: { url: string; body?: string }[] }[] };
      }).data;
      const facebook = data.results.find((r) => r.platform === 'facebook');
      expect(facebook?.outcome).toBe('dry-run');
      expect(facebook?.previews.length).toBeGreaterThan(0);
      expect(facebook?.previews[0]?.url).toContain('$FB_PAGE_ID');
      // URLSearchParams percent-encodes the $ — the key NAME is what must survive.
      expect(facebook?.previews[0]?.body).toContain('FB_PAGE_ACCESS_TOKEN');
      const google = data.results.find((r) => r.platform === 'google');
      expect(google?.previews[0]?.url).toContain('GSC_SITE_URL');
      expect(text).not.toContain(SENTINEL); // catches every _PAGE/_FBTOK/_CRED/_SITE variant
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/target/preview — assist platforms', () => {
  it('returns the prefilled submit URL for hackernews without touching the ledger', async () => {
    const { api } = await boot({ providers: [new HackerNewsProvider({} as NodeJS.ProcessEnv)] });
    const dir = await makeTarget();
    try {
      await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
      const store = new LaunchStore(dir);
      await store.saveDraft({
        platform: 'hackernews',
        status: 'filled',
        title: 'Show HN: demo-app — uptime monitoring for solo devs',
        url: 'https://demoapp.io',
        makerComment: 'I built this because…',
      });
      const { status, body } = await api('POST', '/api/target/preview', {
        dir,
        platforms: ['hackernews'],
      });
      expect(status).toBe(200);
      const result = (body as { data: { results: { outcome: string; url?: string }[] } }).data.results[0];
      expect(result?.outcome).toBe('dry-run');
      expect(result?.url).toContain('news.ycombinator.com/submitlink');
      expect(await store.loadLedger()).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/target/notify', () => {
  async function initWithContacts(): Promise<string> {
    const dir = await makeTarget();
    await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
    const store = new LaunchStore(dir);
    await store.ensureDirs();
    await writeFile(
      store.contactsPath,
      JSON.stringify({
        email: [
          { address: 'yes@example.com', name: 'Consenting', consent: true },
          { address: 'no@example.com', name: 'Refused', consent: false },
        ],
        sms: [],
      }),
      'utf8',
    );
    await store.saveDraft({
      platform: 'email',
      status: 'filled',
      subject: 'demo-app is live',
      html: '<p>Try it at https://demoapp.io</p><p><a href="#">Unsubscribe</a></p>',
      text: 'Try it: https://demoapp.io',
    });
    return dir;
  }

  it('defaults to dry-run: consent split returned, non-consented excluded, nothing written', async () => {
    const { api } = await boot();
    const dir = await initWithContacts();
    try {
      const { status, body } = await api('POST', '/api/target/notify', { dir, channel: 'email' });
      expect(status).toBe(200);
      const data = (body as {
        data: {
          live: boolean;
          payloadCount: number;
          consent: { consented: { to: string }[]; excluded: { to: string }[] };
        };
      }).data;
      expect(data.live).toBe(false);
      expect(data.consent.consented.map((c) => c.to)).toEqual(['yes@example.com']);
      expect(data.consent.excluded.map((c) => c.to)).toEqual(['no@example.com']);
      expect(data.payloadCount).toBe(1);
      const outDir = new LaunchStore(dir).outDir;
      expect(existsSync(join(outDir, 'notify-payloads.json'))).toBe(false);
      expect(existsSync(join(outDir, 'email.html'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('live requires its own confirm; with confirm it writes payloads for consented contacts only', async () => {
    const { api } = await boot();
    const dir = await initWithContacts();
    try {
      const noConfirm = await api('POST', '/api/target/notify', { dir, channel: 'email', live: true });
      expect(noConfirm.status).toBe(400);

      const { status, body } = await api('POST', '/api/target/notify', {
        dir,
        channel: 'email',
        live: true,
        confirm: DOMAIN,
      });
      expect(status).toBe(200);
      const data = (body as { data: { live: boolean; payloadCount: number; payloadsPath: string } }).data;
      expect(data.live).toBe(true);
      expect(data.payloadCount).toBe(1);
      expect(existsSync(data.payloadsPath)).toBe(true);
      const payloads = JSON.parse(
        await (await import('node:fs/promises')).readFile(data.payloadsPath, 'utf8'),
      ) as { input: { to: string[] } }[];
      expect(payloads).toHaveLength(1);
      expect(payloads[0]?.input.to).toEqual(['yes@example.com']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/target/research', () => {
  it('runs offline research and reports per-platform outcomes', async () => {
    const { api } = await boot();
    const dir = await makeTarget();
    try {
      await runInit(dir, { domain: DOMAIN, price: '$9/mo' });
      const { status, body } = await api('POST', '/api/target/research', { dir, offline: true });
      expect(status).toBe(200);
      const data = (body as { data: { exitCode: number; messages: string[] } }).data;
      expect(data.exitCode).toBe(0);
      expect(data.messages.length).toBeGreaterThan(0);
      expect(existsSync(join(dir, '.launch', 'research', 'x.md'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
