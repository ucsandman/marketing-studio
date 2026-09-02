import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUiServer, type UiServer } from '../src/ui/server.js';
import { registerReadRoutes } from '../src/ui/routes-read.js';
import { registerActionRoutes } from '../src/ui/routes-actions.js';
import { RecentsStore } from '../src/recents.js';

// Not a secret — a short fixture value.
const TOKEN = 'fixture-tok';

/**
 * Security re-audit: EVERY registered /api route — read and action, across all
 * phases — must reject token-less requests with a structured 403 before any
 * handler logic runs. The route list comes from the server itself, so a route
 * added later is automatically covered.
 */
describe('guard coverage across all registered routes', () => {
  let ui: UiServer;
  let base: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'launch-ui-guard-'));
    ui = createUiServer({ port: 0, token: TOKEN, webRoot: join(base, 'none') });
    registerReadRoutes(ui, { recents: new RecentsStore(base), env: {} as NodeJS.ProcessEnv, providers: [] });
    registerActionRoutes(ui, { recents: new RecentsStore(base), env: {} as NodeJS.ProcessEnv, providers: [] });
    await ui.listen();
  });

  afterAll(async () => {
    await ui.close();
    await rm(base, { recursive: true, force: true });
  });

  function rawStatus(method: string, path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolvePromise, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: ui.port, path, method }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('covers the full expected route surface (catches accidental de-registration)', () => {
    const patterns = ui.registeredRoutes().map((r) => `${r.method} ${r.pattern}`);
    expect(patterns.sort()).toEqual(
      [
        'GET /api/health',
        'GET /api/meta/platforms',
        'GET /api/products',
        'GET /api/fs',
        'GET /api/target',
        'GET /api/target/status',
        'GET /api/target/doctor',
        'GET /api/target/briefs',
        'GET /api/target/drafts',
        'GET /api/target/postkit',
        'POST /api/target/init',
        'PUT /api/target/drafts/:platform',
        'POST /api/target/research',
        'POST /api/target/preview',
        'POST /api/target/post',
        'POST /api/target/notify',
        'PUT /api/target/config/postkit',
        'POST /api/target/postkit/open',
      ].sort(),
    );
  });

  it('rejects every registered route without a token: 403 structured error', async () => {
    const routes = ui.registeredRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(15);
    for (const route of routes) {
      const path = route.pattern.replace(/:([a-zA-Z]+)/g, 'x');
      const { status, body } = await rawStatus(route.method, path);
      expect(status, `${route.method} ${path} must 403 without a token`).toBe(403);
      const parsed = JSON.parse(body) as { ok: boolean; error: string };
      expect(parsed.ok).toBe(false);
      expect(parsed.error).not.toContain('\n');
    }
  });

  it('rejects every registered route with a non-localhost Host header: 403', async () => {
    for (const route of ui.registeredRoutes()) {
      const path = route.pattern.replace(/:([a-zA-Z]+)/g, 'x');
      const result = await new Promise<number>((resolvePromise, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: ui.port,
            path,
            method: route.method,
            headers: { Host: 'evil.example.com', Authorization: `Bearer ${TOKEN}` },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolvePromise(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(result, `${route.method} ${path} must 403 for foreign Host`).toBe(403);
    }
  });
});
