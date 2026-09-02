import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { LaunchStore } from '../state.js';
import { DRAFT_PLATFORMS, PLATFORMS } from '../types.js';
import { isStale, parseBriefMeta } from '../research/brief.js';

export interface StatusResult {
  exitCode: number;
  messages: string[];
  /** Structured view — additive, consumed by the dashboard. */
  posted?: { platform: string; postedAt: string; url?: string }[];
  drafts?: { platform: string; status: string }[];
  briefs?: { platform: string; state: 'fresh' | 'stale' | 'missing' }[];
  remaining?: string[];
}

/** Core of `launch status` — testable without spawning the CLI. */
export async function runStatus(dir: string): Promise<StatusResult> {
  const targetDir = resolve(dir);
  if (!existsSync(targetDir)) {
    return { exitCode: 1, messages: [`Target directory not found: ${targetDir}`] };
  }
  const store = new LaunchStore(targetDir);
  if (!store.hasConfig()) {
    return { exitCode: 1, messages: [`No launch config at ${store.configPath} — run \`launch init\` first.`] };
  }

  const config = await store.loadConfig();
  const ledger = await store.loadLedger();
  const messages: string[] = [];

  messages.push(`# ${config.name} — launch status`);
  messages.push('');
  messages.push(`config:   ${config.domain} → ${config.productUrl} (${config.pricing})`);

  // Research briefs
  const staleOrMissing: string[] = [];
  const briefStates: { platform: string; state: 'fresh' | 'stale' | 'missing' }[] = [];
  let fresh = 0;
  for (const platform of PLATFORMS) {
    const briefPath = join(store.researchDir, `${platform}.md`);
    if (!existsSync(briefPath)) {
      staleOrMissing.push(`${platform} (missing)`);
      briefStates.push({ platform, state: 'missing' });
      continue;
    }
    const meta = parseBriefMeta(await readFile(briefPath, 'utf8'));
    if (!meta || isStale(meta, new Date())) {
      staleOrMissing.push(`${platform} (stale)`);
      briefStates.push({ platform, state: 'stale' });
    } else {
      fresh++;
      briefStates.push({ platform, state: 'fresh' });
    }
  }
  messages.push(
    `research: ${fresh}/${PLATFORMS.length} briefs fresh` +
      (staleOrMissing.length > 0 ? ` — needs attention: ${staleOrMissing.join(', ')}` : ''),
  );

  // Drafts
  const draftStates: { platform: string; status: string }[] = [];
  messages.push('drafts:');
  for (const platform of DRAFT_PLATFORMS) {
    const draft = await store.loadDraft(platform);
    draftStates.push({ platform, status: draft ? draft.status : 'missing' });
    messages.push(`  ${platform.padEnd(12)} ${draft ? draft.status : 'missing'}`);
  }

  // Ledger
  messages.push('posted (ledger):');
  if (ledger.length === 0) {
    messages.push('  (nothing posted yet)');
  } else {
    for (const entry of ledger) {
      messages.push(`  ${entry.platform.padEnd(12)} ${entry.postedAt}  ${entry.url ?? ''}`);
    }
  }

  // Remaining steps
  const posted = new Set(ledger.map((e) => e.platform));
  const remaining: string[] = [];
  if (staleOrMissing.length > 0) remaining.push('launch research (refresh briefs)');
  for (const platform of DRAFT_PLATFORMS) {
    const draft = await store.loadDraft(platform);
    if (!draft) remaining.push(`launch copy --scaffold (${platform} draft missing)`);
    else if (draft.status === 'draft') remaining.push(`fill + validate the ${platform} draft`);
  }
  for (const platform of ['x', 'facebook', 'linkedin', 'reddit', 'hackernews', 'producthunt', 'google']) {
    if (!posted.has(platform as (typeof PLATFORMS)[number])) remaining.push(`launch post --platform ${platform}`);
  }
  if (!existsSync(join(store.outDir, 'notify-payloads.json'))) {
    remaining.push('launch notify --channel email / sms');
  }
  messages.push('remaining steps:');
  messages.push(...(remaining.length > 0 ? remaining.map((r) => `  - ${r}`) : ['  (launch complete)']));

  return {
    exitCode: 0,
    messages,
    posted: ledger.map((e) => ({ platform: e.platform, postedAt: e.postedAt, url: e.url })),
    drafts: draftStates,
    briefs: briefStates,
    remaining,
  };
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show launch progress: config, brief freshness, draft states, posted-ledger, remaining steps')
    .argument('<dir>', 'target project directory')
    .action(async (dir: string) => {
      const result = await runStatus(dir);
      const out = result.exitCode === 0 ? console.log : console.error;
      for (const message of result.messages) out(message);
      process.exitCode = result.exitCode;
    });
}
