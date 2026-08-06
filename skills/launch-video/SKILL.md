---
name: launch-video
description: Use when the user wants a full launch video / hero video / 30-90s product announcement composing demo footage, logo, and copy (e.g. "/launch-video", "make the launch video for synthacon").
---

# Launch Video

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `C:\Projects\animations`.

Produces: `out/<brand>/launch.mp4` — ~45s five-act composition: logo reveal ->
hook headline -> live demo -> feature beats (1-3) -> end card, over the brand's
background loop.

## Recipe

1. Ingredients first — this template COMPOSES existing assets. Ensure (running the
   sibling skills as needed): logo reveal asset (vector reveal or Blender PNG
   sequence — logo-reveal skill steps 1-4), background loop (Blender `background_loop`
   scene per brand; PLAYBOOK seam rules), demo capture + telemetry (product-demo skill
   steps 1-4), feature screenshots.
2. Props builder: no `build-<brand>-launch-props.mjs` ships in a synthacon-only tree
   (the noban template was removed in the brand slim). Author
   `scripts/build-synthacon-launch-props.mjs` fresh, following the brief-overlay
   convention (see `build-synthacon-demo-props.mjs`) — it is the copy's source of
   truth (headline, feature lines, CTA; no em dashes) and pulls telemetry from the
   demo props so they never drift. Run it.
3. Act timing comes from `studio/src/lib/launchTiming.ts` (shared with
   calculateMetadata — never duplicate the math; adjust constants there if pacing
   changes, and its vitest tests with them).
4. Proof stills: one frame per act (logo/hook/demo/each feature/end card), Read all,
   iterate copy and framing until intentional.
5. `npx remotion render LaunchVideo out/<brand>/launch.mp4 --props=props/<brand>-launch.json`
   (~1350 frames, minutes). Deliver per marketing-studio.
6. Audio: run the audio-track skill to add music + voiceover to the render.
