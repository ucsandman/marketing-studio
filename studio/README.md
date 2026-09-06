# Marketing Studio renderer

This private Remotion package renders the video and static compositions used by
Marketing Studio. It is the shared engine behind product demos, launch films, social
clips, OG assets, store tiles, campaign cards, wrap clips, and scripted agent sessions.

Production inputs and outputs belong to the product that owns them under
`<product>/marketing/assets/<brand>/`. The renderer source stays here; `studio/public/`
and engine-local output folders are staging areas only.

## Setup

From this directory:

```bash
npm ci
npm run dev
```

The Remotion Studio lists 13 compositions. The reusable compositions are
`SocialClip`, `ProductDemo`, `LogoReveal`, `LaunchVideo`, `AnimatedOG`, `StoreTile`,
`Card`, `WrapClip`, and `AgentSession`. `PostflopFilm` and `DashClawFilm` are bespoke
films; `ComponentGallery` and `StagedGallery` are review surfaces.

## Commands

```bash
npm run dev       # open Remotion Studio
npm run build     # create a Remotion bundle
npm test          # run composition, schema, timing, layout, and motion tests
npm run lint      # run ESLint and TypeScript checks
```

Render production assets through the repository scripts from the repository root so
workspace ownership, props routing, evidence, and review gates stay intact. For example:

```bash
node scripts/render-matrix.mjs <brand> --project <product> --production --stills-only
```

See the root [README](../README.md), [production quality contract](../docs/production-quality.md),
and [playbook](../docs/PLAYBOOK.md) for the complete workflow.

## Licence

This package is part of the MIT-licensed Marketing Studio repository. Remotion has
separate licence terms for some commercial users; see the root README before use.
