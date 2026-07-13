# Magnetic wrap pipeline — phase 2 design (long-form → short-form)

Date: 2026-07-12
Status: approved direction. Implements phase 2 of
`2026-07-12-magnetic-integration-design.md`; phase 1 (portfolio suite) shipped
2026-07-12 (animations main 3f989a9, Magnetic main 5a21128).

## Problem

Long narrated product walkthroughs get rough-cut in Magnetic (silence removal,
Rough Cut, transcript edits), but turning the good moments into branded social
clips is manual. Neither repo covers the seam: Magnetic exports one flat MP4;
the animations studio has no way to know which moments matter or what was said.

## Decisions made

- **Pilot content: product walkthroughs** — first run is a narrated DashClaw
  walkthrough (richest existing brand kit). The round-trip (record → Magnetic
  rough-cut → markers → handoff export → wrapped clips reviewed by the user)
  is the phase's definition of done.
- **Segment selection: markers in Magnetic.** Human judgment stays in the
  editor, matching Magnetic's human-gate philosophy. No agent proposal in this
  phase (phase 2.5 candidate).
- **Magnetic side: a real "Marketing Handoff" export** (final-cut-pro repo is
  open for writes again). One click writes a self-contained handoff folder.
  Rejected alternatives: manifest-over-MCP (requires the app running with
  Agent Access on; export and manifest can drift) and a manifest-only menu
  item (two manual steps per handoff).
- **Animations side: new `WrapClip` composition family** (approach A).
  Rejected: adapting SocialClip (built for feature panels, not continuous
  source video; regression risk across three live brands) and pure-ffmpeg
  branding (abandons brand tokens, motion system, judges).

## Contract: the handoff folder

Written by Magnetic's Marketing Handoff export; consumed by
`scripts/build-wrap-props.mjs`. One folder per export:

```
<name>-handoff/
  video.mp4       # existing smart-render export path
  captions.srt    # existing caption sidecar path
  captions.vtt    #   "
  segments.json   # NEW — the manifest
```

`segments.json` (version 1, zod-validated on BOTH sides):

```json
{
  "version": 1,
  "video": "video.mp4",
  "captions": "captions.srt",
  "fps": 30,
  "exportedAt": "2026-07-12T20:00:00Z",
  "segments": [
    {"id": "guard-decisions", "title": "Guard decisions in one call",
     "startSec": 12.5, "endSec": 41.0}
  ]
}
```

All times are in the exported video's own timeline (post-Rough-Cut), so no
timecode remapping exists anywhere downstream. `id` is a slug of the title;
collisions get `-2`, `-3` suffixes deterministically.

### Marker convention (parsed at export, kernel untouched)

- A marker named `clip: <title>` starts a segment (any color; the name is the
  signal).
- The segment ends at the first of: the next marker named `end`, the next
  `clip:` marker, start + 90 s, or sequence end.
- Zero `clip:` markers → the Marketing Handoff export is disabled in the
  dialog with an explanatory hint (fail loud in UX, not in a log).
- Parsing lives in the export layer (`src/shared/` pure function beside the
  existing timeline helpers), unit-tested against marker orderings: paired,
  unterminated, overlapping starts, cap-hit, markers on removed ranges
  (invisible markers per `markerIsVisible` are excluded).

## Magnetic side (final-cut-pro repo)

- Export dialog gains a "Marketing Handoff" option beside the existing movie
  export: destination folder picker, then runs the existing smart-render
  export + existing SRT/VTT sidecar writers + the new segments.json emitter.
- New pure function `deriveSegments(sequence): Segment[]` implementing the
  marker convention; IPC handler zod-validates as all handlers do.
- No timeline-kernel changes; markers stay point markers.
- Tests: unit (deriveSegments orderings above), one E2E spec (build a
  sequence with markers via the `__test` bridge, run the handoff export,
  assert folder contents + segment math).
- Follows that repo's conventions (design tokens, dialog patterns per
  DESIGN.md; register the export in the shortcut overlay if it gets a key).

## Animations side (this repo)

- **`studio/src/templates/WrapClip.tsx`** — schema
  `{brandId, video, segment: {startSec, endSec, title}, captions:
  [{startSec, endSec, text}], cta, audio?}` — captions arrive as cue objects
  embedded in props (the builder parses and windows the SRT; comps do no
  file I/O): plays the handoff video windowed via `OffthreadVideo`
  startFrom/endAt (no pre-cutting); hook title from segment title (brand
  textReveal preset); burned captions in the brand's caption style; FloatBar progress; EndCard CTA from brief.json;
  music bed via the existing audio feeder ducked under source narration
  (audioMix constants); FilmGrade overlay. Registered in Root.tsx with
  nullable/placeholder props so smoke stays green on a clean clone.
- **`scripts/build-wrap-props.mjs <brand> <handoffDir>`** — validates
  segments.json (same zod schema, mirrored), windows the SRT per segment,
  emits `props/<brand>-wrap-<segmentId>.json` per segment (builder owns
  props; lint-copy gates every emitted file; segment titles are copy and go
  through the same gate).
- **`scripts/render-matrix.mjs` + `scripts/build-postkit.mjs`** learn
  WrapClip: each segment fans to 16:9/9:16/1:1/4:5 with captioned variants
  for muted-autoplay rows, thumbs, and postkit folders — same as
  LaunchVideo/SocialClip today.
- Judges (pacing, palette, motion) run as advisories on wrapped clips;
  budgets stay hard gates.

## Pilot / verification (definition of done)

1. Record a narrated DashClaw walkthrough (OBS or the capture feeder).
2. Rough-cut it in Magnetic; drop 2–3 `clip:` markers; Marketing Handoff
   export.
3. `node scripts/build-wrap-props.mjs dashclaw <handoffDir>` → lint clean.
4. Render one segment's stills (act boundaries), inspect, then full
   render-matrix fan-out + postkit.
5. User reviews the wrapped clips (exit criterion, per repo rule).
6. Suites green in both repos (Magnetic: typecheck/lint/test/e2e touched
   specs; animations: smoke, studio tests, budgets).

## Out of scope

Agent-proposed segments (phase 2.5), the phase 3 MCP review station,
posting/scheduling, multi-video handoffs, translation/caption styling beyond
the existing brand caption presets.
