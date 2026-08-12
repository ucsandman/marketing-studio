---
name: social-clip
description: Use when the user wants a short social media video / feature announcement clip / X-LinkedIn-TikTok teaser for any product (e.g. "/social-clip", "make a clip announcing the new dashboard").
---

# Social Clip

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `${CLAUDE_SKILL_DIR}/../..`.

Produces: `out/<brand>/<name>.mp4` — 10s, 1920x1080, three acts:
headline word-spring -> screenshot panel + feature lines -> end card.

## Recipe

1. Toolchain + brand check per marketing-studio.
2. Screenshot: copy the product screenshot into `studio/public/<brand>/` (create a
   `fetch-<brand>-assets.mjs` if repeatable). The SocialClip panel zooms into it —
   tune the `zoom {from,to,origin}` so the crop ends BEFORE any app-side clipped edge
   and the money-shot column/element is the rightmost thing in frame.
3. Props file `props/<brand>-<name>.json` matching `socialClipSchema`
   ({brandId, kicker, headline, lines (1-4), screenshot, cta}). Copy: terse, factual,
   brand voice, no em dashes.
4. Proof stills at frames 45/150/280 (headline / panel+lines / end card), Read each,
   iterate copy + zoom until intentional.
5. `npx remotion render SocialClip out/<brand>/<name>.mp4 --props=<props>`.
6. Deliver per marketing-studio.
