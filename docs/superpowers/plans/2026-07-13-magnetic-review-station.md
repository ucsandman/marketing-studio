# Magnetic Review Station Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phase 3: Agent Access v2 in Magnetic (allowlisted `import_media` + assemble proposal ops + fileName provenance) and the animations-side review loop (driver, verdict pull, Mission Control buttons), validated by a live DashClaw wrap-segment review pilot.

**Architecture:** Magnetic-side first (Tasks 1–4: allowlist → import tool → assemble ops → E2E), because the animations driver can only be integration-tested against a real sidecar; its unit layer uses a stubbed sidecar so Tasks 5–7 don't block. Verdicts flow: driver writes `magnetic-review.json` manifest → user edits in Magnetic → pull script diffs `read_timeline` against the manifest → writes Mission Control's `review.json` format.

**Tech Stack:** Electron + zod IPC + loopback HTTP sidecar (final-cut-pro), Playwright `_electron` E2E, plain-node scripts + `node --test` (animations), Mission Control's existing vanilla-JS console.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-magnetic-review-station-design.md` — verbatim law for: allowlist semantics (empty default = reject all; normalization/symlink resolution before the inside-allowlist check; one bad path rejects the whole call naming it), verdict rules (survive-even-trimmed → approved; deleted → rejected; never-imported → unreviewed, never silently approved), reel scope (VIDEO assets only, mp4/webm), no export over MCP, no kernel changes (assemble ops reuse existing kernel append/insert/connect commands — the work is proposal exposure).
- Magnetic conventions: zod on every IPC/sidecar payload; DESIGN.md tokens for settings/sidebar UI; commit style `Prefix: sentence`; gates `npm run typecheck && npm run lint && npm test` + touched e2e specs.
- Animations conventions: fail-loud scripts with isMain guards + `node --test`; Mission Control buttons follow its existing action wiring (probe `data-act` handlers at scripts/mission-control.mjs:617); review.json format's source of truth is Mission Control's own Approve/Redo writer (~line 319) — probe, mirror exactly, never invent fields.
- Two repos: animations work on branch `magnetic-review`; final-cut-pro work on its main. USER GATES: pilot steps (Task 8) — allowlist setup, live review, verdict confirmation.

---

### Task 1: Agent media folders — allowlist (final-cut-pro)

**Files:**
- Create: `src/main/agent-allowlist.ts`
- Test: `src/main/agent-allowlist.test.ts`
- Modify: settings persistence + sidebar display (probe: where Agent Access's toggle state lives — `src/main/agent-sidecar.ts` + the sidebar component that renders the toggle; the allowlist persists the same way and renders beside it, read-only list + add/remove in settings)

**Interfaces:**
- Produces: `isAllowedPath(candidate: string, allowlist: string[]): boolean` (pure; realpath-normalizes both sides, case-insensitive on win32, rejects traversal escapes) and `getAgentMediaFolders(): string[]` (persisted setting accessor). Task 2 consumes both.

- [ ] **Step 1: Probe** — locate Agent Access's toggle persistence and sidebar rendering; record exact files/lines in the report before editing.
- [ ] **Step 2: Failing tests for `isAllowedPath`** — inside dir → true; outside → false; `..\` traversal that resolves outside → false; case-differing drive/dir on win32 → true; symlink inside allowlist pointing outside → false (use a real temp symlink, skip on symlink-unsupported CI); empty allowlist → always false.
- [ ] **Step 3: Implement + pass** — `npx vitest run src/main/agent-allowlist.test.ts`.
- [ ] **Step 4: Settings + sidebar wiring** — persisted string[] (same store as the Agent Access toggle), settings UI add/remove (DESIGN.md control states, 11–13px), sidebar shows the folders under the toggle when Agent Access is on.
- [ ] **Step 5: Gates + commit** — `Agent access: allowlisted agent media folders`.

---

### Task 2: `import_media` tool (final-cut-pro)

**Files:**
- Modify: `src/main/agent-sidecar.ts` (tool route), `src/renderer/copilot/agent-runtime.ts` ONLY if tool dispatch lives renderer-side (probe Task 1's findings: `importAndProcess` at src/main/index.ts:99 is main-process — if the sidecar routes tools to the renderer, import_media should route to main directly; record the routing decision), `scripts/magnetic-mcp.mjs` (TOOLS entry)
- Test: extend `src/main/agent-allowlist.test.ts` sibling or new `src/main/agent-import.test.ts` for the handler's validation layer

**Interfaces:**
- Consumes: `isAllowedPath`/`getAgentMediaFolders` (Task 1); existing `importAndProcess(paths)` (src/main/index.ts:99 — reuse, never reimplement).
- Produces: sidecar tool `import_media {paths: string[]}` → `{assets: [{assetId, fileName}]}`; bridge TOOLS entry with description "Import video files from the user's allowlisted agent media folders into the open library. Rejects paths outside the allowlist."

- [ ] **Step 1: Failing tests** — zod payload shape (non-array, empty array, non-string entries all reject); one path outside allowlist rejects the WHOLE call with the offending path in the message (no partial import); allowlisted-but-missing file rejects naming it.
- [ ] **Step 2: Implement** — validate all paths first (loop isAllowedPath + existsSync), THEN import once via importAndProcess; map returned assets to `{assetId, fileName}`.
- [ ] **Step 3: Bridge entry** — add to TOOLS in scripts/magnetic-mcp.mjs (schema: `{paths: {type:'array', items:{type:'string'}}}`, required).
- [ ] **Step 4: Gates + commit** — `Agent access: import_media — allowlisted paths into the open library`.

---

### Task 3: Assemble ops + provenance (final-cut-pro)

**Files:**
- Modify: the propose_edits op translation (probe: `src/renderer/copilot/tools.ts` — the existing op set ripple_delete/blade/trim/move/roll/slip/add_transition/set_role/set_volume/add_marker translates there; assemble ops join it), `read_timeline` serializer (same area) for fileName provenance, `scripts/magnetic-mcp.mjs` (propose_edits description gains the three ops)
- Test: extend `src/renderer/copilot/tools.test.ts` (existing patterns)

**Interfaces:**
- Consumes: existing kernel append/insert/connect commands (the editor's E/W/Q equivalents — probe `src/shared/timeline/ops.ts` for exact names); asset ids from Task 2.
- Produces: ops `append_clip {asset_id}`, `insert_clip {asset_id, at_index}`, `connect_clip {asset_id, at_sec}` flowing through the SAME proposal machinery (ghost render, invariant guard, Accept/Discard, one undo step); `read_timeline` clips gain `fileName`.

- [ ] **Step 1: Probe** — op translation table + kernel command names + how the proposal working-copy applies ops; record in report.
- [ ] **Step 2: Failing tests** — each op translates to the right kernel command (append lands at spine end; insert at index ripples; connect at seconds→flicks on the right lane); unknown asset_id rejects the proposal batch naming it; invariant guard still validates the resulting sequence (reuse the existing guard test pattern).
- [ ] **Step 3: Implement + pass**; update read_timeline serializer (fileName from the asset record) + its test.
- [ ] **Step 4: Bridge description update** (propose_edits op list in scripts/magnetic-mcp.mjs).
- [ ] **Step 5: Gates + commit** — `Agent access: assemble ops — append/insert/connect through the proposal gate`.

---

### Task 4: Agent Access v2 E2E (final-cut-pro)

**Files:**
- Modify: `e2e/agent-mcp.spec.ts` (extend; follow its existing sidecar-driving pattern)

- [ ] **Step 1: Write the spec extension** — temp dir added to allowlist (via whatever settings API the e2e can reach — probe how agent-mcp.spec.ts enables Agent Access today), copy two fixture videos in; `import_media` both (assert assetIds + browser count); `propose_edits` batch: append both + green markers; Accept via the real UI button; `read_timeline` asserts both clips present WITH fileName provenance; negative: a path outside the allowlist rejects naming it; no export tool present in tools list (regression-pin the spec's existing assertion if it has one).
- [ ] **Step 2: Run** — `npm run build && npx playwright test e2e/agent-mcp.spec.ts` → PASS; full gates.
- [ ] **Step 3: Commit** — `Agent access: v2 e2e — import, assemble, accept, provenance`.

---

### Task 5: Sidecar client + review driver (animations)

**Files:**
- Create: `scripts/lib/magnetic-sidecar.mjs`, `scripts/review-in-magnetic.mjs`
- Test: `scripts/lib/magnetic-sidecar.test.mjs`, `scripts/review-in-magnetic.test.mjs`

**Interfaces:**
- Produces: `discoverSidecar()` (env vars MAGNETIC_AGENT_PORT/TOKEN, else %APPDATA%/magnetic|Magnetic/agent-sidecar.json — mirror scripts/magnetic-mcp.mjs's discover() in final-cut-pro, lines 23-39, exactly) and `callTool(tool, input)` (loopback POST /tool, bearer token, throws the bridge's exact unreachable/off hints). Driver CLI: `node scripts/review-in-magnetic.mjs <brand>` — reads out/<brand>/marketing/run.json, filters VIDEO assets (mp4/webm), `import_media`, one `propose_edits` batch (append_clip per asset in inventory order + green add_marker named by asset key at each start — compute marker at_sec from cumulative durations via ffprobe or the run.json metadata, probe which exists), writes `out/<brand>/marketing/magnetic-review.json` manifest `{proposedAt, assets: [{key, file, fileName, assetId}]}`, exits.
- Consumes (Task 6): the manifest shape above.

- [ ] **Step 1: Failing tests** — discoverSidecar env precedence + discovery-file fallback + null; callTool error mapping (fetch reject → "Agent Access is switched off" flavor); driver against a fixture run.json + stub HTTP sidecar (node http server in-test): happy path (import called with only video assets, propose called once, manifest written with assetIds), allowlist-rejection surfaces the sidecar's message + exits 1, partial-import impossible (whole-call semantics), unreachable sidecar exits 1 with the enable hint.
- [ ] **Step 2: Implement + pass** — `node --test scripts/lib/magnetic-sidecar.test.mjs scripts/review-in-magnetic.test.mjs`.
- [ ] **Step 3: Commit** — `feat(review): magnetic sidecar client + review-reel driver`.

---

### Task 6: Verdict pull (animations)

**Files:**
- Create: `scripts/pull-magnetic-verdicts.mjs`
- Test: `scripts/pull-magnetic-verdicts.test.mjs`

**Interfaces:**
- Consumes: `callTool('read_timeline')` (clips with fileName provenance, Task 3); `magnetic-review.json` manifest (Task 5); Mission Control's review.json writer format — PROBE scripts/mission-control.mjs (~lines 54, 319, 617: reviewPath, the approve/redo write shape, atomic write pattern) and mirror it EXACTLY; never invent fields.
- Produces: CLI `node scripts/pull-magnetic-verdicts.mjs <brand>` → verdict map {assetKey: approved|rejected|unreviewed} merged into review.json the same way Mission Control's buttons write it; prints the per-asset summary table.

- [ ] **Step 1: Probe** — record review.json's exact written shape from mission-control.mjs in the report.
- [ ] **Step 2: Failing tests (pure mapping first)** — `mapVerdicts(manifest, timelineClips)`: clip with matching fileName survives → approved; fileName absent → rejected; manifest asset with no assetId (import failed) → unreviewed; trimmed clip (same fileName, shorter duration) → approved; extra clips the user added themselves → ignored.
- [ ] **Step 3: Implement + pass**; CLI wiring with stub-sidecar test (read_timeline stubbed, review.json written to a temp marketing dir, shape matches the probed format byte-conventions).
- [ ] **Step 4: Commit** — `feat(review): pull magnetic verdicts into review.json`.

---

### Task 7: Mission Control buttons (animations)

**Files:**
- Modify: `scripts/mission-control.mjs` (two actions following the existing `data-act` button wiring at ~line 617 and its server-side act handlers)

**Interfaces:**
- Consumes: the two CLIs (Tasks 5–6) — spawn them (same-process import also fine if mission-control already imports script modules; follow its existing pattern for running work).
- Produces: "Review in Magnetic" button (runs driver; inline error surface for sidecar-unreachable/allowlist messages) and "Pull verdicts" button (runs pull, refreshes the run view so review.json verdicts render in the existing display).

- [ ] **Step 1: Probe** — how existing buttons dispatch and how errors render inline; record.
- [ ] **Step 2: Implement minimally** — two buttons + handlers; no new UI framework, match existing styles.
- [ ] **Step 3: RENDERED PROOF** — start mission-control for dashclaw, open the page (agent-browser/Playwright), screenshot the run view showing both buttons; click "Review in Magnetic" with the sidecar OFF and screenshot the inline error (the enable-Agent-Access hint). LOOK at both screenshots.
- [ ] **Step 4: Tests** — `node --test` for any extracted handler logic + existing mission-control tests still green (if none exist for it, note that and rely on the rendered proof).
- [ ] **Step 5: Commit** — `feat(review): mission control — review-in-magnetic + pull-verdicts buttons`.

---

### Task 8: Live pilot — USER GATES

- [ ] **Step 1: USER GATE — setup.** Ask the user to: open Magnetic, add `C:\Projects\animations\out` to Agent media folders (Settings), enable Agent Access, open (or create) a project. STOP until confirmed.
- [ ] **Step 2:** "Review in Magnetic" on the dashclaw run (button, not CLI — the human surface is the deliverable). Confirm the reel proposal appears in Magnetic (user sees ghost-diff) — user Accepts.
- [ ] **Step 3: USER GATE — review.** User reviews the reel with editor ergonomics: delete at least one asset, trim another. STOP until they say done.
- [ ] **Step 4:** "Pull verdicts" (button). Verify: review.json updated; Mission Control shows the verdicts; the summary matches what the user did (trimmed → approved, deleted → rejected). Send the user the summary — their confirmation is phase 3's definition of done.
- [ ] **Step 5:** PLAYBOOK: add the review-station recipe + any earned gotchas; ledger; commit docs.

---

## Execution notes

- Order: 1→2→3→4 (Magnetic), 5→6→7 (animations, unit-testable against stubs any time after 3 defines shapes), 8 last (live, user-driven).
- Task 4's E2E is the cross-repo drift guard for the tool shapes Tasks 5–6 consume — land it before trusting the stubs.
- Final whole-branch review covers both repos (two packages) before merge, as in phase 2.
