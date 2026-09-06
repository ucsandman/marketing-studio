# Speed and token budget: design (2026-09-06)

Wes's complaint: the studio works, but a run is slow and burns tokens. This spec records
what was measured before anything was changed, which hypotheses the measurement killed,
and the four changes that ship together.

## What was measured (this machine, 2026-09-06, Remotion 4.0.486)

| Probe | Result |
|---|---|
| `remotion bundle` (webpack, warm cache) | 1.5 s |
| `remotion still` from the entry point (bundles first) | 2.6 s |
| `remotion still` from a prebuilt bundle | 1.9 s |
| `remotion render` LogoReveal, 60 frames, default log level | 22.6 s, 69 log lines (one per frame) |
| `remotion still` with `--log=error` | 0 log lines, same bytes as the loud run (SHA-256 identical) |
| root test suite (`node --test`, 566 tests) | 2.8 s, 642 lines / 51 KB of output |
| required reading before an executor's first command | PLAYBOOK 60 KB + marketing-studio 4 KB + asset skill 2 to 4 KB; the main loop also holds marketing/SKILL.md at 22 KB |
| render call sites that shell to `npx remotion ...` | 51 sites in 22 scripts |
| child processes run with `stdio: 'inherit'` | 64 sites in scripts and feeders |

Consequences of those numbers:

- A full 2700-frame LaunchVideo render prints about 2700 progress lines (100 KB, roughly
  25k tokens). Every script that inherits stdio hands that to whichever agent ran it.
  The PLAYBOOK says "pipe render logs to tail -2", but the scripts do not, so the rule
  only holds when a human remembers it.
- Six executor subagents per `/marketing` run each read 66 to 90 KB before acting: about
  100k tokens per run spent re-reading the same prose. Nothing in a Blender gotcha helps
  the agent scoring audio.
- Rendering itself is Chrome-bound at about 0.4 s per 1080p frame; the harness around it
  (bundling, npx resolution) is under a second. Speed work belongs in the composition
  and the render flags, not in a bundle cache.

## Hypotheses the measurement killed

- **Bundle cache.** Remotion already caches its webpack build; a prebuilt bundle saves
  0.7 s per invocation. Not worth migrating 22 scripts. Dropped.
- **Test suite speed.** 2.8 s. The cost is the 51 KB of output, not the time.

## Changes that ship

### 1. One quiet Remotion runner: `scripts/lib/remotion.mjs`

- `remotion(args, {cwd, capture})`: runs the checked-in `remotion-cli.js` through
  `process.execPath` (never the `npx` shim, which returns `EINVAL` on Windows; see
  ERRORS.md 2026-09-05). Appends `--log=error` to `render` and `still`. Buffers stdout
  and stderr. On success prints exactly one line:
  `remotion render LaunchVideo -> launch-v3.mp4 (2700 frames, 612.4s, 14.5 MB)`.
  On failure prints the last 40 buffered lines and rethrows, so the OOM signature the
  PLAYBOOK documents ("bare Command failed") is still visible.
- `ffmpeg(args, {capture})`: the same for `remotion ffmpeg` and `remotion ffprobe`,
  with `-hide_banner -loglevel error` unless the caller asked to capture output (the
  loudness master parses ebur128 lines and keeps its own flags).
- `REMOTION_VERBOSE=1` restores inherited stdio for debugging.
- Every script that shells to Remotion or its ffmpeg moves to the runner. The
  behaviour proof is byte equality: three stills (LogoReveal, AnimatedOG, Card) rendered
  before and after the migration have identical SHA-256, per the PLAYBOOK rule "verify
  behaviour-preserving refactors with SHA-256-compared stills".

### 2. One gate runner and one verify runner

- `scripts/gates.mjs <brand> --project <product> [--strict]` runs the seven mechanical
  gates in the canonical order (av-sync, demo-pacing, palette, motion, budgets, audio,
  and drift LAST because it scores the set). Each gate's full output goes to
  `<workspace>/marketing/reports/gates/<gate>.log` plus its `--json` report beside it.
  The terminal gets one row per gate: verdict, the gate's own count line, seconds, log
  path. Exit code follows the hard gates (check-budgets, check-audio) and, with
  `--strict`, any judge FAIL.
- `scripts/verify.mjs` runs the root test suite, studio vitest, studio lint, and the
  smoke render in sequence, logs each to `out/verify/<suite>.log`, and prints one row
  per suite with pass/fail counts and seconds. `--no-smoke` skips the render for a
  docs-only change. The row carries the count it processed (L2: a verdict on zero work
  is not a verdict).

### 3. PLAYBOOK split by topic, reading map in the skills

- `docs/PLAYBOOK.md` keeps the engine map, brand onboarding, process rules, token
  discipline, delivery contract, and a topic index. The gotcha sections move verbatim
  (no rewording, no trimming) to `docs/playbook/<topic>.md`: remotion, capture,
  magnetic-wrap, blender, unreal, comfy, brand-effects (brand effects + FilmGrade),
  judge-drift, audio (feeder + ear-gate).
- Each asset skill names the topic files it needs instead of "read the PLAYBOOK":
  logo-reveal reads blender + remotion, product-demo reads capture + remotion,
  audio-track reads audio, og-assets reads remotion, launch-video reads remotion +
  audio + capture. marketing-studio's required-reading line becomes PLAYBOOK.md plus
  the topic files the recipe names. CLAUDE.md says the same.
- `scripts/playbook-index.test.mjs` fails when a topic file is missing from the index
  or the index names a file that does not exist, and when any skill still points at a
  heading that moved.

### 4. Render flags, decided by measurement

`--chrome-mode=chrome-for-testing --gl=angle`, `--concurrency` variants and
`--scale=0.5` were timed on LogoReveal and LaunchVideo (60 frames each). Result, two
rounds each: `chrome-for-testing` + `angle` took LaunchVideo from 28 to 30 s down to 6 to
7 s and LogoReveal from 30 to 33 s down to 6 to 8 s; `--concurrency` changed nothing;
stills were unchanged. GPU output is visually identical (mean channel delta about 1/255,
0.1 percent of pixels differ by more than 8 at antialiased edges and grain) but not byte
identical. It is now the default in `studio/remotion.config.ts`, off under `CI` (no GPU,
and a 685 MB Chrome for Testing download per run) or `REMOTION_GPU=0`; the numbers are
in `docs/playbook/remotion.md` so the next session does not redo the experiment.

## Out of scope, recorded

- `skills/marketing/SKILL.md` (22 KB) reads as a retro archive. Moving its anecdotes to
  ERRORS.md would halve it, but another session has uncommitted edits in that file
  today, so it is not touched in this change.
- Composition cost (FilmGrade grain and halation are SVG filters Chrome rasterises per
  frame) is the real render-time lever and is a design change, not a harness change.

## Testing

- `node scripts/verify.mjs` green, and its output read.
- SHA-256 equality of the three stills before and after the runner migration.
- `node scripts/gates.mjs truckside --project C:\Projects\tradesdesk` runs end to end on
  the existing truckside workspace and its table matches the individual judges' verdicts.
- `node scripts/smoke.mjs` prints one line per composition instead of Remotion's
  progress output.

## Follow-ups recorded at ship (2026-09-06)

- `scripts/build-cards.mjs` still shells to the CLI directly (another session held the
  file during this change); move it onto `scripts/lib/remotion.mjs` when that run lands.
- Source comments that still say "see the PLAYBOOK's <section>" for a section that moved
  (Blender and Unreal scene scripts, several `scripts/*.mjs` headers, `studio/src`
  files) are listed in the PLAYBOOK-split agent report; they are comments, not links,
  and the topic index in PLAYBOOK.md resolves them. Repoint them when those files are
  next edited.
- `skills/marketing/SKILL.md` keeps "read the PLAYBOOK gotchas" in its executor dispatch
  contract; the marketing-studio skill it also requires now names the topic files, so
  executors read the short set either way. Trim the 22 KB skill's anecdotes into
  ERRORS.md in a later change.
- The runner's one-line-per-render claim was verified on stills and a 60-frame render
  (`--log=error` prints nothing); the first full-length production render through a
  migrated script should be watched once.
