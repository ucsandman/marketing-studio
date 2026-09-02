import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { LaunchStore } from '../state.js';
import { DRAFT_PLATFORMS } from '../types.js';
import { scaffoldDrafts } from '../copy/templates.js';
import { validateDraft, type RuleViolation } from '../copy/validate.js';

export interface CopyOptions {
  scaffold?: boolean;
  validate?: boolean;
  force?: boolean;
}

export interface CopyResult {
  exitCode: number;
  messages: string[];
}

function formatViolation(v: RuleViolation): string {
  return `[${v.severity.toUpperCase()}] ${v.platform}.${v.field} (${v.rule}): ${v.message}`;
}

/** Core of `launch copy` — testable without spawning the CLI. */
export async function runCopy(dir: string, opts: CopyOptions): Promise<CopyResult> {
  const targetDir = resolve(dir);
  if (!existsSync(targetDir)) {
    return { exitCode: 1, messages: [`Target directory not found: ${targetDir}`] };
  }
  const store = new LaunchStore(targetDir);
  if (!store.hasConfig()) {
    return {
      exitCode: 1,
      messages: [`No launch config at ${store.configPath} — run \`launch init\` first.`],
    };
  }
  if (!opts.scaffold && !opts.validate) {
    return { exitCode: 1, messages: ['Pass --scaffold or --validate.'] };
  }

  const config = await store.loadConfig();
  const messages: string[] = [];

  if (opts.scaffold) {
    for (const draft of scaffoldDrafts(config)) {
      const existing = await store.loadDraft(draft.platform);
      if (existing && existing.status !== 'draft' && !opts.force) {
        messages.push(`${draft.platform}: kept (status ${existing.status}) — use --force to re-scaffold`);
        continue;
      }
      await store.saveDraft(draft);
      messages.push(`${draft.platform}: scaffolded ${store.draftPath(draft.platform)}`);
    }
  }

  if (opts.validate) {
    let errorCount = 0;
    let checked = 0;
    for (const platform of DRAFT_PLATFORMS) {
      const draft = await store.loadDraft(platform);
      if (!draft) continue;
      checked++;
      const { errors, warnings } = validateDraft(draft, { productUrl: config.productUrl });
      for (const w of warnings) messages.push(formatViolation(w));
      for (const e of errors) messages.push(formatViolation(e));
      errorCount += errors.length;
    }
    if (checked === 0) {
      return { exitCode: 1, messages: ['No drafts found — run `launch copy --scaffold` first.'] };
    }
    messages.push(
      errorCount === 0
        ? `Validation passed: ${checked} drafts, 0 errors.`
        : `Validation failed: ${errorCount} error(s) across ${checked} drafts.`,
    );
    if (errorCount > 0) return { exitCode: 1, messages };
  }

  return { exitCode: 0, messages };
}

export function registerCopy(program: Command): void {
  program
    .command('copy')
    .description('Scaffold and validate per-platform launch drafts in <dir>/.launch/drafts/')
    .argument('<dir>', 'target project directory (must have launch.config.json)')
    .option('--scaffold', 'write draft skeletons with {{placeholder}} slots')
    .option('--validate', 'check drafts against platform hard rules (exit 1 on errors)')
    .option('--force', 'overwrite drafts that are already filled')
    .action(async (dir: string, opts: CopyOptions) => {
      const result = await runCopy(dir, opts);
      const out = result.exitCode === 0 ? console.log : console.error;
      for (const message of result.messages) out(message);
      process.exitCode = result.exitCode;
    });
}
