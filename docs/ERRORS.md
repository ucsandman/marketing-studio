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
