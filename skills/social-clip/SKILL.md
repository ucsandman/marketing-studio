---
name: social-clip
description: Use when the user wants a short social media video / feature announcement clip / X-LinkedIn-TikTok teaser for any product (e.g. "/social-clip", "make a clip announcing the new dashboard").
---

# Social Clip

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `${CLAUDE_SKILL_DIR}/../..`.

Produces a scored short-form asset in `<product>/marketing/assets/<brand>/`. Its opening,
aspect-specific composition, and CTA must serve the platform rather than repeat the
launch film's end card by default.

## Recipe

1. Toolchain + brand check per marketing-studio.
2. Put approved capture/source media under the product workspace's `public/<brand>/`
   tree using a repeatable product-aware feeder. The SocialClip panel zooms into it —
   tune the `zoom {from,to,origin}` so the crop ends BEFORE any app-side clipped edge
   and the money-shot column/element is the rightmost thing in frame.
3. Product-owned props file matching `socialClipSchema`
   ({brandId, kicker, headline, lines (1-4), screenshot, cta}). Copy: terse, factual,
   brand voice, no em dashes.
4. Proof stills at frames 45/150/280 (headline / panel+lines / end card), Read each,
   iterate copy + zoom until intentional.
5. Render into the product workspace with the product props and
   `--public-dir=<product>/marketing/assets/<brand>/public`.
6. Score it (mandatory: SocialClip renders silent and a silent clip is not
   deliverable): run `score-social-clip` with `--project <product>` and the one narration
   line that matches the plate. Cuts alone do not justify generic SFX.
7. `node scripts/check-audio.mjs <brand> --project <product>` exits 0, then deliver the scored file per
   marketing-studio.
