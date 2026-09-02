import { mkdtemp, rm, writeFile, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorruptedStateError, LaunchStore } from '../src/state.js';
import type { LaunchConfig, LedgerEntry } from '../src/types.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const sampleConfig: LaunchConfig = {
  name: 'Demo App',
  tagline: 'Demos, but launched',
  description: 'A demo application used to test the launch engine.',
  domain: 'demoapp.io',
  productUrl: 'https://demoapp.io',
  pricing: 'free',
  audience: 'developers',
  stack: ['typescript'],
};

const sampleEntry: LedgerEntry = {
  platform: 'x',
  idempotencyKey: 'x:demoapp:launch-thread',
  postedAt: new Date().toISOString(),
  url: 'https://x.com/i/status/123',
};

describe('LaunchStore', () => {
  let target: string;
  let store: LaunchStore;

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'launch-engine-test-'));
    store = new LaunchStore(target);
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it('creates the .launch directory tree and saves a config', async () => {
    await store.saveConfig(sampleConfig);
    expect(store.hasConfig()).toBe(true);
  });

  it('round-trips a config through save and reload', async () => {
    await store.saveConfig(sampleConfig);
    const reloaded = new LaunchStore(target);
    const config = await reloaded.loadConfig();
    expect(config).toEqual(sampleConfig);
  });

  it('appends ledger entries and reloads them in order', async () => {
    await store.appendLedger(sampleEntry);
    await store.appendLedger({
      ...sampleEntry,
      platform: 'reddit',
      idempotencyKey: 'reddit:demoapp:r-webdev',
    });
    const ledger = await store.loadLedger();
    expect(ledger).toHaveLength(2);
    expect(ledger[0]?.platform).toBe('x');
    expect(ledger[1]?.platform).toBe('reddit');
  });

  it('reports idempotency keys already in the ledger', async () => {
    await store.appendLedger(sampleEntry);
    await expect(store.has(sampleEntry.idempotencyKey)).resolves.toBe(true);
    await expect(store.has('never-posted')).resolves.toBe(false);
  });

  it('throws CorruptedStateError naming the file for invalid JSON', async () => {
    await mkdir(store.launchDir, { recursive: true });
    await writeFile(store.configPath, '{not json', 'utf8');
    await expect(store.loadConfig()).rejects.toThrowError(CorruptedStateError);
    await expect(store.loadConfig()).rejects.toThrowError(/launch\.config\.json/);
  });

  it('throws CorruptedStateError for JSON that fails schema validation', async () => {
    await mkdir(store.launchDir, { recursive: true });
    await writeFile(store.ledgerPath, JSON.stringify([{ platform: 'x' }]), 'utf8');
    await expect(store.loadLedger()).rejects.toThrowError(CorruptedStateError);
  });

  it('deduplicates ledger entries by idempotency key, keeping the newer one', async () => {
    await store.appendLedger(sampleEntry);
    const newer: LedgerEntry = {
      ...sampleEntry,
      postedAt: new Date(Date.parse(sampleEntry.postedAt) + 1000).toISOString(),
      url: 'https://x.com/i/status/456',
    };
    await store.appendLedger(newer);
    const ledger = await store.loadLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.postedAt).toBe(newer.postedAt);
    expect(ledger[0]?.url).toBe(newer.url);
  });

  // REG-6: a fixed temp name is shared by every writer, so two concurrent
  // appendLedger calls interleave into the SAME file and the atomic rename
  // publishes a torn ledger — worse than the lost update it replaced.
  it('writes the ledger through a per-call unique temp file plus rename', async () => {
    const renameMock = vi.mocked(rename);
    renameMock.mockClear();
    await store.appendLedger(sampleEntry);
    await store.appendLedger({ ...sampleEntry, idempotencyKey: 'x:demoapp:second' });
    const tmpPaths = renameMock.mock.calls.map((c) => String(c[0]));
    expect(tmpPaths).toHaveLength(2);
    for (const tmp of tmpPaths) {
      expect(tmp.startsWith(`${store.ledgerPath}.`)).toBe(true);
      expect(tmp.endsWith('.tmp')).toBe(true);
      expect(tmp).not.toBe(`${store.ledgerPath}.tmp`);
    }
    expect(new Set(tmpPaths).size).toBe(2);
    expect(renameMock.mock.calls.every((c) => c[1] === store.ledgerPath)).toBe(true);
  });

  // F10: --force reposting used to DROP the previous row, and --mark-posted
  // refuses a key already present, so the original URL was unrecoverable.
  it('keeps the superseded url and postedAt when a key is re-posted', async () => {
    await store.appendLedger(sampleEntry);
    const newer: LedgerEntry = {
      ...sampleEntry,
      postedAt: new Date(Date.parse(sampleEntry.postedAt) + 1000).toISOString(),
      url: 'https://x.com/i/status/222',
    };
    await store.appendLedger(newer);
    const ledger = await store.loadLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.url).toBe(newer.url);
    expect(ledger[0]?.supersedes).toEqual({ url: sampleEntry.url, postedAt: sampleEntry.postedAt });
  });

  // One level only: a third repost records the second, not the first. That is the
  // deliberate ceiling — a full chain would need a recursive schema for an audit
  // case nobody has hit. Upgrade to a nested `supersedes` if a real trail is needed.
  it('records the immediately superseded publication on every repost', async () => {
    await store.appendLedger(sampleEntry);
    await store.appendLedger({ ...sampleEntry, postedAt: '2026-09-02T00:00:00.000Z', url: 'https://x.com/i/status/222' });
    await store.appendLedger({ ...sampleEntry, postedAt: '2026-09-03T00:00:00.000Z', url: 'https://x.com/i/status/333' });
    const ledger = await store.loadLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.url).toBe('https://x.com/i/status/333');
    expect(ledger[0]?.supersedes?.url).toBe('https://x.com/i/status/222');
  });

  it('round-trips a draft through save and reload', async () => {
    await store.saveDraft({
      platform: 'hackernews',
      status: 'draft',
      title: 'Show HN: Demo App',
      url: 'https://demoapp.io',
    });
    const draft = await store.loadDraft('hackernews');
    expect(draft?.platform).toBe('hackernews');
    expect(store.loadDraft('x')).resolves.toBeUndefined();
  });
});
