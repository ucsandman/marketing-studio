# animations: agent-driven marketing studio

Remotion (studio/) renders all final video for synthacon (the studio's only brand);
assets are copied out to the product's repo at the end. brands/<id>.json holds per-product tokens
(zod-validated via studio/src/lib/brand.ts; mark components in studio/src/brands/marks.ts);
templates resolve getBrand(brandId) and never hardcode brand values. Feeders:
feeders/blender (headless bpy), feeders/capture (Playwright), feeders/comfy (ComfyUI,
non-load-bearing). Spec: docs/superpowers/specs/2026-07-09-animation-studio-design.md.
skills/ is the shareable mirror of the user-level asset skills (installed via
scripts/install-skills.mjs); when a skill changes, update both copies.

**Read docs/PLAYBOOK.md before any asset or feeder work** — engine map, brand
onboarding, and verified gotchas (Blender 5.1.2 API traps, camera math, seamless-loop
rules, capture lessons). Do not re-derive them. User-level skills (/logo-reveal,
/social-clip, /product-demo, /launch-video, /og-assets) drive this repo from any repo.

Rules:
- Brand color rules live in each brand's JSON `voice` (synthacon: violet/white/black
  only — no gold or yellow, no glow, no bloom; green = success/online only, red = error only).
- Rendered proof: visual work is not done until a rendered frame was inspected;
  final assets are not done until the user saw them.
- Smoke check before claiming done: node scripts/smoke.mjs (every composition listed).
- Generated props JSON is edited only via its builder script (scripts/build-*-props.mjs).
- Asset copy traces to out/<brand>/marketing/brief.json (agent-synthesized, gated by
  scripts/lint-copy.mjs and the storyboard approval); builders overlay brief copy —
  never hand-edit copy into generated props.
- out/, assets/, studio/public/*/ are gitignored build products.
- Blender via BLENDER_PATH in .env; ComfyUI on :8000/:8188 with documented fallback.
