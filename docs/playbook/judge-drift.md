# Cross-asset drift judge

Read this when: running or interpreting scripts/judge-drift.mjs.

## Cross-asset drift judge (`scripts/judge-drift.mjs`)
- Every other judge scores ONE asset. This one scores the product workspace as a **set**,
  because the failure it looks for is invisible per file: assets that are each
  individually on-palette can collectively fragment into several distinct brands, and
  no per-file gate — including judge-palette, including a human approving one
  storyboard frame — can see that. Run it LAST, once everything has rendered.
- Two signals, and they fail independently. `tokenShare` is ABSOLUTE (share of
  colourful pixels sitting on a brand token) and catches an asset that went off
  palette even if every sibling went off the same way. `driftZ` is RELATIVE (distance
  from the set centroid in sd) and catches the asset that does not belong with its
  siblings whatever they agreed on. Verdict follows judge-palette's two-condition
  idiom for the same false-positive reason: captured product UI legitimately carries
  the PRODUCT's colours, so low tokenShare alone is a WARN. Both together is a FAIL.
- **There is no absolute drift threshold, and inventing one would be wrong.** Nobody
  publishes a number mapping an image distance to "a human would call this a
  different brand" — Chromatic (YIQ 0.063), Playwright (maxDiffPixelRatio
  0.01-0.025), Arize and pHash all answer the same way: calibrate on your own
  labelled data. So driftZ is scored against the set's own dispersion, the report
  always states the basis, and sets below `MIN_SET` (4) or with zero dispersion
  report distances with z-scores **withheld** rather than fabricated.
  Calibrate properly with `--ref <dir>` pointed at already-approved assets.
- **Trap, cost a real bug:** measure token adherence on a COARSE colour grid and a
  bucket's reported centre can sit inside `TOKEN_RADIUS` of a brand token when the
  actual pixels do not. A flat `#ff1493` probe is 92 RGB units from noban's magenta
  token (correctly off-brand) but its 64-wide bucket centre is 70 units away
  (wrongly on-brand) — so a deliberately off-brand asset scored 100% on-palette and
  the FAIL verdict was silently unreachable. `describe()` therefore quantizes at 32
  (matching judge-palette's calibration) and FOLDS the coarse histogram from it.
  Found only by injecting an off-brand probe on purpose; a green judge proves nothing.
- Descriptors are histograms, so they are resolution-invariant and stills of
  different sizes compare directly. The upgrade path if layout/composition drift ever
  matters is to swap `describe()` for a DINOv2 embedding — the set math
  (centroid/driftZ) is agnostic to where the vector came from. DINOv2 over CLIP:
  CLIP is language-aligned, so a gold dollar sign and a gold trophy score alike.
