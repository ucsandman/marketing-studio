/**
 * `launch notify` — renders announcement email/SMS artifacts and DashClaw-ready
 * payload JSON. This module has NO network code by design: the CLI never
 * sends; the /launch skill passes the payloads to the offlocal MCP tools
 * (send_resend_email / send_twilio_sms).
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { LaunchStore } from '../state.js';
import { validateDraft } from '../copy/validate.js';

export interface NotifyOptions {
  channel?: string;
  dryRun?: boolean;
  /** offlocal environment id/name every payload targets (default 'production'). */
  environment?: string;
  /** UI preview mode: compute everything, write NO files (artifacts or payloads). */
  preview?: boolean;
}

/** Per-channel consent split — additive, consumed by the UI. */
export interface NotifyConsent {
  consented: { to: string; name?: string }[];
  excluded: { to: string; name?: string }[];
}

export interface NotifyResult {
  exitCode: number;
  messages: string[];
  consent?: NotifyConsent;
  payloadCount?: number;
  payloadsPath?: string;
}

/**
 * Fallback environment. offlocal's send_resend_email / send_twilio_sms take
 * `environment` as a REGISTERED per-project id or name, not a free-form label,
 * so a project whose environments are called prod/staging needs --environment.
 */
const DEFAULT_ENVIRONMENT = 'production';

/** Keys EXACTLY match the offlocal tool input schemas (src/tools/index.ts). */
export interface ResendEmailPayload {
  environment: string;
  from: string;
  /** send_resend_email takes an array of recipients (min 1). */
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export interface TwilioSmsPayload {
  environment: string;
  /** send_twilio_sms takes a single E.164 string, not an array. */
  to: string;
  body: string;
}

export type NotifyPayload =
  | { tool: 'send_resend_email'; input: ResendEmailPayload }
  | { tool: 'send_twilio_sms'; input: TwilioSmsPayload };

/** Core of `launch notify` — testable without spawning the CLI. */
export async function runNotify(dir: string, opts: NotifyOptions): Promise<NotifyResult> {
  const targetDir = resolve(dir);
  if (!existsSync(targetDir)) {
    return { exitCode: 1, messages: [`Target directory not found: ${targetDir}`] };
  }
  if (opts.channel !== 'email' && opts.channel !== 'sms') {
    return { exitCode: 1, messages: ['Pass --channel email or --channel sms.'] };
  }
  const store = new LaunchStore(targetDir);
  if (!store.hasConfig()) {
    return { exitCode: 1, messages: [`No launch config at ${store.configPath} — run \`launch init\` first.`] };
  }
  if (!store.hasContacts()) {
    return {
      exitCode: 1,
      messages: [
        `No contacts file at ${store.contactsPath}.`,
        'Expected format: {"email":[{"address":"a@b.c","consent":true}],"sms":[{"number":"+15551234567","consent":true}]}',
      ],
    };
  }

  const config = await store.loadConfig();
  const contacts = await store.loadContacts();
  const environment = opts.environment ?? DEFAULT_ENVIRONMENT;
  const messages: string[] = [];

  const draftPlatform = opts.channel === 'email' ? ('email' as const) : ('sms' as const);
  const draft = await store.loadDraft(draftPlatform);
  if (!draft) {
    return { exitCode: 1, messages: [`No ${draftPlatform} draft — run \`launch copy --scaffold\` and fill it.`] };
  }
  const { errors } = validateDraft(draft, { productUrl: config.productUrl });
  if (errors.length > 0) {
    return {
      exitCode: 1,
      messages: [`${draftPlatform} draft fails validation: ${errors.map((e) => e.rule).join(', ')}. Run \`launch copy --validate\`.`],
    };
  }

  if (!opts.preview) await store.ensureDirs();
  const payloads: NotifyPayload[] = [];
  let consent: NotifyConsent | undefined;

  if (opts.channel === 'email' && draft.platform === 'email') {
    const consented = contacts.email.filter((c) => c.consent === true);
    const excluded = contacts.email.filter((c) => c.consent !== true);
    consent = {
      consented: consented.map((c) => ({ to: c.address, name: c.name })),
      excluded: excluded.map((c) => ({ to: c.address, name: c.name })),
    };
    messages.push(`email: ${consented.length} consented recipient(s), ${excluded.length} excluded (no consent).`);

    if (!opts.preview) {
      await writeFile(join(store.outDir, 'email.html'), draft.html, 'utf8');
      await writeFile(join(store.outDir, 'email.txt'), draft.text, 'utf8');
      messages.push(`email: rendered ${join(store.outDir, 'email.html')} and email.txt`);
    }

    const from = config.emailFrom ?? `launch@${config.domain}`;
    for (const contact of consented) {
      payloads.push({
        tool: 'send_resend_email',
        input: {
          environment,
          from,
          to: [contact.address],
          subject: draft.subject,
          html: draft.html,
          text: draft.text,
        },
      });
    }
  }

  if (opts.channel === 'sms' && draft.platform === 'sms') {
    const consented = contacts.sms.filter((c) => c.consent === true);
    const excluded = contacts.sms.filter((c) => c.consent !== true);
    consent = {
      consented: consented.map((c) => ({ to: c.number, name: c.name })),
      excluded: excluded.map((c) => ({ to: c.number, name: c.name })),
    };
    messages.push(`sms: ${consented.length} consented recipient(s), ${excluded.length} excluded (no consent).`);

    if (!opts.preview) {
      await writeFile(join(store.outDir, 'sms.txt'), draft.body, 'utf8');
      messages.push(`sms: rendered ${join(store.outDir, 'sms.txt')}`);
    }

    for (const contact of consented) {
      payloads.push({
        tool: 'send_twilio_sms',
        input: { environment, to: contact.number, body: draft.body },
      });
    }
  }

  if (payloads.length === 0) {
    messages.push('Nothing to send — zero consented contacts for this channel.');
    return { exitCode: 0, messages, consent, payloadCount: 0 };
  }

  if (opts.preview) {
    messages.push(`preview: ${payloads.length} ${opts.channel} payload(s) would be written — nothing written.`);
    return { exitCode: 0, messages, consent, payloadCount: payloads.length };
  }

  // Merge with the other channel's payloads: replace this channel's tool entries only.
  const payloadsPath = join(store.outDir, 'notify-payloads.json');
  const currentTool = opts.channel === 'email' ? 'send_resend_email' : 'send_twilio_sms';
  let existing: NotifyPayload[] = [];
  if (existsSync(payloadsPath)) {
    try {
      existing = (JSON.parse(await readFile(payloadsPath, 'utf8')) as NotifyPayload[]).filter(
        (p) => p.tool !== currentTool,
      );
    } catch {
      existing = []; // unreadable previous file: regenerate from scratch
    }
  }
  const merged = [...existing, ...payloads];
  await writeFile(payloadsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  messages.push(
    `Wrote ${payloads.length} ${opts.channel} payload(s) to ${payloadsPath} (${merged.length} total) — the CLI never sends; pass these to DashClaw.`,
  );

  return { exitCode: 0, messages, consent, payloadCount: payloads.length, payloadsPath };
}

export function registerNotify(program: Command): void {
  program
    .command('notify')
    .description('Render launch announcement artifacts + DashClaw-ready payloads (never sends)')
    .argument('<dir>', 'target project directory')
    .option('--channel <channel>', 'email or sms')
    .option('--dry-run', 'explicitly dry — identical behavior; this command never sends anything')
    .option('--environment <name>', 'offlocal environment id/name stamped on every payload', 'production')
    .action(async (dir: string, opts: NotifyOptions) => {
      const result = await runNotify(dir, opts);
      const out = result.exitCode === 0 ? console.log : console.error;
      for (const message of result.messages) out(message);
      process.exitCode = result.exitCode;
    });
}
