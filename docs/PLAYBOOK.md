# Animation Studio Playbook

The operational reference for generating brand assets with this repo. The user-level
skills (/logo-reveal, /social-clip, /product-demo, /launch-video, /og-assets) point
here. Everything below was learned the expensive way during the 5-phase build
(2026-07-09); do not re-derive it.

## Engine map

All rendering happens IN THIS REPO (`C:\Projects\animations`), never in the product's
repo. Assets are copied out to the calling repo at the end.

| Piece | Where | Run |
|---|---|---|
| Remotion studio (all final video) | `studio/` | `cd studio && npm run dev` / `npx remotion render <Comp> <out> --props=<json>` |
| Health checks + Studio | `launch.py` | `python launch.py --check` |
| Smoke (frame 0 of every comp) | `scripts/smoke.mjs` | run before claiming any studio change done |
| Brand tokens | `brands/<id>.json` + `studio/src/lib/brand.ts` (zod) + `studio/src/brands/marks.ts` (mark registry) | |
| Playwright capture feeder | `feeders/capture/record-noban-demo.mjs` | needs the product's app running |
| Blender feeder | `feeders/blender/render.py <scene> --out <dir> --frame N \| --animation` | Blender via `BLENDER_PATH` in `.env` |
| ComfyUI feeder | `feeders/comfy/client.mjs hero [--seed N]` | non-load-bearing; exit 2 = fallback |
| Stage Blender output | `scripts/stage-blender-assets.mjs [brandId]` | assets/<brand>/ -> studio/public/<brand>/ |
| Launch props builder | `scripts/build-launch-props.mjs` | copy source of truth (JSON is generated) |
| Static presets | `scripts/render-statics.mjs` | og.mp4 / og.gif / readme.gif |
| Audio feeder (ElevenLabs) | `feeders/audio/client.mjs vo\|music\|probe` | needs ELEVENLABS_API_KEY in .env; exit 2 = silent fallback |
| Audio build + merge | `scripts/build-<brand>-audio.mjs`, `scripts/merge-launch-audio.mjs` | VO/music copy source of truth -> props/<brand>-audio.json |

Compositions: SocialClip, ProductDemo, LogoReveal, LaunchVideo, AnimatedOG,
ComponentGallery (test bench). All schemas carry `brandId`; templates resolve
`getBrand(brandId)` and pass `brand` down. Every asset prop is nullable with a
placeholder so smoke stays green on a clean clone.

## Onboarding a new brand (first step for any non-noban product)

1. `brands/<id>.json` — copy `brands/noban.json` shape exactly (zod-enforced: 13 color
   tokens, 3 fonts, tagline, voice). Derive values from the product repo's DESIGN.md,
   tailwind config, or CSS variables; ask the user for anything ambiguous. Encode the
   brand's color RULES in `voice` (e.g. noban: profit gold NEVER green).
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
  `transformOrigin: cx cy` does NOT center the region (it pins it) — this mismatch
  silently crops edges.
- PNG sequences: `frame_%04d.png`, 1-indexed. `PngSequence` clamp holds the last
  frame; loop is `(frame % frameCount) + 1`.
- Seamless loops: every animated value must satisfy f(0) == f(duration); use
  `frame / durationInFrames` (NOT `durationInFrames - 1`); GIF `--every-nth-frame=N`
  preserves the seam only when N divides the duration evenly.
- GIF exports: `--codec=gif --every-nth-frame=2 [--scale=0.5]`. GIFs are heavy
  (full-size 8s 1200x630 ~= 30MB); prefer mp4 for social embeds; scale down for READMEs.
- Rendered proof: inspect stills at act boundaries BEFORE full renders; a full render
  is never the first look at anything.

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

### Brand-driven effects and fonts (post-DashClaw-onboarding facts)
- Backdrop wash/glow intensities are brand-driven via the optional `effects` block in
  brands/<id>.json (brand.ts has the schema + `alphaHex` helper; defaults reproduce
  the original hardcoded values). LogoReveal consumes it; AnimatedOG/LaunchVideo still
  carry the hardcoded-alpha pattern and are trivial to convert when a brand needs it.
  A saturated brand color as a big radial hero-wash is a known failure mode — check
  the brand's stated rules before leaning on the default.
- Fonts are per-brand: `loadBrandFonts(brand)` keyed off brand.fonts, loaders
  registered in fonts.ts. Subset new Google Fonts loaders to 'latin' — an unsubset
  family fans out to dozens of font requests per render.

### Audio (ElevenLabs feeder)
- Verified endpoints (Context7, do not re-derive): TTS
  `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`
  with body `{"text", "model_id": "eleven_multilingual_v2"}`; Music
  `POST https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128` with body
  `{"prompt", "music_length_ms", "model_id": "music_v2"}`. Both take header
  `xi-api-key`, return binary mp3. `music_length_ms` covers the 3s-120s range we need.
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
- If a line overruns its act's time budget, trim the COPY rather than squeeze the
  timing — shortening `launchTiming.ts`'s act lengths to fit audio inverts the
  source of truth.
- Free tier returns 402 (`paid_plan_required`) on API voice/library access — Starter
  plan or above is required for both TTS and music generation (music also needs a
  paid plan for the commercial license). Cost is cents per video for TTS; a few
  credits per generation for music.
- Remotion's `Audio` component is deprecated; use `Html5Audio` (same export, same
  props, zero behavior change) — see `SoundTrack.tsx`.
- Fallback behavior is part of the contract, not an error state: missing
  `ELEVENLABS_API_KEY` makes the feeder exit 2 with guidance and the video renders
  silent — that silent render is still a valid deliverable on a clean clone.

### Process
- Every generated props file has a builder script as its source of truth
  (`build-launch-props.mjs` pattern) — never hand-edit generated JSON.
- Verify behavior-preserving refactors with SHA-256-compared stills, not eyeballs.
- Exit criterion for any asset is the USER seeing the rendered artifact, not code
  compiling.

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
3. Send the file to the user for approval — the asset is not done until a human saw it.
