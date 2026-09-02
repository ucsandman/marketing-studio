/**
 * Product Hunt assisted provider.
 *
 * PH has no create-post API (and never will, per their API docs) — automation
 * is structurally impossible and faking it via browser scripting is a
 * delisting risk. This provider assembles a complete launch kit the human
 * works through, opens the submit page, and copies the tagline. The only API
 * use is the READ-ONLY GraphQL stats poller (`launch stats`).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { copyToClipboard, openInBrowser, type SpawnImpl } from '../assist.js';
import type { Draft, PostResult } from '../types.js';
import type { PostOptions, Provider, ProviderStatus } from './types.js';

const SUBMIT_URL = 'https://www.producthunt.com/posts/new';
const GRAPHQL_URL = 'https://api.producthunt.com/v2/api/graphql';

export interface ProductHuntDeps {
  open?: typeof openInBrowser;
  copy?: typeof copyToClipboard;
  platform?: NodeJS.Platform;
  spawnImpl?: SpawnImpl;
  fetchImpl?: typeof fetch;
}

export interface PhStats {
  live: boolean;
  votes?: number;
  comments?: number;
  featuredAt?: string;
}

export class ProductHuntProvider implements Provider {
  readonly name = 'producthunt' as const;
  readonly draftPlatform = 'producthunt' as const;
  private readonly open: typeof openInBrowser;
  private readonly copy: typeof copyToClipboard;
  private readonly fetchImpl: typeof fetch;
  private readonly deps: ProductHuntDeps;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    deps: ProductHuntDeps = {},
  ) {
    this.open = deps.open ?? openInBrowser;
    this.copy = deps.copy ?? copyToClipboard;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.deps = deps;
  }

  mode(): 'assist' {
    return 'assist';
  }

  async ready(): Promise<ProviderStatus> {
    const hasToken = Boolean(this.env.PRODUCTHUNT_DEV_TOKEN);
    return {
      ok: true,
      detail: `assisted — launch kit + manual submit${hasToken ? '; stats polling enabled' : '; set PRODUCTHUNT_DEV_TOKEN for post-launch stats polling'}`,
    };
  }

  /** Build the markdown launch kit from the draft (+ live research findings when present). */
  async composeKit(
    draft: Extract<Draft, { platform: 'producthunt' }>,
    opts: PostOptions,
  ): Promise<string> {
    let scheduleResearch = '';
    if (opts.researchDir) {
      const briefPath = join(opts.researchDir, 'producthunt.md');
      if (existsSync(briefPath)) {
        const brief = await readFile(briefPath, 'utf8');
        const live = /## Live findings[\s\S]*?(?=\n## |$)/.exec(brief)?.[0];
        if (live) scheduleResearch = `\n${live.trim()}\n`;
      }
    }

    return [
      '# Launch kit — Product Hunt',
      '',
      '## Tagline',
      '',
      draft.tagline,
      '',
      `(${draft.tagline.length}/60 chars)`,
      '',
      '## Description',
      '',
      draft.description,
      '',
      '## Topics',
      '',
      ...draft.topics.map((t) => `- ${t}`),
      '',
      '## Gallery checklist',
      '',
      draft.galleryNotes ?? '- Hero image 1270x760\n- 2-4 product shots\n- Optional demo video',
      '',
      '## First comment',
      '',
      draft.firstComment ?? '(write the maker first comment before launch)',
      '',
      '## Schedule recommendation',
      '',
      'Launch at 12:01 AM PT for the full 24h voting window. Pick a low-competition day via https://hunted.space/stats (often Thursday).',
      scheduleResearch,
      '## Links',
      '',
      `- Product: ${opts.productUrl ?? '(set productUrl in launch.config.json)'}`,
      `- Submit page: ${SUBMIT_URL}`,
      '',
    ].join('\n');
  }

  async post(draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    if (draft?.platform !== 'producthunt') {
      return { platform: 'producthunt', ok: false, error: 'ProductHuntProvider needs a producthunt draft', dryRun: opts.dryRun };
    }

    const kit = await this.composeKit(draft, opts);

    if (opts.dryRun) {
      console.log(`Would write launch kit to ${opts.outDir ? join(opts.outDir, 'producthunt-kit.md') : '.launch/out/producthunt-kit.md'}`);
      console.log(`Would open: ${SUBMIT_URL} (with --assist)`);
      return { platform: 'producthunt', ok: true, url: SUBMIT_URL, dryRun: true };
    }

    if (!opts.outDir) {
      return { platform: 'producthunt', ok: false, error: 'ProductHunt kit needs outDir (.launch/out)', dryRun: false };
    }
    const kitPath = join(opts.outDir, 'producthunt-kit.md');
    await writeFile(kitPath, kit, 'utf8');
    console.log(`Launch kit written: ${kitPath}`);

    if (opts.assist) {
      await this.open(SUBMIT_URL, this.deps);
      await this.copy(draft.tagline, this.deps);
      console.log('Submit page opened; tagline copied to clipboard. Work through the kit top to bottom.');
    } else {
      console.log(`Submit page (use --assist to open it automatically): ${SUBMIT_URL}`);
    }

    return { platform: 'producthunt', ok: true, url: SUBMIT_URL, dryRun: false, assisted: true };
  }

  /** Read-only GraphQL stats for a launched post. Graceful when not yet live. */
  async fetchStats(slug: string): Promise<PhStats> {
    const token = this.env.PRODUCTHUNT_DEV_TOKEN;
    if (!token) throw new Error('PRODUCTHUNT_DEV_TOKEN missing — see .env.example');
    const res = await this.fetchImpl(GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query { post(slug: "${slug.replace(/"/g, '')}") { votesCount commentsCount featuredAt } }`,
      }),
    });
    if (!res.ok) throw new Error(`Product Hunt GraphQL HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: { post?: { votesCount?: number; commentsCount?: number; featuredAt?: string } | null };
    };
    const post = json.data?.post;
    if (!post) return { live: false };
    return {
      live: true,
      votes: post.votesCount,
      comments: post.commentsCount,
      featuredAt: post.featuredAt,
    };
  }
}
