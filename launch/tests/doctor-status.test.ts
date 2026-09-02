import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { runStatus } from '../src/commands/status.js';
import { runInit } from '../src/commands/init.js';
import { runCopy } from '../src/commands/copy.js';
import { buildProviders } from '../src/providers/index.js';
import { LaunchStore } from '../src/state.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'demo-app');

describe('runDoctor', () => {
  it('with zero creds: every API provider blocked with a hint, both assist providers ready, exit 0', async () => {
    const providers = buildProviders({} as NodeJS.ProcessEnv);
    const result = await runDoctor({ providers });
    expect(result.exitCode).toBe(0);

    const byName = Object.fromEntries(result.rows.map((r) => [r.provider, r]));
    for (const api of ['x', 'facebook', 'linkedin', 'reddit', 'google']) {
      expect(byName[api]?.mode, `${api} should be blocked`).toBe('blocked');
      expect(byName[api]?.fixHint, `${api} needs a fix hint`).toBeTruthy();
    }
    for (const assist of ['hackernews', 'producthunt']) {
      expect(byName[assist]?.mode, `${assist} should be assist`).toBe('assist');
      expect(byName[assist]?.fixHint).toBeUndefined();
    }
    expect(result.messages.join('\n')).toContain('provider');
  });
});

describe('runStatus', () => {
  let target: string;
  let store: LaunchStore;

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'launch-status-test-'));
    await cp(FIXTURE, target, {
      recursive: true,
      filter: (src) => !src.includes('.launch'),
    });
    await runInit(target, { domain: 'demoapp.io', price: '$9/mo', force: true });
    await runCopy(target, { scaffold: true });
    store = new LaunchStore(target);
    await store.appendLedger({
      platform: 'x',
      idempotencyKey: 'x:demoapp.io',
      postedAt: '2026-06-12T15:00:00.000Z',
      url: 'https://x.com/i/status/123',
    });
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it('renders config, draft states, ledger entries, and remaining steps', async () => {
    const result = await runStatus(target);
    expect(result.exitCode).toBe(0);
    const text = result.messages.join('\n');
    expect(text).toContain('demoapp.io → https://demoapp.io');
    expect(text).toContain('x.com/i/status/123'); // ledger entry with URL
    expect(text).toMatch(/x\s+draft/); // draft states listed
    expect(text).toContain('launch post --platform facebook'); // remaining
    expect(text).not.toContain('launch post --platform x\n'); // x already posted
    expect(text).toContain('launch research'); // briefs missing → refresh step
  });

  it('errors cleanly without a config', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'launch-status-bare-'));
    try {
      const result = await runStatus(bare);
      expect(result.exitCode).toBe(1);
      expect(result.messages.join('\n')).toContain('launch init');
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});
