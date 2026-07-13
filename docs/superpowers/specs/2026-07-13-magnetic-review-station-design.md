# Magnetic review station — phase 3 design

Date: 2026-07-13
Status: approved direction. Implements phase 3 of
`2026-07-12-magnetic-integration-design.md`. Phases 1 (portfolio suite) and
2 (wrap pipeline) shipped; phase 2's DashClaw wrap segments are this phase's
pilot content.

## Problem

Rendered marketing assets are reviewed by watching MP4s one at a time (or via
Mission Control's static cards). Magnetic — a real editor with JKL,
frame-stepping, and ripple delete — is the better review surface, and its
Agent Access ghost-diff gate is built for exactly this trust model. But the
current MCP surface can only edit clips that already exist on the open
timeline: there is no import tool and no op that adds a clip. Phase 3 grows
Agent Access so an agent can assemble a review reel, and wires the verdicts
back into the marketing repo's existing review loop.

## Decisions made

- **Accept semantics: verdicts flow back.** The assembled timeline is a
  review reel, not a deliverable. Assets stay the deliverables; the user's
  keep/delete decisions map to per-asset verdicts written into the same
  `review.json` Mission Control's Approve/Redo buttons write. The
  finishing-station flow (edit the reel into a new exported deliverable) is
  explicitly deferred as phase 3.5 — same plumbing, different Accept
  semantics.
- **Import gating: allowlisted directories, direct.** Settings gain "Agent
  media folders". Imports from inside the allowlist land directly (visible,
  additive, removable); anything outside is rejected loudly. The ghost-diff
  gate stays focused on timeline mutations. Rejected alternatives:
  proposal-gated staging (orphaned-media lifecycle machinery, invisible
  preparation) and unrestricted paths (hands agents arbitrary filesystem
  reach — wrong posture for the product whose story is the human gate).
- **Approach: grow Agent Access properly** (assemble ops through the
  existing proposal machinery). Rejected: externally writing `.mglib`
  bundles (private format, brittle, bypasses the gate) and an HTML-only
  review reel (abandons editor ergonomics and the dogfooding narrative).

## Magnetic side (final-cut-pro repo): Agent Access v2

### Agent media folders (settings + sidebar)

- A persisted allowlist of directories, editable in app settings; current
  entries visible near the Agent Access toggle in the sidebar (the human
  always sees what agents may read).
- Empty allowlist (default) means `import_media` rejects everything —
  opt-in per directory.

### New MCP tool: `import_media {paths: string[]}`

- Validates every path resolves inside an allowlisted directory (after
  normalization/symlink resolution — no traversal escapes); one bad path
  rejects the whole call, naming it.
- Routes through the existing import pipeline (same code path as the import
  dialog: hardlink-or-copy into the library, thumbnail/waveform jobs),
  returns `{assets: [{assetId, fileName}]}`.
- Assets appear in the browser immediately — direct, not proposal-gated.

### New proposal ops (inside existing `propose_edits`)

- `append_clip {asset_id}` — append to spine end.
- `insert_clip {asset_id, at_index}` — insert at spine index, ripple.
- `connect_clip {asset_id, at_sec}` — connected clip at sequence time.
- All three flow through the existing ghost-diff proposal: preview render,
  invariant guard, Accept/Discard, one undo step, session-only attribution —
  identical to the current op set. No export over MCP (unchanged).
- `read_timeline` output gains each clip's source `fileName` (provenance for
  the verdict mapping).

### Testing (Magnetic)

- Unit: allowlist path validation (inside/outside/traversal/symlink cases);
  new ops' proposal translation (existing kernel append/insert/connect ops
  are reused — the work is exposure, not new edit semantics).
- E2E: extend `e2e/agent-mcp.spec.ts` — enable Agent Access with a temp
  allowlisted dir, `import_media` two fixture files, propose
  append+connect+marker batch, Accept via UI, `read_timeline` shows the
  clips with fileName provenance; a path outside the allowlist rejects.

## Animations side (this repo): driver + human surface

### `scripts/review-in-magnetic.mjs <brand>`

- Reads `out/<brand>/marketing/run.json` (the same inventory Mission
  Control renders), resolves the asset files to review. Scope: VIDEO assets
  only (mp4/webm) — stills and GIFs stay on Mission Control's cards; a
  timeline adds nothing to reviewing a PNG.
- Connects to the sidecar over loopback HTTP with the bridge's token
  discovery (`%APPDATA%/magnetic/agent-sidecar.json` or env); fails loudly
  with the enable-Agent-Access hint if unreachable.
- `import_media` the assets (their staging dir must be in the user's
  allowlist — the error message says exactly which dir to add), then one
  `propose_edits` batch: `append_clip` per asset in inventory order + a
  green `add_marker` naming each asset key at its start.
- Exits after the proposal lands (the human Accepts in Magnetic and reviews
  at leisure) — pull-based, no waiting daemon.

### Verdict pull

- `scripts/pull-magnetic-verdicts.mjs <brand>`: `read_timeline` via the
  sidecar, map surviving clips to assets by fileName provenance, diff
  against the manifest the driver wrote (`out/<brand>/marketing/
  magnetic-review.json`: the imported asset list), and write verdicts into
  `review.json` in the exact shape Mission Control's Approve/Redo writer
  uses (probe at implementation; that writer is the format's source of
  truth).
- Verdict rules: clip survives (even trimmed) → approved; clip deleted →
  rejected; asset never imported/proposal never accepted → unreviewed
  (never silently approved).

### Mission Control buttons (human surface, §5 contract)

- **"Review in Magnetic"** — runs the driver for the run's brand; surfaces
  the sidecar-unreachable / allowlist errors inline.
- **"Pull verdicts"** — runs the pull script, renders the per-asset verdict
  summary, and refreshes the run view (review.json drives the existing
  Approve/Redo display).

### Testing (animations)

- Driver + pull-script unit tests against a fixture run.json and a stubbed
  sidecar HTTP server (happy path, unreachable sidecar, allowlist
  rejection, partial import).
- Verdict mapping unit tests: survive/deleted/trimmed/never-imported.

## Pilot / definition of done

1. User adds the animations `out/` dir to Magnetic's Agent media folders.
2. "Review in Magnetic" on the phase-2 DashClaw wrap run → reel proposal
   appears in Magnetic → user Accepts.
3. User reviews with editor ergonomics, deletes at least one asset,
   trims another (trim must still count approved).
4. "Pull verdicts" → review.json updates; Mission Control shows the
   verdicts; the summary matches what the user did on the timeline.
5. Both repos' gates green (Magnetic: typecheck/lint/test + extended e2e;
   animations: script tests + smoke; no studio/render changes expected).

## Out of scope

Finishing-station export flow (phase 3.5), auto-dispatching redo renders
from rejections, multi-brand simultaneous review sessions, proposal-gated
import staging, any new export capability over MCP.
