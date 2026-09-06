---
name: audio-track
description: Use when the user wants music, voiceover, narration, or a soundtrack added to a video asset, OR wants standalone generated audio for any purpose (e.g. "/audio-track", "add music to the launch video", "narrate the demo", "make a 30 second music sting", "generate a voiceover mp3", "jingle for the intro").
---

# Audio Track

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `${CLAUDE_SKILL_DIR}/../..`.
Read `${CLAUDE_SKILL_DIR}/../../docs/playbook/audio.md` first (endpoints, ducking, manifest contract).

Every film gets this pass; it is not opt-in (CLAUDE.md: a film is not done without
audio, and audio means narration). `node scripts/check-audio.mjs <brand> --project <product>` is the exit
gate for all three recipes that touch video.

Three modes; pick by what the target is:
- **Bespoke film** (`studio/src/films/<brand>/`, e.g. PostflopFilm) — post-render
  scoring with `scripts/build-<brand>-film-audio.mjs` + `scripts/score-film.mjs`.
  Recipe A0.
- **Video soundtrack** — a directed LaunchVideo composition scored with music and
  voiceover inside the product workspace. Recipe A.
- **Standalone audio** — a music track and/or narration mp3s delivered as files
  (a sting, a jingle, a narration for something outside this studio). Recipe B.

Both need `ELEVENLABS_API_KEY` in the repo `.env` (missing key = feeder exits 2;
videos stay silent). Generation costs real money: one pass, trim copy rather than
regenerate blindly. Free tier returns 402; Starter or above required.

## Recipe A0: bespoke film

1. Shared-repo guard + toolchain per marketing-studio.
2. Copy source of truth: `scripts/build-<brand>-film-audio.mjs` (copy postflop's).
   Narration lines carry the film SECOND they start on, computed from the film's
   timeline.ts so a re-timed shot moves its line with it; SFX cues carry the frame the
   shot lands something on (Stamp/Rule/click constants + the shot's `from`), max two
   per beat. Budget ~2.6 words/second minus a 150ms breath per line.
3. Run it (VO lines and the exact-length bed hit the API once; re-runs reuse files,
   `--force <id,...|music>` regenerates). Read the printed start/end table: every line
   inside its shot.
4. `node scripts/score-film.mjs <brand> <product-film> --project <product>` — refuses
   overlapping lines (trim copy, re-run the builder) and zero-VO manifests; masters by
   measured gain and verifies the DELIVERED file (I within 0.5 of TARGET_I, TP <= -1).
5. Listen-proof: `node scripts/verify-cue.mjs <scored.mp4> <voStart> <voDur>` on one
   narration window and one bed-only window (voice ~6 dB above the bed), then
   `node scripts/check-audio.mjs <brand> --project <product>` (exit 0), then SEND the scored file.

## Recipe A: video soundtrack

1. Shared-repo guard + toolchain per marketing-studio.
2. Copy source of truth: `scripts/build-<brand>-audio.mjs` (copy the noban one for a
   new brand). VO lines are keyed by act, written FOR THE EAR ("dot gg", not ".gg"),
   one line per act, terse. Music prompt describes the brand's sonic character.
3. Run it with `--project <product>` (music takes 1-3 min). Check every
   line's duration fits its act; trim TEXT if not, re-run with --force.
4. Merge with `--project <product>`, then render into the product workspace using its
   public directory. Picture and sound consume the same shot plan; explicit `audioRef`
   maps voice independently of visual source IDs, while `null` means no narration.
5. Listen-proof: verify the mp4 has an audio stream (ffprobe), then SEND the video —
   audio is approved by ear, by the user. Ducking feel (base 0.35 / duck 0.12) is
   tunable in `studio/src/lib/audioMix.ts` if redlined.

## Recipe B: standalone audio

1. Shared-repo guard per marketing-studio. The feeder code lives in the engine, but all
   generated audio lives in the product workspace.
2. Music: `node feeders/audio/client.mjs music --project <product> --brand <brand> --prompt "<sonic character>" --length-ms <n> --out <product-output>.mp3`
   (exact-length, commercially licensed on paid plans; 3s-120s).
   Voiceover: write `{lines: [{id, text}]}` to a temp JSON (text written for the ear),
   then run the voice feeder with `--project <product> --brand <brand>` and a product-owned output.
   Durations print as `... OK: <name> <ms>ms`; `probe --file <mp3>` re-measures.
3. Listen-proof: SEND the product-owned mp3(s) to the user. Machine loudness, beat, and
   cue reports remain incomplete until a human listens.
