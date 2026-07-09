# animations

Agent-driven animation studio. Remotion is the backbone; per-product brand
configs live in `brands/`. Spec: `docs/superpowers/specs/2026-07-09-animation-studio-design.md`.

## Setup

Copy `.env.example` to `.env` and set `BLENDER_PATH` if Blender is not on PATH
(used by the phase 3 feeder and `launch.py` health checks).

## Run

    python launch.py     # health checks + opens Remotion Studio in the browser

Manual equivalents:

    cd studio && npm install            # once
    node scripts/fetch-noban-assets.mjs # once: copy noban screenshots (gitignored) into studio/public/
    node feeders/capture/record-noban-demo.mjs  # record dashboard demo (needs noban stack running)
    cd studio && npm run dev            # Remotion Studio
    node scripts/smoke.mjs              # frame-0 still of every composition

## Render

    cd studio
    npx remotion render SocialClip ../out/noban/clip.mp4 --props=../props/noban-social-launch.json
    npx remotion render ProductDemo ../out/noban/demo.mp4 --props=../props/noban-demo.json
