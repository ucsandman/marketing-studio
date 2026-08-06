#!/usr/bin/env node
/**
 * ComfyUI feeder client. NON-LOAD-BEARING: if the server is unreachable the
 * studio falls back to procedural backgrounds (documented fallback, exit 2).
 *
 * Usage: node feeders/comfy/client.mjs hero [--workflow NAME] [--out DIR] [--seed N]
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PORTS = [8000, 8188]; // ComfyUI Desktop / classic default
const POLL_MS = 1500;
const TIMEOUT_MS = 5 * 60 * 1000;

const POSITIVE =
  'abstract dark trading terminal backdrop, deep violet glow on near black, faint geometric grid lines, subtle depth haze, cinematic minimal composition, high detail';
const NEGATIVE = 'text, watermark, logo, people, faces, bright colors, green, ui, screenshot';

export const fillTemplate = (text, tokens) => {
  let out = text;
  for (const [key, value] of Object.entries(tokens)) {
    // numeric tokens replace the quoted placeholder to stay valid JSON numbers
    out = out.replaceAll(`"{{${key}}}"`, typeof value === 'number' ? String(value) : `"${value}"`);
    out = out.replaceAll(`{{${key}}}`, String(value));
  }
  const leftover = out.match(/\{\{[A-Z_]+\}\}/);
  if (leftover) throw new Error(`unresolved token ${leftover[0]} in workflow template`);
  return JSON.parse(out);
};

export const firstCheckpoint = (objectInfo) =>
  objectInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]?.[0] ?? null;

export const imagesFromHistory = (history, promptId) =>
  Object.values(history?.[promptId]?.outputs ?? {}).flatMap((node) => node.images ?? []);

const probe = async () => {
  for (const port of PORTS) {
    const base = `http://127.0.0.1:${port}`;
    try {
      const res = await fetch(`${base}/system_stats`, {signal: AbortSignal.timeout(2000)});
      if (res.ok) return base;
    } catch {
      /* try next port */
    }
  }
  return null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runHero = async (outDir, seed, WORKFLOW = 'synthacon') => {
  const base = await probe();
  if (!base) {
    console.error(
      'ComfyUI not reachable on :8000/:8188. Falling back to the procedural background (documented fallback). Start ComfyUI Desktop and re-run to generate the AI hero.',
    );
    process.exit(2);
  }
  console.log(`comfy: ${base}`);

  const info = await (
    await fetch(`${base}/object_info/CheckpointLoaderSimple`, {signal: AbortSignal.timeout(10_000)})
  ).json();
  const checkpoint = process.env.COMFY_CHECKPOINT || firstCheckpoint(info);
  if (!checkpoint) {
    console.error('no checkpoints installed in ComfyUI; install a model or set COMFY_CHECKPOINT');
    process.exit(1);
  }
  console.log(`checkpoint: ${checkpoint}`);

  // Workflow graphs are per-brand and live in workflows/<brand>-hero.json. None
  // ship in-repo today (the noban graph went with the synthacon-only slim), so
  // this fails loudly rather than silently rendering the wrong brand's hero.
  const workflowPath = join(HERE, 'workflows', `${WORKFLOW}-hero.json`);
  if (!existsSync(workflowPath)) {
    console.error(`no ComfyUI workflow at ${workflowPath}; author it or pass --workflow <name>`);
    process.exit(1);
  }
  const template = readFileSync(workflowPath, 'utf8');
  const graph = fillTemplate(template, {
    CHECKPOINT: checkpoint,
    POSITIVE,
    NEGATIVE,
    SEED: seed,
  });

  const queue = await (
    await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({prompt: graph, client_id: randomUUID()}),
      signal: AbortSignal.timeout(10_000),
    })
  ).json();
  if (!queue.prompt_id) {
    console.error(`queue rejected: ${JSON.stringify(queue).slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`queued: ${queue.prompt_id}`);

  const deadline = Date.now() + TIMEOUT_MS;
  let images = [];
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const history = await (
      await fetch(`${base}/history/${queue.prompt_id}`, {signal: AbortSignal.timeout(10_000)})
    ).json();
    images = imagesFromHistory(history, queue.prompt_id);
    if (images.length > 0) break;
  }
  if (images.length === 0) {
    console.error('render timed out after 5 minutes');
    process.exit(1);
  }

  const img = images[0];
  const params = new URLSearchParams({filename: img.filename, subfolder: img.subfolder, type: img.type});
  const bytes = Buffer.from(
    await (await fetch(`${base}/view?${params}`, {signal: AbortSignal.timeout(60_000)})).arrayBuffer(),
  );
  mkdirSync(outDir, {recursive: true});
  const dest = join(outDir, 'hero.png');
  writeFileSync(dest, bytes);
  console.log(`hero OK: ${dest} (${Math.round(bytes.length / 1024)} KB, seed ${seed})`);
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] !== 'hero') {
    console.error('usage: node feeders/comfy/client.mjs hero [--workflow NAME] [--out DIR] [--seed N]');
    process.exit(1);
  }
  const outIdx = args.indexOf('--out');
  const seedIdx = args.indexOf('--seed');
  const wfIdx = args.indexOf('--workflow');
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : join(ROOT, 'assets', 'synthacon', 'comfy');
  const seed = seedIdx >= 0 ? Number(args[seedIdx + 1]) : 47;
  await runHero(outDir, seed, wfIdx >= 0 ? args[wfIdx + 1] : 'synthacon');
}
