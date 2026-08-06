# Audio Feeder + Remotion Audio Integration — Design Spec

> **Historical note:** this spec predates the later slim of the studio to
> synthacon-only. References to noban, dashclaw, or paperroute below are
> historical and describe brands that have since been removed from the repo.

**Date:** 2026-07-09
**Status:** Approved direction (ElevenLabs VO + Eleven Music, generic capability, LaunchVideo first)
**Repo:** `C:\Projects\animations`

## Purpose

Add music and voiceover to studio renders. One provider (ElevenLabs) covers both;
audio is a reusable capability any composition can adopt, wired fully into
LaunchVideo in v1. A user-level skill (`audio-track`) drives it from any repo.

## Verified API facts (Context7, 2026-07-09 — do not re-derive)

- TTS: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`,
  headers `xi-api-key`, `content-type: application/json`, body
  `{"text", "model_id": "eleven_multilingual_v2"}` → binary mp3.
- Music: `POST https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128`,
  same headers, body `{"prompt", "music_length_ms", "model_id": "music_v2"}` → binary mp3.
  `music_length_ms` supports the 3s-120s range we need (45s launch track fits).
- Key: `ELEVENLABS_API_KEY` in repo `.env` (already set; placeholder goes in
  `.env.example`). Optional `ELEVENLABS_VOICE_ID` (default: Rachel,
  `21m00Tcm4TlvDq8ikWAM`). NEVER print the key; redact it from error text.

## Architecture

```
feeders/audio/client.mjs        # dependency-free fetch client: `vo` and `music` commands
scripts/build-noban-audio.mjs   # VO script + music prompt source of truth per brand
props/<brand>-audio.json        # MANIFEST (generated): music + lines with measured durationMs
studio/src/lib/audioMix.ts      # pure ducking/fade volume math (vitest)
studio/src/components/SoundTrack.tsx  # music <Audio> with ducked volume curve
studio/src/templates/LaunchVideo.tsx  # + optional audio prop (nullable)
~/.claude/skills/audio-track/   # user-level skill
```

### Feeder (`feeders/audio/client.mjs`)

Follows the ComfyUI client pattern (pure helpers + CLI, node:test, exit codes):

- `node feeders/audio/client.mjs vo --script <script.json> --out <dir>` — script is
  `{lines: [{id, text}]}`; writes `<id>.mp3` per line.
- `node feeders/audio/client.mjs music --prompt "<text>" --length-ms N --out <file>`.
- After every download the client measures real duration via the bundled ffprobe
  (`npx remotion ffprobe <file>` from `studio/`, parse `Duration: HH:MM:SS.cc`) and
  prints it; the audio build script assembles the manifest from these.
- Missing `ELEVENLABS_API_KEY` → exit 2 with an actionable message (videos render
  silent; audio is non-load-bearing like ComfyUI). HTTP errors → exit 1 with status
  + response text (key redacted). All fetches carry `AbortSignal.timeout` (music
  generation can take ~1-3 min: timeout 300s for music, 60s for TTS).
- Pure, unit-tested helpers: `parseFfprobeDuration(stderr: string): number|null`
  (→ ms), `redact(text, key)`, `buildTtsUrl(voiceId)`, `buildMusicBody(prompt, ms)`.

### Audio build script (`scripts/build-noban-audio.mjs`)

The copy source of truth for audio (same rule as build-launch-props: the manifest
JSON is generated, never hand-edited). It:

1. Defines VO lines keyed by act: `logo`, `hook`, `demo`, `feature-0`, `feature-1`,
   `end` (terse, brand voice, no em dashes; the demo line is one sentence — the demo
   act's captions carry the detail).
2. Defines the music prompt (noban: "minimal dark electronic pulse, restrained
   analog synth, steady confident tempo around 100 bpm, instrument-like precision,
   no vocals, subtle build") and length = the LaunchVideo total duration
   (`launchTiming` on the current demo telemetry, ms).
3. Invokes the feeder for each line + the track, collects measured durations, writes
   `props/noban-audio.json`:

```json
{
  "music": {"src": "noban/audio/music.mp3", "durationMs": 45100},
  "lines": [{"act": "hook", "src": "noban/audio/hook.mp3", "durationMs": 3900, "text": "..."}]
}
```

4. Audio files land in `studio/public/noban/audio/` (gitignored); the manifest is
   committed. Re-running regenerates only missing files unless `--force`.

### Studio integration

- `audioSchema` (zod, exported from `studio/src/lib/audioMix.ts`):
  `{music: {src, durationMs}.nullable(), lines: [{act, src, durationMs, text}]}`,
  attached to `launchVideoSchema` as `audio: audioSchema.nullable()` (default null —
  today's behavior, smoke-safe).
- Pure math (vitest): `voWindows(lines, timing)` maps each line to
  `{fromFrame, toFrame}` = its act's `from + VO_LEAD` (12 frames) through
  `from + VO_LEAD + ceil(durationMs/1000*30)`, clamped to the act;
  `duckedVolume(frame, windows)` returns music volume: base 0.35, 0.12 inside any
  VO window, eased ramps over 9 frames (300ms), plus master fade-in (24 frames) and
  fade-out (36 frames) against total duration.
- `SoundTrack` component: `<Audio src={staticFile(music.src)} volume={(f) => duckedVolume(f, windows)} />`.
  VO lines: one `<Sequence from={window.fromFrame}><Audio src=.../></Sequence>` each.
- LaunchVideo renders `<SoundTrack>` + VO when `audio` is non-null. If a VO line's
  audio would overrun its act, it still plays (audio does not cut mid-word); the
  window only affects ducking.
- Lint/tests/smoke must stay green with `audio: null` defaults.

### Skill (`~/.claude/skills/audio-track/SKILL.md`)

Thin recipe per the established pattern: REQUIRED BACKGROUND animation-studio;
steps = key check → write/extend the brand's audio build script (copy + prompt) →
run it → listen-proof (send the mp3s or the re-rendered video) → re-render the
target composition with `audio` in its props → deliver. Cross-reference added to
the launch-video skill; PLAYBOOK gains an Audio section (endpoints, ducking
constants, ffprobe parsing, credit-cost note).

## Error handling

Fail loudly, exit non-zero; exit 2 reserved for missing-key fallback. The client
never prints the key. Manifest validation happens at composition time via zod
(bad manifest = loud render failure, not silent silence).

## Testing

- node:test for the feeder's pure helpers (URL/body builders, ffprobe parsing, redaction).
- vitest for `voWindows` + `duckedVolume` (window mapping, ramp continuity,
  clamping, fades, empty-lines case).
- Rendered/listened proof: re-render `out/noban/launch.mp4` with audio; user
  approves by ear (exit criterion).

## Out of scope (v1)

- Per-line word timestamps / caption karaoke (ElevenLabs with-timestamps exists if
  ever wanted).
- SocialClip/ProductDemo wiring (they accept the same fragment later).
- Local TTS fallback engine.
