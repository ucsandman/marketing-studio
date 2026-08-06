---
name: product-demo
description: Use when the user wants a product demo video / screen recording with zooms and cursor / dashboard walkthrough clip for any product (e.g. "/product-demo", "record a demo of the app", "Screen-Studio style demo").
---

# Product Demo

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `C:\Projects\animations`.

Produces: `out/<brand>/demo.mp4` — real app footage with synthetic smooth cursor,
focus-driven camera zooms, and step captions, plus a brand end card.

## Recipe

1. Toolchain + brand check per marketing-studio. The product's app must be RUNNING
   (ask the user to start it; never start their stack yourself).
2. Capture script: `feeders/capture/record-<brand>-demo.mjs`. For a new product copy
   `record-synthacon-demo.mjs`: viewport wide enough for the app, `deviceScaleFactor: 2`,
   proven ready-locators per view, a step caption per view. Read the PLAYBOOK's
   capture gotchas FIRST — especially: camera focus rects are MEASURED from raw
   footage frames, never derived from click points, and must end before any app-side
   clipped edge.
3. Run the capture; verify `capture OK` + the props JSON it writes.
4. Measure/tune focus rects: extract raw frames
   (`npx remotion ffmpeg -ss <t> -i studio/public/<brand>/demo.webm -frames:v 1 f.png`),
   Read them, set focus {x,y,w,h} centers/sizes in the capture script, re-capture (~20s).
5. Proof stills of the `ProductDemo` composition at one frame per view; check camera
   framing, cursor plausibility, captions, brightness.
6. Render, deliver per marketing-studio. Known accepted aesthetic: cursor may leave
   frame during zoom holds (see PLAYBOOK for the redline options if the user objects).
