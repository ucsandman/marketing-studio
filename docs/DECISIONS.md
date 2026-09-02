# Decisions

Durable architecture and product decisions for the marketing studio. One entry per
decision, newest first. Gotchas and lessons go to ERRORS.md; operating reference to
PLAYBOOK.md.

## 2026-09-01 — Launch films are bespoke compositions, and audio is part of done

**Decision.** A launch film is written per brand as a bespoke Remotion composition
at `studio/src/films/<brand>/` (timeline + ui kit + one component per shot), with
every product shot rebuilt as native UI. The five-act LaunchVideo template is the
fallback, not the default. Every delivered film carries a mastered soundtrack with
narration; `scripts/check-audio.mjs` gates delivery.

**Why.** Compared against a reference film (x.com/chddaniel/status/2094883770164015174)
the template output read as a narrated slideshow: raw screen capture, a screenshot
panel, captions, 77s. The template's byte-identical guarantees and nullable-prop
defaults protect repeatability across brands, which is exactly the property that
gives every brand the same film. The Phase C kit (CameraRig, StageCursor,
StagedScene) had been built on 2026-08-09 and never used by any props file. The
bespoke PostflopFilm (28s, 8 shots) was built and scored the same day; the director
judge scored likeness 7.5/10 on v2 against the reference before the fix pass.

**Consequences.** The launch-video skill now specifies a film-spec + shot build +
score pipeline; render-matrix and postkit still key off the LaunchVideo id and need
wiring to `<Brand>Film` (open). Music-only is a recorded exception via
`score-film --music-only`, never a default.
