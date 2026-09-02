import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { HttpError, jsonOk, type UiRequest, type UiServer } from './server.js';
import { RecentsStore } from '../recents.js';
import { LaunchStore } from '../state.js';
import { scanTarget } from '../intake.js';
import { runStatus } from '../commands/status.js';
import { runDoctor } from '../commands/doctor.js';
import { buildProviders } from '../providers/index.js';
import type { Provider } from '../providers/types.js';
import { isStale, parseBriefMeta } from '../research/brief.js';
import { PLATFORM_LIMITS, validateDraft } from '../copy/validate.js';
import { DRAFT_PLATFORMS, PLATFORMS } from '../types.js';
import { loadPostKit, resolveInside } from '../postkit.js';
import { isMediaPlatform, mediaProblems, probeVideo } from '../media-probe.js';

/**
 * Read-only endpoints: thin wrappers over the same run*() functions the CLI
 * uses, so the GUI sees exactly what the CLI sees. Provider readiness reports
 * missing env KEY NAMES only — env values never enter a response.
 */

export interface ReadRouteDeps {
  recents?: RecentsStore;
  env?: NodeJS.ProcessEnv;
  osPlatform?: NodeJS.Platform;
  /** Injected by tests so doctor never makes live network calls. */
  providers?: Provider[];
}

/** Validate a target dir value — must be an absolute path to an existing directory. */
export async function requireExistingDir(dir: string | null | undefined): Promise<string> {
  if (!dir) throw new HttpError(400, 'Missing required parameter: dir');
  if (!isAbsolute(dir)) throw new HttpError(400, `dir must be an absolute path: ${dir}`);
  try {
    if (!(await stat(dir)).isDirectory()) {
      throw new HttpError(400, `dir is not a directory: ${dir}`);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, `dir does not exist: ${dir}`);
  }
  return dir;
}

const requireDir = (req: UiRequest): Promise<string> => requireExistingDir(req.query.get('dir'));

async function listRoots(osPlatform: NodeJS.Platform): Promise<{ name: string; path: string }[]> {
  if (osPlatform !== 'win32') {
    return [{ name: '/', path: '/' }];
  }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const roots: { name: string; path: string }[] = [];
  for (const letter of letters) {
    const drive = `${letter}:\\`;
    try {
      if ((await stat(drive)).isDirectory()) roots.push({ name: drive, path: drive });
    } catch {
      // drive letter not mounted
    }
  }
  return roots;
}

export function registerReadRoutes(ui: UiServer, deps: ReadRouteDeps = {}): void {
  const recents = deps.recents ?? new RecentsStore();
  const env = deps.env ?? process.env;
  const osPlatform = deps.osPlatform ?? process.platform;

  ui.route('GET', '/api/meta/platforms', () =>
    jsonOk({
      draftPlatforms: DRAFT_PLATFORMS,
      limits: PLATFORM_LIMITS,
      // HN/PH are assist-only BY DESIGN (automation is a ban risk) — the UI
      // must never render a live-post control for them.
      assistOnly: ['hackernews', 'producthunt'],
    }),
  );

  ui.route('GET', '/api/products', async () => {
    const file = await recents.load();
    const targets = file.targets.map((t) => ({
      ...t,
      initialized: new LaunchStore(t.dir).hasConfig(),
    }));
    return jsonOk({ targets });
  });

  ui.route('GET', '/api/fs', async (req) => {
    const requested = req.query.get('path');
    if (!requested) {
      return jsonOk({ path: null, parent: null, entries: await listRoots(osPlatform) });
    }
    if (!isAbsolute(requested)) {
      throw new HttpError(400, `path must be absolute: ${requested}`);
    }
    let names;
    try {
      names = await readdir(requested, { withFileTypes: true });
    } catch {
      throw new HttpError(400, `Cannot list directory: ${requested}`);
    }
    // Directories only, dotfiles hidden — never file entries, never contents.
    const entries = names
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: join(requested, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = dirname(requested);
    return jsonOk({ path: requested, parent: parent === requested ? null : parent, entries });
  });

  ui.route('GET', '/api/target', async (req) => {
    const dir = await requireDir(req);
    const store = new LaunchStore(dir);
    const scan = await scanTarget(dir);
    if (!store.hasConfig()) return jsonOk({ initialized: false, scan });
    return jsonOk({ initialized: true, config: await store.loadConfig(), scan });
  });

  ui.route('GET', '/api/target/status', async (req) => {
    const dir = await requireDir(req);
    return jsonOk(await runStatus(dir));
  });

  ui.route('GET', '/api/target/doctor', async () => {
    return jsonOk(await runDoctor({ providers: deps.providers ?? buildProviders(env) }));
  });

  ui.route('GET', '/api/target/briefs', async (req) => {
    const dir = await requireDir(req);
    const store = new LaunchStore(dir);
    if (!store.hasConfig()) return jsonOk({ initialized: false, briefs: [] });
    const briefs = [];
    for (const platform of PLATFORMS) {
      const briefPath = join(store.researchDir, `${platform}.md`);
      if (!existsSync(briefPath)) continue;
      const content = await readFile(briefPath, 'utf8');
      const meta = parseBriefMeta(content);
      briefs.push({
        platform,
        content,
        meta: meta ?? null,
        stale: meta ? isStale(meta, new Date()) : true,
      });
    }
    return jsonOk({ initialized: true, briefs });
  });

  ui.route('GET', '/api/target/drafts', async (req) => {
    const dir = await requireDir(req);
    const store = new LaunchStore(dir);
    if (!store.hasConfig()) return jsonOk({ initialized: false, drafts: [] });
    const config = await store.loadConfig();
    const drafts = [];
    for (const platform of DRAFT_PLATFORMS) {
      const draft = await store.loadDraft(platform);
      if (!draft) continue;
      drafts.push({
        platform,
        draft,
        validation: validateDraft(draft, { productUrl: config.productUrl }),
      });
    }
    return jsonOk({ initialized: true, drafts });
  });

  ui.route('GET', '/api/target/postkit', async (req) => {
    const dir = await requireDir(req);
    const store = new LaunchStore(dir);
    if (!store.hasConfig()) return jsonOk({ initialized: false, configured: false, platforms: [] });
    const config = await store.loadConfig();
    if (!config.postkitDir) return jsonOk({ initialized: true, configured: false, platforms: [] });

    let kit;
    try {
      kit = await loadPostKit(config.postkitDir);
    } catch (err) {
      return jsonOk({
        initialized: true,
        configured: true,
        dir: config.postkitDir,
        manifestError: err instanceof Error ? err.message : String(err),
        platforms: [],
      });
    }

    const platforms = [];
    for (const [platform, entry] of Object.entries(kit.manifest.platforms)) {
      let video: { file: string; missing: boolean; sizeBytes: number | null } | null = null;
      if (entry.video) {
        let sizeBytes: number | null = null;
        try {
          const videoPath = resolveInside(kit.dir, entry.video);
          sizeBytes = (await stat(videoPath)).size;
        } catch {
          sizeBytes = null;
        }
        video = { file: entry.video, missing: sizeBytes === null, sizeBytes };
      }
      let caption: string | null = null;
      if (entry.caption) {
        try {
          caption = (await readFile(resolveInside(kit.dir, entry.caption), 'utf8')).trim();
        } catch {
          caption = null;
        }
      }
      let thumbDataUri: string | null = null;
      if (entry.thumb) {
        try {
          const thumbPath = resolveInside(kit.dir, entry.thumb);
          const buf = await readFile(thumbPath);
          const mime = thumbPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
          thumbDataUri = `data:${mime};base64,${buf.toString('base64')}`;
        } catch {
          thumbDataUri = null;
        }
      }
      const autoAttach = platform === 'x' || platform === 'linkedin';
      // The badge follows the LIMIT TABLE, not autoAttach: bluesky has its own
      // (much lower) cap and must not read as OK just because it is not auto-attached.
      let check: { ok: boolean; durationSeconds: number | null; problems: string[] } | null = null;
      if (isMediaPlatform(platform) && entry.video && video && !video.missing) {
        try {
          const probe = await probeVideo(resolveInside(kit.dir, entry.video));
          const problems = mediaProblems(platform, probe);
          check = { ok: problems.length === 0, durationSeconds: probe.durationSeconds, problems };
        } catch (err) {
          check = { ok: false, durationSeconds: null, problems: [err instanceof Error ? err.message : String(err)] };
        }
      }
      platforms.push({
        platform,
        autoAttach,
        folder: join(kit.dir, platform),
        note: entry.note,
        video,
        caption,
        thumbDataUri,
        check,
      });
    }
    return jsonOk({
      initialized: true,
      configured: true,
      dir: kit.dir,
      brand: kit.manifest.brand,
      generatedAt: kit.manifest.generatedAt,
      platforms,
    });
  });
}
