---
name: logo-reveal
description: Use when the user wants a logo reveal / logo animation / brand intro video for any product (e.g. "/logo-reveal", "make a logo reveal for synthacon", "animated logo for the landing page").
---

# Logo Reveal

**REQUIRED BACKGROUND:** marketing-studio skill (engine location, brand onboarding,
PLAYBOOK gotchas). Work happens in `C:\Projects\animations`.

Produces: `out/<brand>/logo-reveal.mp4` — logo draw-on composited in Remotion over the
brand backdrop with wordmark + CTA (5s total).

## Recipe

1. Toolchain + brand check per marketing-studio (onboard the brand first if new).
2. Check `studio/src/brands/reveals.ts` for a vector Reveal component. synthacon has
   one (`SynthaconReveal.tsx` — pure SVG/React, frame math in `lib/revealTiming.ts`,
   `DURATION_S = 2.8`): skip straight to step 4, `sequence: null` in props (see
   `props/synthacon-logo-reveal.json`) — no Blender step needed.
3. **Only if the brand has no vector reveal** (a new brand, not synthacon): fall back
   to the Blender PNG-sequence path — `feeders/blender/scenes/logo_reveal_<brand>.py`,
   or copy `logo_reveal.py` and re-author its geometry builders from scratch (its
   current shapes are a noban-derived reference only, explicitly not reusable as-is
   per its own file docstring). Read the PLAYBOOK's Blender 5.1.2 gotchas first
   (cleanup, emission 1.0, non-cyclic splines), render proof frames
   (`python feeders/blender/render.py <scene> --out assets/<brand>/logo-reveal --frame 20|55|90`),
   then `--animation` + `node scripts/stage-blender-assets.mjs <brandId>`.
4. Composite: render the `LogoReveal` composition with
   `--props='{"brandId":"<id>","sequence":<null for the vector path, or "<id>/logo-reveal"
   for the Blender path>,"frameCount":<1, or 90 for the Blender path>,"cta":"<brand cta>"}'`.
   Inspect stills across the draw-on (early stroke, terminal-connect around the
   midpoint, final held lockup) — for synthacon these timings come from `revealTiming.ts`.
5. Deliver per marketing-studio (copy into calling repo + send to user).
