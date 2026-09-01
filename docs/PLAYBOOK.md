# Marketing Studio Playbook

The operational reference for generating brand assets with this repo. The user-level
skills (/logo-reveal, /social-clip, /product-demo, /launch-video, /og-assets) point
here. Everything below was learned the expensive way during the 5-phase build
(2026-07-09); do not re-derive it.

## Engine map

All rendering happens IN THE ENGINE REPO (the directory holding this `docs/` folder),
never in the product's repo. Assets are copied out to the calling repo at the end.
Every path below is relative to that engine root, so they resolve whether the engine
is a source clone or an installed plugin.

| Piece | Where | Run |
|---|---|---|
| Remotion studio (all final video) | `studio/` | `cd studio && npm run dev` / `npx remotion render <Comp> <out> --props=<json>` |
| Health checks + Studio | `launch.py` | `python launch.py --check` |
| Smoke (frame 0 of every comp) | `scripts/smoke.mjs` | run before claiming any studio change done |
| Brand tokens | `brands/<id>.json` + `studio/src/lib/brand.ts` (zod) + `studio/src/brands/marks.ts` (mark registry) | |
| Playwright capture feeder | `feeders/capture/record-noban-demo.mjs` | needs the product's app running |
| Blender feeder | `feeders/blender/render.py <scene> --out <dir> --frame N \| --animation` | Blender via `BLENDER_PATH` in `.env` |
| ComfyUI feeder | `feeders/comfy/client.mjs hero [--seed N]` | non-load-bearing; exit 2 = fallback |
| Diagram feeder | `feeders/diagram/render.mjs <brand> <spec.d2> [--out DIR] [--width N]` | D2 (WASM) + resvg; brand-colored SVG+PNG+source -> out/<brand>/marketing/diagrams/; own npm install (MPL-2.0 deps, consumed unmodified) |
| Infographic style bridge | `scripts/build-infographic-style.mjs <brand>` | brand tokens -> out/<brand>/marketing/infographic-style.md, a design-language file for the installed /epic-infographics skill (copy it into that skill's references/design-languages/) |
| Cards | `scripts/build-cards.mjs <brand> [--brief path] [--out dir] [--dry-run]` | one stat card per brief proofPoint + a quote card from hook.headline, rendered as Card stills at 1080x1080 and 1080x1350 -> out/<brand>/marketing/cards/; clean skip when there is no brief |
| Link-preview wiring check | `scripts/verify-og-wired.mjs <brand> [url] [--strict]` | fetches the LIVE page, compares its og:image against the delivered og asset; advisory, skips clean without a url |
| Stage Blender output | `scripts/stage-blender-assets.mjs [brandId]` | assets/<brand>/ -> studio/public/<brand>/ |
| Launch props builder | `scripts/build-launch-props.mjs` | copy source of truth (JSON is generated) |
| Static presets | `scripts/render-statics.mjs` (noban), `scripts/render-<brand>-statics.mjs` per brand | og.png / og.mp4 / og.gif / readme.gif |
| Audio feeder (ElevenLabs) | `feeders/audio/client.mjs vo\|music\|probe` | needs ELEVENLABS_API_KEY in .env; exit 2 = silent fallback |
| Audio build + merge | `scripts/build-<brand>-audio.mjs`, `scripts/merge-launch-audio.mjs <brand>` | VO/music copy source of truth -> props/<brand>-audio.json; merge takes brand argv, defaults noban |
| Content brief gatherer | `scripts/derive-brief.mjs <brand> <productRepo> [--url]` | grounding (README, package.json, route names, CHANGELOG, public GitHub issue titles via gh, landing DOM) -> out/<brand>/marketing/brief-inputs.json; agent synthesizes brief.json (zod: `studio/src/lib/brief.ts` — includes grounding sections: audience, customerLanguage, objections, JTBD switchingForces, sourced proofPoints, hook.strategies; hook/CTA formulas in `skills/marketing/references/hook-formulas.md`, campaign evidence in `references/campaign-evidence.md`); build-launch-props overlays brief copy when brief.json exists |
| Copy voice-linter | `scripts/lint-copy.mjs <file.json> [--json]` | gates any props/brief JSON: em dashes, slop lexicon, hype, weak qualifiers, announcement openers, generic CTAs, unsourced stats in briefs; exit 1 on ERROR violations |
| Storyboard board | `scripts/build-storyboard.mjs <brand>` | brief.json -> out/<brand>/marketing/storyboard.html (content approval before any render) |
| Mission Control | `scripts/mission-control.mjs <brand> [--port 4600]` | live run console over run.json; Approve/Redo buttons write manifest + review.json atomically; advisory bar surfaces judge-*.json verdicts, footage staleness (cache meta vs product git HEAD), and results.json engagement per variant |
| Results loop | `scripts/fetch-results.mjs <brand>` | posts.json ({platform, url, variant, metrics?}) -> results.json; X metrics via X_BEARER_TOKEN in .env (exit 2 fallback), LinkedIn manual; closes the hook A/B loop with real engagement. posts.json is seeded by build-postkit (one row per platform, published:false) and rows are written by Mission Control's Mark posted button as well as by hand; fetch-results prints N of M rows published beside its verdict |
| Export matrix | `scripts/render-matrix.mjs <brand> [--comp] [--stills-only]` + `scripts/platforms.json` | fans LaunchVideo/SocialClip into 16:9/9:16/1:1/4:5 via calculateMetadata props (no --width CLI flag in Remotion 4.0.486); captioned variants for muted-autoplay rows when audio props exist |
| Caption sidecars | `scripts/build-captions.mjs <brand> [--check]` | props/<brand>-audio.json -> out/<brand>/captions/launch.srt + .vtt |
| Thumbnails | `scripts/extract-thumbs.mjs <brand> [--comp] [--frame <n>] [--frame-<aspect> <n>]` | poster JPG per aspect -> out/<brand>/thumbs/; the poster frame is CHOSEN, never defaulted (precedence: `--frame-<aspect>` > `--frame` > a dormant `posterFrame` in props/<brand>-launch.json > the script default). Never mid-motion, half-typed, or cursor-visible; test it at 200px wide |
| Publish (Bluesky) | `scripts/publish-bluesky.mjs <brand> [--dry-run]` | the only platform with an open write API: uploads out/<brand>/postkit/bluesky/social-16x9.mp4 through video.bsky.app, posts caption.txt (links become facets, 300-grapheme cap enforced) with alt.txt, records the URL in posts.json via Mission Control's applyPosted; BLUESKY_HANDLE + BLUESKY_APP_PASSWORD in .env (missing = exit 2). Mission Control's Publish to Bluesky button runs the same script. fetch-results reads its counts from the public AppView, no token |
| Post kit | `scripts/build-postkit.mjs <brand>` | per-platform folders (video, lint-gated caption.txt, alt.txt, thumb, POST.md, SRT/VTT for yt/li) -> out/<brand>/postkit/; also writes a `<video>-silent.mp4` per copied video (ffmpeg `-c copy -an`, skipped with a log line when ffmpeg is missing) and two root records: `LICENCES.md` (music/SFX/font sources actually present) and `DISCLOSURE.md` (what this pipeline actually synthesised for the brand, the per-platform AI toggle to set at upload, and the gaps it does NOT close — no C2PA credential embedded despite EU AI Act Art. 50 since 2026-08-02, plus the TikTok Content Posting API's private-until-audited trap) |
| Contact sheets | `scripts/contact-sheet.mjs <brand> <Comp>` | act-boundary stills + sheet HTML -> out/<brand>/marketing/stills/; Mission Control shows the strip |
| Footage cache | `scripts/lib/cache.mjs`; capture scripts + stage-blender-assets consult it | key = product git HEAD+porcelain + script source + config; `--force` re-captures; caching disabled when product git state is unresolvable; capture entries also store readable meta {productRepo, productHead} so Mission Control can warn when footage falls behind the product repo |
| SFX library | `scripts/build-sfx.mjs` (one-time, idempotent) | ElevenLabs sound-generation -> assets/sfx/ + studio/public/sfx/ (whoosh/tick/riser, exit 2 = silent fallback); cues derived at render from launchTiming via `studio/src/lib/sfxCues.ts`, gated by `sfx.enabled` in the audio manifest (builder flips it only when files are staged) |
| Quality judges | `scripts/judge-av-sync.mjs`, `judge-demo-pacing.mjs`, `judge-palette.mjs <brand>`, `judge-motion.mjs [brand]`, `judge-drift.mjs <brand>` | Phase-4 advisors (exit 0 + JSON verdicts; `--strict` gates): VO overruns/caption dwell, dead-air (raw-capture footage means dead = literally frozen frames, threshold 0.2), forbidden-color washes with high/low confidence + `--mask-region` (product-UI false-positive guard), motion-craft conventions (no Easing.in/scale(0)/CSS transitions in studio src, springs via lib/motion.ts, brand motion-token bands, entry-scale + stagger + grain + halation ceilings — numbers IMPORTED from lib/motion.ts, never restated; adapted from Emil Kowalski's review-animations standards, MIT). **judge-drift is the only SET judge** — it scores the whole out/<brand>/ rather than one file, so it runs LAST once everything has rendered, and it emits a worst-first `drift-sheet.html` alongside its JSON. Its z-scores are relative to the set's own dispersion with NO absolute threshold; calibrate with `--ref <dir>` against approved assets (see the cross-asset drift section below) |
| Encode budgets | `scripts/check-budgets.mjs <brand>` (hard gate, exit 1 on OVER) | byte budgets per asset class; render-matrix now faststart-remuxes every mp4 and `--webm` adds a VP9/Opus transcode |
| Hook A/B | `scripts/render-hook-variants.mjs <brand> [--headlines '<json>']` | renders the hook act per headline (brief.json altHeadlines or flag) -> out/<brand>/marketing/hooks/ + picker.html; registers run.json variants[] for Mission Control's radio pick |
| Hero takes | `scripts/render-variants.mjs <brand> <logo-reveal\|launch-hook> [--takes N]` | brand-safe motion-knob takes via nullable `motionOverride` prop (exuberant take floors at 0.65 — below ~0.55 the spring is overdamped and deltas render invisible); registers variants[] |

Compositions: SocialClip, ProductDemo, LogoReveal, LaunchVideo, AnimatedOG,
Card (still, 1080x1080 default, 1080x1350 via formatWidth/formatHeight; stat and
quote cards from brief proof points via scripts/build-cards.mjs),
WrapClip, ComponentGallery + StagedGallery (test benches). All schemas carry
`brandId`; templates resolve
`getBrand(brandId)` and pass `brand` down. Every asset prop is nullable with a
placeholder so smoke stays green on a clean clone.

## Onboarding a new brand (first step for any non-noban product)

1. `brands/<id>.json` — copy `brands/noban.json` shape exactly (zod-enforced: 13 color
   tokens, 3 fonts, tagline, voice). Derive values from the product repo's DESIGN.md,
   tailwind config, or CSS variables; ask the user for anything ambiguous. Encode the
   brand's color RULES in `voice` (e.g. noban: profit gold NEVER green). Optional
   zod-defaulted blocks: `grade` (FilmGrade
   grain/grainSize/halation/vignette/bloom/aberration/letterbox — zero bloom AND zero
   halation for brands whose voice forbids glow, since halation blooms whatever is
   brightest and that is the accent by construction; `grainSize` is the baseFrequency
   at 1080p and scales by frame height; judge-motion WARNs above grain 0.4 and
   halation 0.35) and `motion` (tempo/exuberance/
   stagger/overshoot plus `parallax`/`settle` depth-and-cut kickers defaulting to 0 and
   a `textReveal` preset [spring|maskWipe|blurIn|charStagger] defaulting to spring —
   the brand's choreography personality; rest positions and zeroed defaults never
   change existing output). Also optional: `speechHint`, the SPOKEN casing of a coined
   brand name, which judge-audio primes the transcriber with (see the ear-gate section).
2. Register it in `studio/src/lib/brand.ts` (import + registry entry).
3. Mark component: `studio/src/brands/<Brand>Mark.tsx` recreating the product's logo
   SVG (viewBox-normalized, `{size, color}` props, `currentColor` strokes), then
   register in `studio/src/brands/marks.ts`.
4. Fonts: `studio/src/lib/fonts.ts` currently loads one global font set
   (Saira/HankenGrotesk/GeistMono). If the new brand needs different fonts, extend
   fonts.ts to a per-brand loader keyed like the mark registry.
5. Screenshots/footage: copy into `studio/public/<id>/` (gitignored) via a
   `scripts/fetch-<id>-assets.mjs` following the noban one.
6. Blender logo reveal for the new brand: copy `feeders/blender/scenes/logo_reveal.py`
   to `logo_reveal_<id>.py` and replace ONLY the geometry builders (rounded rect /
   circle / ticks / dot) with the new mark's shapes sampled from its SVG. Everything
   else (materials, draw-on choreography, camera, alpha, arg parsing) is
   brand-agnostic. Colors come from the brand JSON automatically.
7. Verify: `cd studio && npm test` (brand schema), one gallery/still render inspected.

## Hard-won gotchas (verified facts, do not re-litigate)

### Remotion / studio
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
- Export matrix: LaunchVideo rows read `out/<brand>/launch-audio-props.json` when it
  exists (scripts/merge-launch-audio.mjs writes it), so they carry the merged audio AND
  the same VO-derived act lengths as the launch video; SocialClip rows have no audio
  track by design and are silent. Measured 2026-09-01 before the fix: dashclaw and
  costclaw launch-16x9.mp4 were -70.0 LUFS (digital silence), tenwords -26.3 only because
  it was the sole EMBED_AUDIO member. Already-rendered brands must be re-rendered one at
  a time and re-approved in Mission Control.
- Burned captions floor at 2.8% of frame height (`captionFontSize` in
  studio/src/lib/captionTiming.ts): 52px at 1080p stays byte-identical, but the
  1080-wide 9:16 and 1:1 rows used to render 29px captions, about 1.5% of a 1920-tall
  frame, on the muted-autoplay rows platforms.json marks as the primary deliverable.

### Playwright capture (product demos)
- The camera must zoom to MEASURED content regions (focus events), never to click
  points — clicks live on nav rails and produce "random zoom" feel. Measure focus
  rects from raw frames (`npx remotion ffmpeg -ss <t> -i demo.webm -frames:v 1 out.png`).
- Apps clip their own overflow: frame focus windows to end BEFORE any ragged
  self-clipped table edge; widening the viewport does not fix an app-side max-width clip.
- `deviceScaleFactor: 2` supersamples the recording (crisper, brighter); pair with
  `filter: brightness(1.12) contrast(1.03)` on the video layer.
- Telemetry: steps (captions) + clicks (cursor/ripple) + focus (camera) with t relative
  to recording start; cursor eases in the last 700ms before a click, clamped so rapid
  clicks never skip the rest state.
- Known accepted aesthetic: during zoom holds the cursor can be off-frame (it rests on
  the sidebar); user approved. Candidate fixes if redlined: widen focus rects or ease
  the camera out during cursor approach windows.
- NEVER print dashboard tokens; scripts read the product's .env at runtime and redact
  tokens from every error path.
- Next.js dev-tools indicator (the dark "N" button) lives INSIDE A SHADOW ROOT
  (`#devtools-indicator`), not light DOM — `nextjs-portal` removal/CSS misses it and it
  ends up baked into footage. Capture scripts need a shadow-root-piercing interval sweep;
  verify it's gone in the first extracted frame before recording the full take
  (see record-paperroute-demo.mjs).

### Marketing Handoff / wrap pipeline (Magnetic round-trip — DashClaw pilot facts)
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

### Blender 5.1.2 (headless bpy) — each of these was a silent wrong-output bug
- Scene cleanup: `for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)`.
  `scene.collection.objects` MISSES the default cube/light/camera (child collection).
- Emission strength must be 1.0 under `view_transform = 'Standard'`; higher strengths
  clip channels and hue-shift brand colors (violet -> hot pink at 4.0).
- `bevel_factor_end` draw-on animation NO-OPS on cyclic splines: build outlines as
  non-cyclic POLY splines with the first point repeated at the end. AND: the open
  spline's two flat end-caps butt together at the join and can carve a visible notch
  at pointed features — run the spline several points PAST its own start so the
  closing tube swallows both caps (discovered on the DashClaw shield tip).
- Curve tubes have flat end-caps only (no stroke-linecap round equivalent). Reads as
  a chisel at display sizes; if a brand needs round caps, add small spheres at the
  endpoints.
- Keyframe fcurves live at `action.layers[].strips[].channelbags[].fcurves`
  (`Action.fcurves` is gone).
- Seamless texture loops: animate the Wave texture's **Phase Offset** by whole 2*pi
  cycles with LINEAR keys at frame 1 and frame N+1. Animating Mapping location breaks
  the seam (distortion noise is not periodic in the offset).
- Alpha: `film_transparent = True` + PNG RGBA. Engine id: `BLENDER_EEVEE`.
- Always render single-frame proofs (and verify alpha: corner pixel `(0,0,0,0)`)
  before committing to an animation render. Renders were fast on the RTX 3070 Ti
  (~21s for 90 frames, ~96s for 240).
- Long single-process `--animation` runs can HANG mid-sequence (observed: 66 frames
  in ~34s then zero output until killed, frame 67/360). Verified workaround: chunked
  renders — fresh Blender process per ~60 frames (`--start-frame`/`--end-frame`;
  keyframes unchanged, so chunk output is pixel-identical) with a hard timeout
  (`render.py --timeout N`). On Windows the timeout must kill the process TREE
  (`taskkill /T /F`) — killing only the shell/python parent orphans blender.exe, which
  keeps writing frames into the output dir (see build-magnetic-demo-media.mjs).

### ComfyUI (non-load-bearing)
- Ports 8000/8188; models live at
  `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\models\checkpoints` (config:
  `%APPDATA%\Comfy Desktop\shared_model_paths.yaml`). New checkpoints are picked up
  without a restart.
- Workflow graphs are stored JSON with `{{TOKEN}}` placeholders;
  `CheckpointLoaderSimple` outputs: model=0, clip=1, vae=2. Deterministic seeds
  (default 47) make heroes reproducible; `--seed N` re-rolls.
- The fallback is part of the contract: exit 2 + message; `render-statics.mjs` logs
  the procedural fallback. Never make an asset depend on ComfyUI being up.
- `feeders/comfy/client.mjs` is noban-hardwired (violet prompt, `assets/noban/comfy`
  output, negative prompt excludes "green"). Other brands take the procedural fallback
  until someone parameterizes it — do not point it at a new brand as-is.

### Brand-driven effects and fonts (post-DashClaw-onboarding facts)
- Backdrop wash/glow intensities are brand-driven via the optional `effects` block in
  brands/<id>.json (brand.ts has the schema + `alphaHex` helper; defaults reproduce
  the original hardcoded values). As of the paperroute run (2026-07-10) ALL five
  templates consume it — LogoReveal, ProductDemo, LaunchVideo, SocialClip, AnimatedOG;
  no hardcoded `${brand.colors.brand}<alpha>` washes remain. A saturated brand color
  as a big radial hero-wash is a known failure mode — check the brand's stated rules
  before leaning on the default (paperroute: wash MUST be 0, One Green Rule).
- FloatBar's progress fill runs brand → profit tokens (changed from safe→profit→loss
  during the paperroute run: a red-tipped scrubber reads as decoration-red and violates
  brands whose red is error-only; noban's end color became its profit gold, on-identity).
- FeaturePanel is orientation-aware (`height > width` switches row→column), so vertical
  9:16 social clips render from the SAME SocialClip comp; no separate template. Set the
  dimensions with the optional `{formatWidth, formatHeight}` PROPS that `calculateMetadata`
  reads (Root.tsx), the same mechanism `render-matrix.mjs` uses. **There are no
  `--width`/`--height` CLI flags in Remotion 4.0.486** — this line used to prescribe them
  and they silently do nothing (found the hard way on the practicalsystems run,
  2026-08-17; the export-matrix row in the table above had it right all along).
- A vertical export is a RESPONSIVE RELAYOUT, never a crop of the 16:9 master. Full-bleeding
  16:9 footage into a 9:16 frame slices the source's own text mid-word at both edges, which
  reads as a broken render rather than as background texture. Fit-to-width with the brand
  ground filling the remainder, crop to a region containing no text, or blur/dim hard enough
  that it is unmistakably texture. On screen, text is either legible or absent; half-legible
  is the one option that is not allowed.
- Fonts are per-brand: `loadBrandFonts(brand)` keyed off brand.fonts, loaders
  registered in fonts.ts. Subset new Google Fonts loaders to 'latin' — an unsubset
  family fans out to dozens of font requests per render.

### FilmGrade — halation and grain (2026-08-17, all rendered-proof facts)
- **`backdrop-filter` DOES render in Remotion's headless Chromium.** Verified with a
  rendered LogoReveal still, not assumed. This is what makes `grade.halation`
  possible: it samples the composited content underneath, so unlike `bloom` (a fixed
  radial gradient that glows the same spot whatever the frame holds) halation blooms
  wherever the frame is *actually* bright. `contrast()` inside the filter chain acts
  as the highlight threshold — it crushes darks toward black, and screen-blending
  near-black adds nothing, so only real highlights bloom.
- Halation renders FIRST in the FilmGrade stack, before the vignette. Put it after
  and it samples the darkened edges as if they were dark content.
- **Halation is the knob that turns a comp into generic AI-glow.** Measured on noban:
  0.55 grew a pronounced halo on the wordmark that read as esports-neon — the exact
  thing noban's voice forbids. 0.22 kept the mark instrument-sharp while still
  reading as photographed. judge-motion WARNs above 0.35.
- **Grain needs no luminance mask.** The colorist rule "real grain is dense in the
  midtones, thin in shadows and highlights" is already satisfied by the
  `mixBlendMode: 'overlay'` the grain layer has always used: overlay is identity at
  both ends of the base (overlay(0,x)=0, overlay(1,x)=1) and peaks at 0.5. Adding a
  tonal mask would double-apply a curve that is already correct.
- `grade.grainSize` is the feTurbulence `baseFrequency` **at 1080p**, and FilmGrade
  scales it by frame height. feTurbulence frequency is in user-space px, so a fixed
  frequency means a fixed PIXEL feature size — i.e. finer grain as a fraction of a
  taller frame. Without the normalisation the same asset carried visibly different
  grain at 1080p and 4K. Default 0.8 is the old hardcoded value, so 1080p output is
  byte-identical.

### Cross-asset drift judge (`scripts/judge-drift.mjs`)
- Every other judge scores ONE asset. This one scores `out/<brand>/` as a **set**,
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

### Audio (ElevenLabs feeder)
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
- Fallback behavior is part of the contract, not an error state: missing
  `ELEVENLABS_API_KEY` makes the feeder exit 2 with guidance and the video renders
  silent — that silent render is still a valid deliverable on a clean clone.

#### Loudness mastering
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

### Audio judge (`scripts/judge-audio.mjs`) — the ear-gate

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

### Process
- Every generated props file has a builder script as its source of truth
  (`build-launch-props.mjs` pattern) — never hand-edit generated JSON.
- Verify behavior-preserving refactors with SHA-256-compared stills, not eyeballs.
- Exit criterion for any asset is the USER seeing the rendered artifact, not code
  compiling.
- 2026-09-01: zero of 47 props files set a staged act across four brand runs since
  commit 440c6ab. Test: if no brand run sets a `staged` act by 2026-12-01, delete
  `StagedScene.tsx`, `lib/staged.ts`, `staged.test.ts`, and `StagedGallery.tsx`
  (~2,109 lines) and remove the `StagedGallery` entry from `scripts/smoke.mjs`.
  `StageCursor.tsx` stays regardless — `DemoCursor.tsx` imports `CURSOR_TIP` and
  `CursorGlyph` from it, and `ComponentGallery.tsx` imports `StageCursor` and
  `controlPressScale` from it, both live outside the staged-scene system.

#### Direction discipline (process, not code)
- Write three one-page directions per `docs/templates/DIRECTION.md`, kill two by its
  four kill questions; the survivor must differ on >= 4 of the 11 dials from the last
  film built in this repo, or it is a variant, not a direction.
- Record the chosen direction in `out/<brand>/marketing/direction.md` before
  storyboarding — the artifact that lets "make another like that" be honored later.
- Never overwrite a render: `launch-v1.mp4`, `-v2`, ... The director loop is render ->
  watch -> write the defect list yourself -> fix -> re-render as a NEW file. Notes are
  symptoms, not specs ("make it 3D" usually means a camera rig, not a rotation).
- Versioning applies to the ITERATION renders only. `out/<brand>/launch.mp4` stays the
  locked/delivered name because `mission-control.mjs` and `review-in-magnetic.mjs`
  both hardcode it; the lock step copies the approved version there. Do not "fix" this
  to a versioned final name.
- Director (watching) and auditor (measuring every on-screen claim/number) are
  DISJOINT review passes — run both; neither substitutes for the other.

## Token discipline for asset generation sessions

- These recipes are solved: execute them, don't re-explore. A routine asset run should
  be: read skill -> run commands -> inspect 2-4 stills -> render -> deliver.
- Keep renders out of context: pipe render logs to tail -1/-2; inspect single STILLS
  (Read tool), never video files; extract video frames via ffmpeg when needed.
- Subagent heavy iteration (visual tuning loops) so the still images land in a
  discarded context; the main loop sees only verdicts.
- Batch verification: tests + lint + smoke in one command at the end, not per edit.
- Model routing: recipe execution works on Opus/Sonnet; reserve top-tier models for
  designing NEW templates or diagnosing visual bugs the playbook doesn't cover.

## Delivery contract (skills end with this)

1. Final artifact rendered into `out/<brand>/`.
2. Copy the artifact into the CALLING repo (ask once where; default `marketing/assets/`
   or the repo's existing media dir).
3. When a post kit is part of the delivery, its root records travel WITH it —
   `LICENCES.md` and `DISCLOSURE.md`. A disclosure record that stays behind in
   `out/` never reaches the person who actually posts the file, which is the only
   moment it matters: the platform AI toggle is set at upload, by a human, once.
4. Send the file to the user for approval — the asset is not done until a human saw it.
