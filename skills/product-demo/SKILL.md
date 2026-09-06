---
name: product-demo
description: Use when the user wants a product demo video / screen recording with zooms and cursor / dashboard walkthrough clip for any product (e.g. "/product-demo", "record a demo of the app", "Screen-Studio style demo").
---

# Product Demo

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `${CLAUDE_SKILL_DIR}/../..`.

Produces `<product>/marketing/assets/<brand>/demo.mp4`: real app footage with a
timestamp-driven cursor, subject-safe camera framing, and concise captions.

## Recipe

1. Toolchain + brand check per marketing-studio. The product's app must be RUNNING
   (ask the user to start it; never start their stack yourself).
2. Capture script: `feeders/capture/record-<brand>-demo.mjs`. For a new product copy
   `record-noban-demo.mjs`: viewport wide enough for the app, `deviceScaleFactor: 2`,
   proven ready-locators per view, a step caption per view. Read the PLAYBOOK's
   capture gotchas FIRST — especially: camera focus rects are MEASURED from raw
   footage frames, never derived from click points, and must end before any app-side
   clipped edge.
3. Run the capture with `--project <product>`; verify `capture OK` and the product-owned
   props/public files it writes. Do not stage product footage in the engine.
4. Measure/tune focus rects: extract raw frames
   (`npx remotion ffmpeg -ss <t> -i <product>/marketing/assets/<brand>/public/<brand>/demo.webm -frames:v 1 f.png`),
   Read them, set focus {x,y,w,h} centers/sizes in the capture script, re-capture (~20s).
5. Render one proof per view with
   `--public-dir=<product>/marketing/assets/<brand>/public`; check that the product action
   is legible at delivery size, camera framing is safe, and pointer phases match capture.
6. Render into the product workspace and deliver per marketing-studio. A full desktop
   recording is raw material, not automatically an authored edit.
