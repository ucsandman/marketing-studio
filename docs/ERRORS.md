# Errors and recurring failures

Short entries only: what failed, why, what fixed it, date. Nothing that belongs in
git history or the PLAYBOOK.

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
