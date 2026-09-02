---
name: launch
description: Take a developed project end-to-end through launch — domain, hosting, payments, email infra, algorithm-researched copy, and multi-platform distribution — with zero copy-paste. Trigger on "launch <project>", "ship <project>", "take <project> live", or "/launch <dir>".
---

# /launch — full launch orchestration

You are orchestrating a product launch using two layers:

- **CLI (`launch-engine`)** — everything deterministic: state, validation, posting providers, research fetchers, payload rendering. Run it as `node "${CLAUDE_SKILL_DIR}/../../../dist/index.js" <cmd>` (or `launch <cmd>` if linked) -- the CLI lives in this package, `${CLAUDE_SKILL_DIR}/../../..`.
- **This session** — everything generative or credentialed-through-MCP: DashClaw infra calls, WebSearch synthesis, draft copywriting, and the approval gates. The CLI never holds DashClaw credentials and never sends email/SMS.

Honesty rule: each step below is labeled **[CLI]** or **[session]**. Don't do session work by shelling out, and don't reimplement CLI work inline.

Target `<dir>` is the project directory being launched (sibling of the engine repo).

Humans can drive the same engine visually with `launch ui` (local dashboard, same gates — see docs/ui-dashboard.md); this skill remains the autonomous path.

## Sequence

### 1. Intake [CLI]

```
launch init <dir> --domain <domain> --price <price> [--name --tagline --audience]
```

Pull flag values from the conversation. Read back `<dir>/.launch/launch.config.json` and confirm the summary with the user. Re-run with `--force` if they correct anything.

### 2. DashClaw setup [session]

1. `select_project` (or `create_project` if this product has no DashClaw project yet).
2. `create_launch` with `declared_stack` from the config — typically `["domain", "vercel", "stripe", "resend"]`.
3. `preflight_launch` — validates every provider token BEFORE any money is spent. If it fails, STOP and present a remediation table (provider → failing check → fix); do not proceed to spend steps.

### 3. Domain [session] — 💰 SPEND GATE #1

1. `check_domain_availability` for the config domain (and 2-3 alternatives if taken).
2. Present price and alternatives to the user.
3. **SPEND GATE: ask the user for explicit approval with AskUserQuestion and WAIT for their answer. Never call `purchase_domain` without a fresh approval in this conversation.** Record the approval decision via `dashclaw_guard` + `dashclaw_record` for the audit trail.
4. On approval: `purchase_domain`. On decline: skip to step 4 using an already-owned domain or stop.

### 4. Hosting [session]

1. `create_vercel_project` (link the product repo).
2. `create_vercel_deployment` and poll `get_vercel_deployment_status` until READY.
3. `add_vercel_domain` for the purchased domain.
4. `set_dns_records` per Vercel's required records (A/CNAME from the add-domain response); verify with `get_dns_records`.
5. Set any product env vars with `set_vercel_env_var`.

### 5. Payments [session] — 💰 SPEND GATE #2 (live mode)

Stripe best practices: create in TEST mode first, verify the full flow, then — and only then — recreate in live mode behind the gate.

1. `create_stripe_product` + `create_stripe_price` (TEST mode) from config pricing.
2. `create_stripe_webhook` pointing at the product's webhook endpoint; store the signing secret as a Vercel env var (`set_vercel_env_var`), never in the repo.
3. Verify test checkout end-to-end.
4. **SPEND GATE: live mode creates real billable objects. Ask the user for explicit approval with AskUserQuestion and WAIT for their answer before recreating product/price/webhook in live mode.** Audit via `dashclaw_guard` + `dashclaw_record`.

### 6. Email infra [session]

1. `create_resend_domain` for the config domain.
2. `set_dns_records` with the DKIM/SPF records from the response.
3. `verify_resend_domain` (DNS propagation can take minutes — poll, don't fail fast).

### 7. Research [CLI + session]

1. **[CLI]** `launch research <dir>` (live mode — keyless fetchers: x-algorithm README, Algolia Show HN winners, hunted.space, per-sub Reddit rules).
2. **[session]** WebSearch synthesis per platform (queries from THINKING.md: "X algorithm ranking signals <month year>", "<month year> LinkedIn algorithm what's working", PH featuring criteria). Write the synthesis into each brief's `## Session research` section — the CLI preserves that section on regeneration.
3. **[CLI]** `launch research <dir> --check` must pass (all briefs fresh) before copy.

### 8. Copy [CLI + session]

1. **[CLI]** `launch copy <dir> --scaffold`.
2. **[session]** Fill every draft in `<dir>/.launch/drafts/` with real copy written from the research briefs (hooks from Show HN winners, X thread structure, LinkedIn link-in-first-comment, per-sub Reddit angles, email/SMS from the announcement templates). Replace every `{{placeholder}}` including `{{unsubscribeUrl}}`.
3. **[CLI]** `launch copy <dir> --validate` — loop fill→validate until exit 0.

### 9. 🚦 PUBLISH GATE [session]

Render EVERY draft (all platforms + the email HTML + SMS text) to the user in one review block. **Ask for explicit approval with AskUserQuestion (multiSelect per-platform opt-out) and WAIT for the user's answer. Nothing is published until the user approves; platforms they deselect are skipped.** Record the decision via `dashclaw_record`.

### 10. Distribute [CLI + session]

1. **[CLI]** `launch post <dir> --all --live` — posts X, Bluesky, Facebook, LinkedIn, YouTube, Reddit via API; submits sitemap + URL inspection to Google; skips blocked providers with a summary; the posted-ledger makes re-runs idempotent.
2. **[CLI]** Assisted platforms at their recommended times (from the briefs):
   - `launch post <dir> --platform hackernews --assist --live` — opens the prefilled Show HN submitlink, copies the maker comment. The HUMAN clicks submit.
   - `launch post <dir> --platform producthunt --assist --live` — writes `.launch/out/producthunt-kit.md`, opens the submit page, copies the tagline. Schedule per the kit (12:01 AM PT, low-competition day).
3. **[CLI]** `launch notify <dir> --channel email` and `--channel sms` — renders artifacts + `.launch/out/notify-payloads.json` (consent-filtered).
4. **[session]** For each payload entry: `send_resend_email` / `send_twilio_sms` with the exact `input` object. The CLI never sends.

### 11. Verify & report [CLI + session]

1. **[session]** `verify_launch` + `get_launch_status` for the infra side.
2. **[CLI]** `launch status <dir>` for the distribution side.
3. Final report: live URL, posted links from the ledger, pending assisted steps, and the stats command (`launch stats <dir> --platform producthunt --slug <slug>`).

## Failure handling

- Any MCP failure: surface the error verbatim, consult `get_launch_status`, and fix forward.
- NEVER re-run a spend step (domain purchase, live Stripe) after a failure without a fresh approval gate — check the launch plan state and the audit log first.
- Posting failures: the ledger guarantees completed platforms are skipped on re-run; fix the failing provider (see `launch doctor`) and re-run `launch post <dir> --all --live`.
- Credential problems: `launch doctor --json` gives provider → mode → fix hint; degrade blocked API platforms to assisted/manual instead of failing the launch.

## Dry-run rehearsal (run this before any real launch)

No money, no posts, no sends — end to end. `launch post` is DRY-RUN BY DEFAULT now,
so `--dry-run` below is optional (kept for back-compat) and `--live` is what actually
publishes. `--assist` is the one exception: it opens a prefilled page and copies text
but submits nothing, so it runs for real without `--live`.


```
launch init <dir> --domain <domain> --price <price>
launch research <dir> --offline
launch copy <dir> --scaffold
# fill drafts (session) …
launch copy <dir> --validate
launch post <dir> --all --dry-run        # prints exact request payloads, writes nothing
launch notify <dir> --channel email --dry-run
launch notify <dir> --channel sms --dry-run
launch status <dir>
```

Skip every DashClaw spend step during rehearsal (no `purchase_domain`, no live Stripe). The rehearsal is green when every command exits 0 and the drafts pass validation.

## Credentials

Social API keys live in the engine repo's `.env` (template: `.env.example`, per-provider setup cost/time guides in `docs/setup-<provider>.md`, launch-day checklist in `docs/launch-runbook.md`). DashClaw infra credentials live with the DashClaw MCP server — this skill calls the tools, the CLI never sees those secrets.
