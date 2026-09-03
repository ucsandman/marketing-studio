# animations: agent-driven marketing studio

Remotion (studio/) renders all final video for ALL products/brands; assets are copied
out to the product's repo at the end. brands/<id>.json holds per-product tokens
(zod-validated via studio/src/lib/brand.ts; mark components in studio/src/brands/marks.ts);
templates resolve getBrand(brandId) and never hardcode brand values. Feeders:
feeders/blender (headless bpy), feeders/capture (Playwright), feeders/comfy (ComfyUI,
non-load-bearing). Spec: docs/superpowers/specs/2026-07-09-animation-studio-design.md.
skills/ is the source of every skill this repo ships (installed to ~/.claude/skills via
scripts/install-skills.mjs; `--check` reports drift). /launch is the gated launch CLI
skill (skills/launch, tested by launch/tests/skill.test.ts); /announce is the studio's
browser-driven announce flow; /ship-it chains /marketing then /launch.

launch/ is the distribution layer, folded in from the launch-engine repo on 2026-09-02:
its own package (Node 24, vitest, tsc, vite dashboard), its own conventions in
launch/CLAUDE.md. Posting is dry-run unless --live; never make a test hit a live
provider. Social keys live in launch/.env; infra credentials are MCP-only.

**Read docs/PLAYBOOK.md before any asset or feeder work** — engine map, brand
onboarding, and verified gotchas (Blender 5.1.2 API traps, camera math, seamless-loop
rules, capture lessons). Do not re-derive them. User-level skills (/logo-reveal,
/social-clip, /product-demo, /launch-video, /og-assets, /audio-track, /marketing)
drive this repo from any repo.

Rules:
- Brand color rules live in each brand's JSON `voice` (noban: profit = gold #d6c23c
  NEVER green; green = safe/simulation only).
- Rendered proof: visual work is not done until a rendered frame was inspected;
  final assets are not done until the user saw them.
- Smoke check before claiming done: node scripts/smoke.mjs (every composition listed).
- **A film is not done without audio, and audio means a voice explaining the product.**
  Every delivered mp4 (launch lock, every `*-final*.mp4`, every postkit file that is
  not a `-silent` variant, the newest `film-vN`) carries a mastered soundtrack: music
  bed + narration + SFX cues, at master-audio's TARGET_I. Music-only is a recorded,
  deliberate exception (`--music-only`), never a default; "none" is not an intake
  option. `node scripts/check-audio.mjs <brand>` is a HARD gate (exit 1) and runs
  before any delivery claim. Two silent postflop cuts shipped on 2026-09-01 because
  nothing enforced this; do not make it three.
- Bespoke films (`studio/src/films/<brand>/`, e.g. PostflopFilm) are scored with
  `scripts/build-<brand>-film-audio.mjs` (copy + cue source of truth, generated
  manifest props/<brand>-film-audio.json) then `scripts/score-film.mjs <brand>
  <film.mp4>`; template films keep build-<brand>-audio.mjs + audio-track.
- Seven mechanical gates run per brand: six judges (judge-av-sync, judge-demo-pacing,
  judge-palette, judge-motion, judge-drift, check-budgets) plus check-audio. The
  judges are advisors: exit 0 unless --strict; check-budgets and check-audio are hard.
  **judge-drift runs LAST** — it scores out/<brand>/ as a SET, so running it before
  everything has rendered scores an incomplete set and the number means nothing. It
  has no absolute threshold on purpose (nobody publishes one); calibrate with
  `--ref <dir>` against approved assets, never by inventing a constant.
- Generated props JSON is edited only via its builder script (scripts/build-*-props.mjs).
- Asset copy traces to out/<brand>/marketing/brief.json (agent-synthesized, gated by
  scripts/lint-copy.mjs and the storyboard approval); builders overlay brief copy —
  never hand-edit copy into generated props.
- out/, assets/, studio/public/*/ are gitignored build products.
- Blender via BLENDER_PATH in .env; ComfyUI on :8000/:8188 with documented fallback.
- Unreal via UNREAL_PATH in .env (feeders/unreal, PLAYBOOK "Unreal Engine 5.8"); plates
  are PNG sequences staged like Blender output.
- **A storyboard or any approval artifact is handed over annotated, never as bare
  frames:** shot number, timing, ground, the camera move drawn on the frame, the
  narration line under it, and one line saying what the whole thing is. Render the page
  and read it as a stranger before handing it over (2026-09-03: an unlabeled tile of
  five Unreal frames was unreadable to Wes). In a terminal session, open it locally.
- **The viewer test comes before the gates.** A film is not done until the agent has
  WATCHED it with sound at full length and written a viewer's verdict ("would I share
  this?"); the seven gates measure properties, not quality, and on 2026-09-03 all of them
  passed a film Wes called bad on every axis. The verdict happens at the animatic
  (half-scale plates + scratch VO), the cheapest point to stop. The DashClaw NIGHT SHIFT
  film is PARKED: do not iterate on it; a new attempt starts from a script read aloud
  and an animatic Wes reacts to in the first hour, with real assets and a chosen voice.
- **Every gate ends with a retro** (approval, ship, wrap, any correction): what worked,
  what did not, the one change, written to docs/ERRORS.md or PLAYBOOK in the same turn.
  The next film starts by reading the last film's retro.
