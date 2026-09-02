import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserCommand, clipboardCommand } from '../src/assist.js';
import { HackerNewsProvider, hnSubmitUrl } from '../src/providers/hackernews.js';
import { ProductHuntProvider } from '../src/providers/producthunt.js';
import type { Draft } from '../src/types.js';

const hnDraft: Draft = {
  platform: 'hackernews',
  status: 'filled',
  title: 'Show HN: DemoApp – uptime monitoring & alerts (for solo devs)',
  url: 'https://demoapp.io/?ref=hn',
  makerComment: 'Maker here — built this after my own site died overnight. Stack: Node + Postgres.',
};

const phDraft: Draft = {
  platform: 'producthunt',
  status: 'filled',
  tagline: 'Uptime monitoring for solo devs',
  description: 'DemoApp watches your endpoints and alerts you before users notice.',
  topics: ['Developer Tools', 'SaaS'],
  firstComment: 'Maker here — ask me anything.',
  galleryNotes: '- Hero shot done\n- Dashboard screenshot done',
};

describe('hnSubmitUrl', () => {
  it('percent-encodes spaces and special characters in title and url', () => {
    const url = hnSubmitUrl(hnDraft.title as string, 'https://demoapp.io/?ref=hn');
    expect(url).toMatch(/^https:\/\/news\.ycombinator\.com\/submitlink\?/);
    expect(url).toContain('u=https%3A%2F%2Fdemoapp.io%2F%3Fref%3Dhn');
    expect(url).toContain('t=Show+HN%3A+DemoApp');
    expect(url).toContain('%26'); // the & in the title
    expect(url).toContain('%28for+solo+devs%29'); // parens encoded
  });
});

describe('assist command construction', () => {
  it('builds the right browser-open command per platform', () => {
    expect(browserCommand('https://x.test', 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'https://x.test'],
    });
    expect(browserCommand('https://x.test', 'darwin')).toEqual({ command: 'open', args: ['https://x.test'] });
    expect(browserCommand('https://x.test', 'linux')).toEqual({ command: 'xdg-open', args: ['https://x.test'] });
  });

  it('builds the right clipboard command per platform with stdin payload', () => {
    expect(clipboardCommand('hello', 'win32')).toEqual({
      command: 'powershell',
      args: ['-NoProfile', '-Command', '$input | Set-Clipboard'],
      stdin: 'hello',
    });
    expect(clipboardCommand('hello', 'darwin')).toEqual({ command: 'pbcopy', args: [], stdin: 'hello' });
    expect(clipboardCommand('hello', 'linux')).toEqual({
      command: 'xclip',
      args: ['-selection', 'clipboard'],
      stdin: 'hello',
    });
  });
});

describe('HackerNewsProvider', () => {
  it('assist opens the prefilled submitlink and copies the maker comment', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const opened: string[] = [];
    const copied: string[] = [];
    const provider = new HackerNewsProvider(process.env, {
      open: async (url) => void opened.push(url),
      copy: async (text) => void copied.push(text),
    });
    const result = await provider.post(hnDraft, { dryRun: false, assist: true });
    expect(result.ok).toBe(true);
    expect(opened[0]).toContain('news.ycombinator.com/submitlink');
    expect(copied[0]).toContain('Maker here');
    log.mockRestore();
  });

  it('blocks assist on a Show HN violation, naming the rule, without opening anything', async () => {
    const opened: string[] = [];
    const provider = new HackerNewsProvider(process.env, {
      open: async (url) => void opened.push(url),
      copy: async () => {},
    });
    const bad: Draft = { ...hnDraft, title: 'DemoApp – no prefix here' } as Draft;
    const result = await provider.post(bad, { dryRun: false, assist: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('hn-title-prefix');
    expect(opened).toHaveLength(0);
  });

  it('mode() is assist and ready() is always ok', async () => {
    const provider = new HackerNewsProvider();
    expect(provider.mode()).toBe('assist');
    expect((await provider.ready()).ok).toBe(true);
  });
});

describe('ProductHuntProvider', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'launch-ph-test-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes a launch kit containing every required section', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const provider = new ProductHuntProvider(process.env, {
      open: async () => {},
      copy: async () => {},
    });
    const result = await provider.post(phDraft, {
      dryRun: false,
      assist: false,
      outDir,
      productUrl: 'https://demoapp.io',
    });
    expect(result.ok).toBe(true);
    const kit = await readFile(join(outDir, 'producthunt-kit.md'), 'utf8');
    for (const heading of [
      '# Launch kit',
      '## Tagline',
      '## Description',
      '## Topics',
      '## Gallery checklist',
      '## First comment',
      '## Schedule recommendation',
      '## Links',
    ]) {
      expect(kit, `missing heading: ${heading}`).toContain(heading);
    }
    expect(kit).toContain('12:01 AM PT');
    expect(kit).toContain('https://demoapp.io');
    log.mockRestore();
  });

  it('assist opens the submit page and copies the tagline', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const opened: string[] = [];
    const copied: string[] = [];
    const provider = new ProductHuntProvider(process.env, {
      open: async (url) => void opened.push(url),
      copy: async (text) => void copied.push(text),
    });
    await provider.post(phDraft, { dryRun: false, assist: true, outDir, productUrl: 'https://demoapp.io' });
    expect(opened[0]).toBe('https://www.producthunt.com/posts/new');
    expect(copied[0]).toBe('Uptime monitoring for solo devs');
    log.mockRestore();
  });

  it('parses mocked GraphQL stats into votes/comments', async () => {
    const fetchImpl = (async () =>
      Response.json({
        data: { post: { votesCount: 142, commentsCount: 37, featuredAt: '2026-06-12T07:01:00Z' } },
      })) as typeof fetch;
    const provider = new ProductHuntProvider({ PRODUCTHUNT_DEV_TOKEN: 'tok' } as NodeJS.ProcessEnv, { fetchImpl });
    const stats = await provider.fetchStats('demoapp');
    expect(stats).toEqual({ live: true, votes: 142, comments: 37, featuredAt: '2026-06-12T07:01:00Z' });
  });

  it('reports not-yet-live gracefully when the post is null', async () => {
    const fetchImpl = (async () => Response.json({ data: { post: null } })) as typeof fetch;
    const provider = new ProductHuntProvider({ PRODUCTHUNT_DEV_TOKEN: 'tok' } as NodeJS.ProcessEnv, { fetchImpl });
    const stats = await provider.fetchStats('demoapp');
    expect(stats.live).toBe(false);
  });
});
