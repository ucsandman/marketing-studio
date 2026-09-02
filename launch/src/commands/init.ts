import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { scanTarget } from '../intake.js';
import { LaunchStore } from '../state.js';
import { LaunchConfigSchema, type LaunchConfig } from '../types.js';

export interface InitOptions {
  name?: string;
  domain?: string;
  tagline?: string;
  price?: string;
  audience?: string;
  /** GUI-only: folders without a README/package.json can't be scanned for one. */
  description?: string;
  force?: boolean;
}

export interface InitResult {
  exitCode: number;
  message: string;
  config?: LaunchConfig;
}

/** Core of `launch init` — testable without spawning the CLI. */
export async function runInit(dir: string, opts: InitOptions): Promise<InitResult> {
  const targetDir = resolve(dir);
  if (!existsSync(targetDir)) {
    return { exitCode: 1, message: `Target directory not found: ${targetDir}` };
  }

  const store = new LaunchStore(targetDir);
  if (store.hasConfig() && !opts.force) {
    return {
      exitCode: 0,
      message: `Config exists at ${store.configPath} — use --force to overwrite.`,
      config: await store.loadConfig(),
    };
  }

  const { scanned } = await scanTarget(targetDir);

  // Merge order: flags > scanned > derived.
  const merged: Partial<LaunchConfig> = {
    ...scanned,
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.domain ? { domain: opts.domain } : {}),
    ...(opts.tagline ? { tagline: opts.tagline } : {}),
    ...(opts.price ? { pricing: opts.price } : {}),
    ...(opts.audience ? { audience: opts.audience } : {}),
    ...(opts.description ? { description: opts.description } : {}),
  };
  if (!merged.productUrl && merged.domain) {
    merged.productUrl = `https://${merged.domain}`;
  }

  const result = LaunchConfigSchema.safeParse(merged);
  if (!result.success) {
    const fields = result.error.issues
      .map((i) => i.path.join('.') || '(root)')
      .filter((v, idx, arr) => arr.indexOf(v) === idx);
    return {
      exitCode: 1,
      message:
        `Cannot build launch config for ${targetDir} — missing/invalid fields: ${fields.join(', ')}.\n` +
        `Provide them via flags: --name --domain --tagline --price --audience.`,
    };
  }

  await store.saveConfig(result.data);
  return {
    exitCode: 0,
    message: `Wrote ${store.configPath}`,
    config: result.data,
  };
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Scan a target project and write .launch/launch.config.json')
    .argument('<dir>', 'target project directory')
    .option('--name <name>', 'product name (overrides scanned package.json name)')
    .option('--domain <domain>', 'product domain, e.g. demoapp.io')
    .option('--tagline <tagline>', 'one-line tagline (overrides scanned README heading)')
    .option('--price <price>', 'pricing, e.g. "$9/mo" or "free"')
    .option('--audience <audience>', 'target audience, e.g. "solo developers"')
    .option('--force', 'overwrite an existing launch.config.json')
    .action(async (dir: string, opts: InitOptions) => {
      const result = await runInit(dir, opts);
      if (result.exitCode === 0) {
        console.log(result.message);
        if (result.config) console.log(JSON.stringify(result.config, null, 2));
      } else {
        console.error(result.message);
      }
      process.exitCode = result.exitCode;
    });
}
