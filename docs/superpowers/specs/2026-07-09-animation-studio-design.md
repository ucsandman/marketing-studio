# Animation Studio — Design Spec

> **Historical note:** this spec predates the later slim of the studio to
> synthacon-only. References to noban, dashclaw, or paperroute below are
> historical and describe brands that have since been removed from the repo.

**Date:** 2026-07-09
**Status:** Approved direction (Approach 1 — code-first studio), pending spec review
**Repo:** `C:\Projects\animations`

## Purpose

An agent-driven pipeline that turns "describe a product + asset request" into finished,
brand-consistent marketing animation assets, with the human role limited to art direction
and approval in a browser. Primary consumer: marketing Wes's own products (web apps and
desktop apps). First target product: **noban.gg** (CS2 skin arbitrage bot).

## Asset types in scope

1. **Launch/hero videos** — 30–90s polished product videos for landing pages and launch posts
2. **Social clips** — short punchy clips for X/LinkedIn/TikTok feature announcements
3. **Animated product demos** — real app footage with Screen-Studio-style zooms, synthetic
   smooth cursor, and captions
4. **Brand motion assets** — logo reveals, animated backgrounds, hero-section loops
5. **Static-plus** — animated OG images, GIFs for READMEs and docs

## Architecture

**Remotion is the backbone.** All final assets are Remotion (React/TypeScript)
compositions rendered deterministically to MP4/WebM/GIF. Three *feeders* produce raw
material that compositions consume; none of the feeders is load-bearing for the pipeline
as a whole.

```
animations/
├── studio/                 # Remotion project (TypeScript/React)
│   └── src/
│       ├── templates/      # SocialClip, ProductDemo, LogoReveal, LaunchVideo, AnimatedOG
│       ├── components/     # captions, smooth cursor, zoom-pan, transitions, audio helpers
│       └── lib/            # brand loader, timing helpers
├── brands/                 # <product>.json — colors, logo path, fonts, voice, URLs
├── feeders/
│   ├── blender/            # bpy scripts + headless render wrapper
│   ├── comfy/              # ComfyUI workflow JSONs + local API client
│   └── capture/            # Playwright app-recording scripts (video + cursor telemetry)
├── assets/<product>/       # raw feeder output (gitignored)
├── out/<product>/          # final renders (gitignored)
└── launch.py               # one command: opens Remotion Studio + health-checks feeders
```

### Brand configs

One JSON file per product under `brands/`. Schema (v1): name, tagline, URLs, logo asset
paths, color tokens, font families, voice/tone notes, and per-template overrides.
Templates never hardcode brand values. The noban.gg config is **derived from
`C:\Projects\noban-gg\DESIGN.md`** (violet hue-285 base, CS2 rarity accent palette,
gold = profit, float-bar signature motif, Hanken Grotesk + Geist Mono), not invented.

### Request flow

1. User asks for an asset ("social clip announcing feature X for noban").
2. Agent loads the brand config, selects/adapts the matching template.
3. Feeders produce any needed raw assets (Playwright capture of the feature, Blender
   background loop, ComfyUI still).
4. Agent wires assets + copy into the composition, renders a preview, and shows it.
5. User reviews in **Remotion Studio** (browser: scrubbing, live props editing) — the
   zero-terminal human surface. `launch.py` is the single entry point.
6. On approval, final render lands in `out/<product>/`.

### Feeders

- **Blender (headless).** Agent-authored `bpy` Python scripts run via
  `blender --background --python <script>`. Verification protocol: render single frames
  as PNG and visually inspect before committing to animation renders. Covers logo
  reveals, abstract brand loops, 3D device mockups. GPU: RTX 3070 Ti (Cycles/OptiX or
  Eevee as appropriate).
- **Playwright capture.** Scripted recordings of the real app at fixed viewport/DPI.
  Cursor positions and click timestamps are logged to JSON alongside the video so the
  Remotion ProductDemo template can overlay a synthetic smooth cursor and auto-zoom to
  interaction points.
- **ComfyUI (local API).** Workflows stored as JSON, queued via ComfyUI Desktop's local
  server API. Scoped to what 8GB VRAM does well: backgrounds, textures, hero stills,
  optional short stylized clips. Explicitly non-load-bearing: if ComfyUI is unavailable,
  every template still renders (fallback to Blender/procedural backgrounds).
- **Cloud AI video (deferred slot).** Not built now. The feeder interface leaves room
  for a Runway/Kling-style API feeder later for occasional cinematic hero shots.

## Verification & failure behavior

- Every pipeline stage emits an inspectable artifact (frame PNG, capture MP4 + telemetry
  JSON, rendered still); the agent inspects it visually before building on it.
- All wrappers and scripts fail loudly and exit non-zero on failure; no silent fallbacks
  except the documented ComfyUI→procedural background fallback (which logs).
- **Smoke script:** renders frame 0 of every template for every brand config; run before
  claiming any studio change done.
- Rendered proof rule: no asset is "done" until it has been watched (agent) and approved
  (user) as rendered output, not just code that compiles.

## Build order

Each phase ends with a rendered artifact reviewed in the browser.

1. **Core:** Remotion scaffold, brand config schema + `brands/noban.json`, SocialClip
   template. Exit: one real noban.gg social clip approved.
2. **ProductDemo:** Playwright capture feeder + cursor/zoom/caption components. Exit: a
   polished demo clip of a real noban.gg dashboard flow.
3. **Blender feeder:** headless wrapper, LogoReveal + background-loop templates. Exit:
   noban.gg logo reveal rendered and composited into a Remotion composition.
4. **LaunchVideo:** template composing demo footage, 3D assets, and copy into 30–90s.
   Exit: a full noban.gg launch video draft.
5. **ComfyUI feeder + Static-plus:** ComfyUI API client + workflows; AnimatedOG and GIF
   export presets. Exit: animated OG + README GIF for noban.gg.

## Dependencies & environment

- Windows 11, RTX 3070 Ti (8GB VRAM), 32GB RAM.
- Node.js + pnpm (Remotion studio); Python 3.x (feeder wrappers, launch.py);
  Blender (installed) on PATH or configured path; ComfyUI Desktop (installed);
  Playwright; FFmpeg (bundled with Remotion).
- No cloud services, no secrets. Any future cloud AI feeder gets keys via `.env`
  (gitignored) with `.env.example` placeholders.

## Out of scope (v1)

- Character animation and narrative shorts.
- Local AI **video** as a primary content source (8GB VRAM ceiling; quality bar).
- Auto-publishing to social platforms — output is files, distribution stays manual.
- Voiceover/TTS (can be added as an audio component later).
