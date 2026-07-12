# Magnetic × animations studio — integration roadmap

Date: 2026-07-12
Status: approved direction; phase 1 designed in full, phases 2–3 scoped sketches
(each gets its own brainstorm when reached).

## Context

Magnetic (`C:\projects\final-cut-pro`, repo name `magnetic`) is a Practical
Systems product: an FCP-style non-linear video editor for Windows (Electron 39 +
React 19), with a Claude Copilot and an MCP server for agent-proposed edits
behind a human Accept/Reject gate. It has a complete in-app design system
(DESIGN.md/PRODUCT.md) but no visual identity outside the app — `resources/
icon.png` is still the default Electron logo — and no marketing assets.

The two repos complement each other along one axis: the animations repo is a
deterministic studio (Remotion renders from code and brand tokens), Magnetic
is built for non-deterministic footage (recordings, takes) where a human or
its Copilot makes judgment cuts. Neither covers the other's half.

**Where they do NOT complement:** the existing Remotion pipeline stays
code-rendered end to end. No NLE step is inserted into deterministic asset
production.

## Decisions made

- **Scope: portfolio-ready, not launch.** Assets land in the Magnetic README
  and repo. Posting/launch-engine flow is a separate later decision; no launch
  video, no social posts in phase 1.
- **Demo footage is studio-rendered.** The animations repo (Blender feeder /
  Remotion) renders the clips that appear as "footage being edited" inside
  Magnetic during demos. Dogfooding loop: studio makes the footage, Magnetic
  edits it on camera, studio wraps the recording.
- **Stage, hand off at end.** Another Claude session is active in
  final-cut-pro. All work happens in this repo; finished files stage in
  `out/magnetic/` with a handoff manifest. Nothing is written into
  final-cut-pro until the user confirms the other session is done or
  non-overlapping.
- **Roadmap shape:** phase 1 designed fully now; phases 2–3 are sketches
  because they depend on phase 1 learnings (agent-driven recording of an
  Electron NLE, export handoff needs) and on Magnetic's in-flight MCP work.

## Phase 1 — Magnetic portfolio suite (full design)

Goal: Magnetic goes from "default Electron icon, no identity outside the app"
to portfolio-ready: real mark, README hero media, product demo, OG assets.

### 1. Brand onboarding

`brands/magnetic.json`, translated from Magnetic's DESIGN.md/PRODUCT.md
(zod-validated via `studio/src/lib/brand.ts`):

- Colors: app-bg `#161617`, panel `#1d1d1f`, accent `#0a84ff` (Apple dark-mode
  system blue — the ONLY accent), text `#f5f5f7`, text-dim `#98989d`.
  Semantic colors from the app: yellow `#ffd60a` marks/keyframes, green
  `#4ca47c` audio waveforms only, red `#ff6961` destructive.
- Voice: "finished Apple pro app" — restrained, precise, quiet confidence.
  Anti-references carried into the `voice` block so lint-copy and the
  motion-craft judge enforce them: no consumer-creator flashiness, no
  gradients/badges/emoji, no hype copy, no engagement-y illustration.
- Motion language mirrors the app: 150ms ease-out sensibility, no entrance
  choreography, footage/product is the hero, chrome recedes.

### 2. Mark design

No mark exists; this is the creative core of the phase. Direction: *magnetic
timeline* — field-line / spine geometry, system blue on near-black, restrained
enough to sit beside Apple pro-app iconography. Process:

- Build 2–3 mark concepts, present as rendered frames (storyboard-approval
  flow). User picks/iterates.
- Winning mark ships as: mark component in `studio/src/brands/marks.ts`,
  app icon set (`icon.png`, `icon.ico`, `icon.icns`) staged for handoff to
  replace the default Electron icon, and the anchor of all video assets.

### 3. Demo footage clips

Blender feeder renders 3–5 short cinematic clips (engines and gotchas per
docs/PLAYBOOK.md) to serve as import media inside Magnetic. Reusable across
demo takes and future phases.

### 4. Demo recording

Drive Magnetic (Electron) with scripted Playwright / agent-browser per the
browser-QA playbook. Scripted edit session: import → filmstrip skim →
append/blade/trim on the magnetic timeline → a Rough Cut ghost-diff moment →
export. Captures feed the product-demo pipeline (zooms, cursor emphasis).
Recording runs against a locally built Magnetic; read-only with respect to
that repo's source.

### 5. Assets produced (staged in `out/magnetic/`)

| Asset | Use |
| --- | --- |
| Mark + app icon set | Replaces default Electron icon (handoff) |
| Logo reveal | Brand anchor animation, README/docs |
| Product demo video (~45–60 s) | README + portfolio |
| README hero GIF | Top of README |
| OG image + social card | GitHub link previews |

Handoff manifest lists destination paths inside final-cut-pro (icon files,
README media, OG image); copy happens only after user go-ahead.

### 6. Verification

- `node scripts/smoke.mjs` passes with new compositions listed.
- Rendered-frame inspection at every visual stage; user sees every final
  asset before handoff (repo rule).
- Copy gated by `scripts/lint-copy.mjs` + brief.json flow; builders overlay
  brief copy — no hand-edited copy in generated props.

### Out of scope (phase 1)

Launch video, social clips, posting, any writes into final-cut-pro before the
handoff gate, changes to Magnetic source code.

## Phase 2 — long-form → short-form pipeline (sketch)

Deliverable is a file contract plus an ingest path:

- Magnetic "marketing handoff" export = smart-rendered MP4 + SRT/VTT sidecar +
  segments manifest (JSON of kept ranges and markers).
- Animations repo: ingest builder (`scripts/build-wrap-props.mjs` pattern) +
  a Wrap template family (brand chrome, captions from sidecar, music bed via
  the audio-track flow).

Open questions for its brainstorm: exact manifest schema; whether Magnetic
needs a new export preset (touches final-cut-pro — coordinate with the other
session); which brand pilots it.

## Phase 3 — Magnetic as review station (sketch)

Animations-repo tooling connects to Magnetic's MCP server
(`scripts/magnetic-mcp.mjs` in that repo), assembles rendered marketing assets
on a timeline as a ghost-diff proposal; the user Accepts/Rejects in Magnetic's
UI and exports by hand (no export over MCP, by Magnetic's design — the human
gate stays). Makes the "final assets are not done until the user saw them"
rule a literal, editable review surface.

Blocked on: phase 1 assets existing; Magnetic's MCP work (other session)
stabilizing; phase 2's file contract for round-tripping.

## Sequencing rationale

1 → 2 → 3. Phase 1 produces the brand and the reusable footage the later
phases consume; phase 2 defines the file contract phase 3 reuses; phase 3
depends on external MCP work landing.
