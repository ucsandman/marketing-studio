# Marketing Studio

[![verify](https://github.com/ucsandman/marketing-studio/actions/workflows/verify.yml/badge.svg)](https://github.com/ucsandman/marketing-studio/actions/workflows/verify.yml)

An agent-driven marketing studio for Claude Code. You type `/marketing` in your product's repo; the agent onboards your brand, films your app, and writes the complete asset suite and its review evidence into that product repo. Then `/launch` takes the product public: domain, payments, comms, and posting to X, LinkedIn, Facebook, Reddit, Bluesky and YouTube with the rendered videos attached, dry-run by default.

## The one command

```
/marketing
```

One run produces, in order:

| # | Asset | Skill behind it |
|---|-------|-----------------|
| 1 | Logo reveal (Blender + Remotion) | `/logo-reveal` |
| 2 | Product demo with camera zooms and cursor (Playwright capture) | `/product-demo` |
| 3 | 30 to 90 second launch video composing demo, logo, and copy | `/launch-video` |
| 4 | Voiceover and music scored to the launch video (ElevenLabs) | `/audio-track` |
| 5 | Social clips per platform (X, LinkedIn, TikTok) | `/social-clip` |
| 6 | OG image, animated OG loop, README GIF | `/og-assets` |

The order is deliberate: the cheapest composition renders first so brand-token bugs surface before the expensive assets, and the demo is filmed once so its footage can feed downstream work. Audio starts during direction with a scratch voice/music animatic; the final mix is scored against the approved picture. The run keeps a manifest on disk, so a died session resumes where it stopped instead of starting over.

Around those assets, the pipeline adds:

- **A derived content brief.** The agent reads your product repo (README, routes, landing page) and synthesizes the story — hooks, ranked benefit-led features, per-act narration, per-platform copy — into a validated `brief.json` that every builder consumes. You approve the whole story on a storyboard page before anything renders.
- **A copy linter.** Every generated line is gated for em dashes, hype, and AI-slop vocabulary before it can reach a render.
- **A film grade and per-brand motion personality.** Grain, vignette, and bloom tuned per brand, and a `motion` token block so each brand's choreography feels like itself. Grain size is stated at 1080p and scaled by frame height, so an asset carries the same visual grain at 4K. Optional `halation` blooms wherever the frame is *actually* bright rather than glowing a fixed spot, which is the difference between footage that reads photographed and a flat vector comp.
- **An export matrix.** The picture-locked launch video and social clips fan into 16:9, 9:16, 1:1, and 4:5 through responsive layout (not crops), with burned-caption variants for muted autoplay and SRT/VTT sidecars.
- **Mission Control.** A local click-to-approve gallery: watch assets land, review act-boundary contact sheets before the expensive render, approve or request a redo with a note, and the run reacts — no terminal required.
- **Designed sound.** Explicit shot events can request sparse ticks, transitions, or a CTA rise from the shared SFX library. Cuts do not receive automatic whooshes.
- **Word-locked sync.** Voiceover lines carry word-level timestamps; when they do, act lengths derive from the measured voice and reveals land on the words that name them, with `judge-av-sync` verifying every cue against the timings. Wordless manifests render exactly as before.
- **A mastered mix.** Final renders pass a two-pass loudness master to -14 LUFS with a true-peak ceiling, measured in the delivered file rather than trusted from the filter graph, plus SFX asset leveling and per-cue audibility proof.
- **A direction pass.** Finite presets help explore alternatives, but they do not guarantee originality or a fixed number of useful directions. The chosen direction records the product-specific metaphor, references, sound intent, and iteration history.
- **A set judge, not just file judges.** Seven mechanical gates run before any human looks: motion craft, palette, A/V sync, demo dead air, size budgets, audio presence (`check-audio`: every delivered film carries a mastered track with narration), and `judge-drift`, which scores the whole output directory *as a set*. That last one catches the failure no per-file gate can see — assets that are each individually on-brand but collectively fragment into three or four different-looking brands. It emits a worst-first review grid, because attention is reliable over about six tiles, not twenty.
- **Paste-ready post kits and a footage cache.** Every platform gets a folder with the right-aspect video, a lint-gated caption, alt text, and a posting checklist; the kit root also carries `manifest.json`, a machine-readable index that the `launch/` CLI reads to auto-attach videos to X, LinkedIn, Bluesky and YouTube posts, plus `LICENCES.md` and `DISCLOSURE.md` — what is synthetic, which platform toggle to set at upload, and which obligations the kit does *not* yet cover. Unchanged product UIs are never re-filmed thanks to content-hash caching of capture and Blender staging.

Each asset also works standalone: run `/logo-reveal`, `/product-demo`, `/launch-video`, `/audio-track`, `/social-clip`, or `/og-assets` on its own from any repo.

`/ship-it` chains the two halves: `/marketing` renders the suite, then `/launch` posts it with the videos attached, through the same approval gates.

## Proof and review

Every run keeps its media beside the product that owns it under
`marketing/assets/<brand>/`. Mission Control shows the full film, shot samples, and
review controls from that workspace. A deliverable production run hashes its
direction, shot plan, every routed props source including caption/audio-bearing
variants, canonical staged-public inventory, final render, samples, and review.
Review identity is a local operator attestation, not authenticated identity. Live
publishing revalidates the current bytes and production verdict before upload. The
current four-shot, 782-frame proof has 12 measured samples and zero failures, but
remains incomplete on nine human stage/full-film checks; it is not an agency-quality
claim. See [Production quality](docs/production-quality.md) for the acceptance
contract and [the playbook](docs/PLAYBOOK.md) for the exact commands.

## How it works

- **One engine, many brands.** Reusable rendering source lives here; every run writes its generated inputs, evidence, renders, and delivery assets into the product repo under `marketing/assets/<brand>/`.
- **Remotion is the backbone.** Every final video renders through Remotion compositions in `studio/` (SocialClip, ProductDemo, LogoReveal, LaunchVideo, AnimatedOG, AgentSession for a scripted Claude Code terminal).
- **Brands are data.** `brands/<id>.json` holds your product's tokens (13 colors, 3 fonts, tagline, voice rules), zod-validated. Templates resolve `getBrand(brandId)` and never hardcode brand values, so a new product is a JSON file and a logo mark component, not a fork.
- **Feeders produce raw material.** Playwright records your running app for demos, headless Blender renders 3D plates, ElevenLabs generates voiceover and music, and ComfyUI can add AI backdrops. Missing required tools produce clear errors; only routes with an explicit documented fallback continue without them.
- **The knowledge lives in the skills.** The `skills/` directory ships the Claude Code skills that operate this repo, including the hard-won gotchas in `docs/PLAYBOOK.md` (camera math, seamless-loop rules, Blender API traps) so the agent does not re-derive them.

The creative acceptance contract, product-owned workspace, baseline evidence, and strict production gate are documented in [Production quality](docs/production-quality.md).

## Requirements

Required: [Claude Code](https://claude.com/claude-code), Node 22+ for the studio and Node 24+ for `launch/` (the versions CI exercises), Python 3.10+, and **ffmpeg on your PATH** (26 scripts shell out to `ffmpeg`/`ffprobe` directly).

Optional: Blender for 3D plates, an ElevenLabs API key for voiceover and music, and ComfyUI for AI backdrops. A workflow must select an explicit fallback before treating any missing optional tool as non-blocking.

**Remotion licence.** Every final video renders through [Remotion](https://www.remotion.dev/), which is free for individuals and for companies of three people or fewer. Larger companies need a Remotion company licence. That is Remotion's term, separate from this repo's MIT licence.

## Install

### As a plugin

```
/plugin marketplace add ucsandman/marketing-studio
/plugin install marketing-studio@ucsandman
```

Plugin skills are namespaced, so the commands are `/marketing-studio:marketing`, `/marketing-studio:logo-reveal`, and so on.

The current plugin version is **2.0.0**. Migrating from 1.x requires a product
repository for every production run: pass `--project <product-repo>` (or invoke a
supported tool from that product worktree). Generated inputs and outputs no longer
default to the installed engine or its legacy `out/` tree.

The engine ships with the plugin, but its npm dependencies do not. Bootstrap once by asking Claude to *"bootstrap the marketing studio engine"*, or run it yourself against the installed plugin directory:

```bash
python <plugin-dir>/launch.py --bootstrap
```

That installs the studio and capture-feeder dependencies and then prints a toolchain report. Copy `.env.example` to `.env` in the same directory if you have a Blender path or an ElevenLabs key.

### From source

```bash
git clone git@github.com:ucsandman/marketing-studio.git
cd marketing-studio
python launch.py --bootstrap    # installs npm deps, then verifies the toolchain
cp .env.example .env            # set BLENDER_PATH / ELEVENLABS_API_KEY if you have them
node scripts/install-skills.mjs # installs /marketing and friends into ~/.claude/skills
```

Installing from source gives you unnamespaced commands (`/marketing` rather than `/marketing-studio:marketing`). Renderer source stays in the clone; production inputs and outputs still belong to the selected product repository. Use this path if you intend to work on the engine itself.

Then, from your product's repo:

```bash
claude
> /marketing
```

The agent asks one batched round of questions (brand, destination, audio, platforms, checkpoint mode) and runs the whole pipeline. If your brand is new, it derives tokens from your repo's design system (DESIGN.md, Tailwind config, CSS variables) and only asks for what it cannot infer.

## The skills

| Skill | What it does |
|-------|--------------|
| `/marketing` | The full pipeline: sequencing, gates, run manifest, resume, final QA and delivery gallery |
| `/logo-reveal` | Animated logo reveal video (Blender draw-on choreography composited in Remotion) |
| `/product-demo` | Screen-Studio style demo: films your running app, adds measured camera zooms and cursor |
| `/launch-video` | Hero announcement video composing demo footage, logo reveal, and copy |
| `/audio-track` | Voiceover and music for any video, or standalone audio |
| `/social-clip` | Short feature clips sized per platform |
| `/og-assets` | OG image, animated OG loop, README GIF, social cards |
| `marketing-studio` | Shared background skill: engine workflow, brand onboarding, non-negotiables |

The pipeline's supporting skills ship too, so nothing in the run dangles:

| Skill | What it does |
|-------|--------------|
| `/polish` | Final UI quality pass (alignment, spacing, states, micro-detail) before the demo is filmed |
| `/frontend-verify` | Headless route verification: console errors, failed requests, text assertions |
| `/de-vibe` | Removes the AI-generated fingerprint (security tells, slop copy, generic defaults) before anything ships |
| `/ship` | Verify, docs, secrets scan, commit, push ritual |
| `/ship-it` | `/marketing` then `/launch` in one run: render the suite, post it with the videos attached |
| `/announce` | Announcement drafts per channel (X, LinkedIn, Show HN, email) with approval gates |
| `/launch` | The launch engine end to end: domain, payments, comms, multi-platform posting (dry-run by default, `--live` to post) |

Installing the plugin ships all of them, namespaced under `marketing-studio:`. For a source checkout, `scripts/install-skills.mjs` copies them into `~/.claude/skills` unnamespaced and rewrites the engine path to wherever you cloned this repo; it never overwrites a skill you have symlinked. Two optional plugins deepen the UI-polish phase if you have them (`impeccable` and `frontend-design`); without them the pipeline films your app as-is.

## Repo layout

```
.claude-plugin/    plugin + marketplace manifests (this repo installs as a plugin)
brands/            per-product brand tokens (zod-validated JSON)
studio/            Remotion project: all final video compositions
feeders/blender/   headless bpy scenes (3D logo reveals)
feeders/unreal/    headless Unreal Engine 5.8 scenes (story worlds, camera moves; Movie Render Queue)
feeders/capture/   Playwright recorder (product demos)
feeders/audio/     ElevenLabs client (voiceover + music)
feeders/comfy/     ComfyUI client (optional AI backdrops)
skills/            the Claude Code skills that drive all of this (rendering and launch)
launch/            distribution layer: the launch CLI + guarded dashboard (own package)
scripts/           props builders, staging, statics, smoke, copy linter, brief
                   gatherer, storyboard board, export matrix, captions, thumbs,
                   post kit, contact sheets, footage cache, SFX library,
                   Mission Control review server
docs/PLAYBOOK.md   the operational reference: engine map, onboarding, gotchas
docs/DECISIONS.md  durable architecture decisions, newest first
reference/         read-only reference material carried in from retired repos
launch.py          single-command health check + Remotion Studio
```

Engine-local `out/`, `assets/`, `props/`, `examples/`, and
`studio/public/*/` are not product-run destinations. Generated product assets belong
under the product repo's `marketing/assets/<brand>/` workspace.

## Manual controls

Everything the skills do can be run by hand:

```bash
python launch.py                    # health checks + Remotion Studio
node scripts/smoke.mjs              # frame-0 still of every composition
node scripts/build-launch-props.mjs <brand> --project <product>
node scripts/lint-copy.mjs <product>/marketing/assets/<brand>/props/<brand>-launch.json
node scripts/render-matrix.mjs <brand> --project <product> --production --stills-only
node scripts/build-captions.mjs <brand> --project <product> --check
node scripts/mission-control.mjs <brand> --project <product>
node scripts/master-audio.mjs <product>/marketing/assets/<brand>/launch.mp4 --project <product>
node scripts/verify-cue.mjs <product>/marketing/assets/<brand>/launch.mp4 2 1.5
node scripts/judge-motion.mjs <brand>                  # motion-craft + motion/grade token bands
node scripts/judge-drift.mjs <brand> --project <product>
node scripts/build-postkit.mjs <brand> --project <product> --production
node launch/dist/index.js post <product-dir> --all      # preview every platform post with the kit attached (dry-run is the default)
node launch/dist/index.js post <product-dir> --all --live   # publish for real, through the ledger and media pre-flight
node scripts/publish-bluesky.mjs <brand> --project <product> --dry-run
node scripts/publish-youtube.mjs <brand> --project <product> --dry-run
node scripts/fetch-results.mjs <brand> --project <product>
```

`docs/PLAYBOOK.md` has the full engine map: every feeder, builder script, and render command, plus the verified gotchas.

## Adding a brand

1. `brands/<id>.json` copying the shape of an existing brand (colors, fonts, tagline, voice rules).
2. Register it in `studio/src/lib/brand.ts` and add a mark component in `studio/src/brands/`.
3. `cd studio && npm test` validates the schema.

Only `id`, `name`, `tagline`, `url`, `colors` (13), `fonts` (3) and `voice` are required. Other blocks are optional. Most retain legacy defaults; `progressTreatment` intentionally defaults to `none`, and only NoBan opts into the `cs2-wear` FloatBar treatment.

| Block | What it tunes |
|-------|---------------|
| `motion` | Choreography personality — `tempo`, `exuberance`, `stagger`, `overshoot`, `parallax`, `settle`, `textReveal`. Retunes every entrance without moving a rest position. |
| `grade` | The film pass — `grain`, `grainSize` (stated at 1080p, scaled by frame height), `halation` (highlight bloom that samples the frame), `vignette`, `bloom`, `aberration`, `letterbox`. |
| `effects` | `wash` and `glow` behind the mark. Brands whose rules forbid a hero wash set `wash: 0`. |
| `textAccent`, `progressTreatment`, `progressFill` | Colored text plus an optional progress treatment. `none` is the default; only NoBan selects `cs2-wear`. |
| `speechHint` | How the brand name is SPOKEN when that differs from how it is written. The transcriber cannot read a coined word it has never seen, so the audio judge primes it with this. |

`voice` is not decoration — it is parsed. `judge-palette` reads "never <color>" rules out of it and fails renders that violate them, so write the real constraints there.

Keep `grade` restrained. `judge-motion` warns above `grain` 0.4 and `halation` 0.35: past those, grain reads as compression noise and halation reads as a CSS glow rather than light scattering off film.

The `/marketing` skill does all of this for you from your product repo's design system; the steps above are the manual path. Details in `docs/PLAYBOOK.md`.

## Verification

```bash
python launch.py --check   # toolchain health
node scripts/smoke.mjs     # renders frame 0 of every composition; must stay green
cd studio && npm test      # brand schema, motion standards, timing libs
cd studio && npm run lint  # eslint + tsc
node --test scripts/*.test.mjs scripts/lib/*.test.mjs feeders/capture/*.test.mjs feeders/audio/*.test.mjs feeders/comfy/*.test.mjs
python -m unittest discover -s feeders -p 'test_workspace.py' -v
```

Every asset prop is nullable with a placeholder, so the smoke test passes on a clean clone with no captures, no Blender, and no API keys.

## launch/ (distribution layer)

`launch/` is the launch engine as a sub-package (`@marketing-studio/launch`), folded in from the standalone launch-engine repo on 2026-09-02. It takes a shipped product the rest of the way: `launch init` scans the product repo into `<product>/.launch/`, `launch research` and `launch copy` write per-platform briefs and drafts validated against each platform's hard limits, and `launch post` publishes to X, LinkedIn, Facebook, Reddit, Google Search Console, Bluesky and YouTube, with assisted flows for Hacker News and Product Hunt.

Safety is the default: `launch post` previews unless you pass `--live`, every post consults an idempotency ledger before any network call, videos are refused before upload when they exceed a platform's duration or size cap, and the local dashboard (`launch ui`) binds to 127.0.0.1 with a per-run token and a typed-domain confirmation for live publishing. Social keys come from `launch/.env` (template in `launch/.env.example`); infrastructure credentials (domain, Vercel, Stripe, Resend, Twilio, DNS) never enter this package and are reached only through the offlocal MCP server from the `/launch` skill.

It keeps its own toolchain (`cd launch && npm ci && npm run build && npm test`, Node 24), gated by the `launch` job in CI. Full docs: [launch/README.md](launch/README.md); provider setup guides in [launch/docs/](launch/docs/).

## License

MIT

## Support

If my tools save you time, you can support my work here:

[![Sponsor on GitHub](https://img.shields.io/badge/GitHub%20Sponsors-%E2%9D%A4-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ucsandman)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-%E2%98%95-ffdd00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/wes_sander)
