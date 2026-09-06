# Changelog

## 2.0.0 (unreleased)

The plugin manifests declare 2.0.0. This version has not been tagged or published as a
GitHub release.

### Changed

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
