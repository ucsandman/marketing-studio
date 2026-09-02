import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { LaunchStore } from '../state.js';
import { PLATFORMS, type LaunchConfig, type Platform } from '../types.js';
import { KNOWLEDGE } from '../research/knowledge.js';
import {
  fetchHuntedSpaceStats,
  fetchShowHnWinners,
  fetchSubreddit,
  fetchXAlgorithm,
  type FetcherDeps,
  type FetchOutcome,
} from '../research/fetchers.js';
import {
  composeBrief,
  extractSessionResearch,
  isStale,
  parseBriefMeta,
} from '../research/brief.js';

export interface ResearchOptions {
  offline?: boolean;
  platform?: string;
  check?: boolean;
}

export interface ResearchDeps extends FetcherDeps {
  now?: () => Date;
}

export interface ResearchResult {
  exitCode: number;
  messages: string[];
}

export const DEFAULT_SUBREDDITS = ['SideProject', 'AlphaAndBetaUsers', 'IMadeThis'];

function liveFetchersFor(
  platform: Platform,
  config: LaunchConfig,
  deps: FetcherDeps,
): Promise<FetchOutcome>[] {
  const niche = config.audience ?? config.name;
  switch (platform) {
    case 'x':
      return [fetchXAlgorithm(deps)];
    case 'hackernews':
      return [fetchShowHnWinners(niche, deps)];
    case 'producthunt':
      return [fetchHuntedSpaceStats(deps)];
    case 'reddit':
      return DEFAULT_SUBREDDITS.map((sub) => fetchSubreddit(sub, deps));
    default:
      return [];
  }
}

/** Core of `launch research` — testable without spawning the CLI. */
export async function runResearch(
  dir: string,
  opts: ResearchOptions,
  deps: ResearchDeps = {},
): Promise<ResearchResult> {
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

  const platforms: Platform[] = opts.platform
    ? [opts.platform as Platform]
    : [...PLATFORMS];
  if (opts.platform && !PLATFORMS.includes(opts.platform as Platform)) {
    return {
      exitCode: 1,
      messages: [`Unknown platform "${opts.platform}". Known: ${PLATFORMS.join(', ')}`],
    };
  }

  const now = deps.now ?? (() => new Date());

  if (opts.check) {
    const stale: string[] = [];
    for (const platform of platforms) {
      const briefPath = join(store.researchDir, `${platform}.md`);
      if (!existsSync(briefPath)) {
        stale.push(`${platform} (missing)`);
        continue;
      }
      const meta = parseBriefMeta(await readFile(briefPath, 'utf8'));
      if (!meta || isStale(meta, now())) {
        stale.push(`${platform} (stale: fetched ${meta?.fetchedAt ?? 'unknown'})`);
      }
    }
    if (stale.length > 0) {
      return {
        exitCode: 1,
        messages: [`Stale or missing research briefs: ${stale.join(', ')}`, 'Re-run `launch research`.'],
      };
    }
    return { exitCode: 0, messages: ['All research briefs fresh.'] };
  }

  const config = await store.loadConfig();
  await store.ensureDirs();
  const messages: string[] = [];

  for (const platform of platforms) {
    const briefPath = join(store.researchDir, `${platform}.md`);
    const existing = existsSync(briefPath) ? await readFile(briefPath, 'utf8') : undefined;
    const sessionResearch = existing ? extractSessionResearch(existing) : undefined;

    const live: FetchOutcome[] = opts.offline
      ? []
      : await Promise.all(liveFetchersFor(platform, config, deps));
    const failures = live.filter((o) => !o.ok);

    const brief = composeBrief({
      knowledge: KNOWLEDGE[platform],
      fetchedAt: now().toISOString(),
      live,
      offline: opts.offline ?? false,
      sessionResearch,
    });
    await writeFile(briefPath, brief, 'utf8');

    messages.push(
      `${platform}: wrote ${briefPath}` +
        (failures.length > 0 ? ` (degraded — ${failures.length} fetch failed)` : '') +
        (sessionResearch ? ' (session research preserved)' : ''),
    );
  }

  return { exitCode: 0, messages };
}

export function registerResearch(program: Command): void {
  program
    .command('research')
    .description('Generate per-platform launch research briefs into <dir>/.launch/research/')
    .argument('<dir>', 'target project directory (must have launch.config.json)')
    .option('--offline', 'static knowledge only, no live fetches')
    .option('--platform <platform>', 'limit to one platform')
    .option('--check', 'exit non-zero if any brief is stale (>7 days) or missing')
    .action(async (dir: string, opts: ResearchOptions) => {
      const result = await runResearch(dir, opts);
      const out = result.exitCode === 0 ? console.log : console.error;
      for (const message of result.messages) out(message);
      process.exitCode = result.exitCode;
    });
}
