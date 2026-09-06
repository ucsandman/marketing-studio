---
name: marketing
description: Use when the user wants the complete marketing asset suite for a product in one run — "/marketing", "build all the marketing assets", "generate everything for the launch", "all the animations and brand assets for X". Not for a single asset (use that asset's own skill) and not for launch copywriting alone (use /launch).
---

# Marketing Mega-Pipeline

One command produces a product's full asset suite: brand onboarding, UI polish, logo reveal, product demo, launch video with audio, social clips, and OG assets. The individual asset skills own their recipes; this skill owns sequencing, gates, and run state.

**REQUIRED BACKGROUND:** marketing-studio (engine-repo workflow shape and non-negotiables). All PLAYBOOK rules apply.

**Production route:** read [`docs/production-quality.md`](../../docs/production-quality.md).
Require `--project <product-repo>` and use
`<workspace> = <product>/marketing/assets/<brand>`. Every generated capture, audio file,
prop, public-stage asset, render, report, matrix row, and post kit stays in that product
workspace. Engine-local `out/` is not a product-run path.

## Resume check — before anything else

Read `<workspace>/marketing/run.json`. If it exists and any asset is not `delivered`,
this invocation is a RESUME: load its intake and continue at the first incomplete asset.
Confirm every claimed artifact exists inside the product workspace before trusting state.

On resume, still run the Phase 1 environment checks (shared-repo guard + `launch.py --check` — the previous process died mid-flight), but skip brand onboarding and Phase 2 polish if the manifest marks them complete. Trust a `rendered`/`approved` status only after confirming its artifact actually exists on disk; missing or truncated artifact → demote that asset to `planned`.

## Phase 0 — Intake: ONE batched question round, then silence

Fresh runs only. Ask everything in a single AskUserQuestion, then run without asking again (exceptions: per-asset stills gates in gated mode, final delivery):

1. **Product/brand** — which brand and the explicit product repo used by `--project`.
2. **UI polish before filming?** Default YES: the demo films the real running app, so rough edges get rendered at 60fps forever. YES = impeccable → polish → frontend-verify on the product repo before any capture. NO = film as-is. This edits product code, so it is always the user's call — never silently skip it AND never silently do it.
3. **Audio** — music + voiceover is the default and the only thing a film ships with; ask only WHO narrates (brand voice id vs default) and whether music leads or narration leads. "None" is not an option and music-only is a recorded exception (`--music-only`), never a default: a film with no voice explaining the product is not done (CLAUDE.md, learned 2026-09-01).
4. **Social clips** — platforms and count (default: X + LinkedIn, one each).
5. **Checkpoint mode** — full-auto (self-check stills, user reviews the final gallery) or gated (user approves stills before each full render).

## Phase 1 — Foundation

1. Shared-repo guard + `python launch.py --check` (marketing-studio steps 0–1), then `node scripts/install-skills.mjs --check` — it warns when a bundled `skills/` copy and its installed `~/.claude/skills` copy have drifted, so the run does not follow a stale checklist. Warn only; fix the drift or note it, then continue.
2. Brand: if `brands/<id>.json` is missing, onboard per PLAYBOOK. Brand-token judgment stays in the main loop — do not delegate it.
3. Create `<workspace>/marketing/run.json`. It stores the intake answers and one entry per planned asset. Statuses mean exactly this:
   - `planned` — not rendered yet. Gated mode: user approves pre-render stills before the render starts (that is the ONLY user gate per asset).
   - `rendered` — artifact on disk, post-render frame check pending (extract 2–3 frames from the artifact and inspect them — self-check in both modes).
   - `approved` — frame check passed; approval is recorded in the manifest the moment it happens, never inferred from chat history. A resumed session redoes the frame check for any `rendered` asset, showing the frames to the user first in gated mode.
   - `delivered` — copied to the product repo.
   Update the manifest after every status change. Never restart a run from scratch because the session died. In executor-judge mode the judge writes `rendered` plus the artifact path the moment an executor returns, before judging: the truckside session died on 2026-09-05 with a finished, scored launch film on disk and a manifest that still read `planned`, and the resume had to be reconstructed from file timestamps.
4. Infographic bridge: build the product-owned `<workspace>/marketing/infographic-style.md`, then name it when an infographic is part of this run so that asset uses the approved brand tokens.

**Content and direction gate.** Once `<workspace>/marketing/brief.json` is synthesized
and passes the copy gate, generate direction, shot plan, and production plan with the
product-aware builder. Run `node scripts/build-storyboard.mjs <brand> --project <product>`.
Approve the grounded copy and a style frame, then build an audio-bearing animatic with
scratch voice/music and obtain named non-author approval before full rendering.

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
| 3 | /launch-video | Build the chosen direction through an authored shot plan. Use directed LaunchVideo or a bespoke film according to the idea; captured UI, rebuilt UI, 2D, 3D, and hybrid shots are all valid. Picture, narration, music, and SFX share the same plan. |
| 4 | /audio-track | MANDATORY unless the recorded music-only exception applies. Score the lock from product-owned audio inputs with `--project <product>`, verify the delivered master, and set the launch artifact to that scored file. A silent launch card is a defect, not a variant. |
| 5 | /social-clip × N | Reuse approved sources per platform. Every delivered clip is scored in the product workspace before it counts. Muted-autoplay captions do not grant permission to ship a silent media file. |
| 6 | /og-assets | Statics + README GIF pulled from final footage |
| 7 | Cards | One stat card per brief proofPoint plus a quote card from the hook, rendered into `<workspace>/marketing/cards/`; skip when there is no grounded brief. A proof point with no figure is engineering-grounding prose, not a card — pass `--skip-figureless` to drop it instead of rendering it as a quote card. Footers never print a path or code citation: `build-cards.mjs` routes every source through `displaySource`, which prints the citation only when it reads as a plain human line and otherwise prints "Verified in the `<brand>` source". |

Per asset, inspect inexpensive representative stills before a full render. For the hero
film, generate hash-bound start/middle/end samples for every planned shot from the exact
final render with `contact-sheet.mjs --project <product> --plan ... --render ...`.
Footage caches also live in the product workspace; `--force` re-captures only when needed.

**Render budget: one full-resolution render per asset.** The renderer is not where a
two-hour run goes; correction rounds are. Measured 2026-09-01 on the 24-core box: a
full-res LaunchVideo render is ~9 minutes and `--x264-preset` barely moves it (Chrome
frame rendering is the bottleneck, not encoding), while `--scale=0.5` renders 3.3x
faster. So: judge every round from the contact sheet, and when a round needs motion,
render the preview at `--scale=0.5` as `launch-vN-preview.mp4`. The full-res render
happens ONCE, after the stills pass. The postflop launch step rendered three full
passes (27 minutes of the step's 48); this rule makes that one. A product bug found
mid-capture is a note in `run.json` judgeNotes for the user, not a fix inside the
run (postflop's demo step spent 64 minutes that way).

**Budget the VO before you dispatch #4, not after.** Picture-lock (#3) and audio (#4) are separate steps, and the trap between them is that measured VO word timings DERIVE act lengths, so scoring a locked film can push it past the 30-90s band `launchTiming.test.ts` enforces. Do the arithmetic yourself at dispatch time and hand it to the executor: `frames_available = 2700 - current_total`, minus the demo act which is FIXED (the PLAYBOOK forbids shortening a recorded demonstration to fit narration). Estimate each act's need at ~150wpm plus `VO_LEAD` + `VO_PAD`. If the narration overruns, say so in the brief and name the act to cut hardest — copy is trimmed ONLY in `build-<brand>-audio.mjs`, never by editing act constants. Measured on the practicalsystems run (2026-08-17): an 80.8s lock left 276 frames of headroom against ~564 needed, so ~25 words had to go. **Name any claim that must survive the trim**, because the shortest phrasing is often the false one — "cold outreach never sends without a human" compresses to "nothing sends without a human", which was untrue there.

**Phase 3.5 — Responsive export matrix.** After the scored launch and social clips pass
their own review, run `render-matrix <brand> --project <product> --production
--stills-only` to prove all formats. This is non-delivery layout evidence. Then run the
production matrix without `--stills-only`; it binds each complete row to the approved
plan and strict evidence. Use `--verify-production` to recheck pending existing media
without rerendering it.

## Execution mode — pick by session model

- **Opus or Sonnet session** (default): run each asset skill inline in the main loop. Visual-tuning loops go to Sonnet subagents (`model: claude-sonnet-5`, always explicit) so iteration stills die with their context. Mechanical checks: Haiku or inline. Escalate to Fable at most once, standalone, only if a new template must be designed mid-run.
- **Fable session** (e.g. `ultracode "/marketing"` with Fable as the main model): executor-judge mode, below. Fable never executes asset recipes inline — its context grows for hours at judging-grade rates while doing checklist work.

## Executor-judge mode (Fable session)

Fable is the judge and orchestrator; it holds only the intake answers, the manifest, dispatch prompts, and verdicts. Everything heavy happens in disposable executor contexts.

1. **Brand onboarding stays in the main loop** — one-time judgment work, exactly what Fable is for. If `brands/<id>.json` is missing, derive tokens from the product repo (DESIGN.md, tailwind, CSS vars per PLAYBOOK) and fold any underivable values into the Phase 0 intake batch — never a mid-run question to an absent user.
2. **Phase 2, if opted in, goes to one `claude-opus-5` executor** that runs impeccable → polish → frontend-verify in the product repo and returns before/after screenshots plus the verify result as raw data. Fable judges those before any capture starts — the polish pass is heavy UI work and does not belong in the judge's context.
3. **One executor subagent per asset, strictly sequential** (the engine repo and CPU rules from Phase 3 apply unchanged). Models, always explicit: `claude-opus-5` for /product-demo and /launch-video (capture choreography and copywriting need judgment); `claude-sonnet-5` for /logo-reveal, /audio-track, /social-clip, /og-assets (recipe execution).
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

1. Watch the entire scored hero film with sound as a viewer before reading judge scores.
   Record whether you would share it and a concrete defect list; weak work returns to its
   cheapest responsible stage. Contact sheets cannot make this decision.
1a. `node scripts/smoke.mjs` — runtime gate; it is not visual approval.
1b. `node scripts/check-audio.mjs <brand> --project <product>` — HARD gate: every
   delivery-surface video carries its intended mastered track. Run it again after postkit.
1c. Run the existing A/V sync, pacing, palette, motion, drift, and budget judges with
`--project <product>` where supported. `judge-audio` is mandatory reading, not optional:
the sound-design judge's PASS counts VO lines from the manifest, while judge-audio
transcribes the master and is the only check that proves each line was heard. On
truckside (2026-09-06) the scored film passed the sound-design judge with a music bed
whose outro fell inside the picture, which left 3s of dead air and an unheard line that
only judge-audio caught. Read its content, order and trailing-silence lines before
approving the audio track. These measure properties; warnings return to the
perceptual review rather than becoming invented aesthetic thresholds.
1d. Record the structured non-author review in Mission Control, then run
`judge-production <brand> --project <product> --plan <production-plan.json> --render
<final.mp4> --strict`. Missing or stale stage approval, three-per-shot evidence, full
render/audio attestations, or hash bindings blocks delivery.
2. Brand-compliance sweep: one Sonnet subagent reviews a still from every asset against the brand's `voice` rules (e.g. noban: profit gold `#d6c23c`, never green). Re-render only violators — but VERIFY findings against the product repo's source first. Product screenshots inside assets show the PRODUCT's own fonts/tokens, not the engine brand's stand-ins; a reviewer expecting the engine's mono will misread the product's mono as a violation (paperroute run 2026-07-10: 4 of 5 sweep findings were this exact false positive; the fifth was a real product bug, fixed in the product repo, no asset re-render needed).

## Phase 5 — Delivery

1. Assets already live in the product workspace; do not copy an engine-local render into
   place at the end. Write a product-owned README listing each file and intended use.
2. Launch `node scripts/mission-control.mjs <brand> --project <product>` and give the
   user its local URL. First re-run `contact-sheet` on the hero master if any matrix
   row's judge ran after it: every judge-production run overwrites
   `production-evidence.json`, and the console binds the perceptual review to whatever
   render the evidence names last (truckside 2026-09-06: it pointed at a rejected 9:16
   row until the sheet was regenerated). The run is not done until a named non-author has watched the
   scored film and the structured review is bound to current evidence.
3. Poll `<workspace>/marketing/{run,review}.json` for approve/redo actions. Approval is a
   recorded, hash-bound action, never inferred from chat. A redo returns to the responsible
   stage and produces a new version rather than overwriting evidence.

**Phase 5.5 — Thumbnails and paste-ready post kits.** Extract thumbnails from the
product-owned matrix, then run `node scripts/build-postkit.mjs <brand> --project
<product> --production`. It copies only strict-PASS, hash-bound matrix assets and keeps
captions, alt text, checklists, licences, and disclosures beside the media.

**Phase 5.75 — Results loop (after publishing, usually a later session).** `/launch`
previews by default and takes the product-owned post kit. Live posting remains a separate
explicitly authorized action. Record live URLs and later metrics in
`<workspace>/marketing/posts.json`; feed the winning hook category into the next brief
rather than treating one campaign's visual treatment as a permanent template.

**Phase 5.9 — Prove the link preview actually changed.** After delivery and site
redeploy, compare the live `og:image`/`twitter:image` against the delivered product-owned
OG file. A correct render does not prove the deployed meta tags or CDN are current.

## Phase 6 — Close out

1. Commit engine source changes only when this run required them (tests + lint + smoke first); generated run data stays in the product repo.
2. Commit product-repo delivery.
3. Final summary: per-asset table (file, duration, status) + deviations log.

## Red flags — stop and re-read this skill

- Running two asset skills concurrently "to save time" → engine-repo collision.
- A second full-res render of the same asset before its stills passed → the render budget above; preview at `--scale=0.5`.
- Fixing the product mid-run because the capture exposed a bug → note it, keep filming.
- Starting with /launch-video "because it matters most" → brand bugs found at the expensive end.
- Capturing before Phase 2 finished → everything gets re-shot.
- "Session died, start over" → read `run.json` and resume.
- Asking the user questions one at a time across the run → all questions live in Phase 0.
- Deciding yourself whether to edit the product's UI → that is intake question 2, the user's call.
