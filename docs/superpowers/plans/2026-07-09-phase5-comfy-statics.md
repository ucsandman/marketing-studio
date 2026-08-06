# Animation Studio Phase 5 — ComfyUI feeder + Static-plus (AnimatedOG + README GIF)

> **Historical note:** this plan predates the later slim of the studio to
> synthacon-only. References to noban, dashclaw, or paperroute below are
> historical and describe brands that have since been removed from the repo.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ComfyUI feeder (local API client + stored workflow) and the Static-plus exports: an animated OG loop and a README GIF for noban.gg, with the OG's AI hero background falling back to the procedural loop when ComfyUI is unavailable.

**Architecture:** A dependency-free Node client (`feeders/comfy/client.mjs`) queues a stored workflow JSON template against ComfyUI Desktop's local API (ports 8000/8188), polls history, and saves the output image to `assets/noban/comfy/`; it is explicitly non-load-bearing — unreachable server exits with a documented fallback message and everything downstream still renders. A new `AnimatedOG` Remotion composition (1200x630, 240 frames, mathematically seamless loop: every animated quantity is periodic over the duration) layers an optional ComfyUI hero image over the phase 3 background loop with the brand lockup. A presets script renders `og.mp4`, `og.gif`, and `readme.gif` via Remotion's GIF codec.

**Tech Stack:** Node 18+ built-in fetch + node:test (feeder), Remotion 4.0.486 GIF codec (`--codec=gif`, `--every-nth-frame`, `--scale`), existing components (BackgroundLoop, PngSequence, NobanMark, FloatBar). No new dependencies.

## Global Constraints

- Repo root `C:\Projects\animations`; Git Bash. Studio checks from `studio/`: `npm test` (22 tests currently), `npm run lint`.
- ComfyUI is NON-LOAD-BEARING (spec): if unavailable, every template still renders; the fallback to the procedural background must be LOGGED, not silent. The client probes ports 8000 then 8188 (`/system_stats`, same as launch.py) and exits code 2 with an actionable message when unreachable.
- Spec: "Workflows stored as JSON" — the graph lives in `feeders/comfy/workflows/noban-hero.json` with `{{TOKEN}}` placeholders; the client fills tokens, it does not build graphs in code.
- 8GB VRAM scope (spec): one 1216x640 txt2img still, ~22 steps. Deterministic default seed 47 (`--seed` overrides) for reproducibility.
- noban brand: profit/CTA gold `#d6c23c` NEVER green; violet `#8847ff`; values only via `getBrand('noban')`. AI hero prompt must forbid green/text/logos (negative prompt).
- Loop-seamlessness: `AnimatedOG` is a 240-frame loop; every animated value must satisfy f(0) == f(240) (the background loop is seamless over exactly 240 frames — do not resample it).
- Null-safe smoke: `heroImage`/`loopSequence` nullable with placeholders; smoke must list 6 compositions and stay green on a clean clone.
- Rendered proof for all visual work. Outputs land in `out/noban/` (gitignored). No em dashes in copy.

## File Structure (end state of Phase 5)

```
feeders/comfy/
├── client.mjs               # health, template fill, queue, poll, download (Task 1)
├── client.test.mjs          # node:test for the pure helpers (Task 1)
└── workflows/noban-hero.json # txt2img graph template with {{TOKEN}}s (Task 1)
studio/src/templates/AnimatedOG.tsx  # 1200x630 seamless loop (Task 2)
studio/src/Root.tsx          # + AnimatedOG (Task 2)
scripts/smoke.mjs            # + AnimatedOG (Task 2)
scripts/render-statics.mjs   # og.mp4 / og.gif / readme.gif presets + hero staging (Task 3)
assets/noban/comfy/hero.png  # ComfyUI output (gitignored, Task 4 when live)
```

---

### Task 1: ComfyUI client + stored workflow

**Files:**
- Create: `feeders/comfy/client.mjs`
- Create: `feeders/comfy/workflows/noban-hero.json`
- Test: `feeders/comfy/client.test.mjs` (run via `node --test client.test.mjs` from `feeders/comfy/`)

**Interfaces:**
- Produces:
  - CLI: `node feeders/comfy/client.mjs hero [--out DIR] [--seed N]` — default out `assets/noban/comfy`. Exit 0 = image saved as `hero.png`; exit 2 = server unreachable (fallback message printed); exit 1 = server reachable but the job failed.
  - Pure helpers (unit tested): `fillTemplate(text: string, tokens: Record<string, string | number>): object` (replaces `"{{KEY}}"` for numbers and `{{KEY}}` inside strings, then JSON.parse), `firstCheckpoint(objectInfo: object): string | null`, `imagesFromHistory(history: object, promptId: string): {filename: string; subfolder: string; type: string}[]`.

- [ ] **Step 1: Write the failing test** — `feeders/comfy/client.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {fillTemplate, firstCheckpoint, imagesFromHistory} from './client.mjs';

test('fillTemplate substitutes string and numeric tokens and parses', () => {
  const text = '{"a": {"inputs": {"ckpt_name": "{{CHECKPOINT}}", "seed": "{{SEED}}", "text": "x {{POSITIVE}} y"}}}';
  const graph = fillTemplate(text, {CHECKPOINT: 'model.safetensors', SEED: 47, POSITIVE: 'violet grid'});
  assert.equal(graph.a.inputs.ckpt_name, 'model.safetensors');
  assert.equal(graph.a.inputs.seed, 47); // numeric, unquoted
  assert.equal(graph.a.inputs.text, 'x violet grid y');
});

test('fillTemplate throws on unresolved tokens', () => {
  assert.throws(() => fillTemplate('{"x": "{{MISSING}}"}', {}), /unresolved token/i);
});

test('firstCheckpoint reads the object_info enum shape', () => {
  const info = {CheckpointLoaderSimple: {input: {required: {ckpt_name: [['a.safetensors', 'b.ckpt']]}}}};
  assert.equal(firstCheckpoint(info), 'a.safetensors');
  assert.equal(firstCheckpoint({}), null);
});

test('imagesFromHistory collects images across output nodes', () => {
  const history = {
    p1: {outputs: {'9': {images: [{filename: 'noban_hero_00001_.png', subfolder: '', type: 'output'}]}}},
  };
  assert.deepEqual(imagesFromHistory(history, 'p1'), [
    {filename: 'noban_hero_00001_.png', subfolder: '', type: 'output'},
  ]);
  assert.deepEqual(imagesFromHistory({}, 'p1'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projects/animations/feeders/comfy && node --test client.test.mjs`
Expected: FAIL — cannot find module './client.mjs'.

- [ ] **Step 3: Write `feeders/comfy/workflows/noban-hero.json`**

```json
{
  "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "{{CHECKPOINT}}"}},
  "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 1216, "height": 640, "batch_size": 1}},
  "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{POSITIVE}}", "clip": ["4", 1]}},
  "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{NEGATIVE}}", "clip": ["4", 1]}},
  "3": {"class_type": "KSampler", "inputs": {"seed": "{{SEED}}", "steps": 22, "cfg": 6.5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
  "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
  "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "noban_hero", "images": ["8", 0]}}
}
```

- [ ] **Step 4: Write `feeders/comfy/client.mjs`**

```js
#!/usr/bin/env node
/**
 * ComfyUI feeder client. NON-LOAD-BEARING: if the server is unreachable the
 * studio falls back to procedural backgrounds (documented fallback, exit 2).
 *
 * Usage: node feeders/comfy/client.mjs hero [--out DIR] [--seed N]
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
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

const runHero = async (outDir, seed) => {
  const base = await probe();
  if (!base) {
    console.error(
      'ComfyUI not reachable on :8000/:8188. Falling back to the procedural background (documented fallback). Start ComfyUI Desktop and re-run to generate the AI hero.',
    );
    process.exit(2);
  }
  console.log(`comfy: ${base}`);

  const info = await (await fetch(`${base}/object_info/CheckpointLoaderSimple`)).json();
  const checkpoint = process.env.COMFY_CHECKPOINT || firstCheckpoint(info);
  if (!checkpoint) {
    console.error('no checkpoints installed in ComfyUI; install a model or set COMFY_CHECKPOINT');
    process.exit(1);
  }
  console.log(`checkpoint: ${checkpoint}`);

  const template = readFileSync(join(HERE, 'workflows', 'noban-hero.json'), 'utf8');
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
    const history = await (await fetch(`${base}/history/${queue.prompt_id}`)).json();
    images = imagesFromHistory(history, queue.prompt_id);
    if (images.length > 0) break;
  }
  if (images.length === 0) {
    console.error('render timed out after 5 minutes');
    process.exit(1);
  }

  const img = images[0];
  const params = new URLSearchParams({filename: img.filename, subfolder: img.subfolder, type: img.type});
  const bytes = Buffer.from(await (await fetch(`${base}/view?${params}`)).arrayBuffer());
  mkdirSync(outDir, {recursive: true});
  const dest = join(outDir, 'hero.png');
  writeFileSync(dest, bytes);
  console.log(`hero OK: ${dest} (${Math.round(bytes.length / 1024)} KB, seed ${seed})`);
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] !== 'hero') {
    console.error('usage: node feeders/comfy/client.mjs hero [--out DIR] [--seed N]');
    process.exit(1);
  }
  const outIdx = args.indexOf('--out');
  const seedIdx = args.indexOf('--seed');
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : join(ROOT, 'assets', 'noban', 'comfy');
  const seed = seedIdx >= 0 ? Number(args[seedIdx + 1]) : 47;
  await runHero(outDir, seed);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /c/Projects/animations/feeders/comfy && node --test client.test.mjs`
Expected: 4 tests PASS.

- [ ] **Step 6: Verify the fallback path fails loudly with exit 2** (ComfyUI is expected to be down right now; if it happens to be up, this step instead verifies the happy path and Task 4 gets a head start)

```bash
cd /c/Projects/animations && node feeders/comfy/client.mjs hero; echo "exit=$?"
```

Expected (server down): the documented fallback message, `exit=2`.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/animations
git add feeders/comfy/client.mjs feeders/comfy/client.test.mjs feeders/comfy/workflows/noban-hero.json
git commit -m "feat: ComfyUI feeder client with stored hero workflow and documented fallback"
```

---

### Task 2: AnimatedOG composition (seamless 240-frame loop)

**Files:**
- Create: `studio/src/templates/AnimatedOG.tsx`
- Modify: `studio/src/Root.tsx` (register)
- Modify: `scripts/smoke.mjs` (add `AnimatedOG`)

**Interfaces:**
- Consumes: `BackgroundLoop`, `NobanMark`, `FloatBar`, `getBrand`, `loadBrandFonts` (existing).
- Produces: composition id `AnimatedOG`, 1200x630 @30fps, 240 frames. `animatedOgSchema = z.object({brandId: z.string(), tagline: z.string(), cta: z.string(), heroImage: z.string().nullable(), loopSequence: z.string().nullable(), loopFrames: z.number().int().positive()})`. Every animated value is periodic over 240 frames (seamless GIF loop): the background loop plays its full 240-frame cycle, the float bar ping-pongs 0 to 1 to 0, the glow pulses one full sine cycle. No intro reveal; the lockup is static.

- [ ] **Step 1: Write `studio/src/templates/AnimatedOG.tsx`**

```tsx
import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {NobanMark} from '../brands/NobanMark';
import {FloatBar} from '../components/FloatBar';
import {BackgroundLoop} from '../components/BackgroundLoop';

export const animatedOgSchema = z.object({
  brandId: z.string(),
  tagline: z.string(),
  cta: z.string(),
  heroImage: z.string().nullable(),
  loopSequence: z.string().nullable(),
  loopFrames: z.number().int().positive(),
});

type Props = z.infer<typeof animatedOgSchema>;

export const AnimatedOG: React.FC<Props> = ({tagline, cta, heroImage, loopSequence, loopFrames}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const cycle = frame / durationInFrames; // 0..1, and frame N == frame 0 on loop
  // triangular ping-pong: 0 -> 1 -> 0 across the loop, continuous at the seam
  const barProgress = cycle < 0.5 ? cycle * 2 : 2 - cycle * 2;
  // one full sine cycle: periodic glow breath
  const glow = 0.75 + 0.25 * Math.sin(2 * Math.PI * cycle);
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <BackgroundLoop dir={loopSequence} frameCount={loopFrames} opacity={0.6} />
      {heroImage ? (
        <Img
          src={staticFile(heroImage)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.35,
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 60% at 50% 40%, ${brand.colors.brand}30, transparent 72%)`,
          opacity: glow,
        }}
      />
      <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 18}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 24}}>
          <NobanMark size={84} color={brand.colors.brand} />
          <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 88, color: brand.colors.ink}}>
            {brand.name}
          </div>
        </div>
        <div style={{fontFamily: fonts.body, fontSize: 30, color: brand.colors.ink2}}>{tagline}</div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 22,
            letterSpacing: '0.22em',
            color: brand.colors.profit,
            marginTop: 6,
          }}
        >
          {cta.toUpperCase()}
        </div>
      </AbsoluteFill>
      <div style={{position: 'absolute', bottom: 36, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={barProgress} brand={brand} width={480} />
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Register in `studio/src/Root.tsx`**

```tsx
import { AnimatedOG, animatedOgSchema } from "./templates/AnimatedOG";
```

```tsx
<Composition
  id="AnimatedOG"
  component={AnimatedOG}
  durationInFrames={240}
  fps={30}
  width={1200}
  height={630}
  schema={animatedOgSchema}
  defaultProps={{
    brandId: "noban",
    tagline: "CS2 skin arbitrage with guardrails",
    cta: "Simulate free at noban.gg",
    heroImage: null,
    loopSequence: null,
    loopFrames: 240,
  }}
/>
```

- [ ] **Step 3: Add `AnimatedOG` to `scripts/smoke.mjs`** (compositions array gains `'AnimatedOG'`, now 6 entries)

- [ ] **Step 4: Rendered proof + loop-seam check + smoke**

```bash
cd /c/Projects/animations/studio
npx remotion still AnimatedOG ../out/smoke/og-0.png --frame=0 --props='{"brandId":"noban","tagline":"CS2 skin arbitrage with guardrails","cta":"Simulate free at noban.gg","heroImage":null,"loopSequence":"noban/background-loop","loopFrames":240}'
npx remotion still AnimatedOG ../out/smoke/og-120.png --frame=120 --props='{"brandId":"noban","tagline":"CS2 skin arbitrage with guardrails","cta":"Simulate free at noban.gg","heroImage":null,"loopSequence":"noban/background-loop","loopFrames":240}'
npx remotion still AnimatedOG ../out/smoke/og-239.png --frame=239 --props='{"brandId":"noban","tagline":"CS2 skin arbitrage with guardrails","cta":"Simulate free at noban.gg","heroImage":null,"loopSequence":"noban/background-loop","loopFrames":240}'
cd /c/Projects/animations && node scripts/smoke.mjs
```

Inspect: frame 0 = lockup over loop backdrop, float bar near 0, gold CTA; frame 120 = float bar at max, backdrop mid-phase; frame 239 = nearly identical to frame 0 (bar returning to 0, glow completing its cycle) — the seam check. Nothing green. Smoke: `smoke OK: 6 compositions`.

- [ ] **Step 5: Tests + lint**

Run: `cd /c/Projects/animations/studio && npm test && npm run lint`
Expected: 22 tests pass, lint clean.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/animations
git add studio/src/templates/AnimatedOG.tsx studio/src/Root.tsx scripts/smoke.mjs
git commit -m "feat: AnimatedOG seamless loop composition"
```

---

### Task 3: Static export presets (og.mp4 / og.gif / readme.gif)

**Files:**
- Create: `scripts/render-statics.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: `AnimatedOG` composition; optional `assets/noban/comfy/hero.png` (Task 4 output); staged `studio/public/noban/background-loop/`.
- Produces: `out/noban/og.mp4` (1200x630), `out/noban/og.gif` (1200x630, 15 effective fps), `out/noban/readme.gif` (600x315). The script stages the ComfyUI hero into `studio/public/noban/hero.png` when it exists, and LOGS the documented fallback when it does not.

- [ ] **Step 1: Write `scripts/render-statics.mjs`**

```js
// Renders the AnimatedOG static-plus exports. If the ComfyUI hero exists it is
// staged and used; otherwise the procedural loop is the backdrop (documented
// fallback, logged below).
import {copyFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hero = join(root, 'assets', 'noban', 'comfy', 'hero.png');
const staged = join(root, 'studio', 'public', 'noban', 'hero.png');

let heroImage = null;
if (existsSync(hero)) {
  mkdirSync(dirname(staged), {recursive: true});
  copyFileSync(hero, staged);
  heroImage = 'noban/hero.png';
  console.log('using ComfyUI hero backdrop');
} else {
  console.log('comfy hero missing; procedural background fallback (documented). Run: node feeders/comfy/client.mjs hero');
}

const props = {
  brandId: 'noban',
  tagline: 'CS2 skin arbitrage with guardrails',
  cta: 'Simulate free at noban.gg',
  heroImage,
  loopSequence: 'noban/background-loop',
  loopFrames: 240,
};
const propsPath = join(root, 'out', 'noban', 'og-props.json');
mkdirSync(dirname(propsPath), {recursive: true});
writeFileSync(propsPath, JSON.stringify(props));

const render = (args, out) => {
  console.log(`render: ${out}`);
  execSync(`npx remotion render AnimatedOG "${join(root, 'out', 'noban', out)}" --props="${propsPath}" ${args}`, {
    cwd: join(root, 'studio'),
    stdio: 'inherit',
  });
};

render('', 'og.mp4');
render('--codec=gif --every-nth-frame=2', 'og.gif');
render('--codec=gif --every-nth-frame=2 --scale=0.5', 'readme.gif');
console.log('statics OK: og.mp4, og.gif, readme.gif in out/noban/');
```

- [ ] **Step 2: Run it and verify the outputs** (three renders, ~2-6 min total; timeout 600000ms)

```bash
cd /c/Projects/animations && node scripts/render-statics.mjs
```

Expected: fallback log line (hero not generated yet), then three renders, `statics OK`. Verify sizes are sane (`ls -la out/noban/`): og.mp4 a few MB, og.gif larger, readme.gif smallest.

- [ ] **Step 3: Rendered proof**

Extract and inspect a GIF frame via the mp4 (same content): `cd studio && npx remotion still AnimatedOG ../out/smoke/og-review.png --frame=60 --props=../out/noban/og-props.json`. Read it: lockup sharp at OG size, gold CTA, backdrop subtle. Also open `out/noban/readme.gif` with the Read tool (first frame renders) to confirm the scaled export is legible.

- [ ] **Step 4: Update `README.md`**

Under Run (manual equivalents), after the build-launch-props line:

```markdown
    node feeders/comfy/client.mjs hero        # optional: AI hero backdrop (needs ComfyUI Desktop; falls back cleanly)
    node scripts/render-statics.mjs           # og.mp4 + og.gif + readme.gif
```

- [ ] **Step 5: Commit**

```bash
cd /c/Projects/animations
git add scripts/render-statics.mjs README.md
git commit -m "feat: animated OG and README GIF export presets"
```

---

### Task 4: Live ComfyUI attempt + review handoff (exit criterion)

**Files:**
- Generated only (gitignored): `assets/noban/comfy/hero.png`, `studio/public/noban/hero.png`, re-rendered `out/noban/og.*`, `readme.gif`

**Interfaces:**
- Consumes: everything above.
- Produces: final `out/noban/og.mp4`, `out/noban/og.gif`, `out/noban/readme.gif` for user review. **Phase exit criterion: user approves the animated OG + README GIF.** ComfyUI output is a bonus, not a gate (spec: non-load-bearing).

- [ ] **Step 1: Probe ComfyUI** (`python launch.py --check` shows the ComfyUI line). If not running, ask the user once whether to start ComfyUI Desktop; if they decline or it stays down, SKIP steps 2-3 — the fallback renders from Task 3 are the deliverables, and the fallback is already logged/documented.

- [ ] **Step 2 (ComfyUI up): Generate the hero and inspect it**

```bash
cd /c/Projects/animations && node feeders/comfy/client.mjs hero
```

Read `assets/noban/comfy/hero.png`: dark abstract violet backdrop, no text/people/green. If it clashes with the brand (too bright, wrong hue), re-run with another `--seed` until acceptable; note seeds tried.

- [ ] **Step 3 (ComfyUI up): Re-render statics with the hero**

```bash
node scripts/render-statics.mjs
```

Expected: `using ComfyUI hero backdrop`; re-inspect one still (Task 3 Step 3 command) — the hero should read as subtle texture under the lockup, not compete with it.

- [ ] **Step 4: Send for user review**

Send `out/noban/og.gif` (or og.mp4) and `out/noban/readme.gif`. **Exit criterion: user approval.** Apply redlines and re-render as needed.

- [ ] **Step 5: Commit** (only if any tracked file changed in redlines; the standard outputs are all gitignored)

---

## Self-Review Notes

- **Spec coverage (phase 5 scope):** ComfyUI API client + workflows stored as JSON (T1), 8GB-VRAM-scoped hero still (T1/T4), explicitly non-load-bearing with LOGGED fallback (T1 exit-2 message + T3 fallback log), AnimatedOG (T2), GIF export presets (T3), exit artifacts animated OG + README GIF (T3/T4). launch.py already health-checks ComfyUI on :8000/:8188 (phase 1).
- **Type consistency:** `animatedOgSchema` fields match the props object `render-statics.mjs` writes; client helper names match between test and implementation; `hero.png` path contract consistent across T1 (writer), T3 (stager), T4 (inspector).
- **Known judgment calls:** the OG loop is ambient (no intro reveal) so the GIF loops seamlessly rather than replaying an entrance; workflow template targets `CheckpointLoaderSimple` txt2img (the most portable graph) with the first installed checkpoint unless `COMFY_CHECKPOINT` overrides; GIFs use `--every-nth-frame=2` (effective 15fps) to keep file sizes sane; the exit criterion deliberately does not require ComfyUI output, matching the spec's non-load-bearing rule.
- **Placeholder scan:** clean; every step has complete code/commands.
