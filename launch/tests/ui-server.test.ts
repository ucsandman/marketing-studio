import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUiServer, jsonErr, jsonOk, type UiServer } from '../src/ui/server.js';
import { runUi } from '../src/commands/ui.js';
import type { SpawnCall } from '../src/assist.js';

// Not a secret — a short fixture value injected into the test server.
const TOKEN = 'fixture-tok';

interface RawResponse {
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}

/**
 * fetch() normalizes `/../x` away and refuses to override Host, so the
 * security tests speak raw node:http — the path goes on the wire verbatim.
 */
function rawRequest(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('createUiServer', () => {
  let webRoot: string;
  let ui: UiServer;

  beforeEach(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'launch-ui-webroot-'));
    await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>SPA INDEX</title>');
    await mkdir(join(webRoot, 'assets'));
    await writeFile(join(webRoot, 'assets', 'app.js'), 'console.log("app");');
    ui = createUiServer({ port: 0, token: TOKEN, webRoot });
    await ui.listen();
  });

  afterEach(async () => {
    await ui.close();
    await rm(webRoot, { recursive: true, force: true });
  });

  describe('security: loopback bind', () => {
    it('binds to 127.0.0.1, never 0.0.0.0', () => {
      const addr = ui.server.address() as AddressInfo;
      expect(addr.address).toBe('127.0.0.1');
    });
  });

  describe('security: token guard', () => {
    it('GET /api/health with Bearer token returns 200 { ok: true, data: { name, version } }', async () => {
      const res = await fetch(`http://127.0.0.1:${ui.port}/api/health`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data: { name: string; version: string } };
      expect(body.ok).toBe(true);
      expect(body.data.name).toBe('@marketing-studio/launch');
      expect(body.data.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('accepts the X-Launch-Token header as an alternative', async () => {
      const res = await fetch(`http://127.0.0.1:${ui.port}/api/health`, {
        headers: { 'X-Launch-Token': TOKEN },
      });
      expect(res.status).toBe(200);
    });

    it('rejects /api/* with a missing token: 403 structured error, no stack trace', async () => {
      const res = await fetch(`http://127.0.0.1:${ui.port}/api/health`);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBeTruthy();
      expect(body.error).not.toContain('\n');
      expect(body.error).not.toContain('    at ');
    });

    it('rejects /api/* with a wrong token: 403', async () => {
      const res = await fetch(`http://127.0.0.1:${ui.port}/api/health`, {
        headers: { Authorization: 'Bearer wrong-tok' },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(false);
    });
  });

  describe('security: DNS-rebinding guard', () => {
    it('rejects /api/* with a non-localhost Host header: 403', async () => {
      const res = await rawRequest(ui.port, '/api/health', {
        Host: 'evil.example.com',
        Authorization: `Bearer ${TOKEN}`,
      });
      expect(res.status).toBe(403);
      const body = JSON.parse(res.body) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
    });

    it('rejects a non-localhost Host even with a port suffix', async () => {
      const res = await rawRequest(ui.port, '/api/health', {
        Host: `evil.example.com:${ui.port}`,
        Authorization: `Bearer ${TOKEN}`,
      });
      expect(res.status).toBe(403);
    });

    it('accepts localhost and 127.0.0.1 Hosts with port', async () => {
      for (const host of [`localhost:${ui.port}`, `127.0.0.1:${ui.port}`]) {
        const res = await rawRequest(ui.port, '/api/health', {
          Host: host,
          Authorization: `Bearer ${TOKEN}`,
        });
        expect(res.status, `Host ${host} should be allowed`).toBe(200);
      }
    });
  });

  describe('security: path traversal', () => {
    const ATTEMPTS = ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/assets/..%2f..%2fpackage.json'];

    it.each(ATTEMPTS)('%s returns 404 and never serves package.json', async (path) => {
      const res = await rawRequest(ui.port, path);
      expect(res.status).toBe(404);
      expect(res.body).not.toContain('"name"');
      expect(res.body).not.toContain('@marketing-studio/launch');
    });
  });

  describe('static serving + SPA fallback', () => {
    it('serves index.html at /', async () => {
      const res = await fetch(`http://127.0.0.1:${ui.port}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('SPA INDEX');
    });

    it('serves real assets with the right content-type', async () => {
      const res = await fetch(`http://127.0.0.1:${ui.port}/assets/app.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/javascript');
    });

    it('falls back to index.html for extension-less deep links', async () => {
      const res = await fetch(`http://127.0.0.1:${ui.port}/products/some-product`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('SPA INDEX');
    });

    it('404s missing real assets (with extension)', async () => {
      const res = await fetch(`http://127.0.0.1:${ui.port}/assets/missing.js`);
      expect(res.status).toBe(404);
    });

    it('serves a placeholder page when the web root does not exist (UI not built)', async () => {
      const bare = createUiServer({ port: 0, token: TOKEN, webRoot: join(webRoot, 'does-not-exist') });
      await bare.listen();
      try {
        const res = await fetch(`http://127.0.0.1:${bare.port}/`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('npm run build');
      } finally {
        await bare.close();
      }
    });
  });

  describe('router', () => {
    it('matches :params and returns the handler response', async () => {
      ui.route('PUT', '/api/target/drafts/:platform', (req) => jsonOk({ platform: req.params.platform }));
      const res = await fetch(`http://127.0.0.1:${ui.port}/api/target/drafts/hackernews`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { platform: string } };
      expect(body.data.platform).toBe('hackernews');
    });

    it('unknown /api/* route returns 404 structured error', async () => {
      const res = await fetch(`http://127.0.0.1:${ui.port}/api/nope`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(false);
    });

    it('handler exceptions surface as one-line 500 errors, never stack traces', async () => {
      ui.route('GET', '/api/boom', () => {
        throw new Error('kaboom happened\n    at secretFunction (/app/secret.ts:1:1)');
      });
      const res = await fetch(`http://127.0.0.1:${ui.port}/api/boom`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toBe('kaboom happened');
      expect(body.error).not.toContain('    at ');
    });

    it('rejects malformed JSON bodies with 400', async () => {
      ui.route('POST', '/api/echo', (req) => jsonOk(req.body ?? null));
      const res = await fetch(`http://127.0.0.1:${ui.port}/api/echo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: '{not json',
      });
      expect(res.status).toBe(400);
    });

    it('jsonErr builds the structured error envelope', () => {
      expect(jsonErr(418, 'teapot')).toEqual({ status: 418, body: { ok: false, error: 'teapot' } });
    });
  });
});

describe('runUi lifecycle', () => {
  it('boots, reports a tokenized 127.0.0.1 URL, opens the browser, and closes cleanly', async () => {
    const calls: SpawnCall[] = [];
    const running = await runUi({
      port: 0,
      spawnImpl: (call) => {
        calls.push(call);
        return Promise.resolve();
      },
    });
    try {
      expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+$/);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args.join(' ')).toContain(running.url);
    } finally {
      await running.close();
    }
  });

  it('respects open: false (the --no-open flag)', async () => {
    const calls: SpawnCall[] = [];
    const running = await runUi({
      port: 0,
      open: false,
      spawnImpl: (call) => {
        calls.push(call);
        return Promise.resolve();
      },
    });
    try {
      expect(calls).toHaveLength(0);
    } finally {
      await running.close();
    }
  });
});
