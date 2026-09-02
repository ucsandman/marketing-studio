import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runResearch, DEFAULT_SUBREDDITS } from '../src/commands/research.js';
import { parseBriefMeta, extractSessionResearch, isStale } from '../src/research/brief.js';
import { PLATFORMS } from '../src/types.js';
import { LaunchStore } from '../src/state.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'demo-app');

/** fetch stub: routes by URL substring; unmatched URLs reject. */
function fakeFetch(routes: Record<string, string | Error>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) {
        if (body instanceof Error) throw body;
        return new Response(body, { status: 200 });
      }
    }
    throw new Error(`No route for ${url}`);
  }) as typeof fetch;
}

const happyRoutes: Record<string, string | Error> = {
  'raw.githubusercontent.com/xai-org': '# X Algorithm\n\nRanking signals: replies > likes.',
  'hn.algolia.com': JSON.stringify({
    hits: [{ title: 'Show HN: UptimeBot', points: 312 }],
  }),
  'hunted.space': '<html>Thursday <b>23</b> launches</html>',
  'reddit.com': JSON.stringify({
    rules: [{ short_name: 'No spam' }],
    data: { children: [{ data: { title: 'I built a monitor', score: 95 } }] },
  }),
};

describe('runResearch', () => {
  let target: string;
  let store: LaunchStore;

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'launch-research-test-'));
    // Exclude any .launch state left in the fixture by manual CLI runs.
    await cp(FIXTURE, target, {
      recursive: true,
      filter: (src) => !src.includes('.launch'),
    });
    await runInit(target, { domain: 'demoapp.io', price: '$9/mo', force: true });
    store = new LaunchStore(target);
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it('--offline writes briefs for all 8 platforms from static knowledge', async () => {
    const result = await runResearch(target, { offline: true });
    expect(result.exitCode).toBe(0);
    for (const platform of PLATFORMS) {
      const briefPath = join(store.researchDir, `${platform}.md`);
      expect(existsSync(briefPath), `${platform}.md missing`).toBe(true);
      const content = await readFile(briefPath, 'utf8');
      expect(content).toContain('## Static knowledge (as of 2026-06)');
      expect(content).toContain('--offline');
    }
  });

  it('live mode merges fetcher output with source URLs and fetchedAt', async () => {
    const result = await runResearch(
      target,
      {},
      { fetchImpl: fakeFetch(happyRoutes) },
    );
    expect(result.exitCode).toBe(0);
    const x = await readFile(join(store.researchDir, 'x.md'), 'utf8');
    expect(x).toContain('Ranking signals: replies > likes.');
    expect(x).toContain('Source: https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md');
    expect(x).toMatch(/## Live findings \(fetched \d{4}-\d{2}-\d{2}T/);
    const meta = parseBriefMeta(x);
    expect(meta?.degraded).toBe(false);
    expect(meta?.sources).toContain(
      'https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md',
    );
    const hn = await readFile(join(store.researchDir, 'hackernews.md'), 'utf8');
    expect(hn).toContain('[312 pts] Show HN: UptimeBot');
    const reddit = await readFile(join(store.researchDir, 'reddit.md'), 'utf8');
    for (const sub of DEFAULT_SUBREDDITS) expect(reddit).toContain(`r/${sub}`);
  });

  it('one fetcher failing degrades only that brief and still exits 0', async () => {
    const routes = { ...happyRoutes, 'hn.algolia.com': new Error('ECONNRESET') } as Record<
      string,
      string | Error
    >;
    const result = await runResearch(target, {}, { fetchImpl: fakeFetch(routes) });
    expect(result.exitCode).toBe(0);

    const hn = await readFile(join(store.researchDir, 'hackernews.md'), 'utf8');
    const hnMeta = parseBriefMeta(hn);
    expect(hnMeta?.degraded).toBe(true);
    expect(hn).toContain('FAILED');
    expect(hn).toContain('## Static knowledge');

    const xMeta = parseBriefMeta(await readFile(join(store.researchDir, 'x.md'), 'utf8'));
    expect(xMeta?.degraded).toBe(false);
  });

  it('--check exits non-zero listing stale platforms', async () => {
    await runResearch(target, { offline: true });
    // Age the x brief past the 7-day TTL.
    const xPath = join(store.researchDir, 'x.md');
    const aged = (await readFile(xPath, 'utf8')).replace(
      /fetchedAt: .+/,
      'fetchedAt: 2026-01-01T00:00:00.000Z',
    );
    await writeFile(xPath, aged, 'utf8');

    const result = await runResearch(target, { check: true });
    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('x (stale');
    expect(result.messages.join('\n')).not.toContain('facebook (stale');
  });

  it('--check exits non-zero when briefs are missing', async () => {
    const result = await runResearch(target, { check: true });
    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('missing');
  });

  it('regeneration preserves ## Session research content', async () => {
    await runResearch(target, { offline: true });
    const xPath = join(store.researchDir, 'x.md');
    const withSession = (await readFile(xPath, 'utf8')).replace(
      /## Session research[\s\S]*$/,
      '## Session research\n\nJune 2026: replies within 15 min boost thread reach 2x.\n',
    );
    await writeFile(xPath, withSession, 'utf8');

    await runResearch(target, { offline: true });
    const regenerated = await readFile(xPath, 'utf8');
    expect(regenerated).toContain('replies within 15 min boost thread reach 2x.');
    expect(extractSessionResearch(regenerated)).toContain('June 2026');
  });

  it('isStale handles fresh, old, and unparseable timestamps', () => {
    const now = new Date('2026-06-12T00:00:00Z');
    const base = { platform: 'x' as const, degraded: false, sources: [] };
    expect(isStale({ ...base, fetchedAt: '2026-06-10T00:00:00Z' }, now)).toBe(false);
    expect(isStale({ ...base, fetchedAt: '2026-06-01T00:00:00Z' }, now)).toBe(true);
    expect(isStale({ ...base, fetchedAt: 'garbage' }, now)).toBe(true);
  });
});
