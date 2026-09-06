# Playwright capture

Read this when: doing product-demo capture or any Playwright work.

## Playwright capture (product demos)
- The camera must zoom to MEASURED content regions (focus events), never to click
  points — clicks live on nav rails and produce "random zoom" feel. Measure focus
  rects from raw frames (`npx remotion ffmpeg -ss <t> -i demo.webm -frames:v 1 out.png`).
- Apps clip their own overflow: frame focus windows to end BEFORE any ragged
  self-clipped table edge; widening the viewport does not fix an app-side max-width clip.
- `deviceScaleFactor: 2` supersamples the recording (crisper, brighter); pair with
  `filter: brightness(1.12) contrast(1.03)` on the video layer.
- Telemetry: steps (captions) + clicks (cursor/ripple) + focus (camera) with t relative
  to recording start; cursor eases in the last 700ms before a click, clamped so rapid
  clicks never skip the rest state.
- Known accepted aesthetic: during zoom holds the cursor can be off-frame (it rests on
  the sidebar); user approved. Candidate fixes if redlined: widen focus rects or ease
  the camera out during cursor approach windows.
- NEVER print dashboard tokens; scripts read the product's .env at runtime and redact
  tokens from every error path.
- Next.js dev-tools indicator (the dark "N" button) lives INSIDE A SHADOW ROOT
  (`#devtools-indicator`), not light DOM — `nextjs-portal` removal/CSS misses it and it
  ends up baked into footage. Capture scripts need a shadow-root-piercing interval sweep;
  verify it's gone in the first extracted frame before recording the full take
  (see record-paperroute-demo.mjs).
- A demo capture MUST perform real clicks (`rec.click(locator)`), not just scroll+hold.
  DemoStage renders the cursor ONLY when telemetry has click events
  (`clickList.length > 0`), so a click-free capture (the truckside script until
  2026-09-05) draws no cursor and the composition is "rotating screenshots" — the exact
  thing Wes rejected. Every scene clicks a control and waits for the visible consequence
  (a new row, a changed badge, a queued Outbox send) before the camera frames it; use
  `page.waitForFunction` on a section's count badge or a status badge, not a fixed sleep,
  because owner ActionForm buttons are `useActionState` client actions that re-render in
  place (no navigation).
- The product hero (`public/media/demo-720.mp4`) and any "cursor visible" deliverable are
  derived from the ProductDemo COMPOSITION (which draws the cursor from click telemetry),
  NEVER from a crop of the raw Playwright webm — the raw recording has no cursor, so a
  raw crop is cursorless. The 2026-09-05 morning run cropped the raw capture and shipped a
  cursorless hero; the reshoot switched it to the composition and moved page.tsx aspect to
  16/9.
