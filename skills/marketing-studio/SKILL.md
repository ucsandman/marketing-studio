---
name: marketing-studio
description: Use when generating any brand video, animation, image, or audio asset (logo reveal, social clip, product demo, launch video, OG image, README GIF, music, voiceover) for any product/repo, or when working inside the marketing-studio engine repo. Required background for /logo-reveal, /social-clip, /product-demo, /launch-video, /og-assets, /audio-track.
---

# Marketing Studio

All brand video/animation/image assets render in ONE engine repo (Remotion +
Blender + Playwright + ComfyUI feeders). Its root is:

    ${CLAUDE_SKILL_DIR}/../..

That path is substituted when this skill loads, so it is correct wherever the
engine is installed. Call it ENGINE below. Never generate animation code inside
a product repo — work in ENGINE, then copy the finished artifact into the
calling repo.

**REQUIRED READING before any asset work:** `${CLAUDE_SKILL_DIR}/../../docs/PLAYBOOK.md`
— engine map, brand onboarding steps, and the verified gotchas (Blender 5.1.2 API
traps, camera math, seamless-loop rules, capture-feeder lessons). Those were
expensive to discover; do not re-derive or second-guess them.

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
3. Execute the asset recipe (per-skill).
4. Rendered proof: inspect 2-4 stills (Read tool) at key frames BEFORE any full render.
5. Full render to `out/<brand>/`; run `node scripts/smoke.mjs` if you touched studio code.
6. Deliver: copy the artifact into the calling repo (ask once for the destination;
   default its existing media/marketing dir) and SEND the file to the user. Not done
   until the user has seen it.
7. Commit the engine repo: any code/config/props changes your run made in
   ENGINE get committed there (tests + lint + smoke first). Renders
   under out/, assets/, studio/public/ stay uncommitted (gitignored). An uncommitted
   engine tree strands your work and blocks the next session.

## Non-negotiables

- Brand values only from `brands/<id>.json` via `getBrand(brandId)`; never literal hex
  in templates. Honor the brand's stated color rules (noban: profit gold, never green).
- Nullable asset props + placeholder fallbacks (clean-clone smoke stays green).
- Copy: no em dashes, no hype words.
- Fail loudly; generated props files are edited via their builder scripts only.

## Token discipline

Recipes are solved — execute, don't explore. Render logs: `| tail -2`. Inspect
stills, never videos (extract frames via `npx remotion ffmpeg` when needed).
Subagent any visual-tuning loop so iteration images land in discarded context.
Routine runs work fine on Opus/Sonnet; escalate model tier only for new template
design or visual bugs the PLAYBOOK doesn't cover.
