# Marketing Handoff / wrap pipeline

Read this when: exporting a walkthrough through the Magnetic wrap / round-trip pipeline.

## Marketing Handoff / wrap pipeline (Magnetic round-trip — DashClaw pilot facts)
- The walkthrough fed to Magnetic MUST carry an audio stream: envelope/dead-air analysis
  and Rough Cut only fire on assets with audio. Playwright `recordVideo` webm is SILENT —
  generate the VO (ElevenLabs) and mux it on before import (`npx remotion ffmpeg`), and
  build the narration track synced to recorded per-beat timestamps so nav/settle overhead
  never desyncs it. Encode audio 48 kHz and make it span the FULL video length.
- The old ">=4-clip spine fails to export" cap is FIXED (final-cut-pro `c284aa6`), so any
  clip count exports. Root cause was `renderMixdownWav` decoding PCM per CLIP: a Rough Cut
  splits one recording into N clips sharing one assetId, and N clips fired N concurrent
  `window.api.ensurePcm` calls for that cold asset. `ensurePcm` is a check-then-write, so
  all N spawned ffmpeg processes writing the SAME `cache/pcm/<id>.wav`; a clip that fetched
  it mid-rewrite read a torn wav → `Export failed: Unable to decode audio data`. The fix
  decodes each DISTINCT asset once (`decodeAssetsOnce`), so there is only one cold write per
  asset. No walkthrough-side workaround is needed anymore — a naturally-paced 12+-clip
  take exports fine. (Single-clip takes still use the smart-render stream-copy path.)
- Grouping the walkthrough into a few feature GROUPS (VO continuous inside each group, 1–2
  long ~5 s dead-air gaps AT the feature boundaries) is still nice-to-have — it makes Rough
  Cut land its cuts ON the feature transitions for clean segment boundaries — but it is no
  longer required for the export to succeed.
- TRIM the leading/trailing silence off the muxed mp4 before import so Rough Cut does not
  leave sub-second sliver clips that shift marker-boundary indexing (a boundary-alignment
  concern now, not an export-failure one). Place `clip:`/`end` markers on the SIGNIFICANT
  spine boundaries (both adjacent clips ≥1 s) via
  `window.__magneticTimeline.playback.seek(flicks)` then the `m` shortcut.
- Captions come from Magnetic's whisper auto-transcription (`ggml-base.en.bin`), which
  runs in the background after import. Wait for the asset's `transcriptUrl` (poll
  `window.api.getLibrary()`) BEFORE exporting or `captions.srt` ships empty; let the
  transcription CPU settle a couple seconds before the export decode so they don't contend.
