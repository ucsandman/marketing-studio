---
name: logo-reveal
description: Use when the user wants a logo reveal / logo animation / brand intro video for any product (e.g. "/logo-reveal", "make a logo reveal for DashClaw", "animated logo for the landing page").
---

# Logo Reveal

**REQUIRED BACKGROUND:** marketing-studio skill (engine location, brand onboarding,
PLAYBOOK gotchas). Work happens in `${CLAUDE_SKILL_DIR}/../..`.

Produces: `out/<brand>/logo-reveal.mp4` — 3s Blender 3D draw-on of the brand mark
composited in Remotion over the brand backdrop with wordmark + CTA (5s total).

## Recipe

1. Toolchain + brand check per marketing-studio (onboard the brand first if new).
2. Blender scene: `feeders/blender/scenes/logo_reveal_<brand>.py`. If missing, copy
   `logo_reveal.py` (noban) and swap ONLY the geometry builders to the new mark's
   SVG shapes — materials/choreography/camera/alpha/args are brand-agnostic. Read the
   PLAYBOOK's Blender 5.1.2 gotchas FIRST (cleanup, emission 1.0, non-cyclic splines).
3. Proof frames: `python feeders/blender/render.py <scene> --out assets/<brand>/logo-reveal --frame 20|55|90`,
   Read each; verify draw-on progression + transparent alpha (corner pixel alpha 0).
4. Animation render (`--animation`, ~30s), then
   `node scripts/stage-blender-assets.mjs <brandId>` (stages every rendered sequence
   under `assets/<brandId>/` into `studio/public/<brandId>/`).
5. Composite: render the `LogoReveal` composition with
   `--props='{"brandId":"<id>","sequence":"<id>/logo-reveal","frameCount":90,"cta":"<brand cta>"}'`.
   Inspect stills at frames 30/80/130 (mid-draw / wordmark in / full lockup, CTA in
   the brand's accent-positive color).
6. Deliver per marketing-studio (copy into calling repo + send to user).
