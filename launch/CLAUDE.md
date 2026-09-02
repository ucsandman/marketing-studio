# launch/ — project conventions (marketing-studio distribution layer)

TypeScript CLI + Claude Code skill that launches developed projects across platforms.
Lives inside marketing-studio as its own package; the `/launch` skill is `../skills/launch/SKILL.md`.

## Stack

- Node >= 24, ESM only (`"type": "module"`, NodeNext resolution — relative imports need `.js` extensions)
- commander (CLI), zod (validation), vitest (tests), eslint flat config (lint)
- Build `npm run build` (tsc → dist/), test `npm test`, lint `npm run lint`

## Conventions

- **Zod-first validation**: every persisted or external shape has a zod schema in `src/types.ts`; types are inferred, never hand-written duplicates.
- **Dry-run default**: any command that could spend money or publish content must support `--dry-run` and default to the safe path. Live posting requires the explicit `--live` flag.
- **Never log env values**: provider code may log which key is *missing*, never its value. No `console.log` of `process.env` contents anywhere.
- **Per-target state** lives in `<target>/.launch/` via `LaunchStore` (`src/state.ts`) — don't read/write those files directly.
- **Idempotency**: posting consults the ledger (`store.has(key)`) before any network call; completed posts append a `LedgerEntry`.
- **Errors**: corrupted state files throw `CorruptedStateError` with the file path; CLI commands exit non-zero with a one-line message, no stack-trace vomit.
- **Credential split**: social API keys come from `.env` (template: `.env.example`). DashClaw infra (domain/Vercel/Stripe/Resend/Twilio/DNS) is MCP-only — the CLI never holds those credentials.
