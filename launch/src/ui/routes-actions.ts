import { spawn } from 'node:child_process';
import { z } from 'zod';
import { HttpError, jsonErr, jsonOk, type FieldError, type UiServer } from './server.js';
import { requireExistingDir } from './routes-read.js';
import { RecentsStore } from '../recents.js';
import { LaunchStore } from '../state.js';
import { runInit } from '../commands/init.js';
import { runPost } from '../commands/post.js';
import { runNotify } from '../commands/notify.js';
import { runResearch, type ResearchDeps } from '../commands/research.js';
import { validateDraft } from '../copy/validate.js';
import { buildProviders } from '../providers/index.js';
import { loadPostKit, resolveInside } from '../postkit.js';
import type { Provider, RequestPreview } from '../providers/types.js';
import { DraftPlatformSchema, DraftSchema, PlatformSchema, type Platform } from '../types.js';

/**
 * Action endpoints. A GUI button must be exactly as safe as the CLI flag it
 * replaces: dry-run is the default, live posting requires confirm === domain
 * (checked BEFORE any provider is constructed), the posted-ledger short-circuits
 * duplicates, and the notify consent hard rule is enforced by runNotify itself.
 */

export interface ActionRouteDeps {
  recents?: RecentsStore;
  env?: NodeJS.ProcessEnv;
  /** Injected by tests so post/preview never construct real providers. */
  providers?: Provider[];
  /** Injected by tests so research never fetches live sources. */
  research?: ResearchDeps;
  /** Opens a folder in the OS file manager. Injectable for tests. */
  openPath?: (path: string) => void;
}

const InitBodySchema = z.object({
  dir: z.string().min(1),
  name: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  tagline: z.string().min(1).optional(),
  price: z.string().min(1).optional(),
  audience: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  force: z.boolean().optional(),
});

const DraftBodySchema = z.object({
  dir: z.string().min(1),
  draft: DraftSchema,
});

const ResearchBodySchema = z.object({
  dir: z.string().min(1),
  platform: z.string().optional(),
  offline: z.boolean().optional(),
});

const PreviewBodySchema = z.object({
  dir: z.string().min(1),
  platforms: z.array(PlatformSchema).min(1),
});

const PostBodySchema = z.object({
  dir: z.string().min(1),
  platform: PlatformSchema,
  confirm: z.string(),
  force: z.boolean().optional(),
});

const NotifyBodySchema = z.object({
  dir: z.string().min(1),
  channel: z.enum(['email', 'sms']),
  live: z.boolean().optional(),
  confirm: z.string().optional(),
});

const PostkitConfigBodySchema = z.object({
  dir: z.string().min(1),
  postkitDir: z.string().min(1).nullable(),
});

const PostkitOpenBodySchema = z.object({
  dir: z.string().min(1),
  platform: z.string().min(1),
});

function zodFields(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** Parse a body against a schema; invalid → 400 listing per-field errors. */
function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, 'Invalid request body', zodFields(result.error));
  }
  return result.data;
}

async function requireInitialized(dir: string): Promise<LaunchStore> {
  const store = new LaunchStore(dir);
  if (!store.hasConfig()) {
    throw new HttpError(400, `Target is not initialized (no ${store.configPath}) — init it first`);
  }
  return store;
}

export function registerActionRoutes(ui: UiServer, deps: ActionRouteDeps = {}): void {
  const recents = deps.recents ?? new RecentsStore();
  const env = deps.env ?? process.env;
  const openPath =
    deps.openPath ??
    ((path: string) => {
      const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(cmd, [path], { detached: true, stdio: 'ignore' }).unref();
    });

  ui.route('POST', '/api/target/init', async (req) => {
    const body = parseBody(InitBodySchema, req.body);
    const dir = await requireExistingDir(body.dir);
    const result = await runInit(dir, {
      name: body.name,
      domain: body.domain,
      tagline: body.tagline,
      price: body.price,
      audience: body.audience,
      description: body.description,
      force: body.force,
    });
    if (result.exitCode !== 0 || !result.config) {
      return jsonErr(400, result.message);
    }
    await recents.touch({ dir, name: result.config.name, domain: result.config.domain });
    return jsonOk({ message: result.message, config: result.config });
  });

  ui.route('PUT', '/api/target/drafts/:platform', async (req) => {
    const platformParse = DraftPlatformSchema.safeParse(req.params.platform);
    if (!platformParse.success) {
      return jsonErr(400, `Unknown draft platform: ${req.params.platform}`);
    }
    const body = parseBody(DraftBodySchema, req.body);
    if (body.draft.platform !== platformParse.data) {
      return jsonErr(400, `Draft platform "${body.draft.platform}" does not match URL platform "${platformParse.data}"`);
    }
    const dir = await requireExistingDir(body.dir);
    const store = await requireInitialized(dir);
    const config = await store.loadConfig();
    // Persist even when violations exist — matches the CLI editing flow.
    await store.saveDraft(body.draft);
    const { errors, warnings } = validateDraft(body.draft, { productUrl: config.productUrl });
    return jsonOk({ saved: true, violations: [...errors, ...warnings] });
  });

  ui.route('POST', '/api/target/research', async (req) => {
    const body = parseBody(ResearchBodySchema, req.body);
    const dir = await requireExistingDir(body.dir);
    await requireInitialized(dir);
    const result = await runResearch(
      dir,
      { offline: body.offline, platform: body.platform },
      deps.research ?? {},
    );
    if (result.exitCode !== 0) return jsonErr(400, result.messages.join(' | '));
    // Per-source outcomes (including partial fetch failures) live in messages.
    return jsonOk(result);
  });

  ui.route('POST', '/api/target/preview', async (req) => {
    const body = parseBody(PreviewBodySchema, req.body);
    const dir = await requireExistingDir(body.dir);
    await requireInitialized(dir);
    const providers = deps.providers ?? buildProviders(env);
    const previews: Record<string, RequestPreview[]> = {};
    const collect = (platform: Platform, preview: RequestPreview): void => {
      (previews[platform] ??= []).push(preview);
    };
    const results = [];
    for (const platform of body.platforms) {
      const result = await runPost(dir, { platform, dryRun: true }, { providers, onPreview: collect });
      results.push({
        platform,
        outcome: result.results[0]?.outcome ?? 'failed',
        error: result.results[0]?.error,
        detail: result.results[0]?.detail,
        url: result.results[0]?.url,
        previews: previews[platform] ?? [],
      });
    }
    return jsonOk({ results });
  });

  ui.route('POST', '/api/target/post', async (req) => {
    const body = parseBody(PostBodySchema, req.body);
    const dir = await requireExistingDir(body.dir);
    const store = await requireInitialized(dir);
    const config = await store.loadConfig();

    // The confirm gate comes BEFORE any provider construction or network.
    if (body.confirm !== config.domain) {
      return jsonErr(400, `Live posting requires confirm to exactly equal the product domain ("${config.domain}")`);
    }

    const providers = deps.providers ?? buildProviders(env);
    const result = await runPost(
      dir,
      { platform: body.platform, dryRun: false, force: body.force },
      { providers },
    );
    const outcome = result.results[0];
    if (!outcome) {
      return jsonErr(400, result.messages[0] ?? `No provider for platform ${body.platform}`);
    }
    switch (outcome.outcome) {
      case 'posted':
        return jsonOk({ posted: true, url: outcome.url, messages: result.messages });
      case 'assist-opened':
        // Submit page opened but the human clicks submit — not recorded as posted.
        return jsonOk({ assistOpened: true, url: outcome.url, messages: result.messages });
      case 'skipped-ledger':
        return jsonOk({ skipped: 'already-posted', detail: outcome.detail, messages: result.messages });
      case 'blocked':
        return jsonErr(400, `${body.platform} blocked — ${outcome.detail ?? 'missing credentials'}`);
      case 'no-draft':
        return jsonErr(400, `${body.platform} has no draft — scaffold and fill it first`);
      case 'refused-validation':
        return jsonErr(400, `${body.platform} draft fails validation: ${outcome.error ?? ''}`);
      default:
        return jsonErr(502, outcome.error ?? `${body.platform} post failed`);
    }
  });

  ui.route('POST', '/api/target/notify', async (req) => {
    const body = parseBody(NotifyBodySchema, req.body);
    const dir = await requireExistingDir(body.dir);
    const store = await requireInitialized(dir);

    const live = body.live === true;
    if (live) {
      const config = await store.loadConfig();
      if (body.confirm !== config.domain) {
        return jsonErr(400, `Writing live notify payloads requires confirm to exactly equal the product domain ("${config.domain}")`);
      }
    }
    const result = await runNotify(dir, { channel: body.channel, preview: !live });
    if (result.exitCode !== 0) return jsonErr(400, result.messages.join(' | '));
    return jsonOk({
      live,
      messages: result.messages,
      consent: result.consent,
      payloadCount: result.payloadCount,
      payloadsPath: result.payloadsPath,
    });
  });

  ui.route('PUT', '/api/target/config/postkit', async (req) => {
    const body = parseBody(PostkitConfigBodySchema, req.body);
    const dir = await requireExistingDir(body.dir);
    const store = await requireInitialized(dir);
    const config = await store.loadConfig();
    if (!body.postkitDir) {
      await store.saveConfig({ ...config, postkitDir: undefined });
      return jsonOk({ postkitDir: null });
    }
    let kit;
    try {
      kit = await loadPostKit(body.postkitDir);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err), [
        { field: 'postkitDir', message: 'not a valid post kit' },
      ]);
    }
    await store.saveConfig({ ...config, postkitDir: kit.dir });
    return jsonOk({ postkitDir: kit.dir });
  });

  ui.route('POST', '/api/target/postkit/open', async (req) => {
    const body = parseBody(PostkitOpenBodySchema, req.body);
    const dir = await requireExistingDir(body.dir);
    const store = await requireInitialized(dir);
    const config = await store.loadConfig();
    if (!config.postkitDir) throw new HttpError(400, 'No post kit configured.');
    const kit = await loadPostKit(config.postkitDir);
    if (!kit.manifest.platforms[body.platform]) {
      throw new HttpError(400, `Post kit has no platform "${body.platform}"`);
    }
    let folder: string;
    try {
      folder = resolveInside(kit.dir, body.platform);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    openPath(folder);
    return jsonOk({ opened: folder });
  });
}
