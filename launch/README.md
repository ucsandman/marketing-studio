# launch (marketing-studio distribution layer)

The launch engine, folded into marketing-studio as the `@marketing-studio/launch` sub-package
on 2026-09-02 (formerly the standalone `launch-engine` repo). A Claude Code skill plus a
TypeScript CLI that takes a developed project end-to-end through domain, hosting, payments,
comms, algorithm-researched marketing copy, and multi-platform distribution: X, LinkedIn,
Facebook, Reddit, Google Search Console, Bing Webmaster Tools, Bluesky and YouTube by API,
Hacker News and Product Hunt assisted. Posting is dry-run unless `--live`.

The CLI produces validated payloads and assisted-launch artifacts; the `/launch` skill
(`../skills/launch/SKILL.md`) orchestrates DashClaw MCP tools (domain, Vercel,
Stripe, Resend, Twilio, DNS) and does the generative work (research synthesis,
copywriting) in-session. Everything defaults to dry-run; nothing is purchased or posted
without explicit approval gates.

## Try it in one command

```bash
npm ci && npm run demo
```

`npm run demo` builds everything, stages a sample product (initialized config, filled
drafts, research briefs, demo contacts — all fake, all dry-run), and opens the
**launch dashboard** in your browser. Browse to the staged product (path printed in the
terminal) and click through init → drafts → preview → post gates. Nothing real is ever
posted or sent. Flags pass through: `npm run demo -- --no-open --port 4500`.

## Quickstart (CLI)

```bash
npm ci
npm run build
node dist/index.js --help
```

Point the engine at a target project (a sibling directory):

```bash
node dist/index.js init ../my-app --domain myapp.io --price "$9/mo"
node dist/index.js research ../my-app --offline
node dist/index.js copy ../my-app --scaffold
# fill the drafts in ../my-app/.launch/drafts/ (the /launch skill does this from research)
node dist/index.js copy ../my-app --validate
node dist/index.js post ../my-app --all --dry-run
node dist/index.js status ../my-app
```

Prefer clicking to typing? The same engine ships with a local web dashboard:

```bash
node dist/index.js ui   # 127.0.0.1:4400 — browse to a product, fill forms, preview, post
```

Guide with screenshots: [docs/ui-dashboard.md](docs/ui-dashboard.md).

Per-target state lives in `<target>/.launch/` (config, research briefs, drafts,
posted-ledger, rendered artifacts). Social API credentials go in `.env` (template:
`.env.example`); DashClaw infra credentials live with the DashClaw MCP server, never in
this repo.

## Commands

| Command | Purpose |
|---|---|
| `launch init <dir>` | scan target project → `.launch/launch.config.json` (`--name --domain --tagline --price --audience --force`) |
| `launch research <dir>` | per-platform algorithm briefs, static 2026 base + keyless live fetchers (`--offline --platform --check`) |
| `launch copy <dir>` | `--scaffold` draft skeletons, `--validate` hard-rule checks (exit 1 on violations) |
| `launch post <dir>` | post via API or assisted flow (`--platform --all --live --assist --force --kit`; dry-run by default, `--dry-run` kept for compatibility), idempotent via posted-ledger |
| `launch notify <dir>` | render email/SMS artifacts + DashClaw-ready payloads, consent-enforced (`--channel email\|sms --dry-run`) |
| `launch doctor` | provider table: mode (api/assist/blocked) + credential health + fix hints (`--json`) |
| `launch status <dir>` | config, brief freshness, draft states, ledger, remaining steps |
| `launch stats <dir>` | read-only Product Hunt votes/comments (`--platform producthunt --slug`) |
| `launch ui` | local web dashboard for all of the above (`--port --no-open`) — [guide](docs/ui-dashboard.md) |

## Marketing assets (post kits)

A **post kit** is a folder of rendered marketing assets (`manifest.json` + per-platform
video/caption/alt files) produced by `/marketing` or
`node scripts/build-postkit.mjs <brand> --project <product>`. It lives with the product
that owns it at `<product>/marketing/assets/<brand>/postkit`.

Wire a kit to a target either by setting `postkitDir` in `<target>/.launch/launch.config.json`
(the dashboard's **marketing** tab does this with a folder picker) or by passing
`launch post <dir> --kit <path>` (overrides `config.postkitDir` for that run). Once wired:

- `launch post` attaches kit video automatically to **X, Bluesky, LinkedIn, and YouTube**.
  Bluesky reuses the X draft and 16:9 clip; YouTube reuses the LinkedIn draft and launch video.
- X, Bluesky, and LinkedIn can fall back to **text-only** when their kit entry has no
  video. YouTube is video-only and is skipped when no media is available.
- A **missing or corrupt manifest**, or a manifest that promises a video file that isn't on disk,
  makes the post **refuse before any network call** (exit 1). Fix by re-running
  `render-matrix.mjs` + `build-postkit.mjs` in the animations repo, or clear `postkitDir`.
- `--dry-run` previews show the actual upload sequence for X, Bluesky, LinkedIn, and YouTube.
- Before any upload (dry-run included), each kit video is probed for duration and file size
  against the target platform's caps. An over-limit or unreadable video makes the post
  **refuse**, never a silent downgrade to text-only; the dashboard's marketing and post tabs
  flag it in red before you try.

TikTok, Shorts, and Instagram remain ready-to-upload folders with checklists; open them from
the dashboard's marketing tab.

The [`/ship-it` skill](../skills/ship-it/SKILL.md) chains rendering (animations studio) and
distribution (this engine) into one flow.

## Provider setup guides

Per-provider steps with cost and time estimates: [X](docs/setup-x.md) ·
[Facebook](docs/setup-facebook.md) · [LinkedIn](docs/setup-linkedin.md) ·
[Reddit](docs/setup-reddit.md) · [Google Search Console](docs/setup-google.md) ·
[Product Hunt](docs/setup-producthunt.md) · [Hacker News](docs/setup-hackernews.md)

Launch day: [docs/launch-runbook.md](docs/launch-runbook.md)

## Development

```bash
npm run build           # vite (dashboard → dist/ui) + tsc (CLI → dist/)
npm test                # vitest run; provider writes are mocked
npm run lint            # eslint (CLI + dashboard sources)
npm run dev:ui          # vite dev loop for the dashboard (proxies /api to a running `launch ui`)
npx playwright test     # browser smoke suite (after `npx playwright install chromium`)
node scripts/rehearsal-ui.mjs   # scripted dashboard rehearsal, fake creds, dry-run only
```

Node >= 24, ESM throughout. Conventions in [CLAUDE.md](CLAUDE.md).
