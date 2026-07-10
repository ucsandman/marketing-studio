# Marketing Studio

An agent-driven marketing studio for Claude Code. You type `/marketing` in your product's repo; the agent onboards your brand, films your app, renders a full marketing asset suite in this engine, and copies the finished files back to you.

![Animated OG loop rendered by the studio](examples/paperroute/readme.gif)

*An animated OG loop the studio rendered for a real product, from brand tokens alone. More in [`examples/`](examples/).*

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

The order is deliberate: the cheapest composition renders first so brand-token bugs surface before the expensive assets, the demo is filmed once and its footage feeds everything downstream, and audio is scored only after the launch video is picture-locked. The run keeps a manifest on disk, so a died session resumes where it stopped instead of starting over.

Around those assets, the pipeline adds:

- **A derived content brief.** The agent reads your product repo (README, routes, landing page) and synthesizes the story — hooks, ranked benefit-led features, per-act narration, per-platform copy — into a validated `brief.json` that every builder consumes. You approve the whole story on a storyboard page before anything renders.
- **A copy linter.** Every generated line is gated for em dashes, hype, and AI-slop vocabulary before it can reach a render.
- **A film grade and per-brand motion personality.** Grain, vignette, and bloom tuned per brand, and a `motion` token block so each brand's choreography feels like itself.
- **An export matrix.** The picture-locked launch video and social clips fan into 16:9, 9:16, 1:1, and 4:5 through responsive layout (not crops), with burned-caption variants for muted autoplay and SRT/VTT sidecars.
- **Mission Control.** A local click-to-approve gallery: watch assets land, review act-boundary contact sheets before the expensive render, approve or request a redo with a note, and the run reacts — no terminal required.
- **Designed sound.** Whooshes on act cuts, ticks on feature reveals, and a riser into the CTA, generated once as a shared SFX library and mixed under the voiceover automatically.
- **Paste-ready post kits and a footage cache.** Every platform gets a folder with the right-aspect video, a lint-gated caption, alt text, and a posting checklist; unchanged product UIs are never re-filmed thanks to content-hash caching of capture and Blender staging.

Each asset also works standalone: run `/logo-reveal`, `/product-demo`, `/launch-video`, `/audio-track`, `/social-clip`, or `/og-assets` on its own from any repo.

## Example output

Everything below was produced by `/marketing` runs against two real products, unedited. Turn the sound on: the voiceover and music are generated too.

### noban.gg (CS2 skin arbitrage dashboard)

https://github.com/user-attachments/assets/7d184b12-1afc-4129-a4f0-87a33da986e3

| File | Asset |
|------|-------|
| [`launch.mp4`](examples/noban/launch.mp4) | 60s launch video with generated voiceover and music |
| [`demo.mp4`](examples/noban/demo.mp4) | Product demo with measured camera zooms ([preview still](examples/noban/demo-still.png)) |
| [`logo-reveal.mp4`](examples/noban/logo-reveal.mp4) | Blender draw-on logo reveal |
| [`social-launch.mp4`](examples/noban/social-launch.mp4) | X/LinkedIn announcement clip |
| [`og.mp4`](examples/noban/og.mp4) | Animated OG loop |

### paperroute.gg (wallpaper ad network)

https://github.com/user-attachments/assets/1bf89936-4f8b-405a-b507-5f051ae18ef8

| File | Asset |
|------|-------|
| [`launch.mp4`](examples/paperroute/launch.mp4) | Launch video with audio |
| [`demo.mp4`](examples/paperroute/demo.mp4) | Product demo |
| [`logo-reveal.mp4`](examples/paperroute/logo-reveal.mp4) | Blender logo reveal |
| [`social-x.mp4`](examples/paperroute/social-x.mp4), [`social-linkedin.mp4`](examples/paperroute/social-linkedin.mp4), [`social-vertical.mp4`](examples/paperroute/social-vertical.mp4) | Per-platform social clips |
| [`og.png`](examples/paperroute/og.png), [`og.gif`](examples/paperroute/og.gif), [`og.mp4`](examples/paperroute/og.mp4) | OG image, loop, and video |
| [`readme.gif`](examples/paperroute/readme.gif) | README-sized GIF (the one at the top of this page) |

## How it works

- **One engine, many brands.** All rendering happens in this repo, never in your product's repo. Finished assets are copied out at the end.
- **Remotion is the backbone.** Every final video renders through Remotion compositions in `studio/` (SocialClip, ProductDemo, LogoReveal, LaunchVideo, AnimatedOG).
- **Brands are data.** `brands/<id>.json` holds your product's tokens (13 colors, 3 fonts, tagline, voice rules), zod-validated. Templates resolve `getBrand(brandId)` and never hardcode brand values, so a new product is a JSON file and a logo mark component, not a fork.
- **Feeders produce raw material.** Playwright records your running app for demos, headless Blender renders 3D logo reveals, ElevenLabs generates voiceover and music, and ComfyUI can add AI backdrops. Every feeder degrades cleanly when its dependency is missing.
- **The knowledge lives in the skills.** The `skills/` directory ships the Claude Code skills that operate this repo, including the hard-won gotchas in `docs/PLAYBOOK.md` (camera math, seamless-loop rules, Blender API traps) so the agent does not re-derive them.

## Quick start

Requirements: [Claude Code](https://claude.com/claude-code), Node 20+, Python 3.10+. Optional: Blender (3D logo reveals), an ElevenLabs API key (audio), ComfyUI (AI backdrops); everything falls back cleanly without them.

```bash
git clone git@github.com:ucsandman/marketing-studio.git
cd marketing-studio
cd studio && npm install && cd ..
cp .env.example .env            # set BLENDER_PATH / ELEVENLABS_API_KEY if you have them
node scripts/install-skills.mjs # installs /marketing and friends into ~/.claude/skills
python launch.py --check        # verifies the toolchain
```

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
| `/launch` | Announcement drafts per channel (X, LinkedIn, Show HN, email) with approval gates |

`scripts/install-skills.mjs` copies all of them into `~/.claude/skills` and rewrites the engine path to wherever you cloned this repo. It never overwrites a skill you have symlinked. Two optional plugins deepen the UI-polish phase if you have them (`impeccable` and `frontend-design`); without them the pipeline films your app as-is.

## Repo layout

```
brands/            per-product brand tokens (zod-validated JSON)
studio/            Remotion project: all final video compositions
feeders/blender/   headless bpy scenes (3D logo reveals)
feeders/capture/   Playwright recorder (product demos)
feeders/audio/     ElevenLabs client (voiceover + music)
feeders/comfy/     ComfyUI client (optional AI backdrops)
skills/            the Claude Code skills that drive all of this
examples/          real output: full asset suites for two shipped products
scripts/           props builders, staging, statics, smoke, copy linter, brief
                   gatherer, storyboard board, export matrix, captions, thumbs,
                   post kit, contact sheets, footage cache, SFX library,
                   Mission Control review server
props/             generated render props (edit via their builder scripts only)
docs/PLAYBOOK.md   the operational reference: engine map, onboarding, gotchas
launch.py          single-command health check + Remotion Studio
```

`out/`, `assets/`, and `studio/public/*/` are build products and stay untracked.

## Manual controls

Everything the skills do can be run by hand:

```bash
python launch.py                    # health checks + Remotion Studio
node scripts/smoke.mjs              # frame-0 still of every composition
cd studio && npx remotion render LogoReveal ../out/<brand>/logo.mp4 \
  --props='{"brandId":"<brand>","cta":"..."}'
node scripts/lint-copy.mjs props/<brand>-launch.json   # no-slop copy gate
node scripts/render-matrix.mjs <brand> --stills-only   # 16:9/9:16/1:1/4:5 fan-out
node scripts/build-captions.mjs <brand> --check        # SRT/VTT sidecars
node scripts/mission-control.mjs <brand>               # click-to-approve run console
```

`docs/PLAYBOOK.md` has the full engine map: every feeder, builder script, and render command, plus the verified gotchas.

## Adding a brand

1. `brands/<id>.json` copying the shape of an existing brand (colors, fonts, tagline, voice rules).
2. Register it in `studio/src/lib/brand.ts` and add a mark component in `studio/src/brands/`.
3. `cd studio && npm test` validates the schema.

The `/marketing` skill does all of this for you from your product repo's design system; the steps above are the manual path. Details in `docs/PLAYBOOK.md`.

## Verification

```bash
python launch.py --check   # toolchain health
node scripts/smoke.mjs     # renders frame 0 of every composition; must stay green
cd studio && npm test      # brand schema tests
```

Every asset prop is nullable with a placeholder, so the smoke test passes on a clean clone with no captures, no Blender, and no API keys.

## License

MIT
