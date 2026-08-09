# Adoption notes: AbubakrChan/product-launch-motion

Distilled 2026-08-09 from https://github.com/AbubakrChan/product-launch-motion
(a Claude Code skill: 12 direction/craft reference docs + 8 audio/grade scripts for
HTML+GSAP frame-by-frame launch films). The renderer is not what we want — the
direction discipline, audio arithmetic, and camera/cursor craft are. Everything below
is renderer-neutral and mapped to our Remotion pipeline.

Their 44s example film: word-locked kinetic type on a dark "argument" ground, product
rebuilt as staged native HTML UI (never screenshots) on a light ground, one gradient
accent with a written budget, fake cursor with a full click stack, LUFS-mastered mix.

## Why theirs reads better than our LaunchVideo (diagnosis)

1. Timing runs VO-first (`hold = measured VO + pad`); every reveal lands on the
   measured start of its word. Ours is fixed act constants; VO is fitted in after.
2. Two visual grounds (dark = argument, light = product evidence). Ours holds one
   dark brand ground for all five acts.
3. Product shots are rebuilt native UI with a camera rig, staged data, and a cursor
   that clicks. Ours shows screenshot panels and captured demo video, camera locked.
4. Their structure varies per film (shot catalog + direction dials). Our 5-act
   template is a house style: every brand gets the same choreography.
5. Their audio is measured (LUFS targets, asset leveling, delivered-file proof).
   Ours has fixed ducking constants and no loudness step at all.

## Adoption plan (ranked)

### Phase A - post-render audio mastering (small, zero template coupling)

Pure post-`remotion render` steps; new scripts only, no studio code touched.

- `scripts/master-audio.mjs` (port of their `master.sh`): two-pass loudnorm to
  **-14 LUFS integrated, true peak <= -1.0 dBTP, LRA 7**, then a true-peak limiter,
  then re-encode.

  ```bash
  # pass 1 - measure
  ffmpeg -i in.mp4 -af loudnorm=I=-14:print_format=json -f null -
  # pass 2 - correct + limit + re-encode (fill measured_* from pass 1 JSON)
  ffmpeg -i in.mp4 \
    -c:v libx264 -preset slow -crf 19 -tune film -pix_fmt yuv420p \
    -af "loudnorm=I=-14:TP=-1.0:LRA=7:linear=true:measured_I=..:measured_TP=..:measured_LRA=..:measured_thresh=..,alimiter=limit=0.891:level=disabled:attack=5:release=50" \
    -c:a aac -b:a 192k -movflags +faststart out.mp4
  # verify on the DELIVERED file
  ffmpeg -i out.mp4 -af ebur128=peak=true:framelog=quiet -f null - 2>&1 | grep -E "^\s+(I|Peak|LRA):"
  ```

  Two proven traps: `linear=true` computes one gain, so a loud transient added after
  measuring can clip (+1.1 dBFS in their history) - the limiter is the fix, not
  belt-and-braces. And `alimiter` applies makeup gain unless `level=disabled`
  (omitting it produced -13.0 LUFS / -0.0 dBFS, louder than target).

- `scripts/verify-cue.mjs` (port of `verify-cue.sh`): measure a time window in the
  delivered MP4 - whole-window mean/peak (`volumedetect`) plus a per-100ms envelope.
  The envelope matters: a window-peak check passed (-1.4 dB) on a cue that was 56%
  leading silence and landed in the wrong half. Audible rule of thumb: transients
  within ~12 dB of the narration bed in that window.

- `scripts/level-sfx.mjs` (port): fix quiet SFX at the ASSET, not the cue volume.
  Law (arithmetic): summing a -38 dB source into a -17 dB bed moves the mix by
  hundredths of a dB no matter the volume prop - raising a cue 0.35 -> 0.85 moved
  the delivered mix 0.1 dB. Their chain:

  ```bash
  ffmpeg -ss 0 -t 1.1 -i sfx.mp3 \
    -af "volume=22dB,alimiter=level_out=0.9:limit=0.9,afade=t=out:st=0.95:d=0.15" \
    -c:a libmp3lame -b:a 192k sfx-loud.mp3
  ```

  Must trim from the first transient (field recordings open with room tone; leveling
  the silence defeats the point). Run once over our `build-sfx.mjs` output library.

- Process rule: tune `<Audio volume>` against the raw VO stem, never against a
  mastered preview (4.6 dB error in their history, always flattering the cue).
- Trap: if a `<Sequence durationInFrames>` is shorter than its audio asset, the baked
  `afade` never plays and the cut clicks. Check cut boundaries.

### Phase B - word-locked sync + VO-first timing (medium; DECISION REQUIRED)

This inverts a PLAYBOOK rule. Today: "if a line overruns its act, trim the COPY -
never squeeze the timing." Theirs: frame durations are DERIVED from measured VO
(`hold = VO duration + ~0.25-0.5s pad`; next act starts at `hold`; the transition
lives in the overlap). Their claim, borne out by their case study: estimated timings
are the root cause of "reveals feel off" notes.

Adoption path that fits our architecture:

1. ElevenLabs TTS supports `with-timestamps` (noted as out-of-scope v1 in our audio
   feeder spec - promote it). Emit word-level timestamps at VO build time into the
   `props/<brand>-audio.json` manifest.
2. `launchTiming.ts` gains a VO-driven mode: act length = VO ms + pad, falling back
   to today's constants when no audio manifest exists (smoke stays byte-identical).
3. Components take optional per-word cue frames (word start * fps) for reveals:
   headline emphasis word, stat count-ups (start on the NAMING word, land on the
   completing word, linear easing - eased-out counts crawl), feature line reveals.
4. Cue-authoring rules worth copying verbatim: cue the verb not the noun; lead by
   0.02-0.06s for things that must be read, land exactly for "hits"; max 2 cues per
   beat; weight reveals to the back half of a shot; 200ms off reads as lag.

Our existing `judge-av-sync.mjs` becomes much stronger once real word times exist.

### Phase C - camera rig, cursor, click stack (new components, big look upgrade)

The single biggest visual difference in their product shots.

- `CameraRig`: TWO nodes, never one. Outer node = dolly (scale only,
  `transform-origin` set to the exact control being pushed toward - fixed-point math
  means the target doesn't move while everything grows around it). Inner node = 3D
  turn (`perspective(2200-2800px)`, `rotateY -7deg -> -1.3deg`, `rotateX 2.1 -> 0.5`,
  never exactly 0 at rest; origin `50% 52%`; ease inOut across the whole shot).
  Rotation + scale on ONE element fight over the transform matrix and judder.
  Everything the camera moves (content AND cursor) lives inside the inner node.
  Static `translateZ` (12-22px) on story-touched elements makes the turn read as depth.
  Push ceiling: `edge_after = edge + (edge - origin) * (scale - 1)` on all 4 edges
  vs the bottom ~17% keep-out band.
  Sequencing: settle the push BEFORE the cursor arrives, dead still through the
  click, release after the state resolves.
- `FakeCursor`: 44x54 px (not life-size 32 - vanishes on saturated controls), white
  fill + dark 1.6px stroke + deep drop shadow, positioned by the TIP (offset ~6,3),
  fades out when its work is done. Travel: x and y on DIFFERENT eases and durations
  so the path bows (a straight line is the #1 fake-cursor tell), plus an 8px/0.05s
  anticipation pull-back. The click lands on its cued word; travel starts earlier.
- `ClickStack`: bloom (148px, leads the press by 0.1s) + cursor press
  (scale 0.86 in 0.06s, back-out recovery) + ripple ring (104px, expands to 1.5x,
  fades) + the CONTROL depresses 6% and springs back. A cursor pressing a static
  button is uncanny.
- `RackFocus`: paired blur(0 -> 2.6px -> 0) + opacity(1 -> 0.55 -> 1) interpolates;
  base style needs explicit `blur(0px)` or frame 1 jumps.
- `SpecularSweep`: skewX(-14deg) element with a 90deg white gradient (peak alpha
  0.11) sweeping xPercent -140 -> 260; one pass per NAMED story beat (thesis, proof,
  CTA - 3 in 44s), never looped ("a sweep on a timer is a screensaver").

Easing house table (maps to Remotion Easing/spring): entrances power3.out
0.24-0.38s; exits power2.in; camera power1/2.inOut; state flips back.out(1.4-2.4);
counters linear with `tabular-nums` and scale-not-font-size. Overshoot is rationed
to exactly 3 jobs (cursor press recovery, state flip, one punctuation unit per hero
beat) - audit our ActContainer kicker, which currently fires on EVERY act cut.
Stagger table: sub-elements 0.02s, cells 0.03-0.04, list waterfall 0.05-0.06,
individually-counted items 0.10-0.15 (2-4 items max).

FilmGrade check: their grain is feTurbulence + feColorMatrix moving luminance into
ALPHA, opacity 0.1, base frequency 0.82, 1 octave, re-seeded at 12 Hz not per frame
(per-frame grain took a 9 MB file to 85 MB and reads as sizzle). HARD BAN on
`mix-blend-mode` / `backdrop-filter` / filter-as-curve in any overlay layer
(composited against transparency -> their entire film rendered white). Verify our
FilmGrade against all of this. Lifted blacks: no pure #000; their dark ground is
#100e19. Vignette corner alpha 0.15 max (same overlay sits over light shots).

### Phase D - direction discipline (kills our house style; process not code)

Our real gap vs theirs is not components, it is that every brand gets the same film.

- Before building a launch video: write THREE one-page directions (thesis, dials,
  palette, type, signature move, sound, risk, wrong-for), kill two. Judge: serves
  the claim or decorates it / this brand but better / could a competitor ship it
  unchanged (kill if yes) / survives imperfect execution.
- 11 direction dials (energy, density, ground, depth, camera, type, texture, colour,
  product-literalness, sound, voice): any two films must differ on >= 4 dials.
- Structural axes are where sameness actually hides: rhetorical device, arc
  (problem->solve is one option, not the option), where the turn lands (try 15% or
  75%, not always 40%), the ending, climax mechanic, opening state.
- Signature move: one thing only this film does, derived from the product's core
  verb, repeated 2-3 times (early / payoff / resolve), cheap enough to do at 100%.
- Two-ground register map: exactly two grounds (argument vs product evidence);
  every register flip is a story turn and carries a transition.
- Accent budget, written: emphasis word, stat numerals, active step, state flips,
  CTA. A third hue is a mistake.
- Shot catalog to draw from (constructions, never a running order): kinetic type
  stack, crowding-problem collapse, held thesis, prompt/composer with typing cursor,
  results waterfall (skeletons resolve in sequence, never all at once), two-pane
  workspace (the long camera shot), pipeline tracker, hero stat count-up,
  testimonial with a real face (wipe not fade), comparison columns arriving turned
  ~6.5deg and squaring up, end card with self-drawing mark, hardware hero (once
  only), reconstructed terminal (22-28px mono, never a recording), map/chart
  (static SVG, scaleY bars from axis origin).
- Composition rules: never the same camera move on adjacent shots; alternate busy
  and still; ~45s budget = 3 dense product shots, 4 near-still, 2 type frames.
- Approved-figures list: every numeral on screen whitelisted with a source before
  animating; round DOWN only. Extend `lint-copy.mjs` to enforce.
- Director loop: render -> watch -> write the defect list yourself -> fix ->
  re-render as a NEW versioned file (video-v1/v2/...; never overwrite - can't prove
  a fix or restore a preferred cut). Notes are symptoms, not specs ("make it 3D"
  meant a camera rig; "add a typing sound" meant the cue was arithmetically
  inaudible). A director pass (watching) and an audit pass (measuring every factual
  claim) catch DISJOINT defect classes; both are required.
- Self-review: 3 passes, one problem class each - sync (5 random reveals vs
  transcript), motion (muted; nothing moving at cuts), read (full screen at
  distance; what do you remember?). Extract the LAST frame of every shot - must be
  static. Judge scale only from full-res stills, never contact-sheet thumbnails
  (two "too small" frames measured 60% and 77% of frame width).

### Phase E - deliverables gaps (we have matrix/captions/postkit; these are missing)

- Poster frame CHOSEN, tested at 200px wide (no mid-motion, half-typed, or
  cursor-visible frames) - our extract-thumbs takes a fixed time today.
- Silent cut (`-an` strip) as a distinct variant for muted autoplay embeds.
- Loop rule: the 2-4s loop must contain one COMPLETE idea (a state change, a count
  landing) - not ambient drift.
- 9:16 is a re-layout, not a crop: payload lives in the central ~60% horizontal
  band; 2-col shots stack; runtime often shortens by cutting a product-detail shot,
  never the claim. (Our matrix already re-renders per aspect - audit templates
  against the central-band rule.)
- The claim exists as on-screen type in the first seconds regardless of captions
  (most feed views are muted).
- Licence recording (music, SFX, fonts, photography) in the handoff folder.
- Handoff includes the direction doc + dial positions so "make another like that"
  can actually be honored.

## Cross-cutting traps to keep (each proven with a measurement)

1. mix-blend-mode / backdrop-filter in overlay tracks -> film renders white.
2. getBoundingClientRect lies under a scaled/rotated ancestor; use offsetWidth/Left/Top.
3. object-position does nothing when source and box share aspect ratio - oversize
   ~1.8x in an overflow:hidden wrapper and offset by hand.
4. Camera push vs keep-out band: run the edge formula before picking scale.
5. Cue volume cannot rescue a quiet source (level the asset).
6. loudnorm linear=true still clips; alimiter needs level=disabled.
7. Per-frame grain re-seed destroys compression (12 Hz).
8. Trust only the delivered file - a change can exist in source and be absent from
   the shipped MP4. Sample frames + measure audio in the MP4 itself.
9. Never overwrite renders; version everything, keep raws.
10. Butt-joined animations on one property: leave a 1-frame gap.

## Status

- Phase A: BUILT 2026-08-09 — scripts/master-audio.mjs, verify-cue.mjs,
  level-sfx.mjs. One deviation from the source skill: the limiter chain works to
  -2.0 dBTP (not -1.0) because alimiter is sample-domain and AAC re-encode
  overshoots ~0.5 dB of true peak; the delivered-file gate stays -1.0 dBTP.
- Phase C: BUILT 2026-08-09 — CameraRig, StageCursor (+ CursorGlyph,
  controlPressScale), RackFocus, SpecularSweep; DemoCursor upgraded to the shared
  glyph with bowed travel (telemetry cursorAt); FilmGrade grain reseed moved to
  12Hz. All demoed in ComponentGallery's staged strip. FilmGrade's blend modes
  were audited and deliberately KEPT: the source skill's white-film trap comes
  from per-track compositing against transparency; Remotion renders one DOM in
  Chrome, so screen/overlay blends have a real backdrop (proven by shipped runs).
- Phase B needs the PLAYBOOK timing-rule inversion approved.
- Phase D is PLAYBOOK + /launch-video skill changes (direction discipline).
- Phase E deliverables gaps not started.
