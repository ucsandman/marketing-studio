import { cp, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runCopy } from '../src/commands/copy.js';
import { gsmLength, validateDraft } from '../src/copy/validate.js';
import { scaffoldDrafts } from '../src/copy/templates.js';
import { LaunchStore } from '../src/state.js';
import { DRAFT_PLATFORMS, type Draft, type LaunchConfig } from '../src/types.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'demo-app');

const config: LaunchConfig = {
  name: 'DemoApp',
  tagline: 'Uptime monitoring for solo devs',
  description: 'Watches endpoints and alerts before users notice.',
  domain: 'demoapp.io',
  productUrl: 'https://demoapp.io',
  pricing: '$9/mo',
  audience: 'solo developers',
  stack: ['express'],
};

function rules(draft: Draft): string[] {
  const { errors, warnings } = validateDraft(draft, { productUrl: config.productUrl });
  return [...errors, ...warnings].map((v) => v.rule);
}

describe('validateDraft rules', () => {
  it('x: post over 280 chars is an error', () => {
    const draft: Draft = { platform: 'x', status: 'filled', thread: ['a'.repeat(281)] };
    expect(rules(draft)).toContain('x-post-length');
  });

  it('x: URL in first post is a WARNING citing the $0.20 surcharge', () => {
    const draft: Draft = {
      platform: 'x',
      status: 'filled',
      thread: ['Check out https://demoapp.io now'],
    };
    const { errors, warnings } = validateDraft(draft);
    expect(errors.map((e) => e.rule)).not.toContain('x-url-first-post');
    const w = warnings.find((v) => v.rule === 'x-url-first-post');
    expect(w).toBeDefined();
    expect(w?.message).toContain('$0.20');
  });

  it('x: clean thread passes', () => {
    const draft: Draft = {
      platform: 'x',
      status: 'filled',
      thread: ['Solid hook', 'Value post'],
      replyWithLink: 'Try it → https://demoapp.io',
    };
    const { errors, warnings } = validateDraft(draft);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('hackernews: missing "Show HN: " prefix is an error', () => {
    const draft: Draft = {
      platform: 'hackernews',
      status: 'filled',
      title: 'DemoApp – uptime monitoring',
      url: 'https://demoapp.io',
      makerComment: 'Maker context here.',
    };
    expect(rules(draft)).toContain('hn-title-prefix');
  });

  it('hackernews: title over 80 chars is an error', () => {
    const draft: Draft = {
      platform: 'hackernews',
      status: 'filled',
      title: `Show HN: ${'x'.repeat(80)}`,
      url: 'https://demoapp.io',
      makerComment: 'Context.',
    };
    expect(rules(draft)).toContain('hn-title-length');
  });

  it('hackernews: URL submission without maker comment is an error', () => {
    const draft: Draft = {
      platform: 'hackernews',
      status: 'filled',
      title: 'Show HN: DemoApp – uptime monitoring',
      url: 'https://demoapp.io',
    };
    expect(rules(draft)).toContain('hn-maker-comment');
  });

  it('linkedin: URL in body is a warning naming the reach penalty', () => {
    const draft: Draft = {
      platform: 'linkedin',
      status: 'filled',
      body: 'I built a thing: https://demoapp.io',
      firstComment: 'link here too',
    };
    const { warnings } = validateDraft(draft);
    const w = warnings.find((v) => v.rule === 'linkedin-link-in-body');
    expect(w?.message).toContain('18.8%');
  });

  it('reddit: empty sub and over-long title are errors', () => {
    const draft: Draft = {
      platform: 'reddit',
      status: 'filled',
      posts: [{ sub: ' ', title: 'y'.repeat(301), body: 'unique body' }],
    };
    const r = rules(draft);
    expect(r).toContain('reddit-sub-required');
    expect(r).toContain('reddit-title-length');
  });

  it('reddit: identical body across subs is a spam warning', () => {
    const draft: Draft = {
      platform: 'reddit',
      status: 'filled',
      posts: [
        { sub: 'SideProject', title: 'I built DemoApp', body: 'same body' },
        { sub: 'IMadeThis', title: 'DemoApp launch', body: 'same body' },
      ],
    };
    const { warnings } = validateDraft(draft);
    expect(warnings.map((w) => w.rule)).toContain('reddit-duplicate-body');
  });

  it('producthunt: tagline over 60 chars and bad topic count are errors', () => {
    const draft: Draft = {
      platform: 'producthunt',
      status: 'filled',
      tagline: 't'.repeat(61),
      description: 'desc',
      topics: [],
    };
    const r = rules(draft);
    expect(r).toContain('ph-tagline-length');
    expect(r).toContain('ph-topics-count');
  });

  it('email: long subject, missing unsubscribe, missing product link are errors', () => {
    const draft: Draft = {
      platform: 'email',
      status: 'filled',
      subject: 's'.repeat(79),
      html: '<html><body><p>hello</p></body></html>',
      text: 'hello',
    };
    const r = rules(draft);
    expect(r).toContain('email-subject-length');
    expect(r).toContain('email-unsubscribe');
    expect(r).toContain('email-product-link');
  });

  it('sms: GSM-7 length over 160 is an error, extended chars count double', () => {
    expect(gsmLength('abc')).toBe(3);
    expect(gsmLength('€')).toBe(2); // extended charset
    const ok: Draft = { platform: 'sms', status: 'filled', body: 'a'.repeat(160) };
    expect(validateDraft(ok).errors).toHaveLength(0);
    const over: Draft = { platform: 'sms', status: 'filled', body: '€'.repeat(81) }; // 162 septets
    expect(rules(over)).toContain('sms-gsm-length');
  });

  it('any platform: unfilled {{placeholder}} is an error naming the field', () => {
    const draft: Draft = {
      platform: 'facebook',
      status: 'draft',
      message: 'DemoApp is live {{fill me}}',
      link: 'https://demoapp.io',
    };
    const { errors } = validateDraft(draft);
    const e = errors.find((v) => v.rule === 'unfilled-placeholder');
    expect(e?.field).toBe('message');
  });
});

describe('scaffoldDrafts', () => {
  it('produces one draft per draft platform with placeholders and no lorem ipsum', () => {
    const drafts = scaffoldDrafts(config);
    expect(drafts.map((d) => d.platform).sort()).toEqual([...DRAFT_PLATFORMS].sort());
    const json = JSON.stringify(drafts);
    expect(json).toContain('{{');
    expect(json.toLowerCase()).not.toContain('lorem');
    const x = drafts.find((d) => d.platform === 'x');
    if (x?.platform !== 'x') throw new Error('x draft missing');
    expect(x.thread[0]).not.toMatch(/https?:\/\//); // first post has no URL slot
    const hn = drafts.find((d) => d.platform === 'hackernews');
    if (hn?.platform !== 'hackernews') throw new Error('hn draft missing');
    expect(hn.title.startsWith('Show HN: ')).toBe(true);
  });
});

describe('runCopy', () => {
  let target: string;
  let store: LaunchStore;

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'launch-copy-test-'));
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

  it('--scaffold writes a draft file per platform', async () => {
    const result = await runCopy(target, { scaffold: true });
    expect(result.exitCode).toBe(0);
    for (const platform of DRAFT_PLATFORMS) {
      expect(existsSync(store.draftPath(platform)), `${platform}.json missing`).toBe(true);
    }
  });

  it('--scaffold keeps filled drafts unless --force', async () => {
    await runCopy(target, { scaffold: true });
    const filled: Draft = {
      platform: 'x',
      status: 'filled',
      thread: ['My hand-written hook'],
    };
    await store.saveDraft(filled);
    await runCopy(target, { scaffold: true });
    let x = await store.loadDraft('x');
    if (x?.platform !== 'x') throw new Error('x draft missing');
    expect(x.thread[0]).toBe('My hand-written hook');
    await runCopy(target, { scaffold: true, force: true });
    x = await store.loadDraft('x');
    if (x?.platform !== 'x') throw new Error('x draft missing');
    expect(x.thread[0]).toContain('{{');
  });

  it('--validate exits 1 on fresh scaffolds (placeholders) naming rule+platform+field', async () => {
    await runCopy(target, { scaffold: true });
    const result = await runCopy(target, { validate: true });
    expect(result.exitCode).toBe(1);
    const text = result.messages.join('\n');
    expect(text).toContain('[ERROR]');
    expect(text).toContain('unfilled-placeholder');
    expect(text).toMatch(/x\.thread\[0\]/);
  });

  it('--validate exits 0 once drafts are filled validly', async () => {
    await runCopy(target, { scaffold: true });
    const valid: Draft[] = [
      { platform: 'x', status: 'filled', thread: ['Hook'], replyWithLink: 'https://demoapp.io' },
      { platform: 'facebook', status: 'filled', message: 'DemoApp is live.', link: 'https://demoapp.io' },
      { platform: 'linkedin', status: 'filled', body: 'Story. Link in first comment.', firstComment: 'https://demoapp.io' },
      { platform: 'reddit', status: 'filled', posts: [{ sub: 'SideProject', title: 'I built DemoApp', body: 'Maker story.' }] },
      { platform: 'hackernews', status: 'filled', title: 'Show HN: DemoApp – uptime monitoring', url: 'https://demoapp.io', makerComment: 'Context.' },
      { platform: 'producthunt', status: 'filled', tagline: 'Uptime monitoring for solo devs', description: 'Full description.', topics: ['Developer Tools'], firstComment: 'Maker comment.', galleryNotes: 'Hero done.' },
      { platform: 'email', status: 'filled', subject: 'DemoApp is live', html: '<p><a href="https://demoapp.io">Try</a></p><p><a href="https://demoapp.io/u">Unsubscribe</a></p>', text: 'DemoApp is live. https://demoapp.io' },
      { platform: 'sms', status: 'filled', body: 'DemoApp is live: https://demoapp.io' },
    ];
    for (const d of valid) await store.saveDraft(d);
    const result = await runCopy(target, { validate: true });
    expect(result.exitCode).toBe(0);
    expect(result.messages.join('\n')).toContain('Validation passed');
  });
});
