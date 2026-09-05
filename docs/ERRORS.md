# Errors and recurring failures

Short entries only: what failed, why, what fixed it, date. Nothing that belongs in
git history or the PLAYBOOK.

---

## A new judge's FAIL verdict was unreachable, and the judge reported PASS

**Date:** 2026-08-17

**Symptom:** `judge-drift` shipped with a two-condition FAIL (off-palette AND
unlike its siblings). Run against the real noban set it reported PASS with only
WARNs, which looked like a clean repo. It was not: the FAIL branch could not fire
at all.

**Root cause:** `describe()` measured token adherence on the same coarse 64-wide
colour grid it used for the histogram vector. `quantize()` reports each bucket's
CENTRE colour, and a coarse centre can land inside `TOKEN_RADIUS` of a brand token
when none of the actual pixels do. A flat `#ff1493` probe sits 92 RGB units from
noban's magenta `rare` token (correctly off-brand) but its bucket centre sits 70
units away (wrongly on-brand), so `tokenShare` came back 1.0 for a deliberately
off-brand asset and `offPalette` was never true.

**Fix:** quantize at 32 (the resolution `judge-palette`'s `TOKEN_RADIUS` was
calibrated against) and FOLD the coarse histogram down from it in the same pass —
two resolutions from one scan, because the vector wants coarse bins and token
adherence wants fine ones. Regression test pins the `#ff1493` case.

**Prevention:** the bug was invisible to every green run and to reading the code;
it surfaced only by writing an off-brand PNG into `out/<brand>/` on purpose and
demanding a FAIL. A verdict branch that has never been observed firing has been
written, not verified. Same lesson caught a second bug in the same script minutes
later: `judge-audio.png`, another judge's own diagnostic plot, was being scored as
a brand asset at 11.2 sd — which inflated the set's stdev enough to MASK three
real outliers, since `driftZ` is denominated in stdevs. Tool exhaust must be
excluded from a set judge, and the exclusions listed, or the denominator shrinks
silently.

---

## Privacy assertion passed while the leak shipped

**Date:** 2026-08-12 (leak introduced in the 2026-08-09/10 sidetap run)

**Failure.** The sidetap `/marketing` run recorded its privacy phase as "REDACT now
stubs contact/message text and masks the home dir; verified by an automated leak
assertion before filming." The delivered `demo.mp4` still contained, at t=29.87s to
t=30.00s, a real contact name and two real message bodies in the dashboard's RECENT
SENDS panel. The same five frames survived into `launch.mp4` and `launch-final.mp4`.
Separately, the live phone stream showed personal photos and a Health card for
several seconds at 1080p.

**Root cause.** The assertion validated the redacted Remotion props JSON, which is an
input. It never sampled the rendered output or the live phone stream. A brief
dashboard re-render painted real data for five frames, and nothing downstream looked
at pixels.

**Why it was hard to spot.** The leak is 0.17s inside a 47s clip. A 1 fps frame scan
steps straight over it. Coarse sampling reported the video as clean.

**Fix.** Verify rendered output, not render inputs. Sweep the finished file at 10 fps
or better, cropped to whatever region can carry private data:

    ffmpeg -v error -i out/<brand>/demo.mp4 \
      -vf "fps=10,crop=<w>:<h>:<x>:<y>,tile=12x73" -frames:v 1 sweep.png

Then read `sweep.png`. 10 fps catches anything lasting 0.1s or longer. Use `-ss` after
`-i`, never before, or the seek snaps to a keyframe and the reported timestamps drift.

**Also fixed the same day.** `launch.py --check` never checked for ffmpeg or ffprobe,
which 26 scripts and feeders shell out to directly. A clean install passed the health
check and then failed deep inside a render. Both are now required checks, and
`launch.py --bootstrap` installs the npm dependencies.

**Status.** The affected videos are gitignored and were never published. The public
artifacts (`og.png`, `readme.gif`) were built from redacted props and are clean.

---

## sed -i rewrites line endings under core.autocrlf

**Date:** 2026-08-12

**Failure.** A scripted identifier rename across all tracked files
(`git ls-files -z | xargs -0 sed -i ...`) left 127 files showing as modified with an
empty `git diff`. `core.autocrlf` is `true` here, so sed rewrote CRLF working copies
as LF. Content was unchanged, but the noise would have tripped the shared-repo guard
in `skills/marketing-studio/SKILL.md`.

**Fix.** After any bulk `sed -i`, restore the files that have no real diff:

    git diff --name-only 2>/dev/null | sort > real.txt
    git status --porcelain | grep '^ M ' | cut -c4- | sort > dirty.txt
    comm -23 dirty.txt real.txt | xargs -d '\n' git checkout --

**Also.** In this shell, sed does not see `\\` as a literal backslash, so
`s|C:\\Projects\\x|...|` silently matches nothing while `grep -F` finds the string.
Use `.` for the separator instead: `s|C:.Projects.x|...|`.

## judge-audio false positives: merged segments and mangled brand words

**Date:** 2026-08-13

**Context.** Three-brand evidence run (sidetap, dashclaw, paperroute) to decide
whether the ear-gate can become a blocking pipeline stage. dashclaw (the one
mastered render) passed clean. sidetap and paperroute each produced one TRUE
finding — both unmastered (-25.7 / -25.2 LUFS vs the -14 target, peaks -6+ dB
under the -2 chain ceiling) — buried in ~7 false FAILs apiece, all from two
matcher failure modes:

1. **Sub-second gaps merge acts.** The matcher merges adjacent whisper segments
   before scoring, so back-to-back VO lines with <1s gaps become one blob that
   matches ONE act; the neighbors report "manifest line was not heard at all"
   even though the words are in the transcript verbatim (sidetap feature-0/
   feature-2 at 57.3s/73.9s; paperroute's end line inside feature-1's blob).
   Blob durations then fail the timing checks too (10.18s vs 5.25s "hook").
2. **Whisper mangles brand words.** "SideTap" → "PsyTep", "paperoute" →
   "paperoot" — the logo/CTA act then can't match. The harness ears tool now
   takes `--hint` (initial_prompt) which recovers the brand word, but hints are
   opt-in: a glossary-style hint threw the small model into an "I, I, I…"
   repetition loop on spelled-out letters ("U I") that ate 30s of transcript.

**Fix (before the gate can block anything).** (a) Match manifest lines WITHIN a
merged blob (windowed alignment) instead of blob-to-one-act; (b) pass a short
prose brand hint through the transcribe shim, or alias-normalize brand words
before scoring. Until then the gate is advisory: a FAIL means "read the
findings", and loudness FAILs are the trustworthy ones (verified independently
with `ears levels` both times).

**Result.** Reports: `out/<brand>/marketing/judge-audio.json`. Real defect to
fix when wanted: re-master sidetap and paperroute launch-final audio through
master-audio (dashclaw proves the mastered path passes).

**Resolved same day.** (1) `matchLinesToWindows` replaced the gap-grouped
matcher — lines match contiguous word windows, so sub-second inter-line gaps
cannot merge acts. (2) Brands with a logo act get a prose transcription hint
from `brands/<id>.json` (`speechHint` carries the spoken casing; "SideTap"
recovered the word, "sidetap"/"Sidetap" did not). (3) Timing FAILs only on
wrong act placement; span deltas alone are WARN (whisper stamped a "This" as
4.4s long after a music gap; edge words now clamp to 1s). (4) sidetap and
paperroute re-mastered to -13.9/-14.2 LUFS; master-audio now pins `-ar 48000`
(loudnorm's internal 192kHz resample had delivered 96kHz masters). All four
brands re-judged: costclaw and dashclaw PASS unchanged, sidetap and paperroute
down to ONE real FAIL each — 2.2s/2.7s of trailing silence in the composition
itself (the end card outlives the fade), which only a re-render can fix.

## 2026-09-01 — Two silent film cuts shipped, then a music-only one

**Symptom.** The first bespoke PostflopFilm (28s, reference-quality picture) was handed to
Wes with no audio track at all. The re-cut added music + SFX and still had no
narration. Both were called "done".

**Root cause.** Nothing in the pipeline made audio part of the definition of done.
The launch-video skill listed audio as step 8 ("run the audio-track skill"), the
marketing intake offered "none" as an option, and no gate checked the delivered
mp4 for a track. A picture-only definition of done let the render pass every judge.

**Fix.** CLAUDE.md rule (a film is not done without audio, and audio means a voice
explaining the product); `scripts/check-audio.mjs` hard gate over the delivery
surfaces (track present, not silent, within 2 LU of TARGET_I, newest film scored
with voLines > 0); `scripts/score-film.mjs` (narration + ducked bed + cues,
verified master, refuses zero-VO manifests and overlapping lines);
`scripts/build-<brand>-film-audio.mjs` as the copy source of truth. Intake option
"none" removed; skills re-synced. First gate run on postflop: 5 of 14 delivery files
failed (unmastered launch rows at -26.6 LUFS, captioned social rows with no track).

**Lesson.** A deliverable's definition of done must be a gate, not a step in a
checklist. Also: master-audio.mjs alone cannot master a generated music bed
(mean -32 dB / peak -0.6 dBFS, crest too high for linear loudnorm) — compress the
bed first, then measured gain into a limiter, re-measure the delivered file.

## 2026-09-03 — score-film cut 17 frames off the picture

**Symptom.** The first scored AgentSession delivery for offlocalhost was 1545 frames
against a 1562-frame source (51.5 s of 52.1 s). Every gate passed: loudness, true peak,
check-audio. Nothing compares the delivered frame count to the input film.

**Root cause.** `mixFilter` fed the raw VO sum into `sidechaincompress` as the duck key.
That filter ends with its shortest input, so the bed stopped when the last narration
line did, and `-shortest` on the mux trimmed the video to match. Any film whose last
line ends before the picture does loses the tail.

**Fix.** The key is padded to the film length (`apad=whole_dur`) before the compressor;
`score-film.test.mjs` pins it. Postflop's shipped `film/film-v4-scored.mp4` has the same
defect (818 of 840 frames) and still needs `score-film --force`; probe its bed length
first, since a bed shorter than the film also cuts picture. Open: score-film should fail
when the delivered `nb_frames` differs from the input's.

**Lesson.** A gate that measures one property (loudness) says nothing about the others
(duration). Compare the deliverable to its source on every axis the pipeline can change.

## 2026-09-03 — Unreal feeder: seven silent wrong-output traps on the way to one frame

**Symptom.** Bringing UE 5.8.2 in as `feeders/unreal` took nine engine launches to
reach a lit frame. Six of the failures exited non-zero with a clear log line; three
exited 0 with a wrong picture, which is the dangerous kind.

**Root causes, in order hit.** Draft plugin names from an older release (engine
abort); Python list quoting doubling the `-script` quotes; the commandlet
C-unescaping `\u` in a path; an asset registry that keeps a deleted level; a
Blueprint-only actor factory returning None for meshes; MRQ's exclusive end frame
(exit 0, zero frames); no camera cut (exit 0, sixty black frames); a sun pointing
along +X with no sky or floor (exit 0, sixty black frames); a camera with zero pitch
looking over the subject (exit 0, subject cut off). All recorded in PLAYBOOK "Unreal
Engine 5.8".

**Fix.** Verify against the shipped headers and the real engine, one launch per
hypothesis, pixel stats on every "success" (`min/max/mean` per frame plus a centre
vs corner crop) before trusting exit 0.

**Lesson.** For a renderer, exit 0 plus N files is not a pass. The gate is the pixels.
Also: the wrong-disk pick (D:, a USB spinning disk) and the stale version pick (5.6)
both came from assumptions Wes had to correct; check `Get-PhysicalDisk` and the live
release page before naming either.

## 2026-09-03 — Retro of the Unreal day: what worked, what did not

**Worked, keep doing.** (1) Proving the load-bearing mechanism first: probe, then a cube,
then the look test, one hypothesis per engine launch, so every trap surfaced with a log
line. (2) Writing each verified trap into the PLAYBOOK the moment it was proven: the
second scene agent inherited 13 traps and hit only new ones. (3) Gating renders on pixel
stats, not exit codes: three of the day's failures were exit 0 with a wrong picture.
(4) Briefs with a VERIFIED GROUND TRUTH block: the fix agent used it to show that my
diagnosis (load_asset returned None) was wrong and the real bug was spawn_actor_from_object.
(5) Headers on disk over remembered API names once the engine existed.

**Did not work, and the change for each.**
- Two targets asserted from memory, both wrong, both caught by Wes: D: as the install
  disk (a USB spinning disk) and UE 5.6 (5.8.2 was current). Change: machine facts from
  Get-PhysicalDisk or df, versions from the live release page, before naming a target.
- The storyboard went out as a bare 3x2 tile of frames; Wes could not tell what he was
  looking at. Change: approval artifacts are annotated pages (now a CLAUDE.md rule),
  rendered and read as a stranger before handoff.
- "It's in your panel": the send-file tool reaches the claude.ai session view, not the
  terminal Wes was in. Change: open deliverables locally in a terminal session.
- Spec numbers that were never measured (a 2000 cd agent light, plugin names from an
  older release) went into briefs as requirements and cost launches: the light was a
  brand-forbidden orange wash. Change: unmeasured numbers are labelled hypotheses in a
  brief; give the agent a measurable target (mean luminance band) instead.
- My own taste check passed the first hall frames as "strong" because they matched the
  spec, not because a stranger would say "server room". Change: judge frames with the
  stranger question, then the spec.
- The draft feeder written before the engine existed carried seven UNVERIFIED marks and
  two of its guesses (plugin names, quoting) cost a launch each. Acceptable trade for the
  install wait; the lesson is to test the guesses in the first launch, which is what
  happened.

**Rule.** Every gate ends with a retro; see CLAUDE.md and the global rule 7.

## 2026-09-03 — DashClaw story film (first Unreal-plated film): retro at the lock

**Worked.** Plates and the Remotion build ran in parallel because the film reads plates
by path with a placeholder; the director loop measured its three knobs off the raw
plates before the first render, so v1 was already calibrated and v2 passed. Frame count
was checked in vs out (1200/1200) after the score-film truncation of 2026-09-03.

**Did not work, and the change.**
- The wide plate's 24 agent lights tinted rack faces amber, a wash the brand forbids,
  and judge-palette passed it because DashClaw's voice is prose and the judge only
  parses "never <color>" rules. Change: WIDE_CD 72 -> 30, WIDE_RADIUS 220 -> 160 and a
  re-render (warm-tinted pixels 0.21%). Open: judge-palette needs a "signal colour
  coverage cap" rule for brands where the accent is allowed but never a wash.
- The last narration line started 2.6 s before the lockup. Change: line start moved
  in the audio builder to 35.0 s, never the picture.
- check-audio FAILs 22 stale DashClaw surfaces (the July postkit and launch-final)
  that predate the audio rule. The new film passes; the old postkit was not rebuilt
  because build-postkit and render-matrix still key off LaunchVideo, not
  `<Brand>Film` (open since postflop). Until that wiring lands, a bespoke film's
  postkit cannot be generated from the film.
- Kit debt, second occurrence: postflop and dashclaw both carry their own Cursor
  because StageCursor's click bloom is an accent wash; PngSequence has no start
  index so the film carries its own Plate. Both belong in components/.

## 2026-09-03 — Wes watched the DashClaw film: "audio is shit, graphics are dogshit, story is horrible"

**Symptom.** Every mechanical gate passed (tsc, judge-motion, judge-palette, judge-drift,
check-audio, verify-cue, frame counts) and the film is bad. Nobody on the pipeline
watched it with sound before it was called done; the coordinator judged stills, contact
sheets and LUFS numbers.

**Root cause.** The gates measure properties (loudness, palette, motion tokens, pixel
bands), not quality. The creative calls that decide quality were all defaults chosen for
survivability, not for the film: primitives-only geometry (reads as a tech demo), a
premade TTS voice with no direction, a generated ambient bed, 74 words of narration over
a light orb in a box corridor, a 40 s runtime carried by one metaphor. The direction
template's "survive a bad day" question was answered by lowering ambition until nothing
could fail, which is the same as nothing being good.

**Fix (the one change).** A film is not done until the coordinator has WATCHED it with
sound, at full length, and written a verdict as a viewer ("would I share this?") before
any gate is run. The gates come after taste, never instead of it. A weak verdict stops
the pipeline at the cheapest point: the animatic (plates at half scale + scratch VO) is
the gate, not the scored master.

**Lesson.** A pipeline that can only measure what it can measure will confidently ship
something nobody wants. The judges are necessary and not sufficient; the viewer test is
the one that matters, and it costs 40 seconds.

## 2026-09-04 — Truckside /marketing run: the dissenter earned its seat, the captioned-vertical trap recurred

**What worked.** The copy council's MANDATORY DISSENTER caught a gate-accuracy overclaim
the other two judges and the main loop missed. The brief said "nothing reaches a customer
or moves money without your tap" — false for Truckside, whose reception agent answers a
live call and books an appointment window autonomously. Verified against product source
(`src/lib/agents/quote.ts` "Approving is the owner's send gate", `notify.ts` LIVE_MODE
gate): only SENDS and money moves are gated; the call and its booking are not. Rescoped
everywhere to "nothing is sent to a customer and no money moves without your tap." A
two-of-three-judges rule would have let this ship (only the dissenter flagged it); the
adversarial seat is not decoration.

**What did not.** The postkit's captioned vertical SOCIAL rows failed check-audio and
carried a layout collision — the SAME class of bug the postflop retro (2026-09-01) already
logged as "tiktok/shorts/instagram rows had no track." Two failures compounded:
`render-matrix` renders SocialClip rows with a SILENT audio stream by design, and its
`-captioned` variant burns the launch hook-VO caption OVER the SocialClip's own headline +
benefit lines (both unreadable at the overlap). The postkit maps tiktok/shorts/instagram
straight at those `-captioned` rows, so it shipped silent, colliding verticals until
check-audio (run again after postkit, correctly) caught the silence and a frame read caught
the collision.

**Fix applied this run (manual).** Mastered the `launch-16x9` matrix row (it renders with
audio but unmastered at -24.3 LUFS). For the verticals, muxed the matching social clip's
mastered audio onto the NON-captioned vertical video (readable lines, no collision) and
overwrote the postkit files. check-audio then passed 11/11.

**The one change (for the engine, next run).** SocialClip captioned matrix rows are a trap
for text-heavy clips: the burned VO caption collides with the clip's own lines and the row
is silent. Either (a) `render-matrix` should score the vertical social rows (bed + the
matching VO line, mastered) the way `score-social-clip` does the 16:9, and skip burning a
second caption layer on a clip that already carries text, or (b) `build-postkit` should
point tiktok/shorts/instagram at the non-captioned vertical social muxed with the scored
audio, never the `-captioned` SocialClip row. Until one lands, the post-postkit check-audio
gate plus a frame read on one captioned vertical is the manual guard.

**Also.** The launch demo act (33 s telemetry) tripped judge-demo-pacing's dead-air FAIL:
the final Outbox beat holds ~4 s frozen because the capture's last `focusOn` has a 4 s
`waitForTimeout` with no motion after it. Left as a deliberate end-hold on the "nothing
leaves" payoff rather than re-capture (the fix cascades into demo + launch silent + launch
scored + audio re-renders). Cheap future fix: shorten only the LAST beat's hold in
`record-truckside-demo.mjs`, or add a tiny final scroll so the tail is not literally static.

---

## Truckside light-theme media refresh (2026-09-05)

**What worked.** OKLCH -> sRGB via Ottosson math gave exact hex from the product's
globals.css; the Blender logo scene reads brand hex from the JSON so the new green
re-rendered with no scene edit; regenerating only the MUSIC bed to the new 76.4 s total
(VO reused) killed the silent-tail failure mode (judge-audio trailing 0.65 s, PASS).

**What did not (the load-bearing gotcha).** Re-rendering LaunchVideo WITH the audio
manifest (the canonical template soundtrack path, Recipe A) crashed the Remotion
compositor intermittently: `Could not extract frame from compositor: Request closed` ->
`No frame found at position N for ...demo source`, at a DIFFERENT frame each attempt
(1018, 614, 707), with both a webm and an h264 demo source. The silent lock render (same
composition, no audio) succeeded every time. So it is the audio+video decode load, not a
seek bug or a bad frame. Three ~5-minute renders were lost chasing webm-seek theories.

**Fix applied this run.** Scored the SILENT launch lock with `score-film.mjs` instead:
added `scripts/build-truckside-film-audio.mjs`, which places each VO line at the exact
frame `audioMix.ts` uses (`act.from + VO_LEAD`, VO_LEAD=12) and derives sfx cue frames
from `sfxCues.ts`. score-film muxes bed+VO+sfx onto the lock, masters to -14, verifies.
judge-audio 7/7 and judge-av-sync PASS, so the mux is timing-identical to the embedded
path. Matrix launch rows reused `launch-final.mp4` (re-encoded to the 8 MB web budget) +
stills, avoiding the same crash.

**The one change (for the engine, next run).** A LaunchVideo template film whose demo act
is a real captured video should be scored by muxing onto the silent lock, NOT by an
audio-embedded re-render — the compositor crash is reproducible under load. Either teach
the audio-track Recipe A to prefer the score-film mux when the film has a video demo act,
or set `--concurrency=1` on the audio-embedded re-render (render-matrix already retries
launch rows at concurrency=1 for this reason). Until then: silent lock + build-<brand>-
film-audio + score-film is the reliable path.

**Also (product-side, redesign drift).** The redesigned truckside `/demo` route now mints
a READ-ONLY demo session (no Simulate button, static fixture); film the OWNER dashboard
via `/api/login` with a passcode set in the server env (never read `.env`). Section header
renamed "Follow-ups due" -> "Follow-ups"; capture selectors updated. cropdetect finds no
crop on an off-white composite, so hero crops come from the raw dashboard capture.
