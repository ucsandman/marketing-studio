---
name: og-assets
description: Use when the user wants OG images, link-preview assets, animated OG loops, README GIFs, or social-card exports for any product (e.g. "/og-assets", "make an OG image and README gif").
---

# OG Assets

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `C:\Projects\animations`.

Produces: `out/<brand>/og.mp4` (8s seamless 1200x630 loop), `og.gif`, `readme.gif`
(600x315), optionally backed by a ComfyUI AI hero texture.

## Recipe

1. Toolchain + brand check per marketing-studio. Background loop staged for the brand
   (Blender `background_loop` scene; PLAYBOOK seam rules) — or run with it null.
2. Optional AI hero: `node feeders/comfy/client.mjs hero [--seed N]` (needs ComfyUI
   Desktop up + a checkpoint; ComfyUI unreachable exits 2, the documented graceful
   fallback — procedural is spec-compliant). No `feeders/comfy/workflows/synthacon-hero.json`
   ships yet — author one against the client's `fillTemplate` tokens
   (`{{CHECKPOINT}}`/`{{POSITIVE}}`/`{{NEGATIVE}}`/`{{SEED}}`) before this produces
   anything; without it the call exits 1 even with ComfyUI up. Read the hero PNG:
   dark, on-brand hue, no text/people/off-brand colors; re-roll seeds until it passes.
   Prompt lives in the client; adapt per brand.
3. `node scripts/render-synthacon-statics.mjs` (extend per brand: props tagline/CTA + hero path).
   The AnimatedOG loop is SEAMLESS by construction — if you touch the template, every
   animated value must stay periodic over the full duration (PLAYBOOK loop rules).
4. Verify one still (lockup sharp, CTA in the brand's positive color) + readme.gif
   legibility (extract frame 0 via ffmpeg if the gif exceeds Read limits).
5. Size check: GIFs are heavy; prefer og.mp4 for social embeds. For READMEs going to
   GitHub keep the gif under ~10MB (`--every-nth-frame=3`, lower `--scale`).
6. Deliver per marketing-studio.
