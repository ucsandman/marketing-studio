---
name: marketing
description: Use when the user wants the complete marketing asset suite for a product in one run — "/marketing", "build all the marketing assets", "generate everything for the launch", "all the animations and brand assets for X". Not for a single asset (use that asset's own skill) and not for launch copywriting alone (use /launch).
---

# Marketing Mega-Pipeline

One command produces a product's full asset suite: brand onboarding, UI polish, logo reveal, product demo, launch video with audio, social clips, and OG assets. The individual asset skills own their recipes; this skill owns sequencing, gates, and run state.

**REQUIRED BACKGROUND:** marketing-studio (engine-repo workflow shape and non-negotiables). All PLAYBOOK rules apply.

## Resume check — before anything else

Glob `out/*/marketing/run.json` in the engine repo. If an incomplete run exists (any asset not `delivered`), this invocation is a RESUME: skip Phase 0, load the saved intake answers from the manifest, and continue at the first asset whose status is not `approved`/`delivered`. If several incomplete runs match, ask which one. Only a fresh run proceeds to Phase 0.

On resume, still run the Phase 1 environment checks (shared-repo guard + `launch.py --check` — the previous process died mid-flight), but skip brand onboarding and Phase 2 polish if the manifest marks them complete. Trust a `rendered`/`approved` status only after confirming its artifact actually exists on disk; missing or truncated artifact → demote that asset to `planned`.

## Phase 0 — Intake: ONE batched question round, then silence

Fresh runs only. Ask everything in a single AskUserQuestion, then run without asking again (exceptions: per-asset stills gates in gated mode, final delivery):

1. **Product/brand + destination** — which brand, and where finished assets land in the product repo (default: its existing media/marketing dir).
2. **UI polish before filming?** Default YES: the demo films the real running app, so rough edges get rendered at 60fps forever. YES = impeccable → polish → frontend-verify on the product repo before any capture. NO = film as-is. This edits product code, so it is always the user's call — never silently skip it AND never silently do it.
3. **Audio** — music only / music + voiceover / none.
4. **Social clips** — platforms and count (default: X + LinkedIn, one each).
5. **Checkpoint mode** — full-auto (self-check stills, user reviews the final gallery) or gated (user approves stills before each full render).

## Phase 1 — Foundation

1. Shared-repo guard + `python launch.py --check` (marketing-studio steps 0–1).
2. Brand: if `brands/<id>.json` is missing, onboard per PLAYBOOK. Brand-token judgment stays in the main loop — do not delegate it.
3. Create the run manifest `out/<brand>/marketing/run.json`. It stores BOTH the Phase 0 intake answers (brand, destination, polish flag, audio choice, social config, checkpoint mode) AND one entry per planned asset. Statuses mean exactly this:
   - `planned` — not rendered yet. Gated mode: user approves pre-render stills before the render starts (that is the ONLY user gate per asset).
   - `rendered` — artifact on disk, post-render frame check pending (extract 2–3 frames from the artifact and inspect them — self-check in both modes).
   - `approved` — frame check passed; approval is recorded in the manifest the moment it happens, never inferred from chat history. A resumed session redoes the frame check for any `rendered` asset, showing the frames to the user first in gated mode.
   - `delivered` — copied to the product repo.
   Update the manifest after every status change. Never restart a run from scratch because the session died.

**Content approval gate.** Once `out/<brand>/marketing/brief.json` is synthesized and passes `node scripts/lint-copy.mjs`, run `node scripts/build-storyboard.mjs <brand>` and show the user `storyboard.html` for content approval BEFORE any rendering; in full-auto mode the main-loop judge reviews it instead.

**Brief synthesis rules.** The zod schema (`studio/src/lib/brief.ts`) is the contract; fill the grounding sections, not just the copy: `audience` + `customerLanguage` + `objections` + `switchingForces` from the brief-inputs grounding, and a `proofPoints` entry (claim + source) for EVERY number the copy cites — an unsourced stat is fabrication, omit it instead (lint-copy WARNs on stat-shaped claims in a brief with no proofPoints). Draw `hook.headline` and each of the (up to two) `altHeadlines` from DIFFERENT hook categories per `references/hook-formulas.md`, record the categories in `hook.strategies`, and include at least one emotion-forward category (story/contrarian) against a value hook — evidence in `references/campaign-evidence.md` (read it before synthesis; it also lists debunked claims that must never appear in copy). Build `cta` with the [Action Verb] + [What They Get] formula. The storyboard renders the grounding sections so the approver can check copy against facts.

**Copy council (full-auto mode).** Before the main-loop judge accepts the storyboard, run a 3-judge council on the brief copy: three parallel Sonnet subagents (`model: claude-sonnet-5`, explicit), one per lens — positioning sharpness (would April Dunford sign it?), emotional resonance vs feature-dump, and evidence honesty (every claim traced to a proofPoint) — with the third judge additionally instructed to argue AGAINST shipping the copy (mandatory dissenter; kills the echo chamber). Issues raised by 2+ judges go back to synthesis; single-judge nits are noted, not blocking. In gated mode the human storyboard review replaces the council — offer it only if the user asks for a copy critique. (Pattern adapted from Corey Haines' marketing-council skill, MIT.)

## Phase 2 — UI polish (only if opted in)

In the PRODUCT repo: impeccable → polish → frontend-verify. Must fully complete before Phase 3 — re-shooting every asset because the UI changed after capture doubles the run. Commit product-repo polish separately from asset delivery.

## Phase 3 — Asset pipeline: STRICTLY SEQUENTIAL

The engine repo is shared mutable state (props builders, registries, render queue). Two asset skills at once collide and renders saturate the CPU. One asset at a time, in this order. (One blessed exception: /logo-reveal touches only the engine repo and captures nothing, so it may run concurrently with Phase 2 polish, which touches only the product repo — zero shared state, real wall-clock savings.)

| # | Skill | Why this position |
|---|-------|-------------------|
| 1 | /logo-reveal | Cheapest comp — surfaces brand-token bugs before the expensive assets |
| 2 | /product-demo | Films the (now polished) UI; footage feeds everything downstream |
| 3 | /launch-video | Picture-lock the hero video (composes demo + logo + copy). Before locking, when the brief carries altHeadlines: `node scripts/render-hook-variants.mjs <brand>` renders the competing hook takes and registers them as Mission Control variants — pick the winner there, then lock. Optionally `node scripts/render-variants.mjs <brand> logo-reveal` for hero takes. |
| 4 | /audio-track | Score the locked launch video (music/VO per intake) and merge |
| 5 | /social-clip × N | Reuse demo/logo footage per platform; add stings if audio opted in |
| 6 | /og-assets | Statics + README GIF pulled from final footage |

Per asset: stills gate before full render — `node scripts/contact-sheet.mjs <brand> <Comp>` is the standard gate artifact (each sub-skill enforces it), render logs `| tail -2`, then update the manifest. Assets #1 (/logo-reveal's Blender staging) and #2 (/product-demo's Playwright capture) check the content-hash footage cache first and skip the expensive stage when their inputs (product git state, capture/staging script, and resolved config) are byte-identical to the last run; pass `--force` to re-capture.

**Phase 3.5 — Responsive export matrix.** Once the launch video is picture-locked and the social clips are rendered, run `node scripts/render-matrix.mjs <brand>` to fan the launch video and social clips into all four aspects (16:9, 1:1, 4:5, 9:16) by responsive layout, not crops. Variants land in `out/<brand>/matrix/` and register in the manifest's `exports[]`. Add `--stills-only` first to prove the layout with one still per aspect before committing CPU to full renders. The muted-autoplay rows (9:16 and 1:1) additionally emit an `<id>-captioned` variant with the VO burned into on-screen captions, and `node scripts/build-captions.mjs <brand>` writes matching `launch.srt`/`launch.vtt` sidecars — both require the brand's audio props (skipped silently without them).

## Execution mode — pick by session model

- **Opus or Sonnet session** (default): run each asset skill inline in the main loop. Visual-tuning loops go to Sonnet subagents (`model: claude-sonnet-5`, always explicit) so iteration stills die with their context. Mechanical checks: Haiku or inline. Escalate to Fable at most once, standalone, only if a new template must be designed mid-run.
- **Fable session** (e.g. `ultracode "/marketing"` with Fable as the main model): executor-judge mode, below. Fable never executes asset recipes inline — its context grows for hours at judging-grade rates while doing checklist work.

## Executor-judge mode (Fable session)

Fable is the judge and orchestrator; it holds only the intake answers, the manifest, dispatch prompts, and verdicts. Everything heavy happens in disposable executor contexts.

1. **Brand onboarding stays in the main loop** — one-time judgment work, exactly what Fable is for. If `brands/<id>.json` is missing, derive tokens from the product repo (DESIGN.md, tailwind, CSS vars per PLAYBOOK) and fold any underivable values into the Phase 0 intake batch — never a mid-run question to an absent user.
2. **Phase 2, if opted in, goes to one `claude-opus-4-8` executor** that runs impeccable → polish → frontend-verify in the product repo and returns before/after screenshots plus the verify result as raw data. Fable judges those before any capture starts — the polish pass is heavy UI work and does not belong in the judge's context.
3. **One executor subagent per asset, strictly sequential** (the engine repo and CPU rules from Phase 3 apply unchanged). Models, always explicit: `claude-opus-4-8` for /product-demo and /launch-video (capture choreography and copywriting need judgment); `claude-sonnet-5` for /logo-reveal, /audio-track, /social-clip, /og-assets (recipe execution).
4. **Dispatch prompt contract**: tell the executor to read the asset's SKILL.md, the marketing-studio skill, and the PLAYBOOK gotchas before acting; give it the brand id, manifest path, and intake answers; have it execute the recipe through full render and return raw data — output path, 3 extracted still paths, and any deviations. No prose reports.
5. **Judge protocol per asset**: Fable Reads the returned stills and judges against the brand's `voice` rules, composition quality, and copy (no em dashes, no hype). Approve → manifest `approved`, next asset. Problems → send a numbered correction list via SendMessage to the SAME executor (its context is intact; never respawn a fresh executor to fix its own work). If the resume fails because the executor's transcript is gone (it happens), spawn a MINIMAL corrections executor whose prompt carries the complete defect list plus file-level context — never re-run the whole asset recipe. Maximum 3 correction rounds per asset; after that, record the asset as `rendered` with judge notes and move on — the user adjudicates it in the final gallery.
6. **This mode is full-auto by definition** — Fable replaces the per-asset user gates as a stronger judge. The user still sees the final gallery (Phase 5 is unchanged), and delivery + commits stay in the main loop.
7. **Fable never spawns Fable**, and the 3-Fable session cap applies. Executors are the fleet; the judge is singular.

## Dynamic workflows — the only two uses

Whatever the execution mode, the Workflow tool touches only read-only fan-outs. Asset execution NEVER goes in a workflow: workflow agents run in the background with no channel back to the judge or the user, renders are CPU-bound and serial so fan-out buys zero wall-clock, and each fresh `agent()` re-reads the PLAYBOOK per call. Corrections need SendMessage to a live executor — a workflow can't do that. Mechanical single commands (`smoke.mjs`, file copies, manifest I/O) stay inline in Bash; a subagent spawned to run one command costs more than the command.

The two legitimate workflows, all agents Sonnet with `model` explicit:
1. Phase 4 brand-compliance sweep: `parallel()` one reviewer per asset still, each finding adversarially verified before it triggers a re-render.
2. Optional pre-delivery judge panel: 3 judges score the full gallery; only issues flagged by 2+ judges go back to Phase 3. In executor-judge mode this panel is a pre-filter — the panel flags, the Fable judge adjudicates.

Fable never goes inside a workflow (the model-guard hook blocks it in `parallel()`/`pipeline()` constructs anyway).

## Phase 4 — Final QA

1. `node scripts/smoke.mjs` — must pass.
1b. Mechanical judges before any agent sweep (cheap, run all five): `node scripts/judge-av-sync.mjs <brand>` (VO overruns/caption dwell), `node scripts/judge-demo-pacing.mjs <brand>` (dead air), `node scripts/judge-palette.mjs <brand> <still>` (forbidden colors; low-confidence findings are product-UI suspects, treat per step 2's false-positive rule), `node scripts/judge-motion.mjs <brand>` (motion-craft conventions in studio src + brand motion-token bands), and `node scripts/check-budgets.mjs <brand>` (hard size gate — an OVER blocks delivery). Their JSON reports feed the judge; only findings the reports can't decide go to the agent sweep.
2. Brand-compliance sweep: one Sonnet subagent reviews a still from every asset against the brand's `voice` rules (e.g. noban: profit gold `#d6c23c`, never green). Re-render only violators — but VERIFY findings against the product repo's source first. Product screenshots inside assets show the PRODUCT's own fonts/tokens, not the engine brand's stand-ins; a reviewer expecting the engine's mono will misread the product's mono as a violation (paperroute run 2026-07-10: 4 of 5 sweep findings were this exact false positive; the fifth was a real product bug, fixed in the product repo, no asset re-render needed).

## Phase 5 — Delivery

1. Copy every asset to the destination dir; write a README there listing each file and its intended use.
2. Launch the operator console: `node scripts/mission-control.mjs <brand>` (add `--port N` if 4600 is taken). Tell the user the URL it prints (default `http://localhost:4600/`). This is a live click-to-approve gallery reading `out/<brand>/marketing/run.json` — one card per asset with the embedded artifact, an Approve button, a Redo box, and variant pickers. An advisory bar under the header shows the mechanical judges' verdicts (expandable findings), footage-staleness warnings ("capture footage: N commits behind" — computed from the cache's recorded product git state), and engagement results when they exist. **The run is not done until the user has seen the gallery.**
3. While it runs, poll `out/<brand>/marketing/run.json` and `out/<brand>/marketing/review.json` for the operator's actions: an asset flipped to `approved` in the manifest is that asset's approval gate cleared (approve is the manifest gate, never inferred from chat); a `redo` entry in `review.json` — with its note, also stored as `redoNote` on the asset (now back to `planned`) — feeds the Phase 3 correction loop. Re-render the redone asset per its skill, update the manifest, and the console picks up the new state on its next 2s poll.

**Phase 5.5 — Thumbnails and paste-ready post kits.** Before delivery, run `node scripts/extract-thumbs.mjs <brand>` to grab one poster still per aspect from `out/<brand>/matrix/` into `out/<brand>/thumbs/`, then `node scripts/build-postkit.mjs <brand>` to assemble `out/<brand>/postkit/{x,linkedin,tiktok,shorts,youtube,instagram}/` — each folder gets the right-aspect video, thumbnail, a lint-gated `caption.txt`, `alt.txt`, caption sidecars (YouTube/LinkedIn), and a `POST.md` checklist. This is what makes delivery paste-ready instead of raw files the user has to reassemble by hand.

**Phase 5.75 — Results loop (after publishing, usually a later session).** When posts go live (via /launch or the launch-engine), record them in `out/<brand>/marketing/posts.json` — an array of `{platform, url, variant?, metrics?}` where `variant` is the run.json variant id the post carried (e.g. `hook-2`) and `metrics` is manual entry for platforms without API access (LinkedIn). Then `node scripts/fetch-results.mjs <brand>` pulls X engagement (X_BEARER_TOKEN in .env; exit 2 + unavailable markers without it) into `results.json`, and Mission Control shows engagement per hook variant. The winning hook CATEGORY feeds the next brief's `hook.strategies` pick — that closes the A/B loop with reality instead of taste.

## Phase 6 — Close out

1. Commit the engine repo (tests + lint + smoke first; `out/`, `assets/`, `studio/public/*/` stay uncommitted). An uncommitted engine tree strands the run.
2. Commit product-repo delivery.
3. Final summary: per-asset table (file, duration, status) + deviations log.

## Red flags — stop and re-read this skill

- Running two asset skills concurrently "to save time" → engine-repo collision.
- Starting with /launch-video "because it matters most" → brand bugs found at the expensive end.
- Capturing before Phase 2 finished → everything gets re-shot.
- "Session died, start over" → read `run.json` and resume.
- Asking the user questions one at a time across the run → all questions live in Phase 0.
- Deciding yourself whether to edit the product's UI → that is intake question 2, the user's call.
