---
name: launch-video
description: Use when the user wants a full launch video / hero video / 20-60s product film composing rebuilt product UI, logo, copy, narration and music (e.g. "/launch-video", "make the launch video for DashClaw").
---

# Launch Video

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `${CLAUDE_SKILL_DIR}/../..`.

Produces: `out/<brand>/film/film-vN-scored.mp4` — a bespoke 20-40s film with music,
narration and SFX cues, plus `out/<brand>/launch.mp4` (the scored lock that postkit,
mission-control and review-in-magnetic expect).

**A film is not done without audio, and audio means a voice explaining the product.**
Step 8 is not optional and `node scripts/check-audio.mjs <brand>` must exit 0 before
the word "done". Two postflop cuts shipped silent on 2026-09-01; that is the reason
this line exists.

## Route

Default: a BESPOKE composition at `studio/src/films/<brand>/` (PLAYBOOK "Bespoke
films"; postflop is the worked example). Every product shot is rebuilt native UI
that animates (grids resolving, figures counting, a cursor that clicks), never a
screenshot panel or a screen recording. The LaunchVideo template is the fallback
only when the user asks for the five-act house style explicitly.

## Recipe

1. Direction, before any storyboarding or building: write three one-page directions
   with `docs/templates/DIRECTION.md`, kill two with its kill questions, and record the
   survivor + its signature move in `out/<brand>/marketing/direction.md`. Skip only if
   that file already exists for this version.
2. Shot spec: write `out/<brand>/marketing/film-spec.md` from the direction (copy
   postflop's shape: non-negotiables from the brand voice, motion rules judge-motion
   scans for, the composition contract, and a timeline table of 6-10 shots with the
   beat each one performs and every numeral traceable to brief.json proofPoints).
   Narration is planned HERE, per shot, at ~2.6 words/second minus a 150ms breath
   between lines; a 28s film carries about 60 spoken words, not 150.
3. Build: `studio/src/films/<brand>/` — timeline.ts (SHOTS, TOTAL, OVERLAP), a ui/
   kit of the product's rebuilt pieces, one shots/ShotNN.tsx per timeline row,
   Film.tsx sequencing them with overlap handovers, registered in Root.tsx and
   scripts/smoke.mjs. Each shot proves itself: render its frame range at
   `--scale=0.5`, tile a contact sheet with ffmpeg, Read it, fix, re-render.
4. Gates on the studio: `npx tsc --noEmit -p .` in studio/, `node scripts/judge-motion.mjs
   <brand>`, `node scripts/smoke.mjs`.
5. Director loop on the whole film: render `out/<brand>/film/film-vN-preview.mp4` at
   half scale, contact-sheet it (fps=2), extract the LAST frame of every shot (must be
   static) and the frames around each cut (must overlap, no pop), write your own defect
   list, fix, re-render as the NEXT version. Never overwrite a version.
6. Full-res render of the version whose sheets passed: `npx remotion render <Brand>Film
   out/<brand>/film/film-vN.mp4`. Read two full-res frames.
7. Audio copy: `scripts/build-<brand>-film-audio.mjs` (copy source of truth: narration
   lines with their start second, SFX cues on the landing frames, music prompt) ->
   `props/<brand>-film-audio.json`. Written for the ear; every figure from the brief.
8. Score: `node scripts/score-film.mjs <brand> out/<brand>/film/film-vN.mp4`. It refuses
   overlapping lines (trim copy in the builder, never the picture) and masters to
   TARGET_I, verifying the DELIVERED file. Then `node scripts/verify-cue.mjs` on one
   narration window and one bed-only window: the voice must sit clearly above the bed.
9. Lock: copy the scored file to `out/<brand>/launch.mp4`; run
   `node scripts/check-audio.mjs <brand>` (exit 0 required) and `node scripts/judge-palette.mjs
   <brand> <scored.mp4>`. Deliver per marketing-studio: the user watches the SCORED cut.
