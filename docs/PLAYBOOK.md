# Marketing Studio Playbook

The operational reference for generating brand assets with this repo. The user-level
skills (/logo-reveal, /social-clip, /product-demo, /launch-video, /og-assets) point
here. Everything below was learned the expensive way during the 5-phase build
(2026-07-09); do not re-derive it.

## Engine map

Reusable source and renderer execution live in the engine repo. Generated inputs,
captures, audio, props, public staging, evidence, renders, and delivery files live in
`<product>/marketing/assets/<brand>/`, selected with `--project <product-repo>` or an
external calling git worktree. They are not rendered in the engine and copied later.
Historical incident notes below may name the old `out/<brand>/` layout; those paths are
provenance, not valid instructions. A generator that cannot resolve a product workspace
is not production-capable until migrated.

**Plugin 2.0.0 migration:** production commands require `--project <product-repo>`
(or documented calling-worktree inference). No generated product input or output may
default to the installed engine. Move any still-needed legacy `out/` artifact into its
product workspace before using it as production evidence.

**Documentation retro, 2026-09-05:** the workspace migration updated the root workflow
but missed sub-package READMEs and skill references. When a workspace, provider, or
package contract changes, search active READMEs, agent instructions, templates, skills,
package metadata, help text, and release notes in the same change. Historical incident
notes may keep old paths when they are clearly labeled as provenance.

| Piece | Where | Run |
|---|---|---|
| Remotion studio (all final video) | `studio/` | `npx remotion render <Comp> <product-output> --props=<product-props> --public-dir=<product>/marketing/assets/<brand>/public` |
| Health checks + Studio | `launch.py` | `python launch.py --check` |
| Smoke (frame 0 of every comp) | `scripts/smoke.mjs` | run before claiming any studio change done |
| Brand tokens | `brands/<id>.json` + `studio/src/lib/brand.ts` (zod) + `studio/src/brands/marks.ts` (mark registry) | |
| Playwright capture feeder | `feeders/capture/record-noban-demo.mjs` | needs the product's app running |
| Blender feeder | `feeders/blender/render.py <scene> --brand <brand> --project <product> [--out <dir>] --frame N \| --animation` | Blender via `BLENDER_PATH` in `.env`; defaults to product-owned assets |
| Unreal feeder | `feeders/unreal/render.py <scene> --brand <brand> --project <product> [--out <dir>] --frame N \| --animation` | UE 5.8.2 via `UNREAL_PATH` in `.env`; defaults to product-owned assets |
| ComfyUI feeder | `feeders/comfy/client.mjs hero --project <product> --brand <brand> [--seed N]` | optional; product-owned output and a clear error when unavailable; a procedural fallback must be selected explicitly |
| Diagram feeder | `feeders/diagram/render.mjs <brand> <spec.d2> --project <product> [--out DIR] [--width N]` | D2 (WASM) + resvg; confined product-owned SVG, PNG, and source under `marketing/diagrams/` by default |
| Infographic style bridge | `scripts/build-infographic-style.mjs <brand> --project <product> [--out path]` | brand tokens to product-owned `marketing/infographic-style.md` |
| Cards | `scripts/build-cards.mjs <brand> --project <product> [--brief path] [--out dir] [--dry-run]` | product-owned square and portrait card stills under `marketing/cards/` |
| Link-preview wiring check | `scripts/verify-og-wired.mjs <brand> --project <product> [url] [--strict]` | compares the live og:image against the product-owned delivered asset |
| Stage Blender output | `scripts/stage-blender-assets.mjs <brand> --project <product>` | product assets to that product's staged public tree |
| Launch props builder | `scripts/build-launch-props.mjs <brand> --project <product>` | product-owned props, direction, shot plan, and production plan |
| Agent session (scripted terminal demo) | `studio/src/templates/AgentSession.tsx` + `studio/src/components/agent-session/` (typing.ts, palette.ts, ui.tsx) + `studio/src/lib/sessionTiming.ts`; props builder `scripts/build-offlocalhost-session-props.mjs` -> props/offlocalhost-session.json | A Claude Code session played as a beat sheet: welcome box, typed prompt, thinking spinner, tool calls that go amber and only then flip, and a buffer that scrolls in stages at overflow, over the brand's own ground, ending on `EndCard`. `sessionTiming.ts` is the one pure lib for BOTH the frame math and the transcript's pixel model, so editing one beat's `frames` reflows every later beat by exactly that amount and `calculateMetadata` cannot disagree with the component. Vendored from the `claude-code-remotion` skill by flocker.md (MIT, 2026); `agent-session/palette.ts` is the ONE allowed home for literal hex outside `brands/*.json` because those are Claude Code's own UI colours, the way a capture plate carries an app's. Brand tokens carry the meaning: accent tints the MCP server prefix, `safe` marks a finished call, `loss` marks a `hold` (finished, waiting on the human) and never flips green. MCP tool names on screen must be verified against the live server, never paraphrased |
| Static presets | `scripts/render-statics.mjs` (noban), `scripts/render-<brand>-statics.mjs` per brand | og.png / og.mp4 / og.gif / readme.gif |
| Audio feeder (ElevenLabs) | `feeders/audio/client.mjs vo\|music\|probe` | needs ELEVENLABS_API_KEY in .env; missing credentials produce a clear non-zero result, and silence is production-valid only when explicitly approved |
| Audio build + merge | `scripts/build-<brand>-audio.mjs --project <product>`, `scripts/merge-launch-audio.mjs <brand> --project <product>` | product-owned VO/music source, props, and scored output |
| Authored films | `studio/src/films/<brand>/` or directed `LaunchVideo` | The chosen direction and shot plan are the canonical story source. Choose captured UI, rebuilt native UI, 2D, 3D, or a hybrid shot by shot according to the idea and required proof; no medium is the universal default |
| Film audio (bespoke) | `scripts/build-<brand>-film-audio.mjs --project <product>`, then `scripts/score-film.mjs <brand> <film.mp4> --project <product>` | Product-owned narration, explicit SFX cues, mix, score report, and master; zero-VO delivery requires a recorded `--music-only` choice |
| Content brief gatherer | `scripts/derive-brief.mjs <brand> --project <product> [--url]` | product grounding -> product-owned `marketing/brief-inputs.json`; the agent synthesizes validated `brief.json`, which the props builder consumes |
| Copy voice-linter | `scripts/lint-copy.mjs <file.json> [--json]` | gates any props/brief JSON: em dashes, slop lexicon, hype, weak qualifiers, announcement openers, generic CTAs, unsourced stats in briefs; exit 1 on ERROR violations |
| Storyboard board | `scripts/build-storyboard.mjs <brand> --project <product>` | product-owned `brief.json` -> `marketing/storyboard.html` before an expensive render |
| Mission Control | `scripts/mission-control.mjs <brand> --project <product> [--port 4600]` | local run console and hash-bound operator attestations; typed reviewer names/roles are not authenticated identities |
| Results loop | `scripts/fetch-results.mjs <brand> --project <product>` | product-owned `posts.json` -> `results.json`; prints N of M rows published beside its verdict |
| Export matrix | `scripts/render-matrix.mjs <brand> --project <product> [--comp] [--stills-only]` + `scripts/platforms.json` | product-owned 16:9/9:16/1:1/4:5 exports via responsive metadata; captioned variants use the routed audio-bearing props |
| Caption sidecars | `scripts/build-captions.mjs <brand> --project <product> [--check]` | product-owned audio props -> product-owned SRT and VTT sidecars |
| Thumbnails | `scripts/extract-thumbs.mjs <brand> --project <product> [--comp] [--frame <n>] [--frame-<aspect> <n>]` | product-owned poster JPG per aspect; choose and inspect the frame at small size |
| Launch (distribution) | `node launch/dist/index.js <init|research|copy|post|notify|ui> <product-dir>` | the folded launch engine (`launch/`, own package, `cd launch && npm ci && npm run build`): scans the product repo into `<product>/.launch/`, drafts and validates per-platform copy, and posts to X, LinkedIn, Facebook, Reddit, GSC, Bluesky and YouTube with the postkit's videos attached (`--kit` or `postkitDir` in the config). Dry-run is the default; `--live` publishes; `--assist` opens the HN and Product Hunt assisted flows. Ledger in `<product>/.launch/ledger.json`, media refused before upload over platform caps. Skill: `/launch`; `/ship-it` runs `/marketing` then this |
| Publish (Bluesky) | `scripts/publish-bluesky.mjs <brand> --project <product> [--dry-run]` | product-owned post kit; before a live upload it re-hashes the media, reruns the strict production evaluation, and refuses stale/non-PASS evidence |
| Publish (YouTube) | `scripts/publish-youtube.mjs <brand> --project <product> [--dry-run] [--auth] [--privacy private\|unlisted\|public]` | product-owned post kit and installed-app OAuth; before live upload it revalidates current media and production evidence; privacy defaults to private |
| Post kit | `scripts/build-postkit.mjs <brand> --project <product> [--production]` | PASS-only product-owned platform folders plus `LICENCES.md` and `DISCLOSURE.md` |
| Contact sheets | `scripts/contact-sheet.mjs <brand> --project <product> --plan <plan> --render <final.mp4>` | three product-owned measured samples per shot plus review HTML |
| Footage cache | `scripts/lib/cache.mjs`; capture scripts + stage-blender-assets consult it | key = product git HEAD+porcelain + script source + config; `--force` re-captures; caching disabled when product git state is unresolvable; capture entries also store readable meta {productRepo, productHead} so Mission Control can warn when footage falls behind the product repo |
| SFX library | `scripts/build-sfx.mjs <brand> --project <product>` | product-owned ElevenLabs SFX; only explicit shot events place cues, and unavailable generation reports a clear non-zero result |
| Quality judges | `scripts/judge-*.mjs <brand> --project <product>` | product-owned reports for A/V sync, pacing, palette, motion, drift, and strict production evidence; advisory measurements never replace local human review |
| Encode budgets | `scripts/check-budgets.mjs <brand>` (hard gate, exit 1 on OVER) | byte budgets per asset class; render-matrix now faststart-remuxes every mp4 and `--webm` adds a VP9/Opus transcode |
| Audio presence | `scripts/check-audio.mjs <brand>` (hard gate, exit 1 on any FAIL) | A film is not done without audio (CLAUDE.md). Scans the delivery surfaces (postkit/** minus `-silent`, top-level `launch.mp4` and `*-final*.mp4`, the newest `film/film-vN.mp4` via its `-scored` sibling + score.json with voLines > 0); each must carry an audio stream that is not silent and sits within 2 LU of TARGET_I. Verdict line carries checked/failed/skipped counts. Working files (launch-vN, demo.mp4, logo-reveal.mp4, og.mp4, `-silent`) are skipped with a reason. First run on postflop (2026-09-01) failed 6 of 14: the launch lock was silent, the youtube/linkedin launch rows were unmastered at -26.6 LUFS, and the captioned 9:16/1:1 social rows had no track at all |
| Hook A/B | `scripts/render-hook-variants.mjs <brand> --project <product> [--headlines '<json>']` | product-owned hook variants and picker |
| Hero takes | `scripts/render-variants.mjs <brand> <logo-reveal\|launch-hook> --project <product> [--takes N]` | product-owned brand-safe motion takes |

Compositions: PostflopFilm (bespoke, studio/src/films/postflop/), SocialClip, ProductDemo, LogoReveal, LaunchVideo, AnimatedOG,
AgentSession (scripted Claude Code terminal session; duration from lib/sessionTiming
via calculateMetadata),
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
   brand name, which judge-audio primes the transcriber with (see the ear-gate section
   in [audio.md](playbook/audio.md)).
2. Register it in `studio/src/lib/brand.ts` (import + registry entry).
3. Mark component: `studio/src/brands/<Brand>Mark.tsx` recreating the product's logo
   SVG (viewBox-normalized, `{size, color}` props, `currentColor` strokes), then
   register in `studio/src/brands/marks.ts`.
4. Fonts: `studio/src/lib/fonts.ts` currently loads one global font set
   (Saira/HankenGrotesk/GeistMono). If the new brand needs different fonts, extend
   fonts.ts to a per-brand loader keyed like the mark registry.
5. Screenshots/footage: stage them inside the product workspace's canonical `public/`
   tree via a workspace-aware capture or `scripts/fetch-<id>-assets.mjs`; never write
   product footage into engine `studio/public/`.
6. Blender logo reveal for the new brand: copy `feeders/blender/scenes/logo_reveal.py`
   to `logo_reveal_<id>.py` and replace ONLY the geometry builders (rounded rect /
   circle / ticks / dot) with the new mark's shapes sampled from its SVG. Everything
   else (materials, draw-on choreography, camera, alpha, arg parsing) is
   brand-agnostic. Colors come from the brand JSON automatically.
7. Verify: `cd studio && npm test` (brand schema), one gallery/still render inspected.

## Gotchas by topic (verified facts, do not re-litigate)

Each topic file below holds facts learned the expensive way during this repo's build;
read only the ones your task touches, not the whole set.

| Topic | File | Read when |
|---|---|---|
| Remotion / studio | [remotion.md](playbook/remotion.md) | any Remotion render, matrix, statics, smoke |
| Playwright capture | [capture.md](playbook/capture.md) | product-demo capture or any Playwright work |
| Marketing Handoff / wrap pipeline | [magnetic-wrap.md](playbook/magnetic-wrap.md) | exporting a walkthrough through the Magnetic round-trip pipeline |
| Blender 5.1.2 | [blender.md](playbook/blender.md) | the Blender (headless bpy) feeder or its scenes |
| Unreal Engine 5.8 | [unreal.md](playbook/unreal.md) | the Unreal Engine feeder or its scenes |
| ComfyUI | [comfy.md](playbook/comfy.md) | the ComfyUI feeder (non-load-bearing) |
| Brand-driven effects and FilmGrade | [brand-effects.md](playbook/brand-effects.md) | tuning brand washes/fonts or FilmGrade grain/halation |
| Cross-asset drift judge | [judge-drift.md](playbook/judge-drift.md) | running or interpreting scripts/judge-drift.mjs |
| Audio (ElevenLabs feeder + ear-gate) | [audio.md](playbook/audio.md) | the audio feeder, mixing, mastering, or scripts/judge-audio.mjs |

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

#### Direction and production proof

- The full contract is [`production-quality.md`](production-quality.md). Start a run
  with `--project <product-repo>`; generated sources and outputs live under
  `<product>/marketing/assets/<brand>/`, not in this engine checkout.
- Explore distinct directions, but treat the chosen `direction.json` as the source of
  truth: visual metaphor, sound intent, references with provenance, and approved style
  frame/animatic. Presets are starting grammars, not finished identities.
- Build the animatic with scratch voice and music. Audio begins during direction; it is
  not finish applied after a silent picture lock.
- A shot plan is editorial intent, not a request for one medium. Use captured UI,
  rebuilt native UI, 2D, 3D, or a hybrid according to the product proof and concept.
- Never overwrite an iteration render. Watch the full scored cut, record defects, then
  render a new version. Notes are symptoms, not specs ("make it 3D" often means missing
  depth or camera intent, not that every element should rotate).
- Local operator review and mechanical audit are disjoint. Generate three hash-bound
  samples per shot, then record full-render, soundtrack, would-share, five quality
  scores, and structured defects in Mission Control. Names and roles are self-attested,
  not authenticated. All five scores must be at least 4/5; any major or blocking defect
  fails approval. Then run `judge-production --strict`.

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

1. Require `--project <product-repo>`. All generated captures, audio, props, public
   staging, evidence, renders, matrix rows, and post kits live in
   `<product>/marketing/assets/<brand>/`. Engine-local `out/` is not a product-run path.
2. Bind `direction.json`, `shot-plan.json`, every routed props source including
   caption/audio-bearing variants, the canonical public inventory, stage artifacts,
   evidence, final render, and review through `production-plan.json` hashes. A stale hash
   is incomplete.
3. Run the contact-sheet evidence builder and strict production judge before the matrix;
   `--production --stills-only` proves layout but is explicitly not deliverable media.
4. When a post kit is part of the delivery, its root records travel WITH it —
   `LICENCES.md` and `DISCLOSURE.md`. A disclosure record that stays behind in
   the engine never reaches the person who actually posts the file, which is the only
   moment it matters: the platform AI toggle is set at upload, by a human, once.
5. The production post kit copies only PASS, hash-bound matrix rows. A live publisher
   re-hashes the current media and reruns production evaluation before upload. Send the
   scored file to the user; the asset is not done until a human watched it with sound.

**2026-09-05 retro.** What worked: immutable renders and all-composition contact sheets
made the repeated template grammar visible. What did not: green runtime gates and
frame-zero smoke had no evidence that the films were worth sharing. One change: every
production run now carries authored, hash-bound stage/render evidence plus a local
full-film operator attestation, with mechanics kept separate from taste.
