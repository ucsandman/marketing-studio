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
    python feeders/blender/render.py feeders/blender/scenes/logo_reveal.py --out assets/noban/logo-reveal --animation
    node scripts/stage-blender-assets.mjs     # copy rendered sequences into studio/public/
    node scripts/build-launch-props.mjs       # assemble launch video props from the latest demo capture
    node feeders/comfy/client.mjs hero        # optional: AI hero backdrop (needs ComfyUI Desktop; falls back cleanly)
    node scripts/render-statics.mjs           # og.mp4 + og.gif + readme.gif
    cd studio && npm run dev            # Remotion Studio
    node scripts/smoke.mjs              # frame-0 still of every composition

## Render

    cd studio
    npx remotion render SocialClip ../out/noban/clip.mp4 --props=../props/noban-social-launch.json
    npx remotion render ProductDemo ../out/noban/demo.mp4 --props=../props/noban-demo.json
    npx remotion render LogoReveal ../out/noban/logo-reveal.mp4 --props='{"brandId":"noban","sequence":"noban/logo-reveal","frameCount":90,"cta":"Simulate free at noban.gg"}'
    npx remotion render LaunchVideo ../out/noban/launch.mp4 --props=../props/noban-launch.json
    node scripts/build-noban-audio.mjs        # generate VO + music (needs ELEVENLABS_API_KEY in .env)
    node scripts/merge-launch-audio.mjs       # merge audio manifest into launch props
    npx remotion render LaunchVideo ../out/noban/launch-audio.mp4 --props=../out/noban/launch-audio-props.json
