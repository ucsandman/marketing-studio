---
name: launch-video
description: Use when the user wants a full launch video, hero video, or 20–60s product film combining product proof, brand, narration, music, and authored motion.
---

# Launch Video

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `${CLAUDE_SKILL_DIR}/../..`.

Produces a scored film and its direction, shot plan, stage approvals, render evidence,
and review record inside `<product>/marketing/assets/<brand>/`. Read
[`docs/production-quality.md`](../../docs/production-quality.md) before production work.

**A film is not done without audio, and audio means a voice explaining the product.**
Scoring is not optional and `node scripts/check-audio.mjs <brand> --project <product>`
must exit 0 before the word "done". Two postflop cuts shipped silent on 2026-09-01;
that is the reason this line exists.

## Route

Choose the route from the concept and product proof. Use a bespoke composition under
`studio/src/films/<brand>/` when the film needs a product-specific visual world or shot
system. Use the directed `LaunchVideo` composition when its authored shot plan can carry
the idea without reverting to the legacy five-act deck. A shot may use a real capture,
native rebuilt UI, 2D, 3D, or a hybrid. Rebuilding UI is useful for controlled actions;
it is not a universal requirement.

## Recipe

1. Set `<product>` explicitly with `--project`. Do not create any generated product input
   or output in engine-local `out/`.
2. Explore distinct directions, choose one with a specific reason, and record its visual
   metaphor, sound intent, references with provenance, and reviewable style frame in
   `direction.json`. The preset is only a starting grammar.
3. Write the shot plan before full production. Each shot needs a purpose, duration,
   scale, camera cadence, transition intent, readable-copy limits, source/reference,
   and audio beat. Plan narration with the edit; every numeric claim traces to a brief
   proof point.
4. Build an audio-bearing animatic with scratch voice and music. A named non-author
   reviewer approves both style frame and animatic, bound to their hashes. A weak visual
   argument stops here, before finish work.
5. Build the chosen route. Directed LaunchVideo consumes `direction` and authored
   `shots`; a bespoke film owns its shot components and timeline. Match cuts may overlap,
   hard cut, wipe, dissolve, or continue motion as the relationship demands. Static end
   frames are one option, not a rule.
6. Render inexpensive shot proofs and a versioned preview. Inspect the product action at
   delivery size, the start/middle/end of every shot, and the frames around every cut.
   Fix the written defect list, then make the full-resolution render once.
7. Build product-owned narration, music, and SFX inputs and score the silent lock with
   `node scripts/score-film.mjs <brand> <film.mp4> --project <product>`. It refuses
   overlapping narration and verifies the delivered master. Music-only requires the
   explicit recorded exception; never imply narration that is absent.
8. Generate hash-bound evidence from the exact final render:
   `node scripts/contact-sheet.mjs <brand> --project <product> --plan <production-plan.json> --render <final.mp4>`.
9. In Mission Control, a named director, operator, or independent reviewer watches the
   complete scored cut, records defects and the “would I share this?” verdict. Then run
   `node scripts/judge-production.mjs <brand> --project <product> --plan <production-plan.json> --render <final.mp4> --strict`.
10. Run the existing audio, palette, studio test/lint, and smoke gates. They prove
    properties and runtime, not taste. Only the scored, strict-PASS lock proceeds to the
    production matrix and post kit.
