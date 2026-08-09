---
name: launch-video
description: Use when the user wants a full launch video / hero video / 30-90s product announcement composing demo footage, logo, and copy (e.g. "/launch-video", "make the launch video for DashClaw").
---

# Launch Video

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `C:\Projects\animations`.

Produces: `out/<brand>/launch.mp4` — ~45s five-act composition: logo reveal ->
hook headline -> live demo -> feature beats (1-3) -> end card, over the brand's
background loop.

## Recipe

1. Direction, before any storyboarding or building: write three one-page directions
   with `docs/templates/DIRECTION.md`, kill two with its kill questions, and record the
   survivor + its signature move in `out/<brand>/marketing/direction.md`. Skip only if
   that file already exists for this version.
2. Ingredients first — this template COMPOSES existing assets. Ensure (running the
   sibling skills as needed): logo-reveal PNG sequence (logo-reveal skill steps 1-4),
   background loop (Blender `background_loop` scene per brand; PLAYBOOK seam rules),
   demo capture + telemetry (product-demo skill steps 1-4), feature screenshots.
3. Props builder: create/extend `scripts/build-<brand>-launch-props.mjs` from the
   noban one — it is the copy's source of truth (headline, feature lines, CTA; no em
   dashes) and pulls telemetry from the demo props so they never drift. Run it.
4. Act timing comes from `studio/src/lib/launchTiming.ts` (shared with
   calculateMetadata — never duplicate the math; adjust constants there if pacing
   changes, and its vitest tests with them).
5. Proof stills: one frame per act (logo/hook/demo/each feature/end card), Read all,
   iterate copy and framing until intentional.
6. Render as a VERSIONED file, never overwritten: `out/<brand>/launch-v1.mp4`, `-v2`,
   ... The director loop is render -> watch -> write your own defect list -> fix ->
   re-render as a NEW versioned file (notes are symptoms, not specs — translate before
   fixing). `npx remotion render LaunchVideo out/<brand>/launch-vN.mp4
   --props=props/<brand>-launch.json` (~1350 frames, minutes).
7. Lock: copy the approved version to `out/<brand>/launch.mp4` — mission-control and
   review-in-magnetic expect that exact path. Deliver per marketing-studio.
8. Audio: run the audio-track skill to add music + voiceover to the locked render.
