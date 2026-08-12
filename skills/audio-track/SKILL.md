---
name: audio-track
description: Use when the user wants music, voiceover, narration, or a soundtrack added to a video asset, OR wants standalone generated audio for any purpose (e.g. "/audio-track", "add music to the launch video", "narrate the demo", "make a 30 second music sting", "generate a voiceover mp3", "jingle for the intro").
---

# Audio Track

**REQUIRED BACKGROUND:** marketing-studio skill. Work in `${CLAUDE_SKILL_DIR}/../..`.
Read the PLAYBOOK's Audio section first (endpoints, ducking, manifest contract).

Two modes; pick by what the user wants:
- **Video soundtrack** — the target composition re-rendered with music + voiceover
  (`out/<brand>/<asset>-audio.mp4`). Recipe A.
- **Standalone audio** — a music track and/or narration mp3s delivered as files
  (a sting, a jingle, a narration for something outside this studio). Recipe B.

Both need `ELEVENLABS_API_KEY` in the repo `.env` (missing key = feeder exits 2;
videos stay silent). Generation costs real money: one pass, trim copy rather than
regenerate blindly. Free tier returns 402; Starter or above required.

## Recipe A: video soundtrack

1. Shared-repo guard + toolchain per marketing-studio.
2. Copy source of truth: `scripts/build-<brand>-audio.mjs` (copy the noban one for a
   new brand). VO lines are keyed by act, written FOR THE EAR ("dot gg", not ".gg"),
   one line per act, terse. Music prompt describes the brand's sonic character.
3. Run it: `node scripts/build-<brand>-audio.mjs` (music takes 1-3 min). Check every
   line's duration fits its act; trim TEXT if not, re-run with --force.
4. Merge + render: `node scripts/merge-launch-audio.mjs` then render the composition
   with the merged props.
5. Listen-proof: verify the mp4 has an audio stream (ffprobe), then SEND the video —
   audio is approved by ear, by the user. Ducking feel (base 0.35 / duck 0.12) is
   tunable in `studio/src/lib/audioMix.ts` if redlined.

## Recipe B: standalone audio

1. Shared-repo guard per marketing-studio (the feeder lives in the engine repo even
   for standalone output).
2. Music: `node feeders/audio/client.mjs music --prompt "<sonic character>" --length-ms <n> --out out/<brand>/<name>.mp3`
   (exact-length, commercially licensed on paid plans; 3s-120s).
   Voiceover: write `{lines: [{id, text}]}` to a temp JSON (text written for the ear),
   then `node feeders/audio/client.mjs vo --script <json> --out out/<brand>/`.
   Durations print as `... OK: <name> <ms>ms`; `probe --file <mp3>` re-measures.
3. Listen-proof: SEND the mp3(s) to the user, then copy approved files into the
   calling repo per the marketing-studio delivery contract.
