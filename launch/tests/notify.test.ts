import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runNotify, type NotifyPayload } from '../src/commands/notify.js';
import { emailHtmlTemplate } from '../src/comms/templates.js';
import { validateDraft } from '../src/copy/validate.js';
import { LaunchStore } from '../src/state.js';
import type { Draft, LaunchConfig } from '../src/types.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'demo-app');

const config: LaunchConfig = {
  name: 'DemoApp',
  tagline: 'Uptime monitoring for solo devs',
  description: 'desc',
  domain: 'demoapp.io',
  productUrl: 'https://demoapp.io',
  pricing: '$9/mo',
  stack: [],
};

const filledEmail: Draft = {
  platform: 'email',
  status: 'filled',
  subject: 'DemoApp is live — uptime monitoring for solo devs',
  html: emailHtmlTemplate(config, '<p>DemoApp is live today. Set up your first monitor in under a minute.</p>').replace(
    '{{unsubscribeUrl}}',
    'https://demoapp.io/unsubscribe',
  ),
  text: 'DemoApp is live. https://demoapp.io — Unsubscribe: https://demoapp.io/unsubscribe',
};

const filledSms: Draft = {
  platform: 'sms',
  status: 'filled',
  body: 'DemoApp is live: uptime alerts for solo devs. https://demoapp.io',
};

const contacts = {
  email: [
    { address: 'yes@example.com', consent: true },
    { address: 'no@example.com', consent: false },
    { address: 'also-no@example.com', consent: false },
  ],
  sms: [
    { number: '+15551230001', consent: true },
    { number: '+15551230002', consent: false },
  ],
};

describe('emailHtmlTemplate', () => {
  it('renders valid balanced HTML with unsubscribe slot and product link', () => {
    const html = emailHtmlTemplate(config, '<p>body</p>');
    expect(html).toContain('{{unsubscribeUrl}}');
    expect(html).toContain('https://demoapp.io');
    expect(html).toContain('<h1');
    // basic tag-balance check for the structural tags
    for (const tag of ['html', 'body', 'table', 'td', 'tr', 'a', 'h1', 'p']) {
      const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
      const close = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      expect(open, `unbalanced <${tag}>`).toBe(close);
    }
  });
});

describe('runNotify', () => {
  let target: string;
  let store: LaunchStore;

  beforeEach(async () => {
    target = await mkdtemp(join(tmpdir(), 'launch-notify-test-'));
    await cp(FIXTURE, target, {
      recursive: true,
      filter: (src) => !src.includes('.launch'),
    });
    await runInit(target, { domain: 'demoapp.io', price: '$9/mo', force: true });
    store = new LaunchStore(target);
    await store.saveDraft(filledEmail);
    await store.saveDraft(filledSms);
    await writeFile(store.contactsPath, JSON.stringify(contacts), 'utf8');
  });

  afterEach(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it('renders email.html with unsubscribe + product link and writes payloads', async () => {
    const result = await runNotify(target, { channel: 'email' });
    expect(result.exitCode).toBe(0);
    const html = await readFile(join(store.outDir, 'email.html'), 'utf8');
    expect(html).toContain('Unsubscribe');
    expect(html).toContain('https://demoapp.io');
    expect(existsSync(join(store.outDir, 'email.txt'))).toBe(true);
  });

  it('email payload key set exactly matches send_resend_email inputs', async () => {
    await runNotify(target, { channel: 'email' });
    const payloads = JSON.parse(
      await readFile(join(store.outDir, 'notify-payloads.json'), 'utf8'),
    ) as NotifyPayload[];
    expect(payloads).toHaveLength(1); // only the consented contact
    expect(payloads[0]?.tool).toBe('send_resend_email');
    expect(Object.keys(payloads[0]!.input).sort()).toEqual([
      'environment',
      'from',
      'html',
      'subject',
      'text',
      'to',
    ]);
    // send_resend_email takes `to` as an array (min 1) and requires `environment`.
    expect((payloads[0]!.input as { to: string[] }).to).toEqual(['yes@example.com']);
    expect((payloads[0]!.input as { environment: string }).environment).toBe('production');
    expect((payloads[0]!.input as { from: string }).from).toBe('launch@demoapp.io');
  });

  it('sms payload key set exactly matches send_twilio_sms inputs', async () => {
    await runNotify(target, { channel: 'sms' });
    const payloads = JSON.parse(
      await readFile(join(store.outDir, 'notify-payloads.json'), 'utf8'),
    ) as NotifyPayload[];
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.tool).toBe('send_twilio_sms');
    expect(Object.keys(payloads[0]!.input).sort()).toEqual(['body', 'environment', 'to']);
    // send_twilio_sms takes a bare E.164 string for `to` (unlike Resend) and requires `environment`.
    expect((payloads[0]!.input as { to: string }).to).toBe('+15551230001');
    expect((payloads[0]!.input as { environment: string }).environment).toBe('production');
  });

  // F8: `environment` is a per-project REGISTERED identifier in offlocal's
  // send_resend_email / send_twilio_sms schemas, not a free-form label. A project
  // whose environments are named prod/staging had no way to say so.
  it('--environment overrides the stamped environment on email payloads', async () => {
    await runNotify(target, { channel: 'email', environment: 'staging' });
    const payloads = JSON.parse(
      await readFile(join(store.outDir, 'notify-payloads.json'), 'utf8'),
    ) as NotifyPayload[];
    expect((payloads[0]!.input as { environment: string }).environment).toBe('staging');
  });

  it('--environment overrides the stamped environment on sms payloads', async () => {
    await runNotify(target, { channel: 'sms', environment: 'prod' });
    const payloads = JSON.parse(
      await readFile(join(store.outDir, 'notify-payloads.json'), 'utf8'),
    ) as NotifyPayload[];
    expect((payloads[0]!.input as { environment: string }).environment).toBe('prod');
  });

  it('reports the excluded non-consented count', async () => {
    const result = await runNotify(target, { channel: 'email' });
    expect(result.messages.join('\n')).toContain('1 consented recipient(s), 2 excluded (no consent)');
  });

  it('zero consented contacts → exit 0 with nothing-to-send notice', async () => {
    await writeFile(
      store.contactsPath,
      JSON.stringify({ email: [{ address: 'no@example.com', consent: false }], sms: [] }),
      'utf8',
    );
    const result = await runNotify(target, { channel: 'email' });
    expect(result.exitCode).toBe(0);
    expect(result.messages.join('\n')).toContain('Nothing to send');
  });

  it('refuses an SMS draft over 160 GSM chars', async () => {
    await store.saveDraft({ platform: 'sms', status: 'filled', body: 'a'.repeat(161) });
    const result = await runNotify(target, { channel: 'sms' });
    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('sms-gsm-length');
  });

  it('missing contacts file → exit 1 naming the path and format', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'launch-notify-bare-'));
    try {
      await cp(FIXTURE, bare, { recursive: true, filter: (src) => !src.includes('.launch') });
      await runInit(bare, { domain: 'demoapp.io', price: '$9/mo', force: true });
      const result = await runNotify(bare, { channel: 'email' });
      expect(result.exitCode).toBe(1);
      expect(result.messages.join('\n')).toContain('contacts.json');
      expect(result.messages.join('\n')).toContain('"consent"');
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it('filled scaffold email passes the validator (template self-consistency)', () => {
    const { errors } = validateDraft(filledEmail, { productUrl: config.productUrl });
    expect(errors).toHaveLength(0);
  });
});
