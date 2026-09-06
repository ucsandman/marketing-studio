# Changelog

## 2.0.0 (unreleased)

The plugin manifests declare 2.0.0. This version has not been tagged or published as a
GitHub release.

### Changed

- Renders run on the GPU by default (`chrome-for-testing` + `angle` in
  `studio/remotion.config.ts`): 4 to 5x faster on LaunchVideo and LogoReveal, measured
  2026-09-06. Off with `REMOTION_GPU=0`; CI keeps the headless shell.
- Every script that shells to Remotion or its ffmpeg goes through
  `scripts/lib/remotion.mjs`: the checked-in CLI via Node (no `npx` shim), `--log=error`,
  one summary line per render instead of one progress line per frame, the last 40 log
  lines on failure. `REMOTION_VERBOSE=1` restores the full output.
- `scripts/gates.mjs <brand> --project <product>` runs the seven mechanical gates in
  order (drift last) and prints one row per gate; full reports land in
  `<workspace>/marketing/reports/gates/`. `scripts/verify.mjs` does the same for the
  four test suites with logs in `out/verify/`.
- `docs/PLAYBOOK.md` keeps the engine map, onboarding, process, and delivery contract;
  the feeder gotchas moved verbatim to `docs/playbook/<topic>.md`, and each asset skill
  names only the topic files its recipe needs.
- Production runs now keep generated inputs, evidence, renders, and delivery assets in
  the owning product repository under `marketing/assets/<brand>/`. Production commands
  require `--project <product-repo>` when they are run outside that product worktree.
- Direction, shot planning, stage review, full-film review, source hashes, and final
  production verdicts form one evidence chain. Production post kits reject stale or
  incomplete evidence.
- The plugin includes the folded `launch/` CLI and local dashboard. Distribution is
  dry-run by default, uses an idempotency ledger, and supports video attachment for X,
  Bluesky, LinkedIn, and YouTube.
- The renderer exposes 13 Remotion compositions, including reusable launch assets,
  static cards, wrap clips, agent sessions, review galleries, and two bespoke films.

### Migration from 1.x

Move or recreate any production assets in the product-owned workspace, then pass
`--project <product-repo>` to builders, renderers, judges, Mission Control, and post-kit
commands. Engine-local `out/`, `assets/`, `props/`, `examples/`, and `studio/public/`
remain staging or legacy locations and are not production destinations.
