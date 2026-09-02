import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { LaunchStore } from '../state.js';
import type { Draft } from '../types.js';
import { buildProviders } from '../providers/index.js';
import type { Provider, RequestPreview } from '../providers/types.js';
import { validateDraft } from '../copy/validate.js';
import type { Platform } from '../types.js';
import { kitMediaFor, loadPostKit } from '../postkit.js';
import { isMediaPlatform, mediaProblems, probeVideo, type MediaPlatform } from '../media-probe.js';

export interface PostCmdOptions {
  platform?: string;
  all?: boolean;
  dryRun?: boolean;
  /** Actually publish — overrides the dry-run default. */
  live?: boolean;
  assist?: boolean;
  force?: boolean;
  kit?: string;
  /** Record a confirmed manual submission (assist platforms) in the ledger. */
  markPosted?: string;
}

export interface PostCmdDeps {
  providers?: Provider[];
  /** Capture dry-run previews as data (UI endpoints) instead of console output. */
  onPreview?: (platform: Platform, preview: RequestPreview) => void;
}

/** Structured per-platform outcome — additive alongside messages (UI consumes this). */
export interface PostOutcome {
  platform: Platform;
  outcome:
    | 'posted'
    | 'assist-opened'
    | 'dry-run'
    | 'skipped-ledger'
    | 'skipped-no-media'
    | 'blocked'
    | 'no-draft'
    | 'refused-validation'
    | 'refused-media'
    | 'failed';
  url?: string;
  error?: string;
  detail?: string;
}

export interface PostCmdResult {
  exitCode: number;
  messages: string[];
  results: PostOutcome[];
}

/** Core of `launch post` — testable without spawning the CLI. */
export async function runPost(
  dir: string,
  opts: PostCmdOptions,
  deps: PostCmdDeps = {},
): Promise<PostCmdResult> {
  const targetDir = resolve(dir);
  if (!existsSync(targetDir)) {
    return { exitCode: 1, messages: [`Target directory not found: ${targetDir}`], results: [] };
  }
  const store = new LaunchStore(targetDir);
  if (!store.hasConfig()) {
    return {
      exitCode: 1,
      messages: [`No launch config at ${store.configPath} — run \`launch init\` first.`],
      results: [],
    };
  }
  if (!opts.all && !opts.platform) {
    return { exitCode: 1, messages: ['Pass --platform <p> or --all.'], results: [] };
  }

  const providers = deps.providers ?? buildProviders();
  let selected: Provider[];
  if (opts.all) {
    selected = providers;
  } else {
    const found = providers.find((p) => p.name === opts.platform);
    if (!found) {
      return {
        exitCode: 1,
        messages: [`Unknown or unsupported platform "${opts.platform}". Available: ${providers.map((p) => p.name).join(', ')}`],
        results: [],
      };
    }
    selected = [found];
  }

  const config = await store.loadConfig();

  // --mark-posted: the human confirmed a manual (assist) submission — record it,
  // nothing is sent. This is the only way assist platforms enter the ledger.
  if (opts.markPosted) {
    if (opts.all || !opts.platform) {
      return { exitCode: 1, messages: ['--mark-posted requires --platform <p> (one platform at a time).'], results: [] };
    }
    const label = selected[0]!.name;
    const idempotencyKey = `${label}:${config.domain}`;
    if (await store.has(idempotencyKey)) {
      return {
        exitCode: 0,
        messages: [`${label}: already in the ledger (${idempotencyKey}) — nothing recorded.`],
        results: [{ platform: label, outcome: 'skipped-ledger', detail: idempotencyKey }],
      };
    }
    await store.appendLedger({
      platform: label,
      idempotencyKey,
      postedAt: new Date().toISOString(),
      url: opts.markPosted,
    });
    return {
      exitCode: 0,
      messages: [`${label}: recorded as posted — ${opts.markPosted}`],
      results: [{ platform: label, outcome: 'posted', url: opts.markPosted }],
    };
  }

  const messages: string[] = [];
  const results: PostOutcome[] = [];
  let exitCode = 0;

  for (const provider of selected) {
    const label = provider.name;

    if (provider.mode() === 'blocked') {
      const status = await provider.ready();
      results.push({ platform: label, outcome: 'blocked', detail: status.detail, error: status.fixHint });
      if (opts.all) {
        messages.push(`${label}: SKIPPED (blocked — ${status.detail})`);
        continue;
      }
      return {
        exitCode: 1,
        messages: [...messages, `${label}: blocked — ${status.detail}`, ...(status.fixHint ? [`  fix: ${status.fixHint}`] : [])],
        results,
      };
    }

    const idempotencyKey = `${label}:${config.domain}`;
    if (!opts.force && (await store.has(idempotencyKey))) {
      messages.push(`${label}: SKIPPED (already posted — ledger key ${idempotencyKey})`);
      results.push({ platform: label, outcome: 'skipped-ledger', detail: idempotencyKey });
      continue;
    }

    let draft: Draft | undefined;
    if (provider.draftPlatform) {
      draft = await store.loadDraft(provider.draftPlatform);
      if (!draft) {
        messages.push(`${label}: no draft — run \`launch copy --scaffold\` and fill it`);
        results.push({ platform: label, outcome: 'no-draft' });
        if (!opts.all) return { exitCode: 1, messages, results };
        exitCode = 1;
        continue;
      }

      const { errors } = validateDraft(draft, { productUrl: config.productUrl });
      if (errors.length > 0) {
        const ruleList = errors.map((e) => e.rule).join(', ');
        messages.push(`${label}: REFUSED — draft fails validation (${ruleList}). Run \`launch copy --validate\`.`);
        results.push({ platform: label, outcome: 'refused-validation', error: ruleList });
        exitCode = 1;
        continue;
      }

      // Kit media: drafts own copy, the kit contributes the video. A manifest
      // that promises a missing file refuses the post — never silent text-only.
      if ((draft.platform === 'x' || draft.platform === 'linkedin') && !draft.media) {
        const kitDir = opts.kit ?? config.postkitDir;
        if (kitDir) {
          try {
            const kit = await loadPostKit(kitDir);
            const media = await kitMediaFor(kit, draft.platform);
            if (media) draft = { ...draft, media };
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            messages.push(`${label}: REFUSED — ${detail}`);
            results.push({ platform: label, outcome: 'refused-media', error: detail });
            exitCode = 1;
            continue;
          }
        }
      }

      // A video-only provider (YouTube) must not fail an otherwise text-only
      // launch just because its OAuth keys happen to be set: skip it the way a
      // blocked provider is skipped, and leave the run's exit code alone.
      if (provider.requiresMedia && !('media' in draft && draft.media)) {
        const detail = 'no video: the draft carries none and no post kit supplied one';
        results.push({ platform: label, outcome: 'skipped-no-media', detail });
        if (opts.all) {
          messages.push(`${label}: SKIPPED (${detail})`);
          continue;
        }
        return {
          exitCode: 1,
          messages: [...messages, `${label}: ${detail} — wire a post kit (--kit <dir>) or set postkitDir.`],
          results,
        };
      }

      // Pre-flight media validation: never hand an upload API (or a dry-run
      // preview) a video that exceeds the platform's real caps. Covers both
      // kit-injected and draft-supplied media. Keyed on the PROVIDER, not the
      // draft: Bluesky reuses the x draft but caps video at 100 MB, not 512 MB.
      if ((draft.platform === 'x' || draft.platform === 'linkedin') && draft.media) {
        const mediaKey: MediaPlatform = isMediaPlatform(label) ? label : draft.platform;
        try {
          const probe = await probeVideo(draft.media.videoPath);
          const problems = mediaProblems(mediaKey, probe);
          if (problems.length > 0) throw new Error(problems.join('; '));
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          messages.push(`${label}: REFUSED — ${detail}`);
          results.push({ platform: label, outcome: 'refused-media', error: detail });
          exitCode = 1;
          continue;
        }
      }
    }

    // Dry-run by default — spending money or publishing content requires --live.
    // --dry-run is still accepted (back-compat) but is a no-op now that it's the default.
    // --assist is the exception: it publishes NOTHING on its own (it opens a
    // prefilled page and copies companion text; a human clicks submit), so gating
    // it behind --live bought zero safety and silently no-opped the HN/PH flows.
    // An explicit --dry-run still wins over the assist default.
    const dryRun = opts.live ? false : (opts.dryRun ?? !opts.assist);

    // Providers print previews immediately, so the header must too (not via messages) —
    // unless the UI is capturing previews as data.
    if (dryRun && !deps.onPreview) console.log(`${label}: DRY RUN — requests that would be sent:`);
    const onPreview = deps.onPreview;
    const result = await provider.post(draft, {
      dryRun,
      assist: opts.assist ?? false,
      productUrl: config.productUrl,
      outDir: store.outDir,
      researchDir: store.researchDir,
      onPreview: onPreview ? (preview) => onPreview(label, preview) : undefined,
    });

    if (result.ok && !result.dryRun && result.assisted) {
      // Assist flow only opened the submit page — the human still has to click
      // submit, so nothing is recorded. Ledger entry comes via --mark-posted.
      messages.push(
        `${label}: ASSIST OPENED — ledger untouched. After you click submit, record it: launch post <dir> --platform ${label} --mark-posted <live-url>`,
      );
      results.push({ platform: label, outcome: 'assist-opened', url: result.url });
      continue;
    }

    if (result.ok && !result.dryRun) {
      await store.appendLedger({
        platform: label,
        idempotencyKey,
        postedAt: new Date().toISOString(),
        url: result.url,
      });
      messages.push(`${label}: POSTED ${result.url ?? ''}`);
      results.push({ platform: label, outcome: 'posted', url: result.url });
    } else if (result.ok && result.dryRun) {
      messages.push(`${label}: dry run OK — nothing sent, ledger untouched`);
      // url carries the assist target (HN submitlink / PH submit page) for the UI.
      results.push({ platform: label, outcome: 'dry-run', url: result.url });
    } else {
      messages.push(`${label}: FAILED — ${result.error}`);
      results.push({ platform: label, outcome: 'failed', error: result.error });
      exitCode = 1;
    }
  }

  return { exitCode, messages, results };
}

export function registerPost(program: Command): void {
  program
    .command('post')
    .description('Post validated drafts to platforms (consults the posted-ledger; dry-run prints payloads)')
    .argument('<dir>', 'target project directory')
    .option('--platform <platform>', 'post to one platform')
    .option('--all', 'post to every configured platform, skipping blocked ones')
    .option('--dry-run', 'print exact request payloads, send nothing, write nothing (default; kept for compatibility)')
    .option('--live', 'actually publish — required to send anything for real')
    .option('--assist', 'for assisted platforms (HN/PH): open the prefilled page + copy companion text (submits nothing, so it runs for real without --live)')
    .option('--force', 'repost even if the ledger says this platform is done')
    .option('--kit <dir>', 'post kit directory (animations out/<brand>/postkit); overrides config postkitDir')
    .option('--mark-posted <url>', 'record a confirmed manual submission (assist platforms) in the ledger; sends nothing')
    .action(async (dir: string, opts: PostCmdOptions) => {
      const result = await runPost(dir, opts);
      const out = result.exitCode === 0 ? console.log : console.error;
      for (const message of result.messages) out(message);
      process.exitCode = result.exitCode;
    });
}
