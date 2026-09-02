import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUiServer, type UiServer } from '../src/ui/server.js';

// Not a secret — a short fixture value.
const TOKEN = 'fixture-tok';
const DIST_UI = join(import.meta.dirname, '..', 'dist', 'ui');

/**
 * Serves the REAL built bundle — run `npm run build` first (the repo's
 * standard order). A missing dist/ui fails loudly by design.
 */
describe('SPA serving from dist/ui (requires npm run build)', () => {
  let ui: UiServer;

  beforeAll(async () => {
    expect(
      existsSync(join(DIST_UI, 'index.html')),
      'dist/ui/index.html missing — run `npm run build` before `npm test`',
    ).toBe(true);
    ui = createUiServer({ port: 0, token: TOKEN, webRoot: DIST_UI });
    await ui.listen();
  });

  afterAll(async () => {
    await ui.close();
  });

  it('GET / returns the SPA HTML', async () => {
    const res = await fetch(`http://127.0.0.1:${ui.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<div id="root">');
  });

  it('GET on a deep-link route falls back to the SPA HTML', async () => {
    const res = await fetch(`http://127.0.0.1:${ui.port}/products/some-product`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('serves a real hashed asset with the correct content-type', async () => {
    const html = await readFile(join(DIST_UI, 'index.html'), 'utf8');
    const assetMatch = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(html);
    expect(assetMatch, 'index.html should reference a hashed JS asset').toBeTruthy();
    const res = await fetch(`http://127.0.0.1:${ui.port}${assetMatch?.[1]}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
  });
});

/**
 * F4: the Post tab renders its rows from /api/target/doctor, but Preview kept its
 * own hardcoded 7-entry literal — so bluesky and youtube got a live-post button
 * and no dry-run row at all. The two screens must read the same source.
 */
describe('Preview and Post derive the same platform list', () => {
  const SCREENS = join(import.meta.dirname, '..', 'ui', 'src', 'screens');

  it('Preview.tsx has no hardcoded platform literal', async () => {
    const src = await readFile(join(SCREENS, 'Preview.tsx'), 'utf8');
    expect(src).not.toMatch(/'hackernews'\s*,\s*'producthunt'/);
    expect(src).not.toContain('POSTING_PLATFORMS = [');
  });

  it('Preview.tsx sources its platforms from /api/target/doctor, like Post.tsx', async () => {
    const preview = await readFile(join(SCREENS, 'Preview.tsx'), 'utf8');
    const post = await readFile(join(SCREENS, 'Post.tsx'), 'utf8');
    expect(post).toContain('/api/target/doctor');
    expect(preview).toContain('/api/target/doctor');
  });
});
