# Animation Studio Phase 1 — Remotion Core + noban.gg Social Clip

> **Historical note:** this plan predates the later slim of the studio to
> synthacon-only. References to noban, dashclaw, or paperroute below are
> historical and describe brands that have since been removed from the repo.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Remotion studio, brand-config system, and SocialClip template, and render one real noban.gg social clip approved in Remotion Studio.

**Architecture:** A Remotion (React/TypeScript) project in `studio/` renders all video. Brand tokens live in `brands/<id>.json`, validated by a zod schema and loaded through a registry so templates never hardcode brand values. The SocialClip template is a 10s, 1920x1080 composition: headline card → screenshot panel with feature lines → end card, with the noban float-bar motif as a progress element. `launch.py` is the single human entry point (health checks + opens Remotion Studio in the browser).

**Tech Stack:** Remotion 4.x, TypeScript, zod@3.22.3, @remotion/google-fonts, vitest (brand loader tests), Python 3 (launch.py), Node 18+.

## Global Constraints

- Platform: Windows 11. All shell steps below are Git Bash (POSIX) unless marked otherwise.
- Repo root: `C:\Projects\animations`. All paths relative to it.
- Brand values come ONLY from `brands/noban.json` (derived from `C:\Projects\noban-gg\DESIGN.md`). Templates must read tokens from the brand object, never literal hex in template code.
- noban brand rules (from DESIGN.md, non-negotiable): positive/profit = gold `#d6c23c`, NEVER green; green `#3fd08c` = safe/simulation only; danger/loss = red `#eb4b4b`; primary accent violet `#8847ff`; near-black bg `#0b0a0f`. No neon-green esports look. Motion easing: ease-out-expo character (Remotion `spring`/`Easing.out(Easing.exp)`).
- Outward-facing copy: no em dashes, no hype words ("seamless", "elevate", "delve").
- Everything fails loudly: scripts exit non-zero on error.
- Rendered proof: a task touching visuals is not done until a rendered PNG/MP4 was produced and visually inspected.
- Do not commit `out/`, `assets/`, `studio/public/*/` (copied screenshots), or `node_modules/`.

## File Structure (end state of Phase 1)

```
animations/
├── brands/noban.json              # brand tokens (Task 2)
├── studio/                        # Remotion project (Task 1 scaffold)
│   ├── public/noban/              # copied screenshots (gitignored, Task 6)
│   └── src/
│       ├── Root.tsx               # composition registry
│       ├── lib/brand.ts           # zod schema + getBrand()
│       ├── lib/brand.test.ts      # vitest
│       ├── lib/fonts.ts           # Google Fonts loaders
│       ├── brands/NobanMark.tsx   # scope-mark logo component
│       ├── components/FloatBar.tsx
│       └── templates/SocialClip.tsx
├── scripts/smoke.mjs              # frame-0 still of every composition (Task 4)
├── props/noban-social-launch.json # real clip props (Task 6)
├── launch.py                      # health checks + open Remotion Studio (Task 5)
├── README.md                      # run steps (Task 1, updated Task 5)
├── CLAUDE.md                      # project brief (Task 1)
└── .gitignore                     # (Task 1)
```

---

### Task 1: Remotion scaffold + repo hygiene

**Files:**
- Create: `studio/` (via create-video scaffold)
- Create: `.gitignore`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Produces: a working Remotion project where `npx remotion still <id> <out.png>` and `npm run dev` (Studio) work from `studio/`. Blank template ships one composition with id `MyComp`.

- [ ] **Step 1: Scaffold the Remotion project**

```bash
cd /c/Projects/animations
npx create-video@latest --yes --blank studio
```

Expected: `studio/` created with `package.json`, `src/Root.tsx`, `src/Composition.tsx`, dependencies installed. If install was skipped, run `cd studio && npm install`.

- [ ] **Step 2: Verify the scaffold renders**

```bash
cd studio
npx remotion still MyComp ../out/smoke/scaffold-check.png --frame=0
```

Expected: exits 0, PNG exists. Open/inspect `out/smoke/scaffold-check.png` (blank template renders an empty/white frame; any valid image is a pass).

- [ ] **Step 3: Write root `.gitignore`**

```gitignore
node_modules/
out/
assets/
studio/public/*/
.env
*.log
```

- [ ] **Step 4: Write `README.md`**

```markdown
# animations

Agent-driven animation studio. Remotion is the backbone; per-product brand
configs live in `brands/`. Spec: `docs/superpowers/specs/2026-07-09-animation-studio-design.md`.

## Run

    python launch.py     # health checks + opens Remotion Studio in the browser

Manual equivalents:

    cd studio && npm install     # once
    cd studio && npm run dev     # Remotion Studio
    node scripts/smoke.mjs       # frame-0 still of every composition

## Render

    cd studio
    npx remotion render SocialClip ../out/noban/clip.mp4 --props=../props/noban-social-launch.json
```

- [ ] **Step 5: Write `CLAUDE.md`**

```markdown
# animations: agent-driven animation studio

Remotion (studio/) renders all final video. brands/<id>.json holds per-product
tokens (zod-validated via studio/src/lib/brand.ts); templates never hardcode
brand values. Feeders (Blender headless, Playwright capture, ComfyUI API) land
in feeders/ in later phases. Spec: docs/superpowers/specs/2026-07-09-animation-studio-design.md.

Rules:
- noban brand: profit = gold #d6c23c NEVER green; green = safe/simulation only.
- Rendered proof: visual work is not done until a rendered frame was inspected.
- Smoke check before claiming done: node scripts/smoke.mjs
- out/, assets/, studio/public/*/ are gitignored build products.
```

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/animations
git add .gitignore README.md CLAUDE.md studio
git commit -m "feat: scaffold Remotion studio with repo hygiene"
```

Note: `studio/node_modules` is excluded by `.gitignore`; the scaffold's own `.gitignore` inside `studio/` stays as generated.

---

### Task 2: Brand config schema, loader, and brands/noban.json

**Files:**
- Create: `brands/noban.json`
- Create: `studio/src/lib/brand.ts`
- Test: `studio/src/lib/brand.test.ts`
- Modify: `studio/package.json` (add vitest + test script), `studio/tsconfig.json` (ensure `resolveJsonModule`)

**Interfaces:**
- Produces: `getBrand(id: string): Brand` — throws on unknown id. `Brand` = `{id, name, tagline, url, colors: {bg, surface, surface2, line, ink, ink2, ink3, brand, profit, safe, loss, info, rare}, fonts: {display, body, mono}, voice}`, all strings, colors hex `#rrggbb`. Later tasks import `getBrand` and `Brand` from `../lib/brand`.

- [ ] **Step 1: Install dev/test deps**

```bash
cd /c/Projects/animations/studio
npm i zod@3.22.3
npm i -D vitest
```

Add to `studio/package.json` scripts: `"test": "vitest run"`.
In `studio/tsconfig.json` ensure `"resolveJsonModule": true` under `compilerOptions` (add if missing).

- [ ] **Step 2: Write `brands/noban.json`** (values from noban-gg DESIGN.md)

```json
{
  "id": "noban",
  "name": "noban.gg",
  "tagline": "CS2 skin arbitrage with guardrails",
  "url": "noban.gg",
  "colors": {
    "bg": "#0b0a0f",
    "surface": "#16151c",
    "surface2": "#1d1c25",
    "line": "#2a2932",
    "ink": "#f4f4f6",
    "ink2": "#bcbcc4",
    "ink3": "#9a9aa3",
    "brand": "#8847ff",
    "profit": "#d6c23c",
    "safe": "#3fd08c",
    "loss": "#eb4b4b",
    "info": "#5a86e6",
    "rare": "#df3ce0"
  },
  "fonts": {
    "display": "Saira",
    "body": "Hanken Grotesk",
    "mono": "Geist Mono"
  },
  "voice": "Instrument-grade trading terminal that speaks CS2. Terse, factual, no hype. Profit is gold, never green. Green means simulation/safe only. Red means loss/live/danger. Not esports-neon."
}
```

- [ ] **Step 3: Write the failing test** — `studio/src/lib/brand.test.ts`

```ts
import {describe, expect, it} from 'vitest';
import {getBrand} from './brand';

describe('getBrand', () => {
  it('loads the noban brand with validated tokens', () => {
    const b = getBrand('noban');
    expect(b.name).toBe('noban.gg');
    expect(b.colors.brand).toBe('#8847ff');
    expect(b.colors.profit).toBe('#d6c23c');
    expect(b.fonts.display).toBe('Saira');
  });

  it('rejects hex colors that are not #rrggbb', () => {
    // schema-level guarantee: every color token matches /^#[0-9a-f]{6}$/i
    const b = getBrand('noban');
    for (const v of Object.values(b.colors)) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('throws a loud error for unknown brand ids', () => {
    expect(() => getBrand('nope')).toThrowError(/Unknown brand "nope"/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd /c/Projects/animations/studio && npm test
```

Expected: FAIL — cannot resolve `./brand`.

- [ ] **Step 5: Write `studio/src/lib/brand.ts`**

```ts
import {z} from 'zod';
import noban from '../../../brands/noban.json';

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'expected #rrggbb hex color');

export const brandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().min(1),
  url: z.string().min(1),
  colors: z.object({
    bg: hex,
    surface: hex,
    surface2: hex,
    line: hex,
    ink: hex,
    ink2: hex,
    ink3: hex,
    brand: hex,
    profit: hex,
    safe: hex,
    loss: hex,
    info: hex,
    rare: hex,
  }),
  fonts: z.object({
    display: z.string().min(1),
    body: z.string().min(1),
    mono: z.string().min(1),
  }),
  voice: z.string().min(1),
});

export type Brand = z.infer<typeof brandSchema>;

const registry: Record<string, unknown> = {noban};

export const getBrand = (id: string): Brand => {
  const raw = registry[id];
  if (raw === undefined) {
    throw new Error(
      `Unknown brand "${id}". Available: ${Object.keys(registry).join(', ')}`,
    );
  }
  return brandSchema.parse(raw);
};
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /c/Projects/animations/studio && npm test
```

Expected: 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/animations
git add brands/noban.json studio/src/lib/brand.ts studio/src/lib/brand.test.ts studio/package.json studio/package-lock.json studio/tsconfig.json
git commit -m "feat: brand config schema, loader, and noban.gg brand tokens"
```

---

### Task 3: Fonts, logo mark, and FloatBar component

**Files:**
- Create: `studio/src/lib/fonts.ts`
- Create: `studio/src/brands/NobanMark.tsx`
- Create: `studio/src/components/FloatBar.tsx`
- Create: `studio/src/templates/ComponentGallery.tsx` (throwaway-quality but kept: a visual test bench)
- Modify: `studio/src/Root.tsx` (register `ComponentGallery`)

**Interfaces:**
- Consumes: `getBrand`, `Brand` from `../lib/brand` (Task 2).
- Produces:
  - `loadBrandFonts(): {display: string; body: string; mono: string}` from `../lib/fonts` — returns CSS font-family strings.
  - `NobanMark: React.FC<{size: number; color: string}>` from `../brands/NobanMark`.
  - `FloatBar: React.FC<{progress: number; brand: Brand; width: number; height?: number}>` from `../components/FloatBar` — `progress` 0..1; renders the CS2 wear gauge (green→gold→red gradient, zone ticks at 0.07/0.15/0.38/0.45, marker at `progress`).

- [ ] **Step 1: Install font packages**

```bash
cd /c/Projects/animations/studio
node -p "require('./package.json').dependencies.remotion"
npm i @remotion/google-fonts@<version printed above>
node -e "require.resolve('@remotion/google-fonts/Saira'); require.resolve('@remotion/google-fonts/HankenGrotesk'); require.resolve('@remotion/google-fonts/GeistMono'); console.log('fonts ok')"
```

Expected: `fonts ok`. If `GeistMono` is missing from the package, substitute `JetBrainsMono` in `fonts.ts` (visually close, tabular figures) and note the substitution in the commit message.

- [ ] **Step 2: Write `studio/src/lib/fonts.ts`**

```ts
import {loadFont as loadSaira} from '@remotion/google-fonts/Saira';
import {loadFont as loadHanken} from '@remotion/google-fonts/HankenGrotesk';
import {loadFont as loadGeistMono} from '@remotion/google-fonts/GeistMono';

// Load once at module scope; Remotion delays render until fonts resolve.
const saira = loadSaira('normal', {weights: ['600', '800']});
const hanken = loadHanken('normal', {weights: ['400', '600']});
const geistMono = loadGeistMono('normal', {weights: ['400', '500']});

export const loadBrandFonts = () => ({
  display: saira.fontFamily,
  body: hanken.fontFamily,
  mono: geistMono.fontFamily,
});
```

- [ ] **Step 3: Write `studio/src/brands/NobanMark.tsx`** (scope mark recreated from noban-gg `marketing/index.html` header SVG)

```tsx
import React from 'react';

export const NobanMark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg viewBox="0 0 32 32" width={size} height={size} fill="none" style={{color}}>
    <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="8" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
    <circle cx="16" cy="16" r="8.5" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
    <path d="M16 4.5v5M16 22.5v5M4.5 16h5M22.5 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="16" cy="16" r="2.6" fill="currentColor" />
  </svg>
);
```

- [ ] **Step 4: Write `studio/src/components/FloatBar.tsx`**

The signature motif. Wear zones: FN 0–0.07, MW 0.07–0.15, FT 0.15–0.38, WW 0.38–0.45, BS 0.45–1.0.

```tsx
import React from 'react';
import type {Brand} from '../lib/brand';

const ZONES = [0.07, 0.15, 0.38, 0.45];

export const FloatBar: React.FC<{
  progress: number; // 0..1
  brand: Brand;
  width: number;
  height?: number;
}> = ({progress, brand, width, height = 8}) => {
  const clamped = Math.max(0, Math.min(1, progress));
  const {safe, profit, loss, line, ink} = brand.colors;
  return (
    <div style={{position: 'relative', width, height}}>
      {/* track */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: height / 2,
          background: `linear-gradient(to right, ${safe}, ${profit} 45%, ${loss})`,
          opacity: 0.25,
        }}
      />
      {/* fill (revealed portion at full opacity) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: `${clamped * 100}%`,
          overflow: 'hidden',
          borderRadius: height / 2,
        }}
      >
        <div
          style={{
            width,
            height,
            background: `linear-gradient(to right, ${safe}, ${profit} 45%, ${loss})`,
          }}
        />
      </div>
      {/* zone ticks */}
      {ZONES.map((z) => (
        <div
          key={z}
          style={{
            position: 'absolute',
            left: `${z * 100}%`,
            top: -2,
            width: 1.5,
            height: height + 4,
            background: line,
          }}
        />
      ))}
      {/* marker */}
      <div
        style={{
          position: 'absolute',
          left: `${clamped * 100}%`,
          top: -6,
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `7px solid ${ink}`,
        }}
      />
    </div>
  );
};
```

- [ ] **Step 5: Write the visual test bench** — `studio/src/templates/ComponentGallery.tsx`

```tsx
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate} from 'remotion';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {NobanMark} from '../brands/NobanMark';
import {FloatBar} from '../components/FloatBar';

export const ComponentGallery: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1]);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.bg,
        color: brand.colors.ink,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 48,
      }}
    >
      <NobanMark size={96} color={brand.colors.brand} />
      <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 72}}>
        {brand.name}
      </div>
      <div style={{fontFamily: fonts.body, fontSize: 32, color: brand.colors.ink2}}>
        {brand.tagline}
      </div>
      <div style={{fontFamily: fonts.mono, fontSize: 24, color: brand.colors.profit}}>
        +$12.40 net spread
      </div>
      <FloatBar progress={progress} brand={brand} width={800} />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: Register it in `studio/src/Root.tsx`**

Replace the file contents with:

```tsx
import React from 'react';
import {Composition} from 'remotion';
import {ComponentGallery} from './templates/ComponentGallery';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ComponentGallery"
        component={ComponentGallery}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
```

(The blank template's `MyComp` registration and `src/Composition.tsx` are removed by this task; delete `src/Composition.tsx`.)

- [ ] **Step 7: Rendered proof**

```bash
cd /c/Projects/animations/studio
npx remotion still ComponentGallery ../out/smoke/gallery-mid.png --frame=45
```

Inspect the PNG (Read tool): near-black violet-tinted bg, violet scope mark, Saira wordmark, gold mono price, float bar at ~50% with ink marker and zone ticks. Fix and re-render until correct.

- [ ] **Step 8: Commit**

```bash
cd /c/Projects/animations
git add studio/src studio/package.json studio/package-lock.json
git commit -m "feat: brand fonts, noban mark, FloatBar motif + component gallery"
```

---

### Task 4: SocialClip template + smoke script

**Files:**
- Create: `studio/src/templates/SocialClip.tsx`
- Create: `scripts/smoke.mjs`
- Modify: `studio/src/Root.tsx` (register `SocialClip`)

**Interfaces:**
- Consumes: `getBrand` (Task 2), `loadBrandFonts` (Task 3), `NobanMark`, `FloatBar` (Task 3).
- Produces: composition id `SocialClip`, 300 frames @ 30fps, 1920x1080, schema `socialClipSchema = z.object({brandId, kicker, headline, lines: z.array(z.string()).min(1).max(4), screenshot: z.string().nullable(), cta})`. `screenshot` is a path relative to `studio/public/` (used via `staticFile`), or `null` to render a brand-color panel instead.

- [ ] **Step 1: Write `studio/src/templates/SocialClip.tsx`**

Structure (10s @ 30fps): frames 0–90 headline card; 70–240 screenshot panel + feature lines; 230–300 end card; FloatBar pinned bottom the whole clip as a progress element. Springs use damping 200 (no wobble; terminal register), fades use `Easing.out(Easing.exp)`.

```tsx
import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {NobanMark} from '../brands/NobanMark';
import {FloatBar} from '../components/FloatBar';

export const socialClipSchema = z.object({
  brandId: z.string(),
  kicker: z.string(),
  headline: z.string(),
  lines: z.array(z.string()).min(1).max(4),
  screenshot: z.string().nullable(),
  cta: z.string(),
});

type Props = z.infer<typeof socialClipSchema>;

const easeOutExpo = Easing.out(Easing.exp);

const Headline: React.FC<{kicker: string; headline: string}> = ({kicker, headline}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const words = headline.split(' ');
  const kickerIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: 'clamp',
    easing: easeOutExpo,
  });
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', gap: 36}}>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 30,
          letterSpacing: '0.35em',
          color: brand.colors.brand,
          opacity: kickerIn,
        }}
      >
        {kicker.toUpperCase()}
      </div>
      <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 28px', maxWidth: 1500}}>
        {words.map((w, i) => {
          const s = spring({frame: frame - 8 - i * 4, fps, config: {damping: 200}});
          return (
            <span
              key={i}
              style={{
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: 120,
                lineHeight: 1.08,
                color: brand.colors.ink,
                opacity: s,
                transform: `translateY(${(1 - s) * 40}px)`,
                display: 'inline-block',
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Feature: React.FC<{screenshot: string | null; lines: string[]}> = ({screenshot, lines}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const panelIn = spring({frame, fps, config: {damping: 200}});
  const zoom = interpolate(frame, [0, 170], [1, 1.06]);
  return (
    <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', padding: 100, gap: 80}}>
      <div
        style={{
          flex: 1.4,
          borderRadius: 16,
          border: `1px solid ${brand.colors.line}`,
          background: brand.colors.surface,
          overflow: 'hidden',
          opacity: panelIn,
          transform: `translateY(${(1 - panelIn) * 60}px)`,
          boxShadow: `0 40px 120px ${brand.colors.bg}`,
        }}
      >
        {screenshot ? (
          <Img
            src={staticFile(screenshot)}
            style={{width: '100%', display: 'block', transform: `scale(${zoom})`, transformOrigin: '30% 20%'}}
          />
        ) : (
          <div style={{width: '100%', aspectRatio: '16/10', background: brand.colors.surface2}} />
        )}
      </div>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 40}}>
        {lines.map((line, i) => {
          const s = spring({frame: frame - 15 - i * 10, fps, config: {damping: 200}});
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                opacity: s,
                transform: `translateX(${(1 - s) * 40}px)`,
              }}
            >
              <div style={{width: 10, height: 10, borderRadius: 5, background: brand.colors.brand}} />
              <div style={{fontFamily: fonts.body, fontWeight: 600, fontSize: 40, color: brand.colors.ink2}}>
                {line}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{cta: string}> = ({cta}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const s = spring({frame, fps, config: {damping: 200}});
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        gap: 32,
        opacity: s,
        transform: `scale(${0.96 + s * 0.04})`,
      }}
    >
      <NobanMark size={110} color={brand.colors.brand} />
      <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: 96, color: brand.colors.ink}}>
        {brand.name}
      </div>
      <div style={{fontFamily: fonts.mono, fontSize: 34, letterSpacing: '0.2em', color: brand.colors.profit}}>
        {cta.toUpperCase()}
      </div>
    </AbsoluteFill>
  );
};

export const SocialClip: React.FC<Props> = ({kicker, headline, lines, screenshot, cta}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const brand = getBrand('noban');
  const fadeAt = (start: number, end: number) =>
    interpolate(frame, [start, start + 12, end - 12, end], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {/* violet glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 50% at 50% 35%, ${brand.colors.brand}22, transparent 70%)`,
        }}
      />
      <Sequence durationInFrames={90}>
        <AbsoluteFill style={{opacity: fadeAt(0, 90)}}>
          <Headline kicker={kicker} headline={headline} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={78} durationInFrames={162}>
        <AbsoluteFill style={{opacity: fadeAt(78, 240)}}>
          <Feature screenshot={screenshot} lines={lines} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={228}>
        <EndCard cta={cta} />
      </Sequence>
      {/* progress float bar, pinned bottom */}
      <div style={{position: 'absolute', bottom: 48, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={frame / (durationInFrames - 1)} brand={brand} width={640} />
      </div>
    </AbsoluteFill>
  );
};
```

Note: `brandId` is accepted by the schema but the noban brand is resolved via `getBrand('noban')` inside the components in this phase; multi-brand resolution (passing `brandId` down) lands when a second brand exists. Keep the prop so props files are forward-compatible.

- [ ] **Step 2: Register `SocialClip` in `studio/src/Root.tsx`**

Add to the existing fragment:

```tsx
import {SocialClip, socialClipSchema} from './templates/SocialClip';

// inside <>
<Composition
  id="SocialClip"
  component={SocialClip}
  durationInFrames={300}
  fps={30}
  width={1920}
  height={1080}
  schema={socialClipSchema}
  defaultProps={{
    brandId: 'noban',
    kicker: 'noban.gg',
    headline: 'Skin arbitrage with guardrails',
    lines: [
      'Scans CSFloat, Steam, and 7 more venues',
      'Float and pattern aware spreads',
      'Hard spend caps on every trade',
    ],
    screenshot: null,
    cta: 'Free in simulation',
  }}
/>
```

- [ ] **Step 3: Rendered proof of each act**

```bash
cd /c/Projects/animations/studio
npx remotion still SocialClip ../out/smoke/social-45.png --frame=45
npx remotion still SocialClip ../out/smoke/social-150.png --frame=150
npx remotion still SocialClip ../out/smoke/social-280.png --frame=280
```

Inspect all three (Read tool): 45 = headline card fully in; 150 = panel + feature lines; 280 = end card with mark, wordmark, gold CTA; float bar advancing in each. Iterate until they look intentional (spacing, sizes, contrast), not defaulty.

- [ ] **Step 4: Write `scripts/smoke.mjs`**

```js
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'smoke');
mkdirSync(outDir, {recursive: true});

const compositions = ['ComponentGallery', 'SocialClip'];

for (const id of compositions) {
  const out = join(outDir, `${id}.png`);
  console.log(`smoke: rendering frame 0 of ${id}`);
  execSync(`npx remotion still ${id} "${out}" --frame=0`, {
    cwd: join(root, 'studio'),
    stdio: 'inherit',
  });
  if (!existsSync(out)) {
    console.error(`smoke FAILED: ${out} was not produced`);
    process.exit(1);
  }
}
console.log(`smoke OK: ${compositions.length} compositions rendered to out/smoke/`);
```

- [ ] **Step 5: Run the smoke script**

```bash
cd /c/Projects/animations && node scripts/smoke.mjs
```

Expected: exits 0, prints `smoke OK: 2 compositions rendered to out/smoke/`.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/animations
git add studio/src scripts/smoke.mjs
git commit -m "feat: SocialClip template with three-act structure + smoke render script"
```

---

### Task 5: launch.py entry point

**Files:**
- Create: `launch.py`
- Modify: `README.md` only if commands changed (they should not)

**Interfaces:**
- Consumes: `studio/` npm project (Task 1), `scripts/smoke.mjs` (Task 4).
- Produces: `python launch.py` = health checks then Remotion Studio (blocking, Ctrl+C to stop). `python launch.py --check` = health checks only, exit non-zero if a required check fails.

- [ ] **Step 1: Write `launch.py`**

```python
"""Animation studio entry point: health checks + Remotion Studio."""
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
STUDIO = ROOT / "studio"


def check(label: str, ok: bool, detail: str = "", required: bool = True) -> bool:
    mark = "OK " if ok else ("FAIL" if required else "-- ")
    print(f"[{mark}] {label}" + (f" ({detail})" if detail else ""))
    return ok or not required


def comfy_running() -> bool:
    for port in (8000, 8188):  # ComfyUI Desktop / classic default
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=1)
            return True
        except Exception:
            continue
    return False


def main() -> int:
    ok = True
    node = shutil.which("node")
    npm = shutil.which("npm")  # resolves npm.cmd on Windows; lets us avoid shell=True
    ok &= check("Node.js", node is not None, node or "not on PATH")
    ok &= check("npm", npm is not None, npm or "not on PATH")
    ok &= check("studio/ deps installed", (STUDIO / "node_modules").is_dir(),
                "run: cd studio && npm install")
    blender = shutil.which("blender")
    check("Blender (phase 3 feeder)", blender is not None,
          blender or "not on PATH", required=False)
    check("ComfyUI server (phase 5 feeder)", comfy_running(),
          "not reachable on :8000/:8188", required=False)

    if not ok:
        print("\nRequired checks failed; fix the FAIL lines above.")
        return 1
    if "--check" in sys.argv:
        return 0

    print("\nStarting Remotion Studio (Ctrl+C to stop)...")
    return subprocess.call([npm, "run", "dev"], cwd=STUDIO)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Verify**

```bash
cd /c/Projects/animations && python launch.py --check
```

Expected: exit 0; `OK` for Node and studio deps; Blender/ComfyUI lines informational either way.

Then run `python launch.py` briefly (background), confirm Remotion Studio serves (default `http://localhost:3000`), then stop it.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/animations
git add launch.py
git commit -m "feat: launch.py entry point with feeder health checks"
```

---

### Task 6: The real noban.gg social clip (exit criterion)

**Files:**
- Create: `props/noban-social-launch.json`
- Create: `studio/public/noban/cockpit.webp` (copied, gitignored)
- Create: `scripts/fetch-noban-assets.mjs`

**Interfaces:**
- Consumes: `SocialClip` composition (Task 4).
- Produces: `out/noban/social-launch.mp4` (1920x1080, ~10s) and the repeatable asset-fetch script.

- [ ] **Step 1: Write `scripts/fetch-noban-assets.mjs`** (repeatable; screenshots are gitignored so any clone re-runs this)

```js
import {copyFileSync, mkdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = 'C:/Projects/noban-gg/marketing/assets/shots';
const dest = join(root, 'studio', 'public', 'noban');

if (!existsSync(src)) {
  console.error(`source not found: ${src}`);
  process.exit(1);
}
mkdirSync(dest, {recursive: true});
for (const f of ['cockpit.webp', 'governance.webp', 'ledger.webp']) {
  copyFileSync(join(src, f), join(dest, f));
  console.log(`copied ${f}`);
}
```

Run it:

```bash
cd /c/Projects/animations && node scripts/fetch-noban-assets.mjs
```

Expected: 3 files copied into `studio/public/noban/`.

- [ ] **Step 2: Write `props/noban-social-launch.json`** (real copy; terse, factual, brand voice, no em dashes)

```json
{
  "brandId": "noban",
  "kicker": "noban.gg",
  "headline": "CS2 skin arbitrage with guardrails",
  "lines": [
    "Scans CSFloat, Steam, and 7 more venues",
    "Float and pattern aware spread detection",
    "Hard spend caps on every trade",
    "Free forever in simulation mode"
  ],
  "screenshot": "noban/cockpit.webp",
  "cta": "Simulate free at noban.gg"
}
```

- [ ] **Step 3: Render the clip**

```bash
cd /c/Projects/animations/studio
npx remotion render SocialClip ../out/noban/social-launch.mp4 --props=../props/noban-social-launch.json
```

Expected: exits 0, MP4 at `out/noban/social-launch.mp4`.

- [ ] **Step 4: Rendered proof + iterate**

Extract and inspect spot frames of the final render:

```bash
cd /c/Projects/animations/studio
npx remotion still SocialClip ../out/smoke/final-45.png --frame=45 --props=../props/noban-social-launch.json
npx remotion still SocialClip ../out/smoke/final-150.png --frame=150 --props=../props/noban-social-launch.json
npx remotion still SocialClip ../out/smoke/final-280.png --frame=280 --props=../props/noban-social-launch.json
```

Inspect all three. Check specifically: cockpit screenshot legible in the panel, all four feature lines fit without wrapping awkwardly, CTA is gold (not green), float bar visible against the bg. Iterate on the template/props and re-render until the frames look shippable.

- [ ] **Step 5: Send the video for user review**

Send `out/noban/social-launch.mp4` to the user AND start `python launch.py` so they can scrub/redline the `SocialClip` composition in Remotion Studio with the launch props. **The phase exit criterion is the user approving this clip.** Apply any redlines, re-render, repeat.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/animations
git add props/noban-social-launch.json scripts/fetch-noban-assets.mjs
git commit -m "feat: noban.gg launch social clip props + asset fetch script"
```

---

## Self-Review Notes

- **Spec coverage (phase 1 scope):** Remotion scaffold (T1), brand schema + noban.json from DESIGN.md (T2), SocialClip template (T3–T4), smoke script (T4), launch.py zero-terminal surface (T5), real rendered + user-reviewed clip (T6). Feeders are later phases per spec build order.
- **Type consistency:** `getBrand`/`Brand` (T2) consumed as declared in T3/T4; `FloatBar` signature matches between T3 definition and T4 use; `socialClipSchema` fields match `props/noban-social-launch.json`.
- **Known judgment calls:** single 16:9 format in v1 (more formats = later); `brandId` prop accepted but noban hardcoded at resolution until a second brand exists (noted inline); GeistMono fallback to JetBrainsMono documented in T3 Step 1.
