import type { Platform } from '../types.js';
import type { PlatformKnowledge } from './knowledge.js';
import type { FetchOutcome } from './fetchers.js';

export interface BriefMeta {
  platform: Platform;
  fetchedAt: string;
  degraded: boolean;
  sources: string[];
}

export const SESSION_RESEARCH_HEADING = '## Session research';
export const DEFAULT_TTL_DAYS = 7;

const SESSION_PLACEHOLDER =
  '_Filled in-session by the /launch skill via WebSearch (same-day algorithm intel). Preserved verbatim on regeneration._';

function section(title: string, items: string[]): string {
  if (items.length === 0) return '';
  return `### ${title}\n\n${items.map((i) => `- ${i}`).join('\n')}\n`;
}

/** Compose a full per-platform brief. `sessionResearch` survives regeneration. */
export function composeBrief(options: {
  knowledge: PlatformKnowledge;
  fetchedAt: string;
  live: FetchOutcome[];
  offline: boolean;
  sessionResearch?: string;
}): string {
  const { knowledge: kb, fetchedAt, live, offline } = options;
  const failures = live.filter((o) => !o.ok);
  const degraded = failures.length > 0;
  const sources = live.filter((o) => o.ok).map((o) => o.source);

  const frontmatter = [
    '---',
    `platform: ${kb.platform}`,
    `fetchedAt: ${fetchedAt}`,
    `degraded: ${degraded}`,
    'sources:',
    ...sources.map((s) => `  - ${s}`),
    '---',
  ].join('\n');

  const staticSection = [
    `## Static knowledge (as of ${kb.asOf})`,
    '',
    `**Strategy:** ${kb.strategy}`,
    '',
    section('Hard rules', kb.hardRules),
    section('Costs', kb.costs),
    section('Timing', kb.timing),
    section('Format', kb.format),
    section('Ban risks', kb.banRisks),
  ].join('\n');

  let liveSection: string;
  if (offline) {
    liveSection = `## Live findings\n\n_Skipped — generated with --offline. Re-run \`launch research\` before launch day._`;
  } else if (live.length === 0) {
    liveSection = `## Live findings (fetched ${fetchedAt})\n\n_No keyless live source for this platform — session research covers it._`;
  } else {
    const parts = live.map((o) =>
      o.ok
        ? `### ${o.title}\n\nSource: ${o.source}\n\n${o.summary}`
        : `### ${o.title} — FAILED\n\nSource: ${o.source}\n\n_Fetch failed (${o.error}). Brief degraded to static knowledge for this source._`,
    );
    liveSection = `## Live findings (fetched ${fetchedAt})\n\n${parts.join('\n\n')}`;
  }

  const sessionSection = `${SESSION_RESEARCH_HEADING}\n\n${options.sessionResearch?.trim() || SESSION_PLACEHOLDER}`;

  return `${frontmatter}\n\n# ${kb.platform} launch brief\n\n${staticSection}\n${liveSection}\n\n${sessionSection}\n`;
}

/** Parse frontmatter meta out of a brief. Returns undefined if unparseable. */
export function parseBriefMeta(content: string): BriefMeta | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return undefined;
  const body = match[1] ?? '';
  const get = (key: string): string | undefined =>
    new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(body)?.[1]?.trim();
  const platform = get('platform');
  const fetchedAt = get('fetchedAt');
  if (!platform || !fetchedAt) return undefined;
  const sources = [...body.matchAll(/^ {2}- (.+)$/gm)].map((m) => (m[1] ?? '').trim());
  return {
    platform: platform as Platform,
    fetchedAt,
    degraded: get('degraded') === 'true',
    sources,
  };
}

/** Extract preserved `## Session research` body from an existing brief. */
export function extractSessionResearch(content: string): string | undefined {
  const idx = content.indexOf(SESSION_RESEARCH_HEADING);
  if (idx === -1) return undefined;
  const body = content.slice(idx + SESSION_RESEARCH_HEADING.length).trim();
  if (body.length === 0 || body === SESSION_PLACEHOLDER) return undefined;
  return body;
}

/** A brief is stale when fetchedAt is older than ttlDays. */
export function isStale(meta: BriefMeta, now: Date, ttlDays: number = DEFAULT_TTL_DAYS): boolean {
  const fetched = Date.parse(meta.fetchedAt);
  if (Number.isNaN(fetched)) return true;
  return now.getTime() - fetched > ttlDays * 24 * 60 * 60 * 1000;
}
