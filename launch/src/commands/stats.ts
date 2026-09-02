import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { LaunchStore } from '../state.js';
import { ProductHuntProvider, type ProductHuntDeps } from '../providers/producthunt.js';

export interface StatsOptions {
  platform?: string;
  slug?: string;
}

export interface StatsResult {
  exitCode: number;
  messages: string[];
}

/** Core of `launch stats` — testable without spawning the CLI. */
export async function runStats(
  dir: string,
  opts: StatsOptions,
  deps: ProductHuntDeps = {},
): Promise<StatsResult> {
  const targetDir = resolve(dir);
  if (!existsSync(targetDir)) {
    return { exitCode: 1, messages: [`Target directory not found: ${targetDir}`] };
  }
  if (opts.platform !== 'producthunt') {
    return { exitCode: 1, messages: ['Only --platform producthunt is supported for stats in v1.'] };
  }
  const store = new LaunchStore(targetDir);
  if (!store.hasConfig()) {
    return { exitCode: 1, messages: [`No launch config at ${store.configPath} — run \`launch init\` first.`] };
  }
  const config = await store.loadConfig();
  const slug = opts.slug ?? config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  try {
    const stats = await new ProductHuntProvider(process.env, deps).fetchStats(slug);
    if (!stats.live) {
      return {
        exitCode: 0,
        messages: [`producthunt: "${slug}" not found — not yet live (or a different slug; pass --slug).`],
      };
    }
    return {
      exitCode: 0,
      messages: [
        `producthunt: ${slug}`,
        `  votes:    ${stats.votes ?? 0}`,
        `  comments: ${stats.comments ?? 0}`,
        `  featured: ${stats.featuredAt ?? 'not featured'}`,
      ],
    };
  } catch (err) {
    return { exitCode: 1, messages: [`producthunt stats failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

export function registerStats(program: Command): void {
  program
    .command('stats')
    .description('Poll read-only post-launch stats (Product Hunt votes/comments)')
    .argument('<dir>', 'target project directory')
    .option('--platform <platform>', 'platform to poll (producthunt)')
    .option('--slug <slug>', 'Product Hunt post slug (defaults to the product name slugified)')
    .action(async (dir: string, opts: StatsOptions) => {
      const result = await runStats(dir, opts);
      const out = result.exitCode === 0 ? console.log : console.error;
      for (const message of result.messages) out(message);
      process.exitCode = result.exitCode;
    });
}
