# Animation Studio Phase 4 — LaunchVideo (compose demo + 3D assets + copy)

> **Historical note:** this plan predates the later slim of the studio to
> synthacon-only. References to noban, dashclaw, or paperroute below are
> historical and describe brands that have since been removed from the repo.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the LaunchVideo template that composes the Blender logo reveal, the background loop, the captured dashboard demo, and feature copy into a ~45s noban.gg launch video draft approved by the user.

**Architecture:** First a behavior-preserving extraction: the pieces currently duplicated or buried inside templates (PNG-sequence playback, end card, headline word-spring, feature panel, demo stage) become shared components under `studio/src/components/`, with existing templates re-consuming them and rendered stills compared before/after. Then `LaunchVideo` composes five acts (logo reveal, hook headline, demo footage, feature beats, end card) over the seamless background loop, with act boundaries computed by a pure, unit-tested timing helper shared between `calculateMetadata` and the component. Real copy lands in a generated `props/noban-launch.json` assembled from the existing demo props by a small script so telemetry stays in sync with the latest capture.

**Tech Stack:** Remotion 4.0.486, zod 4.3.6, vitest (all existing). No new dependencies. Assets already staged: `studio/public/noban/logo-reveal/` (90 frames alpha), `studio/public/noban/background-loop/` (240 frames, seamless), `studio/public/noban/demo.webm` + `props/noban-demo.json` (16.1s telemetry), screenshots `noban/{cockpit,governance,ledger}.webp`.

## Global Constraints

- Repo root `C:\Projects\animations`; shell steps Git Bash. Studio checks from `studio/`: `npm test` (19 tests currently), `npm run lint`.
- noban brand: profit/CTA = gold `#d6c23c` NEVER green; green `#3fd08c` = safe/simulation only; violet `#8847ff`; bg `#0b0a0f`; values only via `getBrand('noban')` (the hardcoded brand id inside components is the established, documented pattern until a second brand exists).
- Motion: `spring` damping 200, `Easing.out(Easing.exp)` character. Outward copy: no em dashes, no hype words.
- Null-safe rendering everywhere: every asset prop (`video`, `telemetry`, `screenshot`, `logoSequence`, `loopSequence`) is nullable and renders a brand placeholder so `node scripts/smoke.mjs` stays green on a clean clone. Smoke must list every composition.
- Refactors must preserve rendered output: re-render a reference still of each touched composition before and after, inspect both, and state the comparison in the report.
- Rendered proof: visual work is not done until rendered frames were inspected. Launch video duration must land in the spec's 30-90s range.
- PNG sequence contract (phase 3): files `frame_%04d.png`, 1-indexed.

## File Structure (end state of Phase 4)

```
studio/src/
├── components/
│   ├── PngSequence.tsx     # frame_%04d.png player, clamp|loop (Task 1)
│   ├── EndCard.tsx         # shared mark+wordmark+gold CTA card (Task 1)
│   ├── Headline.tsx        # kicker + word-spring headline (Task 2)
│   ├── FeaturePanel.tsx    # screenshot panel + feature lines (Task 2)
│   ├── DemoStage.tsx       # bordered panel + camera + video + cursor (Task 2)
│   └── BackgroundLoop.tsx  # looping backdrop from the PNG sequence (Task 2)
├── lib/launchTiming.ts     # pure act-boundary math, vitest-tested (Task 3)
└── templates/
    ├── LogoReveal.tsx      # consumes PngSequence (Task 1)
    ├── SocialClip.tsx      # consumes EndCard, Headline, FeaturePanel (Tasks 1-2)
    ├── ProductDemo.tsx     # consumes EndCard, DemoStage (Tasks 1-2)
    └── LaunchVideo.tsx     # five-act composition (Task 3)
scripts/build-launch-props.mjs  # assemble props/noban-launch.json (Task 4)
props/noban-launch.json         # generated, committed (Task 4)
scripts/smoke.mjs               # + LaunchVideo (Task 3)
```

---

### Task 1: Extract PngSequence + EndCard (behavior-preserving)

**Files:**
- Create: `studio/src/components/PngSequence.tsx`
- Create: `studio/src/components/EndCard.tsx`
- Modify: `studio/src/templates/LogoReveal.tsx` (consume PngSequence)
- Modify: `studio/src/templates/SocialClip.tsx` (replace local EndCard)
- Modify: `studio/src/templates/ProductDemo.tsx` (replace local EndCard)

**Interfaces:**
- Consumes: `getBrand`, `loadBrandFonts`, `NobanMark` (existing).
- Produces (used by Tasks 2, 3):
  - `PngSequence: React.FC<{dir: string; frameCount: number; mode: 'clamp' | 'loop'; style?: React.CSSProperties}>` — renders `staticFile(`${dir}/frame_%04d.png`)`, 1-indexed: `clamp` holds the last frame, `loop` wraps modulo frameCount. Frame source: `useCurrentFrame()` (relative to the enclosing Sequence).
  - `EndCard: React.FC<{cta: string}>` — spring-in mark + wordmark + gold CTA, identical to the card currently duplicated in SocialClip and ProductDemo.

- [ ] **Step 1: Capture BEFORE reference stills**

```bash
cd /c/Projects/animations/studio
npx remotion still SocialClip ../out/smoke/ref-social-280-before.png --frame=280 --props=../props/noban-social-launch.json
npx remotion still ProductDemo ../out/smoke/ref-demo-500-before.png --frame=500 --props=../props/noban-demo.json
npx remotion still LogoReveal ../out/smoke/ref-logo-80-before.png --frame=80 --props='{"brandId":"noban","sequence":"noban/logo-reveal","frameCount":90,"cta":"Simulate free at noban.gg"}'
```

- [ ] **Step 2: Write `studio/src/components/PngSequence.tsx`**

```tsx
import React from 'react';
import {Img, staticFile, useCurrentFrame} from 'remotion';

export const PngSequence: React.FC<{
  dir: string;
  frameCount: number;
  mode: 'clamp' | 'loop';
  style?: React.CSSProperties;
}> = ({dir, frameCount, mode, style}) => {
  const frame = useCurrentFrame();
  const idx = mode === 'loop' ? (frame % frameCount) + 1 : Math.min(frame + 1, frameCount);
  return <Img src={staticFile(`${dir}/frame_${String(idx).padStart(4, '0')}.png`)} style={style} />;
};
```

- [ ] **Step 3: Write `studio/src/components/EndCard.tsx`** (move the card verbatim from ProductDemo)

```tsx
import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {NobanMark} from '../brands/NobanMark';

export const EndCard: React.FC<{cta: string}> = ({cta}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const s = spring({frame, fps, config: {damping: 200}});
  return (
    <AbsoluteFill
      style={{justifyContent: 'center', alignItems: 'center', gap: 32, opacity: s}}
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
```

Note: SocialClip's local EndCard additionally applies `transform: scale(${0.96 + s * 0.04})`. Carry that scale line into the shared component (it is imperceptible at ProductDemo's usage and preserves SocialClip exactly):

```tsx
      style={{justifyContent: 'center', alignItems: 'center', gap: 32, opacity: s, transform: `scale(${0.96 + s * 0.04})`}}
```

- [ ] **Step 4: Consume in the three templates**

- `SocialClip.tsx`: delete its local `EndCard` component; add `import {EndCard} from '../components/EndCard';`. Its `<EndCard cta={cta} />` call site is unchanged. Remove now-unused imports (`NobanMark` if unused elsewhere in the file).
- `ProductDemo.tsx`: same deletion + import. `NobanMark` stays imported (used by the placeholder panel).
- `LogoReveal.tsx`: replace the inline `<Img src={staticFile(...)} .../>` block with:

```tsx
<PngSequence dir={sequence} frameCount={frameCount} mode="clamp" style={{width: '100%', height: '100%', display: 'block'}} />
```

and delete the now-unused `seqFrame` computation and `Img`/`staticFile` imports (keep what the placeholder path still needs).

- [ ] **Step 5: Verify behavior preserved**

```bash
cd /c/Projects/animations/studio && npm test && npm run lint
npx remotion still SocialClip ../out/smoke/ref-social-280-after.png --frame=280 --props=../props/noban-social-launch.json
npx remotion still ProductDemo ../out/smoke/ref-demo-500-after.png --frame=500 --props=../props/noban-demo.json
npx remotion still LogoReveal ../out/smoke/ref-logo-80-after.png --frame=80 --props='{"brandId":"noban","sequence":"noban/logo-reveal","frameCount":90,"cta":"Simulate free at noban.gg"}'
cd /c/Projects/animations && node scripts/smoke.mjs
```

Read each before/after pair; they must look identical. Smoke: `smoke OK: 4 compositions`.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/animations
git add studio/src/components/PngSequence.tsx studio/src/components/EndCard.tsx studio/src/templates
git commit -m "refactor: extract PngSequence and shared EndCard"
```

---

### Task 2: Extract Headline, FeaturePanel, DemoStage; add BackgroundLoop

**Files:**
- Create: `studio/src/components/Headline.tsx`
- Create: `studio/src/components/FeaturePanel.tsx`
- Create: `studio/src/components/DemoStage.tsx`
- Create: `studio/src/components/BackgroundLoop.tsx`
- Modify: `studio/src/templates/SocialClip.tsx` (consume Headline, FeaturePanel)
- Modify: `studio/src/templates/ProductDemo.tsx` (consume DemoStage)

**Interfaces:**
- Consumes: `PngSequence` (Task 1); `cameraAt`, `clicks`, `Telemetry` (phase 2 libs); `DemoCursor` (phase 2).
- Produces (used by Task 3):
  - `Headline: React.FC<{kicker: string; headline: string}>` — violet mono kicker + word-by-word display-font spring, exactly SocialClip's current local `Headline`.
  - `FeaturePanel: React.FC<{screenshot: string | null; lines: string[]; zoom?: {from: number; to: number; origin: string}}>` — SocialClip's current local `Feature`, with its hardcoded zoom `interpolate(frame, [0, 170], [1.5, 1.6])` and `transformOrigin '58% 30%'` becoming the `zoom` prop default `{from: 1.5, to: 1.6, origin: '58% 30%'}` so SocialClip renders identically by default.
  - `DemoStage: React.FC<{video: string | null; telemetry: Telemetry | null; timeMs: number}>` — ProductDemo's bordered stage: viewport-sized panel, camera transform (scale about center + translate, from `cameraAt`), `OffthreadVideo` with `brightness(1.12) contrast(1.03)`, `DemoCursor` overlay, placeholder when video null. The stage div is `position: relative` at `telemetry?.viewport ?? {width: 1600, height: 1000}` size; callers wrap it in their own scale transform.
  - `BackgroundLoop: React.FC<{dir: string | null; frameCount: number; opacity?: number}>` — `AbsoluteFill` playing the loop via `PngSequence mode="loop"`; solid `brand.colors.bg` fill when dir is null.

- [ ] **Step 1: Write `studio/src/components/Headline.tsx`** (move verbatim from SocialClip)

```tsx
import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';

const easeOutExpo = Easing.out(Easing.exp);

export const Headline: React.FC<{kicker: string; headline: string}> = ({kicker, headline}) => {
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
```

- [ ] **Step 2: Write `studio/src/components/FeaturePanel.tsx`** (move SocialClip's `Feature`, zoom parameterized)

```tsx
import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';

export const FeaturePanel: React.FC<{
  screenshot: string | null;
  lines: string[];
  zoom?: {from: number; to: number; origin: string};
}> = ({screenshot, lines, zoom = {from: 1.5, to: 1.6, origin: '58% 30%'}}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const panelIn = spring({frame, fps, config: {damping: 200}});
  const zoomNow = interpolate(frame, [0, 170], [zoom.from, zoom.to]);
  return (
    <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', padding: 72, gap: 72}}>
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
            style={{width: '100%', display: 'block', transform: `scale(${zoomNow})`, transformOrigin: zoom.origin}}
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
                alignItems: 'flex-start',
                gap: 20,
                opacity: s,
                transform: `translateX(${(1 - s) * 40}px)`,
              }}
            >
              <div style={{width: 10, height: 10, borderRadius: 5, background: brand.colors.brand, marginTop: 22}} />
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
```

- [ ] **Step 3: Write `studio/src/components/DemoStage.tsx`** (move ProductDemo's stage internals)

```tsx
import React from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile} from 'remotion';
import {getBrand} from '../lib/brand';
import type {Telemetry} from '../lib/telemetry';
import {clicks, focuses} from '../lib/telemetry';
import {cameraAt} from '../lib/camera';
import {DemoCursor} from './DemoCursor';
import {NobanMark} from '../brands/NobanMark';

export const DemoStage: React.FC<{
  video: string | null;
  telemetry: Telemetry | null;
  timeMs: number;
}> = ({video, telemetry, timeMs}) => {
  const brand = getBrand('noban');
  const vp = telemetry?.viewport ?? {width: 1600, height: 1000};
  const cam = cameraAt(telemetry ? focuses(telemetry) : [], timeMs, vp);
  const clickList = telemetry ? clicks(telemetry) : [];
  return (
    <div
      style={{
        width: vp.width,
        height: vp.height,
        borderRadius: 14,
        border: `1px solid ${brand.colors.line}`,
        background: brand.colors.surface,
        overflow: 'hidden',
        boxShadow: `0 40px 120px ${brand.colors.bg}`,
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `scale(${cam.scale}) translate(${vp.width / 2 - cam.originX}px, ${vp.height / 2 - cam.originY}px)`,
          position: 'relative',
        }}
      >
        {video ? (
          <OffthreadVideo
            src={staticFile(video)}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              filter: 'brightness(1.12) contrast(1.03)',
            }}
            muted
          />
        ) : (
          <AbsoluteFill
            style={{background: brand.colors.surface2, justifyContent: 'center', alignItems: 'center'}}
          >
            <NobanMark size={120} color={brand.colors.line} />
          </AbsoluteFill>
        )}
        {telemetry ? <DemoCursor clickList={clickList} timeMs={timeMs} brand={brand} /> : null}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Write `studio/src/components/BackgroundLoop.tsx`**

```tsx
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {getBrand} from '../lib/brand';
import {PngSequence} from './PngSequence';

export const BackgroundLoop: React.FC<{
  dir: string | null;
  frameCount: number;
  opacity?: number;
}> = ({dir, frameCount, opacity = 1}) => {
  const brand = getBrand('noban');
  if (!dir) return <AbsoluteFill style={{backgroundColor: brand.colors.bg}} />;
  return (
    <AbsoluteFill style={{opacity}}>
      <PngSequence dir={dir} frameCount={frameCount} mode="loop" style={{width: '100%', height: '100%'}} />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 5: Consume in SocialClip and ProductDemo**

- `SocialClip.tsx`: delete local `Headline` and `Feature`; import `{Headline}` and `{FeaturePanel}` from components; the `<Feature screenshot={...} lines={...} />` call becomes `<FeaturePanel screenshot={...} lines={...} />` (default zoom preserves current output). Remove imports the deletions orphaned.
- `ProductDemo.tsx`: replace the inline stage div (panel + camera + video + cursor) with `<DemoStage video={video} telemetry={telemetry} timeMs={timeMs} />` wrapped in the existing scale transform div (`scale(${STAGE_SCALE}) translateY(-28px)`); the caption, float bar, end card, and `bodyFrames` logic stay in the template. Remove imports the extraction orphaned (`OffthreadVideo`, `staticFile`, `cameraAt`, `clicks`, `focuses`, `DemoCursor` if no longer referenced).

- [ ] **Step 6: Verify behavior preserved (same reference frames as Task 1)**

```bash
cd /c/Projects/animations/studio && npm test && npm run lint
npx remotion still SocialClip ../out/smoke/ref-social-45-after2.png --frame=45 --props=../props/noban-social-launch.json
npx remotion still SocialClip ../out/smoke/ref-social-150-after2.png --frame=150 --props=../props/noban-social-launch.json
npx remotion still ProductDemo ../out/smoke/ref-demo-200-after2.png --frame=200 --props=../props/noban-demo.json
cd /c/Projects/animations && node scripts/smoke.mjs
```

Read the stills against the known-good phase 2 frames (headline card, feature panel with zoomed cockpit ending at the gold column, demo stage with zoom+cursor). Must look identical. Smoke: `smoke OK: 4 compositions`.

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/animations
git add studio/src/components studio/src/templates
git commit -m "refactor: extract Headline, FeaturePanel, DemoStage; add BackgroundLoop"
```

---

### Task 3: Launch timing lib + LaunchVideo template

**Files:**
- Create: `studio/src/lib/launchTiming.ts`
- Test: `studio/src/lib/launchTiming.test.ts`
- Create: `studio/src/templates/LaunchVideo.tsx`
- Modify: `studio/src/Root.tsx` (register)
- Modify: `scripts/smoke.mjs` (add `LaunchVideo`)

**Interfaces:**
- Consumes: everything from Tasks 1-2; `telemetrySchema` (phase 2); `steps` from '../lib/telemetry' (captions inside the demo act).
- Produces: composition id `LaunchVideo`, 1920x1080 @30fps, duration from `calculateMetadata`. Schema:

```ts
launchVideoSchema = z.object({
  brandId: z.string(),
  kicker: z.string(),
  headline: z.string(),
  demo: z.object({video: z.string().nullable(), telemetry: telemetrySchema.nullable()}),
  features: z.array(z.object({
    screenshot: z.string().nullable(),
    heading: z.string(),
    lines: z.array(z.string()).min(1).max(4),
  })).max(3),
  cta: z.string(),
  assets: z.object({
    logoSequence: z.string().nullable(),
    logoFrames: z.number().int().positive(),
    loopSequence: z.string().nullable(),
    loopFrames: z.number().int().positive(),
  }),
});
```

  - `launchTiming(telemetryDurationMs: number | null, featureCount: number): {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act; total: number}` with `Act = {from: number; len: number}` — pure, fps 30 baked in: logo 150; hook 186; demo `ceil(ms/1000*30)+24` (fallback 240); each feature 180; end 150. Acts are laid out sequentially with no gaps.

- [ ] **Step 1: Write the failing test** — `studio/src/lib/launchTiming.test.ts`

```ts
import {describe, expect, it} from 'vitest';
import {launchTiming} from './launchTiming';

describe('launchTiming', () => {
  it('lays out sequential acts with no gaps', () => {
    const t = launchTiming(16000, 2);
    expect(t.logo).toEqual({from: 0, len: 150});
    expect(t.hook).toEqual({from: 150, len: 186});
    expect(t.demo.from).toBe(336);
    expect(t.demo.len).toBe(Math.ceil((16000 / 1000) * 30) + 24); // 504
    expect(t.features[0].from).toBe(336 + 504);
    expect(t.features[1].from).toBe(336 + 504 + 180);
    expect(t.end.from).toBe(336 + 504 + 360);
    expect(t.total).toBe(336 + 504 + 360 + 150);
  });

  it('falls back to a fixed demo act without telemetry', () => {
    const t = launchTiming(null, 0);
    expect(t.demo.len).toBe(240);
    expect(t.features).toHaveLength(0);
    expect(t.end.from).toBe(336 + 240);
  });

  it('stays inside the spec 30-90s range for the real inputs', () => {
    const t = launchTiming(16108, 2);
    expect(t.total / 30).toBeGreaterThanOrEqual(30);
    expect(t.total / 30).toBeLessThanOrEqual(90);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projects/animations/studio && npm test`
Expected: FAIL — cannot resolve `./launchTiming`.

- [ ] **Step 3: Write `studio/src/lib/launchTiming.ts`**

```ts
export type Act = {from: number; len: number};

const FPS = 30;
const LOGO_LEN = 150;
const HOOK_LEN = 186;
const DEMO_FALLBACK_LEN = 240;
const DEMO_TAIL = 24;
const FEATURE_LEN = 180;
const END_LEN = 150;

export const launchTiming = (
  telemetryDurationMs: number | null,
  featureCount: number,
): {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act; total: number} => {
  const demoLen = telemetryDurationMs
    ? Math.ceil((telemetryDurationMs / 1000) * FPS) + DEMO_TAIL
    : DEMO_FALLBACK_LEN;
  let cursor = 0;
  const next = (len: number): Act => {
    const act = {from: cursor, len};
    cursor += len;
    return act;
  };
  const logo = next(LOGO_LEN);
  const hook = next(HOOK_LEN);
  const demo = next(demoLen);
  const features = Array.from({length: featureCount}, () => next(FEATURE_LEN));
  const end = next(END_LEN);
  return {logo, hook, demo, features, end, total: cursor};
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projects/animations/studio && npm test`
Expected: 22 tests PASS.

- [ ] **Step 5: Write `studio/src/templates/LaunchVideo.tsx`**

```tsx
import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {telemetrySchema, steps} from '../lib/telemetry';
import {launchTiming} from '../lib/launchTiming';
import {BackgroundLoop} from '../components/BackgroundLoop';
import {PngSequence} from '../components/PngSequence';
import {Headline} from '../components/Headline';
import {FeaturePanel} from '../components/FeaturePanel';
import {DemoStage} from '../components/DemoStage';
import {EndCard} from '../components/EndCard';
import {Caption} from '../components/Caption';
import {FloatBar} from '../components/FloatBar';
import {NobanMark} from '../brands/NobanMark';

export const launchVideoSchema = z.object({
  brandId: z.string(),
  kicker: z.string(),
  headline: z.string(),
  demo: z.object({video: z.string().nullable(), telemetry: telemetrySchema.nullable()}),
  features: z.array(
    z.object({
      screenshot: z.string().nullable(),
      heading: z.string(),
      lines: z.array(z.string()).min(1).max(4),
    }),
  ).max(3),
  cta: z.string(),
  assets: z.object({
    logoSequence: z.string().nullable(),
    logoFrames: z.number().int().positive(),
    loopSequence: z.string().nullable(),
    loopFrames: z.number().int().positive(),
  }),
});

type Props = z.infer<typeof launchVideoSchema>;

const FADE = 12;

// per-act fade against the act-local frame
const useActFade = (len: number): number => {
  const f = useCurrentFrame();
  return interpolate(f, [0, FADE, len - FADE, len], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};

const LogoAct: React.FC<{assets: Props['assets']; len: number}> = ({assets, len}) => {
  const brand = getBrand('noban');
  const fade = useActFade(len);
  return (
    <AbsoluteFill style={{opacity: fade, justifyContent: 'center', alignItems: 'center'}}>
      <div style={{width: 500, height: 500, filter: `drop-shadow(0 0 42px ${brand.colors.brand}66)`}}>
        {assets.logoSequence ? (
          <PngSequence
            dir={assets.logoSequence}
            frameCount={assets.logoFrames}
            mode="clamp"
            style={{width: '100%', height: '100%', display: 'block'}}
          />
        ) : (
          <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', position: 'relative'}}>
            <NobanMark size={400} color={brand.colors.brand} />
          </AbsoluteFill>
        )}
      </div>
    </AbsoluteFill>
  );
};

const HookAct: React.FC<{kicker: string; headline: string; len: number}> = ({kicker, headline, len}) => {
  const fade = useActFade(len);
  return (
    <AbsoluteFill style={{opacity: fade}}>
      <Headline kicker={kicker} headline={headline} />
    </AbsoluteFill>
  );
};

const DemoAct: React.FC<{demo: Props['demo']; len: number}> = ({demo, len}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand('noban');
  const fade = useActFade(len);
  const timeMs = (frame / fps) * 1000;
  const stepList = demo.telemetry ? steps(demo.telemetry) : [];
  const activeStep = [...stepList].reverse().find((s) => s.t <= timeMs);
  return (
    <AbsoluteFill style={{opacity: fade, justifyContent: 'center', alignItems: 'center'}}>
      <div style={{transform: 'scale(0.9) translateY(-28px)'}}>
        <DemoStage video={demo.video} telemetry={demo.telemetry} timeMs={timeMs} />
      </div>
      {activeStep ? (
        <div style={{position: 'absolute', bottom: 108}}>
          <Caption label={activeStep.label} brand={brand} enteredMsAgo={timeMs - activeStep.t} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const FeatureAct: React.FC<{feature: Props['features'][number]; len: number}> = ({feature, len}) => {
  const brand = getBrand('noban');
  const fonts = loadBrandFonts();
  const fade = useActFade(len);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const headIn = spring({frame, fps, config: {damping: 200}});
  return (
    <AbsoluteFill style={{opacity: fade}}>
      <div
        style={{
          position: 'absolute',
          top: 64,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: 56,
          color: brand.colors.ink,
          opacity: headIn,
        }}
      >
        {feature.heading}
      </div>
      <AbsoluteFill style={{paddingTop: 96}}>
        <FeaturePanel screenshot={feature.screenshot} lines={feature.lines} zoom={{from: 1, to: 1.04, origin: '50% 30%'}} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const LaunchVideo: React.FC<Props> = ({kicker, headline, demo, features, cta, assets}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const brand = getBrand('noban');
  const t = launchTiming(demo.telemetry?.durationMs ?? null, features.length);
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {/* loop backdrop behind every act except the demo (kept dark for footage contrast) */}
      <BackgroundLoop dir={assets.loopSequence} frameCount={assets.loopFrames} opacity={0.55} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 55% at 50% 32%, ${brand.colors.brand}26, transparent 72%)`,
        }}
      />
      <Sequence durationInFrames={t.logo.len}>
        <LogoAct assets={assets} len={t.logo.len} />
      </Sequence>
      <Sequence from={t.hook.from} durationInFrames={t.hook.len}>
        <HookAct kicker={kicker} headline={headline} len={t.hook.len} />
      </Sequence>
      <Sequence from={t.demo.from} durationInFrames={t.demo.len}>
        <DemoAct demo={demo} len={t.demo.len} />
      </Sequence>
      {features.map((feature, i) => (
        <Sequence key={i} from={t.features[i].from} durationInFrames={t.features[i].len}>
          <FeatureAct feature={feature} len={t.features[i].len} />
        </Sequence>
      ))}
      <Sequence from={t.end.from}>
        <EndCard cta={cta} />
      </Sequence>
      <div style={{position: 'absolute', bottom: 40, left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={frame / (durationInFrames - 1)} brand={brand} width={640} />
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: Register in `studio/src/Root.tsx`**

```tsx
import { LaunchVideo, launchVideoSchema } from "./templates/LaunchVideo";
import { launchTiming } from "./lib/launchTiming";
```

```tsx
<Composition
  id="LaunchVideo"
  component={LaunchVideo}
  durationInFrames={1350}
  fps={30}
  width={1920}
  height={1080}
  schema={launchVideoSchema}
  defaultProps={{
    brandId: "noban",
    kicker: "noban.gg",
    headline: "CS2 skin arbitrage with guardrails",
    demo: {video: null, telemetry: null},
    features: [],
    cta: "Simulate free at noban.gg",
    assets: {logoSequence: null, logoFrames: 90, loopSequence: null, loopFrames: 240},
  }}
  calculateMetadata={({props}) => ({
    durationInFrames: launchTiming(
      props.demo.telemetry?.durationMs ?? null,
      props.features.length,
    ).total,
  })}
/>
```

- [ ] **Step 7: Add to smoke, placeholder proof, tests, lint**

`scripts/smoke.mjs`: `const compositions = ['ComponentGallery', 'SocialClip', 'ProductDemo', 'LogoReveal', 'LaunchVideo'];`

```bash
cd /c/Projects/animations/studio
npx remotion still LaunchVideo ../out/smoke/launch-placeholder.png --frame=200
npm test && npm run lint
cd /c/Projects/animations && node scripts/smoke.mjs
```

Inspect the placeholder still (frame 200 = hook act with null assets): headline words in, solid brand bg (no loop), float bar; no crash. Smoke: `smoke OK: 5 compositions`.

- [ ] **Step 8: Commit**

```bash
cd /c/Projects/animations
git add studio/src/lib/launchTiming.ts studio/src/lib/launchTiming.test.ts studio/src/templates/LaunchVideo.tsx studio/src/Root.tsx scripts/smoke.mjs
git commit -m "feat: LaunchVideo five-act composition with tested act timing"
```

---

### Task 4: Launch props + full render + docs (exit criterion)

**Files:**
- Create: `scripts/build-launch-props.mjs`
- Create (generated, committed): `props/noban-launch.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `props/noban-demo.json` (telemetry source of truth), staged assets, `LaunchVideo` composition.
- Produces: `out/noban/launch.mp4` (~45s). **Phase exit criterion: user approves the draft.**

- [ ] **Step 1: Write `scripts/build-launch-props.mjs`** (keeps launch telemetry synced to the latest capture)

```js
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = JSON.parse(readFileSync(join(root, 'props', 'noban-demo.json'), 'utf8'));

const launch = {
  brandId: 'noban',
  kicker: 'noban.gg',
  headline: 'CS2 skin arbitrage with guardrails',
  demo: {video: demo.video, telemetry: demo.telemetry},
  features: [
    {
      screenshot: 'noban/governance.webp',
      heading: 'Guardrails, enforced in the backend',
      lines: [
        'Hard spend caps on every trade',
        'Bannable operations never run automatically',
        'Kill switch halts execution instantly',
      ],
    },
    {
      screenshot: 'noban/ledger.webp',
      heading: 'Every trade, accounted for',
      lines: [
        'FIFO cost basis and realized gains',
        'Tax worksheet export for your accountant',
        'Signed provenance and ledger bundles',
      ],
    },
  ],
  cta: 'Simulate free at noban.gg',
  assets: {
    logoSequence: 'noban/logo-reveal',
    logoFrames: 90,
    loopSequence: 'noban/background-loop',
    loopFrames: 240,
  },
};

writeFileSync(join(root, 'props', 'noban-launch.json'), JSON.stringify(launch, null, 2) + '\n');
console.log('wrote props/noban-launch.json');
```

Run it: `cd /c/Projects/animations && node scripts/build-launch-props.mjs`

- [ ] **Step 2: Render spot frames of every act and inspect**

```bash
cd /c/Projects/animations/studio
npx remotion still LaunchVideo ../out/smoke/launch-a.png --frame=100  --props=../props/noban-launch.json
npx remotion still LaunchVideo ../out/smoke/launch-b.png --frame=260  --props=../props/noban-launch.json
npx remotion still LaunchVideo ../out/smoke/launch-c.png --frame=600  --props=../props/noban-launch.json
npx remotion still LaunchVideo ../out/smoke/launch-d.png --frame=900  --props=../props/noban-launch.json
npx remotion still LaunchVideo ../out/smoke/launch-e.png --frame=1100 --props=../props/noban-launch.json
npx remotion still LaunchVideo ../out/smoke/launch-f.png --frame=1300 --props=../props/noban-launch.json
```

Checklist: a = logo reveal over dimmed loop backdrop; b = headline words in over loop; c = demo stage with real footage, camera framing content, cursor visible; d = first feature (governance screenshot + heading + lines); e = second feature (ledger); f = end card, gold CTA. All acts: loop backdrop subtle (not competing), captions legible, nothing green except in-app simulation badges, float bar advancing. Iterate until intentional.

- [ ] **Step 3: Render the full draft and watch it**

```bash
cd /c/Projects/animations/studio
npx remotion render LaunchVideo ../out/noban/launch.mp4 --props=../props/noban-launch.json
```

Expected: exits 0; duration ≈ 45s (1350 frames at the real telemetry). Verify smooth act transitions by re-inspecting 2-3 boundary frames (e.g. 150, 336) if anything looked off in stills.

- [ ] **Step 4: Update `README.md`**

Under Run (manual equivalents), after the stage-blender-assets line:

```markdown
    node scripts/build-launch-props.mjs       # assemble launch video props from the latest demo capture
```

Under Render:

```markdown
    npx remotion render LaunchVideo ../out/noban/launch.mp4 --props=../props/noban-launch.json
```

- [ ] **Step 5: Send for user review**

Send `out/noban/launch.mp4`. **Exit criterion: user approval.** Apply redlines, re-render, repeat.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/animations
git add scripts/build-launch-props.mjs props/noban-launch.json README.md
git commit -m "feat: noban launch video props builder and draft assembly"
```

---

## Self-Review Notes

- **Spec coverage (phase 4 scope):** "template composing demo footage, 3D assets, and copy into 30-90s" — demo footage (DemoStage act), 3D assets (logo reveal sequence + background loop acts), copy (hook + features + CTA via props), 30-90s enforced by a unit test on real inputs. Exit artifact = full launch video draft (T4). Audio/voiceover explicitly out of scope per spec v1.
- **Type consistency:** `launchTiming` signature identical in test (T3 S1), impl (T3 S3), template (T3 S5), and `calculateMetadata` (T3 S6); `launchVideoSchema` fields match `props/noban-launch.json` (T4 S1); component props match their extraction sources and consumers (`FeaturePanel zoom` default reproduces SocialClip's literals; `DemoStage` prop names match ProductDemo's call site).
- **Known judgment calls:** refactor tasks verify with before/after stills rather than pixel-diff tooling (consistent with the repo's rendered-proof practice); the loop backdrop stays behind the demo act at 0.55 opacity rather than being unmounted (simpler, and the demo stage covers most of it); `brandId` prop pattern unchanged per the standing phase 1 decision; feature-act zoom is gentle (1 to 1.04) because launch pacing differs from the social clip's tight crop — flagged for redline review rather than guessed further.
- **Placeholder scan:** clean; every step carries complete code/commands.
