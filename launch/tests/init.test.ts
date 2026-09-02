import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { scanTarget } from '../src/intake.js';
import { LaunchStore } from '../src/state.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'demo-app');

describe('scanTarget', () => {
  it('extracts name and description from the fixture package.json and tagline from README', async () => {
    const { scanned, missing } = await scanTarget(FIXTURE);
    expect(scanned.name).toBe('demo-app');
    expect(scanned.description).toBe(
      'Uptime monitor for solo developers — get pinged before your users do.',
    );
    expect(scanned.tagline).toBe('DemoApp — uptime monitoring for solo devs');
    expect(scanned.stack).toContain('express');
    expect(missing).toContain('domain');
    expect(missing).toContain('pricing');
  });
});

describe('runInit', () => {
  let target: string;

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'launch-init-test-'));
    // Exclude any .launch state left in the fixture by manual CLI runs.
    await cp(FIXTURE, target, {
      recursive: true,
      filter: (src) => !src.includes('.launch'),
    });
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it('writes a zod-valid config from scanned values plus flags', async () => {
    const result = await runInit(target, { domain: 'demoapp.io', price: '$9/mo' });
    expect(result.exitCode).toBe(0);
    expect(result.config?.name).toBe('demo-app');
    expect(result.config?.domain).toBe('demoapp.io');
    expect(result.config?.pricing).toBe('$9/mo');
    expect(result.config?.productUrl).toBe('https://demoapp.io');
    const saved = await new LaunchStore(target).loadConfig();
    expect(saved).toEqual(result.config);
  });

  it('lets flags override scanned values', async () => {
    const result = await runInit(target, {
      domain: 'demoapp.io',
      price: 'free',
      name: 'DemoApp Pro',
      tagline: 'Custom tagline',
    });
    expect(result.exitCode).toBe(0);
    expect(result.config?.name).toBe('DemoApp Pro');
    expect(result.config?.tagline).toBe('Custom tagline');
  });

  it('exits 1 naming the path for a nonexistent target dir', async () => {
    const bogus = join(target, 'does-not-exist');
    const result = await runInit(bogus, { domain: 'x.io', price: 'free' });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain(bogus);
  });

  it('exits 1 listing missing fields when flags cannot complete the config', async () => {
    const result = await runInit(target, {});
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('domain');
    expect(result.message).toContain('pricing');
  });

  it('is idempotent: re-run without --force keeps the existing config', async () => {
    await runInit(target, { domain: 'demoapp.io', price: '$9/mo' });
    const rerun = await runInit(target, { domain: 'other.io', price: '$99/mo' });
    expect(rerun.exitCode).toBe(0);
    expect(rerun.message).toContain('--force');
    const saved = await new LaunchStore(target).loadConfig();
    expect(saved.domain).toBe('demoapp.io');
  });

  it('overwrites with --force', async () => {
    await runInit(target, { domain: 'demoapp.io', price: '$9/mo' });
    const rerun = await runInit(target, { domain: 'other.io', price: '$99/mo', force: true });
    expect(rerun.exitCode).toBe(0);
    const saved = await new LaunchStore(target).loadConfig();
    expect(saved.domain).toBe('other.io');
  });
});
