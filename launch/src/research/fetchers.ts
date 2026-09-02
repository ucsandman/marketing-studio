/**
 * Keyless live research fetchers. No API keys, 10s timeout, typed outcomes.
 * Never called at module load — only from the research command.
 */

export interface FetchSuccess {
  ok: true;
  source: string;
  title: string;
  summary: string;
}

export interface FetchFailure {
  ok: false;
  source: string;
  title: string;
  error: string;
}

export type FetchOutcome = FetchSuccess | FetchFailure;

export interface FetcherDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const USER_AGENT = 'launch-engine/0.1 research fetcher (keyless, read-only)';

async function get(url: string, deps: FetcherDeps): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

function failure(source: string, title: string, err: unknown): FetchFailure {
  return {
    ok: false,
    source,
    title,
    error: err instanceof Error ? err.message : String(err),
  };
}

/** X ranking-signal canon: the xai-org/x-algorithm README (Grok-era, not the stale 2023 repo). */
export async function fetchXAlgorithm(deps: FetcherDeps = {}): Promise<FetchOutcome> {
  const source = 'https://raw.githubusercontent.com/xai-org/x-algorithm/main/README.md';
  const title = 'xai-org/x-algorithm README';
  try {
    const text = await get(source, deps);
    // First ~40 non-empty lines carry the ranking overview; the rest is repo plumbing.
    const summary = text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .slice(0, 40)
      .join('\n');
    return { ok: true, source, title, summary };
  } catch (err) {
    return failure(source, title, err);
  }
}

interface AlgoliaHit {
  title?: string;
  points?: number;
  objectID?: string;
}

/** Successful Show HN title patterns in the product's niche (Algolia, points > 100). */
export async function fetchShowHnWinners(
  niche: string,
  deps: FetcherDeps = {},
): Promise<FetchOutcome> {
  const source = `https://hn.algolia.com/api/v1/search?tags=show_hn&numericFilters=points%3E100&query=${encodeURIComponent(niche)}`;
  const title = `Show HN winners for "${niche}" (Algolia, points>100)`;
  try {
    const text = await get(source, deps);
    const parsed = JSON.parse(text) as { hits?: AlgoliaHit[] };
    const hits = (parsed.hits ?? []).slice(0, 10);
    if (hits.length === 0) {
      return { ok: true, source, title, summary: 'No Show HN posts over 100 points for this niche — study adjacent niches.' };
    }
    const summary = hits
      .map((h) => `- [${h.points ?? '?'} pts] ${h.title ?? '(untitled)'}`)
      .join('\n');
    return { ok: true, source, title, summary };
  } catch (err) {
    return failure(source, title, err);
  }
}

/** Product Hunt competition stats (hunted.space, best-effort HTML scrape). */
export async function fetchHuntedSpaceStats(deps: FetcherDeps = {}): Promise<FetchOutcome> {
  const source = 'https://hunted.space/stats';
  const title = 'hunted.space launch-competition stats';
  try {
    const html = await get(source, deps);
    // Best-effort: pull day-name + count pairs out of the stats markup.
    const matches = [...html.matchAll(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^0-9]{0,40}(\d{1,4})/gi)]
      .slice(0, 14)
      .map((m) => `- ${m[1]}: ${m[2]} launches`);
    const summary =
      matches.length > 0
        ? matches.join('\n')
        : 'Stats page fetched but per-day counts not parseable — open https://hunted.space/stats manually for day selection.';
    return { ok: true, source, title, summary };
  } catch (err) {
    return failure(source, title, err);
  }
}

interface RedditRule {
  short_name?: string;
  description?: string;
}

interface RedditTopChild {
  data?: { title?: string; score?: number };
}

/** A subreddit's live rules plus its top posts this month. */
export async function fetchSubreddit(
  sub: string,
  deps: FetcherDeps = {},
): Promise<FetchOutcome> {
  const rulesUrl = `https://www.reddit.com/r/${sub}/about/rules.json`;
  const topUrl = `https://www.reddit.com/r/${sub}/top.json?t=month&limit=10`;
  const title = `r/${sub} rules + top posts (month)`;
  try {
    const [rulesText, topText] = await Promise.all([get(rulesUrl, deps), get(topUrl, deps)]);
    const rules = (JSON.parse(rulesText) as { rules?: RedditRule[] }).rules ?? [];
    const top = (JSON.parse(topText) as { data?: { children?: RedditTopChild[] } }).data?.children ?? [];
    const summary = [
      '**Rules:**',
      ...rules.map((r) => `- ${r.short_name ?? ''}${r.description ? ` — ${r.description.slice(0, 120)}` : ''}`),
      '',
      '**Top posts this month:**',
      ...top.map((c) => `- [${c.data?.score ?? '?'} pts] ${c.data?.title ?? '(untitled)'}`),
    ].join('\n');
    return { ok: true, source: rulesUrl, title, summary };
  } catch (err) {
    return failure(rulesUrl, title, err);
  }
}
