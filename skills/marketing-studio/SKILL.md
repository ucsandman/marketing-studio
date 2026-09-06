---
name: marketing-studio
description: Use when generating any brand video, animation, image, or audio asset (logo reveal, social clip, product demo, launch video, OG image, README GIF, music, voiceover) for any product/repo, or when working inside the marketing-studio engine repo. Required background for /logo-reveal, /social-clip, /product-demo, /launch-video, /og-assets, /audio-track.
---

# Marketing Studio

Reusable video/animation/image source lives in one engine repo (Remotion + Blender +
Playwright + ComfyUI feeders). Its root is:

    ${CLAUDE_SKILL_DIR}/../..

Call it ENGINE below. The product repo is PROJECT. Reusable source changes belong in
ENGINE; every generated input, capture, audio file, prop, public-stage asset, review
record, render, and delivery file belongs in
`PROJECT/marketing/assets/<brand>/`. Pass `--project PROJECT` to generators and
renderers. Do not render into ENGINE and copy out later.

**REQUIRED READING before any asset work:** `${CLAUDE_SKILL_DIR}/../../docs/PLAYBOOK.md`
(engine map, onboarding, process, delivery contract) plus ONLY the
`${CLAUDE_SKILL_DIR}/../../docs/playbook/<topic>.md` files the recipe names; do not
read the other topic files. Those were expensive to discover; do not re-derive or
second-guess them.

## Workflow shape (every asset skill follows this)

0. Shared-repo guard: `git -C "${CLAUDE_SKILL_DIR}/../.." status --short`. If the tree has
   uncommitted modifications you did not make, ANOTHER session is likely mid-flight
   in the engine repo — tell the user what you found and ask whether to wait or
   proceed (scope-lock if proceeding in parallel). Never build on top of a stranger's
   uncommitted edits silently.
1. `cd "${CLAUDE_SKILL_DIR}/../.." && python launch.py --check` — verify the toolchain.
2. Brand check: does `brands/<id>.json` exist for the product? If not, run the
   PLAYBOOK's "Onboarding a new brand" section first (tokens from the product repo's
   DESIGN.md/tailwind/CSS vars; mark component; registries). Ask the user only for
   values you cannot derive.
3. For hero creative, choose a direction with references/provenance, approve a style
   frame, and build an audio-bearing animatic before finish work. Use capture, native UI,
   2D, 3D, or hybrid shots according to the product proof, not a house-style ritual.
4. Execute the asset recipe with `--project PROJECT`. Remotion commands that use staged
   media also pass `--public-dir=PROJECT/marketing/assets/<brand>/public`.
5. Inspect representative stills before any full render. For a production film, inspect
   start/middle/end evidence for every shot and watch the complete scored cut with sound.
6. Run the asset gates plus `node scripts/check-audio.mjs <brand> --project PROJECT`.
   Narration is the default; music-only is an explicit recorded exception. Mechanical
   PASS never substitutes for the named non-author “would I share this?” review.
7. The finished artifact already lives in PROJECT. Send it to the user; it is not done
   until they have seen it. Commit only reusable ENGINE source/config changes and the
   product-owned run artifacts appropriate for PROJECT.

## Non-negotiables

- Brand values only from `brands/<id>.json` via `getBrand(brandId)`; never literal hex
  in templates. Honor the brand's stated color rules (noban: profit gold, never green).
- Nullable asset props + placeholder fallbacks (clean-clone smoke stays green).
- Production generators never write personal/product material into ENGINE. Diagnostic
  probes use the explicit temp mode supplied by their wrapper and stay under OS temp.
- Copy: no em dashes, no hype words.
- Fail loudly; generated props files are edited via their builder scripts only.

## Token discipline

Recipes are solved — execute, don't explore. Render logs: `| tail -2`. Inspect
stills, never videos (extract frames via `npx remotion ffmpeg` when needed).
Subagent any visual-tuning loop so iteration images land in discarded context.
Routine runs work fine on Opus/Sonnet; escalate model tier only for new template
design or visual bugs the PLAYBOOK doesn't cover.
