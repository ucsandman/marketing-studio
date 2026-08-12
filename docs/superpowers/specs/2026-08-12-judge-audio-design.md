# Audio Judge (the ear-gate) — Design Spec

**Date:** 2026-08-12
**Status:** Approved direction (advisory judge + `--strict`, local faster-whisper, final deliverable only)
**Repo:** `C:\Projects\animations`

## Purpose

Every existing audio check reads the PLAN, not the OUTPUT. `judge-av-sync.mjs` is
explicitly "PURE DATA, no rendering" and cross-checks JSON against JSON.
`master-audio.mjs` and `level-sfx.mjs` measure signal, but only on the file they are
asked to process, and only for level. The audio-feeder spec (2026-07-09) named the
exit criterion honestly: "user approves by ear."

So one whole class of defect is invisible to the repo and lands on Wes's ears: the
rendered audio can say the wrong thing. Stale VO after a copy edit, the wrong brand's
track muxed in, a line truncated mid-word, a TTS mispronunciation, a duck that never
happened in the render, audio that does not span the video.

`judge-audio.mjs` closes that. It reads the FINAL rendered deliverable, transcribes
it, and diffs what was actually said against the manifest that claims what should
have been said. It also emits a picture, so an agent with no ears can still SEE the
audio and reason about it the way a rendered frame lets it reason about layout.

## Verified facts (measured on this machine 2026-08-12 — do not re-derive)

- ffmpeg `9.0-full_build-www.gyan.dev` on PATH has `showwavespic`, `showspectrumpic`,
  `ebur128`, `silencedetect`, `astats`, `volumedetect`. Remotion's bundled ffmpeg does
  NOT (already in the PLAYBOOK for `master-audio`); shell to plain `ffmpeg`.
- `faster_whisper` 1.2.1 is installed against Python 3.12.10 (`pip` 25.3). **No new
  dependency is required.**
- `openai-whisper` is BROKEN on this machine: `import whisper` dies with
  `ImportError: Numba needs NumPy 2.3 or less. Got NumPy 2.4`. Do not reach for it.
- Model `Systran/faster-whisper-small` (CTranslate2) is cached at
  `~/.cache/huggingface/hub`, 464 MB, downloaded on first use. Later runs are offline.
- Cost on `out/costclaw/launch-final.mp4` (73.8s, aac 48kHz stereo), CPU int8:
  **25s wall total** — 15.7s to load the model, 9.2s to transcribe 14 segments.
  Model load dominates, so batch a brand's assets in one process.
- Whisper output does NOT match manifest text literally. Measured deltas on a
  known-good asset: manifest `"n p x costclaw audit"` was heard as `"NPX Cost Claw
  audit"`; `"CostClaw."` as `"Cost Claw,"`; `"Each priced, with evidence."` as
  `"each priced with evidence"`. **An exact string diff would false-positive on every
  asset.** Normalization plus a similarity threshold is load-bearing, not polish.
- `showwavespic`'s `colors=0x4ade80` did not take effect as passed; output was white.
  Confirm any colour choice on a rendered PNG before trusting it.

## Baseline: what the gate said about a known-good asset

`out/costclaw/launch-final.mp4`, all 7 manifest lines heard in order with correct
words. Measured spoken span vs declared `durationMs`:

| act | manifest | measured | delta |
|---|---|---|---|
| logo | 2870ms | 2.84s | -0.03 |
| hook | 6030ms | 5.94s | -0.09 |
| demo | 7370ms | 7.22s | -0.15 |
| feature-0 | 6400ms | 6.12s | -0.28 |
| feature-1 | 5150ms | 5.10s | -0.05 |
| feature-2 | 7000ms | 6.94s | -0.06 |
| end | 5040ms | 4.86s | -0.18 |

Every act within 0.3s. The manifest is honest for this asset, and the gate confirms
rather than accuses. It also surfaced one fact nothing in the repo could previously
report: VO stops at 19.78s and resumes at 43.28s, a **23.5s speechless stretch**. The
spectrogram and the transcript agree on it independently. That is almost certainly the
demo section playing under music by design, which is why the finding is a WARN with a
number attached, not a FAIL.

## Architecture

```
scripts/judge-audio.mjs              # the judge (Node, sibling of judge-av-sync.mjs)
scripts/judge-audio.test.mjs         # node:test over the pure helpers
feeders/audio/transcribe.py          # faster-whisper sidecar, JSON on stdout
out/<brand>/marketing/judge-audio.json   # verdict (the machine artifact)
out/<brand>/marketing/judge-audio.png    # the picture (the agent-readable artifact)
out/<brand>/marketing/heard-<asset>.json # transcript cache
```

Node owns the judge because every sibling judge is Node and the findings shape is
shared. Python owns only the whisper call, and it lives in `feeders/audio/` because
that is where the audio feeder already lives.

### CLI

`node scripts/judge-audio.mjs <brand> [--asset launch-final] [--strict] [--json]`

Default asset is the brand's final deliverable (`out/<brand>/launch-final.mp4`), not
every intermediate. Intermediates are already measured by the feeder's `probe` at
build time. Exit 0 with the verdict in the report; exit 1 only under `--strict` when
a finding is FAIL. This is `judge-av-sync`'s exact contract, so existing shipped
assets do not suddenly start failing a pipeline.

### Checks

1. **Stream** — `ffprobe` confirms an audio stream exists and its duration spans the
   full video (FAIL if absent, or short by more than 0.5s). Sample rate is expected to
   be 48 kHz and reported as a WARN when it is not: the PLAYBOOK states 48 kHz for the
   Magnetic handoff specifically, so treating it as a hard rule everywhere would be an
   over-generalization.
2. **Loudness** — `ebur128` gives integrated LUFS, LRA and true peak. Targets are
   IMPORTED from `master-audio.mjs` (`TARGET_I`, `CHAIN_TP`, `TARGET_LRA`), never
   re-declared. One source of truth, same rule the PLAYBOOK applies to duration math.
3. **Silence** — `silencedetect` (`noise=-35dB`, the level
   `build-magnetic-demo-media.mjs` already uses) reports leading silence, trailing
   silence, and the longest interior speechless stretch. Explicit thresholds, chosen
   from the costclaw baseline and revisable once more assets are measured:
   leading or trailing silence over **1.0s** is a FAIL (the PLAYBOOK already requires
   trimming these before Magnetic import); an interior speechless stretch over
   **8.0s** is a WARN carrying the measured number. Costclaw's 23.5s stretch WARNs
   under this rule, which is the intended behavior — it is a fact worth surfacing, not
   a defect worth blocking.
4. **Transcript** — `transcribe.py` returns segments and word timestamps.
5. **Content diff** — normalized fuzzy match of heard vs manifest, per act, in order.
6. **Timing diff** — measured line start/end vs manifest `durationMs` and the
   `launchTiming.ts` act windows. This is the check `judge-av-sync` structurally
   cannot perform, because it never touches the rendered file.
7. **Duck** — mean level inside each VO window vs the music-only regions either side,
   compared against `audioMix.ts`'s `BASE` and `DUCKED`. Proves the duck happened in
   the render, not just in the constants. Tolerance is wide: `master-audio`'s
   loudnorm compresses dynamics, so this asserts "a duck is present", not its depth.
8. **Picture** — `showwavespic` over `showspectrumpic`, vstacked, with act boundaries
   and VO windows drawn on top.

### Content diff normalization (load-bearing, see Verified facts)

Both sides are normalized before comparison: lowercase, strip punctuation, collapse
whitespace, join single-letter runs (`n p x` → `npx`), and split camel case
(`costclaw` and `cost claw` compare equal). Then per-act token similarity with a
threshold; below it, the finding reports the two strings side by side so a human can
judge. Ordering is checked separately from wording, because a reordered-but-correct
transcript means a different bug than a misheard word.

### Transcript cache

`heard-<asset>.json` keyed on the mp4's size and mtime. A re-run with unchanged media
skips whisper entirely, which matters because model load is 15.7s of the 25s. Deleting
the cache is always safe.

## Error handling

Fail loudly, exit non-zero, per the repo standard. Missing input file or missing
manifest is exit 1. The judge never edits media.

Exit codes, in precedence order:

| code | meaning |
|---|---|
| 2 | whisper or its model is unavailable. **Takes precedence over every other code.** The judge still runs checks 1-3 and 8, still writes both artifacts, and marks the transcript-dependent findings `SKIPPED`. The gate degrades to levels-and-picture rather than dying — the same "non-load-bearing capability" contract the audio feeder uses for a missing API key. |
| 1 | a hard error (missing input, missing manifest, unparseable ffmpeg output), OR `--strict` was passed and at least one finding is FAIL. |
| 0 | ran to completion. Findings live in the report, whatever their level. This is the default even when findings are FAIL, matching `judge-av-sync`. |

## Testing

- `node:test` over the pure helpers: normalization, similarity, `ebur128` and
  `silencedetect` output parsing, act-window mapping, findings roll-up.
  Parser tests use captured real ffmpeg stderr, the way
  `build-magnetic-demo-media.test.mjs` already does.
- Fixture-based end-to-end on `out/costclaw/launch-final.mp4`, asserting the baseline
  table above holds and that a deliberately corrupted manifest produces a FAIL.
- Rendered proof: the emitted PNG is inspected, per the repo's rendered-proof rule.

## Out of scope (v1)

- Wiring into `mission-control` / `render-matrix` as a blocking pipeline stage.
  Advisory first; promote once the false-positive rate is known.
- Music-content checks (does the track match the brand's sonic prompt).
- Speaker or voice-identity verification.
- Any intermediate asset. Final deliverable only.
- Replacing `master-audio` or `level-sfx`. This judge measures; those two fix.
