---
name: og-assets
description: Use when the user wants OG images, link-preview assets, animated OG loops, README GIFs, or social-card exports for any product (e.g. "/og-assets", "make an OG image and README gif").
---

# OG Assets

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `${CLAUDE_SKILL_DIR}/../..`.

Produces product-owned `og.mp4`, `og.gif`, `readme.gif`, and social-card exports under
`<product>/marketing/assets/<brand>/`, optionally backed by an approved ComfyUI texture.

## Recipe

1. Toolchain + brand check per marketing-studio. Background loop staged for the brand
   (Blender `background_loop` scene; PLAYBOOK seam rules) — or run with it null.
2. Optional AI hero: `node feeders/comfy/client.mjs hero --project <product> --brand <brand> [--seed N]` (needs ComfyUI
   Desktop up + a checkpoint; exit 2 = fine, procedural fallback is spec-compliant).
   Read the hero PNG: dark, on-brand hue, no text/people/off-brand colors; re-roll
   seeds until it passes. Prompt lives in the client; adapt per brand.
3. Run the brand's statics renderer with `--project <product>`; it writes product-owned
   props/output and passes the workspace public directory to Remotion.
   The AnimatedOG loop is SEAMLESS by construction — if you touch the template, every
   animated value must stay periodic over the full duration (PLAYBOOK loop rules).
4. Verify one still (lockup sharp, CTA in the brand's positive color) + readme.gif
   legibility (extract frame 0 via ffmpeg if the gif exceeds Read limits).
5. Size check: GIFs are heavy; prefer og.mp4 for social embeds. For READMEs going to
   GitHub keep the gif under ~10MB (`--every-nth-frame=3`, lower `--scale`).
6. Run `verify-og-wired <brand> --project <product>` after deployment, then deliver per
   marketing-studio. This is a live wiring check, not permission to deploy.
