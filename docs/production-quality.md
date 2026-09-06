# Production quality

This is the acceptance contract for production marketing films. It does not promise
"agency quality." It makes the creative source, rendered evidence, and human verdict
auditable, and it fails closed when any of them are missing or stale.

## Baseline verdict

The 2026-09-05 before audit, taken from source snapshot `0485f25`, is **9/20 (Poor)**
and **fatal for an agency-quality claim**. All 13 registered compositions were sampled;
all 14 template files (2,023
lines), all 34 bespoke-film files (4,388 lines), and all 22 shared components (3,201
lines) were covered. Review used settled representative frames from all registrations
plus immutable pre-rebuild Postflop and Truckside LaunchVideo, LogoReveal, ProductDemo,
SocialClip, and OG renders. Frame-zero smoke was treated only as a runtime check.

## What production quality means here

A passing film has four independent properties:

1. **Authored intent:** a chosen direction states the visual metaphor, sound intent,
   references and provenance; a shot plan gives every shot a purpose, scale, camera
   cadence, transition, duration, readable-copy limits, and referenced source.
2. **Stage proof:** a style frame and an audio-bearing animatic carry explicit local
   operator attestations bound to the artifact hash. Typed names and roles are audit
   labels, not authenticated identities.
3. **Rendered proof:** start, middle, and end frames from every planned shot are extracted
   from the exact final render and bound to both the render and production-plan hashes.
4. **Viewer proof:** a local director, operator, or independent reviewer attests they watched the
   entire render with sound, answers yes to “would I share this?”, rates story clarity,
   visual hierarchy, motion intent, product readability, and ending confidence from 1–5,
   and records structured defects. Approval requires all five scores to be at least 4/5;
   any major or blocking defect fails the review. This is local attestation, not identity
   authentication.

Mechanical checks reject stale sources, missing shots, blank/black frames, truncated
renders, and missing evidence. Low contrast, low edge occupancy, repetition, and
near-static motion are review prompts, not universal aesthetic failures. Taste remains a
separate perceptual pass.

## Production architecture

```text
product brief + references
  -> direction.json -> approved style frame
  -> shot-plan.json + scratch voice/music -> approved animatic
  -> authored shots (capture, native UI, 2D, 3D, or hybrid)
  -> final render -> 3 measured samples per shot
  -> Mission Control full-film review
  -> judge-production --strict
  -> hash-bound matrix rows -> PASS-only post kit
```

`studio/src/lib/direction.ts` supplies editorial, precision, and playful starting
grammars plus overrides. These are starting points, not brand identities.
`studio/src/lib/shotPlan.ts` normalizes legacy and directed timelines into the one plan
used by picture, sound, metadata, and gates. Authored shots may replace the defaults.
Use the medium the idea needs: real captured UI for credibility, native rebuilt UI for
controlled interaction, 2D/3D for a product-specific metaphor or impossible camera,
and hybrid work when the cut benefits from both. Do not rebuild UI by ritual.

The source bundle hashes the chosen direction, shot plan, every routed props source
including caption/audio-bearing variants, and the canonical public-media inventory.
Evidence and review bind to that bundle plus the exact render. A live publisher reruns
the production evaluation and rejects changed media, stale evidence, or a non-PASS
verdict before network upload.

Directed LaunchVideo keeps old props on the legacy path, but new props may order logo,
hook, demo, feature, end, or external-asset sources; trim source ranges; set a viewport
and focus box; designate hero and ending holds; and choose continuity, readability, and
sparse audio events per shot. Its metadata and picture use the same normalized plan.
Semantic wide/medium/close/detail framing clamps subjects to title-safe bounds, eases
camera cues with deterministic holds/settles, and lets real capture telemetry drive the
focus. Pointer motion follows recorded approach/hover/press/release timestamps. Text fit
uses browser `measureText` during render with a conservative Node fallback.

The optional Blender hybrid route is `feeders/blender/scenes/product_beauty.py`: it
places a real raster product plate on a shallow physical display with restrained
materials, softbox key/fill/rim lighting, depth of field, and deterministic camera
motion. It writes `product-beauty.json` provenance and confines relative inputs and
outputs to the product repo. Use it only when physical light/material/camera depth adds
meaning; it does not replace editable native UI, exact live capture, or precise 2D work.

The accepted Postflop technical-depth proof uses the real EV-surface plate, an
aspect-preserving focal crop, a slim off-axis display, a dark neutral stage, and broad
key plus restrained rim light. Its product-owned source is
`marketing/assets/postflop/assets/product-beauty/frame_0060.png`; the Remotion-facing
copy is `marketing/assets/postflop/public/postflop/product-beauty/frame_0060.png` in the
verified Postflop repository. An earlier gray, near-front-on monitor treatment was
rejected: it washed out the environment, softened the UI, clipped the bright rim, and
added an unexplained pedestal. The accepted frame proves the reusable depth route, not
an approved campaign film. Only one still was rendered; the full animation remains
unverified, and the 900x540 source plate limits letter sharpness.

Audio begins with direction and the animatic. Narration remains the default delivery
contract; music-only is an explicit recorded exception. Picture, narration, music, and
SFX must consume the same shot timing. Do not shorten a truthful claim into a false one
to fit a lock, and do not call a file finished because loudness or cue checks passed.
`SoundTrack` maps narration through explicit `audioRef` values instead of assuming visual
and voice IDs match; `null` means no line and unresolved or duplicate requested refs fail.
Cuts do not synthesize SFX. Explicit shot events create sparse cues, while bounded J/L
bridges may lead or trail a cut by at most 15 frames. The scorer uses distinct bed,
narration/EQ, ducking, and SFX buses, measures the delivered master, and reports music
markers against detected onsets without inventing or snapping a weak BPM estimate.

## Product-owned workspace

Every run takes an explicit `--project <product-repo>`. Generated inputs, captures,
audio, props, public media, evidence, renders, matrix rows, thumbnails, captions, and
post kits live under:

```text
<product>/marketing/assets/<brand>/
  marketing/  matrix/  thumbs/  captions/  postkit/  props/  assets/  public/
```

The engine repo owns reusable source only. Production paths are constrained to the
product repo; do not create generated product inputs or outputs in engine-local `out/`.

Current production commands:

```bash
node scripts/contact-sheet.mjs <brand> --project <product> --plan <production-plan.json> --render <final.mp4>
node scripts/judge-production.mjs <brand> --project <product> --plan <production-plan.json> --render <final.mp4> --strict
node scripts/render-matrix.mjs <brand> --project <product> --production --stills-only
node scripts/render-matrix.mjs <brand> --project <product> --production
node scripts/render-matrix.mjs <brand> --project <product> --production --verify-production
node scripts/build-postkit.mjs <brand> --project <product> --production
```

`--production --stills-only` is layout proof, never delivery. `--verify-production`
rechecks pending existing media without rerendering. The matrix hashes every complete
row to its plan and evidence; the production post kit copies only PASS, hash-bound rows.

## Ranked audit and remediation

All source paths and line-number citations in this baseline section refer to snapshot
`0485f25`; remediation labels describe the current tree.

1. **One skeleton wears eleven brands.** `Headline.tsx:67-106`, `EndCard.tsx:25-46`,
   `SocialClip.tsx:171-202`, and `AnimatedOG.tsx:99-157` repeat centered lockup, plate,
   copy, and rail grammar. Require a product-specific metaphor and shot plan.
2. **The product is present but illegible.** `FeaturePanel.tsx:38-126` makes the default
   screenshot-left/list-right slide; existing launch/social/demo renders shrink a whole
   desktop below useful reading size. Frame one consequential interaction per shot.
3. **Remediated: the CS2 wear-zone metaphor leaked across products.** `progressTreatment`
   now defaults to `none`; `FloatBar` renders only for `cs2-wear`, which only NoBan opts
   into. Templates can retain the shared mount without showing NoBan product language on
   other brands.
4. **The reusable film is a deck, not an argument.** The legacy logo, claim, desktop,
   feature slides, CTA sequence provides coverage without causality. Make a visual thesis
   and motivated shot order prerequisites.
5. **LogoReveal can reveal any logo and therefore expresses none.**
   `LogoReveal.tsx:39-100` is a centered 520 px box, radial wash, shadow, wordmark, and
   uppercase CTA. Let mark construction, product verb, material, or environment lead.
6. **Social and OG repeat the long-form ending.** `SocialClip.tsx:171-202` and
   `AnimatedOG.tsx:99-157` recycle headline/panel/end-card ingredients. Compose the hook
   and thumbnail for their distinct jobs.
7. **Bespoke format overrides overpromise.** `postflop/Film.tsx:28-31` and
   `dashclaw/Film.tsx:33-38` accept dimensions while `Shot03Composer.tsx:17-20`,
   `Shot04Intercept.tsx:28-45`, and others use fixed 1920 coordinates. Author alternate
   blocking or explicitly lock the film to 16:9.
8. **Postflop regresses to a generic equal-card grid.** `Shot06Features.tsx:8-14,345-367`
   places four equal cards in 2x2. Stage an editorial sequence or transforming system.
9. **Postflop proof is developer-native before it is human-readable.**
   `Shot04Workbench.tsx:208-280`, `Shot05Convergence.tsx:141-308`, and
   `Shot07Browser.tsx:138-302` prioritize versions, nodes, iterations, tables, and grids.
   Organize technical proof around one understandable consequence.
10. **Typography collapses brands into one developer voice.** Nine of eleven brand files
    specify JetBrains Mono, three use Inter display, and `fonts.mono` appears 89 times in
    23 source files. Reserve mono for machine output; art-direct display and editorial type.
11. **Postflop repeats one handover at every cut.** `postflop/Film.tsx:49-68` applies the
    same eight-frame opacity/translate treatment. Make each cut express shot relationship.
12. **Static tails became an aesthetic rule.** `postflop/Film.tsx:21-26` requires settle
    before overlap. Permit motivated hard cuts, motion matches, audio leads, and occlusion.
13. **FilmGrade is a global preset, not cinematography.** Eleven roots mount it;
    `FilmGrade.tsx:74-111` adds bloom, vignette, and fringe independent of shot content.
    Grade per direction and plate after the edit works without it.
14. **Radial wash is default decoration.** Eleven matches across eight files include
    `LogoReveal.tsx:42`, `ProductDemo.tsx:39`, `SocialClip.tsx:168`, and
    `AnimatedOG.tsx:95`. Motivate light, texture, depth, or negative space from concept.
15. **EndCard is fixed and centered across formats.** `EndCard.tsx:25-58` uses fixed
    110/96/34 px sizes and an 84% CTA bound without `useFormat`. Author format-specific
    lockups and test long copy.
16. **ProductDemo transports a recording but does not edit it.** `ProductDemo.tsx:21-65`
    scales one DemoStage, overlays telemetry, then swaps to EndCard. Select and reframe the
    proof rather than treating a complete desktop recording as one shot.
17. **Captions put card UI on card UI.** `Caption.tsx:20-44` and
    `CaptionTrack.tsx:42-80` use bordered translucent rounded containers. Make caption
    typography and placement part of the direction.
18. **Frame-zero smoke is not visual QA.** Existing frame zero is nearly empty for
    SocialClip, LaunchVideo, PostflopFilm, and WrapClip. Keep it for rendering health; add
    representative shot evidence and a full-length viewer pass.
19. **Card encodes the generic hero-metric pattern.** `Card.tsx:42-44,86-117` centers a
    large number or quote. Keep it as campaign utility, not the hero-quality ceiling.
20. **Internal galleries inflate composition coverage.** `Root.tsx:25-40` registers
    ComponentGallery and StagedGallery beside deliverables. Label proof fixtures and
    exclude them from production coverage percentages.

The strongest active 2D work is Postflop, but its tables, counters, mono labels, and
reconstructed UI cap accessibility and emotional range. The DashClaw world/plate concept
is the cinematic ceiling in source, but that film is parked and was not changed.

## Roadmap and gates

1. **Now:** keep legacy rendering compatible while new work supplies direction, shot
   plan, locally attested style frame/animatic, product-owned sources, and explicit references.
2. **Before full render:** inspect the style frame and the audio-bearing animatic. Kill a
   weak visual argument here; do not rely on expensive finish to rescue it.
3. **Before delivery:** inspect every shot’s three samples, watch the complete scored
   film, record the structured review, then run the strict judge.
4. **Before distribution:** render format-specific still proofs, verify production rows,
   and build the PASS-only post kit from the same product workspace.
5. **Regression:** preserve the immutable before media and compare representative frames
   and the full scored cut. Frame-zero smoke remains a runtime check, not visual approval.

## Limits

- The three direction presets are finite defaults; they cannot create a product insight.
- Pixel statistics detect integrity problems and review risks, not beauty, originality,
  truthful storytelling, voice performance, or whether an idea deserves to exist.
- A contact sheet cannot prove timing, edit rhythm, narration intelligibility, or mix.
- Audio reports intentionally leave perceptual review incomplete. The authoritative
  product-workspace mix proof is 26.066667 seconds with four VO lines, zero decorative
  SFX, -14 LUFS, -2.8 dBTP, and 48 kHz stereo AAC. It has no recorded listening
  approval, so it remains internal proof rather than distribution-cleared media.
- The Blender product-beauty path has an accepted aspect-correct Postflop technical
  still. The rejected gray-monitor iteration is retained only as before evidence. Its
  120-frame animation is unverified, so the route remains infrastructure proof rather
  than production-proven campaign creative.
- A named review can still be poor judgment; the hash binding proves provenance, not taste.
- The current directed proof covers four shots, 782 frames, and 12 measured samples with
  zero FAIL findings. Its nine INCOMPLETE findings are limited to local human stage and
  full-film-with-sound attestations. It is not an agency-quality claim or an approved film.
- Internal galleries and proof fixtures do not count toward production coverage.
- Existing engine-local renders are noncanonical; migrate or recreate any still-needed
  artifact inside its product workspace before using it in a run.
- Matrix, thumbnail, caption, postkit, results, publisher, cache, feeder, static, teaser,
  and store-tile production paths use the product workspace.
- The final live-writer scan found no production output default under the engine.
  Diagram source/output, Magnetic icon output, and NoBan source/public staging now
  resolve through the external product workspace. Engine-path references in
  `scripts/migrate-workspace.mjs` are intentional legacy inputs, not output defaults.

## Baseline command evidence

- `python launch.py --check` exited 0; Node, npm, ffmpeg, ffprobe, studio dependencies,
  Blender, and capture dependencies reported `[OK]`; optional ComfyUI reported `[--]`.
- `npm --prefix studio test` exited 0 with `18 passed (18)` files and `204 passed (204)`
  tests in the before snapshot.
- `npm --prefix studio run lint` exited 1 during concurrent rebuild work at
  `studio/src/lib/shotPlan.ts:192:0 error Parsing error: '}' expected`, plus five
  non-pure-animation warnings. The new direction/shot-plan files were excluded from the
  before-source audit; this was recorded as a rebuild blocker, not hidden as a green gate.

## Current upgrade verification (point-in-time)

These counts were observed during the coordinated rebuild and are not a substitute for
the final repo-wide verification after every parallel source edit lands.

- `python launch.py --check` exits 0 with the required toolchain available; optional
  ComfyUI remains unavailable and non-load-bearing.
- `npm --prefix studio test` exits 0: 23 files and 222 tests pass.
- `npm --prefix studio run lint` exits 0 with zero errors and zero warnings; the Studio
  production build also passes.
- The current product-workspace production proof reports four shots, 782 frames, 12
  measured samples, zero failures, and nine incompletes, all limited to missing local
  human stage/full-film attestations.
- All nine changed bundled skill folders pass the skill-creator `quick_validate.py`
  check; the eight separately installed custom copies pass the same validation.
- The Node suite exits 0 across 56 files: 558 tests, 556 passed, zero failed, and two
  optional fixtures skipped. This includes the real D2 diagram render. The launch
  package separately passes 251 tests.
- The native feeder Python suite passes all 23 tests, including Blender, Unreal, and
  shared product-workspace boundary coverage.

## Practice references

[Ordinary Folk’s process](https://ordinaryfolk.co/process) starts sound during concept
development and combines boards, voice, sound, and music in an animatic before final
animation. [Its Webflow Ecommerce case study](https://ordinaryfolk.co/project/webflow-ecommerce)
shows real interface as the focal proof while dimensional 2D/3D work supplies context.
[BUCK’s Notion case study](https://buck.co/work/notion-think-it-make-it) demonstrates the
opposite of a house-template mandate: one bespoke visual concept executed with deliberate
minimal restraint. These are process references, not a claim of equivalent output.

## Dependency PR review

The two human-authored dependency PRs were reviewed as a pair. PR #4 selects `nanoid`
3.3.17, which remains affected by
[GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8);
the 3.x fix is 3.3.18. PR #3 selects `postcss` 8.5.18, but the later source-map issue
[GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) affects versions
through 8.5.22; the current scoped repair targets 8.5.28. Verify the combined override and
lockfile change, then supersede/close the stale PRs after the verified push. A clean
temporary `npm ci --ignore-scripts` installed 348 packages and `npm ls` resolved
`postcss@8.5.28` plus `nanoid@3.3.18`; final repository verification and push remain the
release gate.
