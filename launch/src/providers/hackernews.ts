/**
 * Hacker News assisted provider.
 *
 * HN has NO write API, and automated submission/voting is a ban risk (2026
 * research, THINKING.md). This provider therefore NEVER submits: it validates
 * the Show HN rules, builds a prefilled submitlink URL, opens it in the
 * browser, and puts the maker comment on the clipboard. The human clicks
 * submit — by design, not as a workaround.
 */
import { copyToClipboard, openInBrowser, type SpawnImpl } from '../assist.js';
import { validateDraft } from '../copy/validate.js';
import type { Draft, PostResult } from '../types.js';
import type { PostOptions, Provider, ProviderStatus } from './types.js';

export interface HackerNewsDeps {
  open?: typeof openInBrowser;
  copy?: typeof copyToClipboard;
  platform?: NodeJS.Platform;
  spawnImpl?: SpawnImpl;
}

export function hnSubmitUrl(title: string, url: string): string {
  const params = new URLSearchParams({ u: url, t: title });
  return `https://news.ycombinator.com/submitlink?${params.toString()}`;
}

export class HackerNewsProvider implements Provider {
  readonly name = 'hackernews' as const;
  readonly draftPlatform = 'hackernews' as const;
  private readonly open: typeof openInBrowser;
  private readonly copy: typeof copyToClipboard;
  private readonly deps: HackerNewsDeps;

  constructor(_env: NodeJS.ProcessEnv = process.env, deps: HackerNewsDeps = {}) {
    this.open = deps.open ?? openInBrowser;
    this.copy = deps.copy ?? copyToClipboard;
    this.deps = deps;
  }

  mode(): 'assist' {
    return 'assist';
  }

  async ready(): Promise<ProviderStatus> {
    return {
      ok: true,
      detail: 'assisted — no credentials needed; engine opens a prefilled submitlink, you click submit',
    };
  }

  async post(draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    if (draft?.platform !== 'hackernews') {
      return { platform: 'hackernews', ok: false, error: 'HackerNewsProvider needs a hackernews draft', dryRun: opts.dryRun };
    }

    // Re-validate Show HN rules at post time — drafts may have been hand-edited since --validate.
    const { errors } = validateDraft(draft, { productUrl: opts.productUrl });
    if (errors.length > 0) {
      return {
        platform: 'hackernews',
        ok: false,
        error: `Show HN rules violated — assist blocked: ${errors.map((e) => `${e.rule} (${e.field})`).join(', ')}`,
        dryRun: opts.dryRun,
      };
    }

    const submitUrl = hnSubmitUrl(draft.title, draft.url);

    if (opts.dryRun) {
      console.log(`Would open: ${submitUrl}`);
      if (draft.makerComment) console.log(`Would copy maker comment to clipboard:\n  ${draft.makerComment}`);
      return { platform: 'hackernews', ok: true, url: submitUrl, dryRun: true };
    }

    if (opts.assist) {
      await this.open(submitUrl, this.deps);
      if (draft.makerComment) {
        await this.copy(draft.makerComment, this.deps);
        console.log('Maker comment copied to clipboard — paste it as the FIRST comment right after submitting.');
      }
      console.log(`Browser opened with the prefilled Show HN submission. Review and click submit.`);
    } else {
      console.log(`Submit URL (use --assist to open it automatically): ${submitUrl}`);
      if (draft.makerComment) console.log(`Maker comment to post immediately after:\n  ${draft.makerComment}`);
    }

    return { platform: 'hackernews', ok: true, url: submitUrl, dryRun: false, assisted: true };
  }
}
