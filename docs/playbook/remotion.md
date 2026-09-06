# Remotion / studio

Read this when: any Remotion render, matrix, statics, or smoke work touches this repo.

## Remotion / studio
- zod version must match what Remotion demands (4.0.486 -> zod 4.3.6). A mismatch
  renders but breaks composition schemas; the render prints a version-mismatch warning.
- Duration math lives in ONE pure lib shared by `calculateMetadata` and the component
  (see `lib/launchTiming.ts`); never duplicate the formula.
- Camera semantics: to center a content region, use
  `transform: scale(s) translate(vpW/2 - cx, vpH/2 - cy)` about the default 50% origin.
- Staged-shot kit (see docs/product-launch-motion-adoption.md, all demoed in
  ComponentGallery's second strip): `CameraRig` (outer dolly node + inner 3D-turn
  node — rotation and scale must never share one element or the matrix fights
  judder; set `dollyOrigin` on the pushed-toward control so it stays a fixed
  point), `StageCursor` (44x54 stage-prop cursor, waypoints ARRIVE on their cued
  frame, bowed travel, bloom+ring+press click stack; must render INSIDE the rig),
  `controlPressScale` (the clicked control must react), `RackFocus`,
  `SpecularSweep` (named beats only, never a loop). FilmGrade grain reseeds at
  12Hz, not per frame — per-frame noise defeats inter-frame compression and
  reads as sizzle.
  `transformOrigin: cx cy` does NOT center the region (it pins it) — this mismatch
  silently crops edges.
- **A render that dies mid-way with a bare `Command failed` and NO Remotion error is
  out of memory, not a props bug.** Each parallel worker holds its own headless Chrome
  and the default worker count scales with core count, so a full-length 1080p row can
  exhaust a busy workstation. Measured 2026-08-17: the export matrix died at frame
  256/2424 with 2.6GB free of 32GB, having produced zero files. `render-matrix.mjs`
  now takes `--concurrency=N` (or `REMOTION_CONCURRENCY`) and retries once serially on
  any mid-render death; `--concurrency=2` completed the same row fine. Check free RAM
  before blaming the composition.
- **Never gate on a compound shell command's exit code.** `node render.mjs > log; echo
  $?; tail log` reports `tail`'s status, so a failed render looks like a clean run. The
  same day, that made a zero-file matrix read as "completed, exit 0". Count the
  artifacts, not the exit code.
- Font faces are discrete: the google-fonts loader registers one FontFace per weight
  in `lib/fonts.ts`, and a `fontWeight` with no face falls back to the nearest loaded
  one. Adding a face nobody requests is not inert (Archivo 900 moved every 800 heading
  from 700 to 900). `scripts/fonts-faces.test.mjs` holds loaded ⊆ requested.
- Capture plates are 16:10 (1440x900 / 1600x1000), never 16:9: a full-bleed plate is
  `cover` on landscape and square and `contain` only on portrait (`plateFit` in
  `lib/layout.ts`); `contain` on landscape pillarboxes it.
- PNG sequences: `frame_%04d.png`, 1-indexed. `PngSequence` clamp holds the last
  frame; loop is `(frame % frameCount) + 1`.
- Seamless loops: every animated value must satisfy f(0) == f(duration); use
  `frame / durationInFrames` (NOT `durationInFrames - 1`); GIF `--every-nth-frame=N`
  preserves the seam only when N divides the duration evenly.
- GIF exports: `--codec=gif --every-nth-frame=2 [--scale=0.5]`. GIFs are heavy
  (full-size 8s 1200x630 ~= 30MB); prefer mp4 for social embeds; scale down for READMEs.
- Rendered proof: inspect stills at act boundaries BEFORE full renders; a full render
  is never the first look at anything.
- Export matrix: LaunchVideo rows read the product-owned merged launch props when they
  exist, so they carry the merged audio AND
  the same VO-derived act lengths as the launch video; SocialClip rows have no audio
  track by design and are silent. A brand whose intake asked for audio scores its per-platform clips AFTER render with `scripts/score-social-clip.mjs` (bed + one VO line, VO compressed 4:1 so master-audio converges in one pass) and build-postkit prefers that `<clipId>-final.mp4` over the matrix row. Measured 2026-09-01 before the fix: dashclaw and
  costclaw launch-16x9.mp4 were -70.0 LUFS (digital silence), tenwords -26.3 only because
  it was the sole EMBED_AUDIO member. Already-rendered brands must be re-rendered one at
  a time and re-approved in Mission Control.
- Burned captions floor at 2.8% of frame height (`captionFontSize` in
  studio/src/lib/captionTiming.ts): 52px at 1080p stays byte-identical, but the
  1080-wide 9:16 and 1:1 rows used to render 29px captions, about 1.5% of a 1920-tall
  frame, on the muted-autoplay rows platforms.json marks as the primary deliverable.

## Render speed and log volume (measured 2026-09-06)

- **GPU rendering is the default** (`studio/remotion.config.ts`: `chrome-for-testing` +
  `angle`, skipped when `CI` or `REMOTION_GPU=0` is set). On the 24-core RTX 3070 Ti
  box, 60 frames, two rounds: LaunchVideo 28-30s -> 6-7s, LogoReveal 30-33s -> 6-8s;
  stills unchanged (browser start dominates). Output is visually identical (mean channel
  delta about 1/255, 0.1% of pixels differ by more than 8 at antialiased edges and
  grain) but NOT byte identical, so a SHA-compared refactor proof renders both sides in
  the same mode. Chrome for Testing downloads once into `studio/node_modules/.remotion`
  (about 685 MB). `--concurrency` made no difference; a bundle cache saves 0.7s per call
  (`remotion bundle` is 1.5s warm) and was not built. Do not redo this experiment.
- **Every script shells to Remotion through `scripts/lib/remotion.mjs`.** It runs the
  checked-in `remotion-cli.js` via `process.execPath` (the `npx` shim returns `EINVAL` on
  Windows), appends `--log=error` to render/still, and prints one summary line per call
  instead of one progress line per frame (a 2700-frame render was 100 KB of progress
  text). On failure it prints the last 40 buffered lines, so the bare `Command failed`
  OOM signature above is still visible. `REMOTION_VERBOSE=1` restores full output.
  New scripts import `remotion`, `ffmpeg`, `ffprobe` from it; never `execSync('npx remotion ...')`.
- **`remotion render --help` hangs on this box.** Two probes sat for ten minutes and
  blocked a benchmark. Read flags from `studio/node_modules/@remotion/cli/dist/config/index.d.ts`.
