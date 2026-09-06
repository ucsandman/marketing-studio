# Audio (ElevenLabs feeder + ear-gate)

Read this when: touching the ElevenLabs audio feeder, mixing, mastering, or the audio judge (ear-gate).

## Audio (ElevenLabs feeder)
- Verified endpoints (Context7, do not re-derive): TTS
  `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`
  with body `{"text", "model_id": "eleven_multilingual_v2"}`; Music
  `POST https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128` with body
  `{"prompt", "music_length_ms", "model_id": "music_v2"}`. Both take header
  `xi-api-key`, return binary mp3. `music_length_ms` covers the 3s-120s range we need.
- Per-brand voice: `client.mjs vo --brand <id>` resolves `ELEVENLABS_VOICE_ID_<BRAND>` (id
  uppercased, dashes -> underscores) over the global `ELEVENLABS_VOICE_ID` over the default
  Rachel voice (`resolveVoiceId` in `feeders/audio/client.mjs`). The client prints which
  source won (`voice source: ...`) once per run. Builders must pass `--brand <id>` to get
  their own voice instead of all nine products narrating in the same one.
- Ducking constants live in `studio/src/lib/audioMix.ts`: `BASE 0.35` (music level when
  no VO is playing) / `DUCKED 0.12` (music level under VO) / `RAMP 9` frames to cross-fade
  the duck / `VO_LEAD 12` frames of music-only lead-in before each line starts /
  track fades `FADE_IN 24` / `FADE_OUT 36` frames. Tune here if a redline calls for it.
- Manifest contract (`props/<brand>-audio.json`, validated by `audioSchema` in
  `audioMix.ts`): `{music: {src, durationMs} | null, lines: [{act, src, durationMs, text}]}`.
  `act` keys match `launchTiming.ts`'s acts (`logo|hook|demo|feature-N|end`). The
  feeder's `probe --file <mp3>` mode measures an existing file's duration with no API
  call, used when a build script skips regenerating a line that's already on disk.
- VO text is written for the ear ("noban dot gg", never "noban.gg") — spell out
  anything a TTS model would otherwise mispronounce.
- Manifest lines may carry `words: [{w, startMs, endMs}]` (+ `wordsEstimated: true`
  when derived by even distribution rather than measured by the TTS alignment).
  Emitted by `feeders/audio/client.mjs vo --timestamps` (ElevenLabs
  `/v1/text-to-speech/{voice}/with-timestamps`, char alignment aggregated to words)
  or `client.mjs words --file <mp3> --text "<line>"` for audio already on disk.
  Re-rendering the VO or changing voice/model invalidates every word time: delete
  the `*.words.json` sidecars and rebuild.
- VO-driven timing ACTIVATES only when at least one manifest line carries `words`.
  Manifest presence alone is not the gate: every shipped brand already has an audio
  manifest, so gating on presence would move every existing picture lock. The
  nullable `voTiming` prop on LaunchVideo forces it on (true) or off (false).
- `VO_LEAD` is owned by `launchTiming.ts` (the VO act length is built from it) and
  re-exported by `audioMix.ts`; every existing import site is unchanged.
- `studio/src/lib/wordCues.ts` imports `'./launchTiming.ts'` WITH the extension, and
  `studio/tsconfig.json` sets `allowImportingTsExtensions`. Both are load-bearing:
  `scripts/judge-av-sync.mjs` loads wordCues through Node type-stripping, which does
  no extensionless resolution. Do not "clean up" either one.
- Timing serves the voice. When a manifest line carries measured `words`, its act
  length is DERIVED: `VO_LEAD + ceil(voMs/1000*fps) + VO_PAD` (`voActLen()` in
  `launchTiming.ts`, VO_PAD 12f ~= 0.4s tail hold). Estimated act constants are the
  root cause of "the reveals feel off" — a reveal lands on the measured start of the
  word it illustrates, so the word times, not the constants, are the source of truth.
- Copy is still trimmed for LENGTH CEILINGS, not for act fit. The ceilings are the
  film's total runtime (30-90s, `launchTiming.test.ts`) and per-act readability; a
  line that pushes the film past its ceiling gets cut in `build-<brand>-audio.mjs`,
  which is still the only place VO copy is edited.
- Derivation never overrides a human. Precedence is
  `actLengths override > measured VO > shared constants`, so a hand-locked picture
  (e.g. costclaw) is untouched, and a brand with no word timings renders exactly as
  it did before Phase B.
- The demo act takes `max(telemetry-derived, VO-derived)`. Never shorten a recorded
  demonstration to fit narration; widen it.
- Known gap: `sfxCues.ts` still derives its per-feature ticks from the stagger
  formula, so a word-cued feature act drifts off its reveals. `judge-av-sync` reports
  this as `sfx-tick-drift` (WARN); the fix is threading the cue arrays into
  `SoundTrack`.
- Free tier returns 402 (`paid_plan_required`) on API voice/library access — Starter
  plan or above is required for both TTS and music generation (music also needs a
  paid plan for the commercial license). Cost is cents per video for TTS; a few
  credits per generation for music.
- Remotion's `Audio` component is deprecated; use `Html5Audio` (same export, same
  props, zero behavior change) — see `SoundTrack.tsx`.
- Missing `ELEVENLABS_API_KEY` produces a clear non-zero result. A silent diagnostic
  render may keep a clean-clone smoke path working, but it is not a production
  deliverable unless the direction records and the operator approves that exception.

### Loudness mastering
- `scripts/master-audio.mjs <in.mp4> [--out <path>]` — two-pass loudnorm to
  -14 LUFS integrated / -1.0 dBTP true peak, re-encodes, then verifies the
  DELIVERED file and exits 1 outside those targets. `scripts/verify-cue.mjs
  <file.mp4> <startSec> <durSec> [--strict]` proves a cue is audible in the
  window (per-100ms envelope, not just window peak). `scripts/level-sfx.mjs
  <in> [--gain] [--dur] [--out]` levels an SFX asset (a cue's volume prop
  cannot rescue a quiet source). All three shell to plain `ffmpeg` on PATH,
  not `npx remotion ffmpeg` — Remotion's bundled build has no
  alimiter/volumedetect/ebur128 filters.
- Three traps: `loudnorm`'s `linear=true` computes one gain for the whole file
  and does not back off for a loud transient — the `alimiter` is the fix, not
  belt-and-braces. `alimiter` applies makeup gain unless `level=disabled` is
  set, which quietly overshoots the target louder than before. And `alimiter`
  constrains SAMPLE peaks only — AAC re-encode overshoots true peak by ~0.5 dB,
  so the processing chain works to -2.0 dBTP to deliver <= -1.0 (verified on a
  real master: chain at -1.0 delivered -0.5 and failed the gate).

## Audio judge (`scripts/judge-audio.mjs`) — the ear-gate

Reads the FINAL rendered file, not the plan. Everything else in this repo checks
JSON against JSON: `judge-av-sync` is explicitly "PURE DATA, no rendering", so
stale VO, a wrong-brand track, a truncated line and a mispronunciation were all
invisible until this existed. Spec:
`docs/superpowers/specs/2026-08-12-judge-audio-design.md`.

- **Use faster-whisper, never openai-whisper.** `import whisper` is BROKEN on this
  machine: `Numba needs NumPy 2.3 or less. Got NumPy 2.4`. `faster_whisper` 1.2.1
  is already installed (no new dependency); model `Systran/faster-whisper-small`
  caches to `~/.cache/huggingface/hub` (464 MB) and runs offline after that.
  Cost: 74s of audio = ~25s wall on CPU int8, of which ~16s is model load — so
  load the model ONCE per process and transcribe every asset in that process.
- **Never diff transcript text exactly.** Whisper heard `"NPX Cost Claw audit"` for
  manifest `"n p x costclaw audit"`, and `"Cost Claw,"` for `"CostClaw."`. An exact
  comparison false-positives on a known-good asset. Normalize both sides (case,
  punctuation, whitespace, single-letter runs, camel-case splits) then score by
  token similarity.
- **Edge-silence bars are derived from the fades, never hardcoded.** `FADE_OUT` is
  36 frames (1.2s), so a correct asset ENDS QUIET BY DESIGN. A flat 1.0s bar
  failed costclaw's legitimate 1.26s tail. Bars = `FADE_IN|FADE_OUT / FPS + 0.5s`.
- **Interior speechless stretches come from the transcript, not `silencedetect`.**
  At `noise=-35dB` silencedetect finds ZERO interior silence on costclaw: the
  music plays through the gap, far above the noise floor. Only the gap between
  recognized words reveals it (costclaw: 23.5s between 19.78s and 43.28s).
  Leading/trailing silence IS real digital silence and does use silencedetect.
- **`master-audio.mjs` used to run its CLI on import**, so importing its loudness
  targets called `process.exit(1)` before the importer's own code ran. Fixed with
  the `isMain` guard `judge-av-sync.mjs` already used. If you add a new script
  meant to be imported, guard its CLI body the same way.
- **`audioMix.ts` now imports `'./launchTiming.ts'` WITH the extension**, for the
  identical reason `wordCues.ts` already does (Node's ESM loader does no
  extensionless resolution, and `judge-audio` loads it through type-stripping).
  Do not "clean up" the extension.
- The duck check is WARN-only by design. This master's LRA is 2.8 LU, so mean
  level inside VO windows differs by well under 1 dB from the music-only regions;
  a FAIL threshold would cry wolf on a known-good asset.
- **Lines match word WINDOWS, never gap-grouped segments.** The first matcher
  split the word stream on >1s gaps and assigned one segment per line; sidetap
  and paperroute speak back-to-back lines with sub-second gaps, so three correct
  lines merged into one blob, one act claimed it, and the neighbors reported
  "not heard at all" (three-brand evidence run, docs/ERRORS.md 2026-08-13).
  `matchLinesToWindows` scores each line against contiguous word windows, so
  segment boundaries cannot matter.
- **Whisper cannot hear a coined brand word without a hint.** "SideTap" came back
  "PsyTep" (similarity 0.29 — under any usable floor). Brands with a logo act get
  an initial_prompt built from `brands/<id>.json`: optional `speechHint` (the
  SPOKEN casing — "SideTap" worked where the lowercase wordmark "sidetap" and
  "Sidetap" both did not) + tagline, as PROSE. Never a glossary list (repetition
  loop, ate 30s of transcript) and never the script itself (that hands the judge
  its own answer key).
- **Timing FAILs only on wrong PLACEMENT (outside the launchTiming act window).**
  A span delta alone is WARN: the render mixes the very wav the manifest
  measured, so a delta with correct placement is whisper timestamp noise —
  measured -0.49s on a correct render, and the first word after a music-only
  stretch can absorb the gap entirely (a "This" stamped 4.4s long; edge words
  are clamped to `MAX_EDGE_WORD_S`). A dropped line is checkContent's catch.
- **`master-audio.mjs` pins `-ar 48000`.** loudnorm resamples to 192kHz
  internally and without the explicit rate the AAC encoder delivered 96kHz
  masters (measured twice, 2026-08-13), tripping the gate's sample-rate check.
