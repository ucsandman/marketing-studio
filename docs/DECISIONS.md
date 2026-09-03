# Decisions

Durable architecture and product decisions for the marketing studio. One entry per
decision, newest first. Gotchas and lessons go to ERRORS.md; operating reference to
PLAYBOOK.md.

## 2026-09-03 — Agent sessions are scripted compositions, and the terminal keeps its own palette

**Decision.** A "watch the agent work" scene is the `AgentSession` composition: a
frame-pure Claude Code terminal driven by a beats array, never a screen capture. The
UI kit and typing helper are vendored from flocker-md/skills (MIT) under
`studio/src/components/agent-session/`. The terminal's Tokyo Night + terracotta palette
is the one allowed home for literal hex outside `brands/*.json`, because it is a third
party product's own UI, like a capture plate. Brand tokens colour everything around and
inside it that carries meaning: page ground, success (safe), the human hold (loss), the
MCP server prefix (info, since the brand reserves green for done).

**Why.** offlocalhost.com's pitch is two commands in Claude Code and its only demo was
the output film. A capture would drift with every Claude Code release and could not be
diffed; a scripted session is copy in a props builder, gated by lint-copy, re-rendered
in a minute. Tool names on screen are real (`offlocal` preflight_launch and
check_domain_availability) by rule 5 of the vendored skill.

**Consequences.** New brands need their fonts registered in `lib/fonts.ts` before any
render (offlocalhost's IBM Plex was missing until this). `sessionTiming.ts` owns both
the duration math and the transcript layout model, since scroll offsets are a function
of accumulated height.

## 2026-09-02 — One marketing repo: launch-engine folds in as launch/

**Decision.** This repo is the single marketing repo. The standalone launch-engine
repo is folded in as the `launch/` sub-package (`@marketing-studio/launch`) and frozen
at its old path with a MOVED.md. gtm-engine (Practical Systems) and offlocalai-mcp stay
separate: the first is a Postgres/Redis worker with a different runtime and its own UI,
the second is the deliberate credential boundary for infrastructure spend. The frozen
`C:\Projects\marketing` archive is a snapshot of gtm-engine; its three unique files
(gtm decision log, x402 outreach kit, dashboard a11y tests) were carried into `docs/`
and `reference/`. `/launch` now installs the gated CLI skill; the studio's announce
flow is `/announce`.

**Why.** A 199-agent review found five repos overlapping on intake, copy limits,
publishing, operator consoles, launch skills and post ledgers, with launch-engine and
this repo the genuine duplicate pair. This repo was the only actively developed one
with CI and the render engine nothing else has; launch-engine had the only real
per-network publishers and media pre-flight. The installed `/launch` skill was the
studio's copy, so the gated CLI version never ran from other repos.

**Consequences.** Five fixes landed on the way in: `launch post` is dry-run by default
with `--live`; the ledger write is atomic and `--force` supersedes instead of
duplicating; Bluesky and YouTube are providers behind the same contract as X and
LinkedIn; the offlocal seam calls `create_launch` and sends `to[]` plus `environment`;
the MCP tool inventory is generated from offlocal's real registry. Still open:
Mission Control's approve/redo loop into the guarded launch server, one post ledger
instead of `posts.json` plus `ledger.json`, and the per-brand `build-*`/`render-*`
scripts, which are brand data modules imported by generic scripts and need a brand
registry before they can go.

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

## 2026-09-03 — Story first: Unreal Engine joins the feeder set

**Decision.** Marketing films are stories (a protagonist, a problem, a turn), not
feature tours, and the studio takes on the tools a story needs. Unreal Engine 5.8.2
is installed on the C: NVMe (`C:\Program Files\Epic Games\UE_5.8`, the D: drive is a
USB spinning disk and never hosts anything Unreal reads at runtime) and enters the
repo as `feeders/unreal/`, on the Blender feeder's contract: a Python scene script,
a headless run, `frame_%04d.png` out, Remotion composites on top. The first film
that pays for the setup is a DashClaw story with Unreal plates.

**Why.** Wes overruled the "spike it when a film needs it" recommendation on
2026-09-03: the point of the studio is telling a story, and the SaaS-UI framing of
every brand is what kept the films reading as demos. Unreal brings places,
characters (MetaHuman) and a camera you can fly; nothing in the Blender/capture/comfy
set does. It is scripted through its Python API and the editor commandlet, so the
feeder needs no computer use.

**Consequences.** `UNREAL_PATH` joins `.env.example`. The load-bearing step, a
headless Movie Render Queue render from a script, is proven before any film work.
Legendary (open-source Epic CLI) is installed and logged in for later scripted
engine and Fab pulls; the engine itself needed the launcher once because the UE
entitlement is granted only by accepting the EULA there.
