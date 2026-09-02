# Tool & Connection Inventory

**Source of truth: `C:\Projects\offlocalai-mcp\src\tools\index.ts` — 124 tools registered with `server.registerTool(...)` (extracted 2026-09-02). Regenerate the offlocal section from that file; never hand-add a tool name here.**

## offlocal MCP (`mcp__offlocal__*`) — the launch backbone

### Project / workspace
- list_projects, create_project, select_project, get_project_context, export_context, add_environment, list_environments

### Provider mappings
- map_provider_resource, list_provider_mappings, get_provider_mapping, list_connections, create_connection, set_app_env_vars

### Policy / governance
- check_policy, simulate_action, list_policy_rules, set_policy_rule, list_pending_approvals, doctor, approve_action, reject_action

### Memory / audit
- read_project_memory, write_project_memory, list_audit_log, export_audit_log, dashclaw_status, dashclaw_recent_decisions, export_dashclaw_evidence, explain_action_risk, governed_action_summary

### App logs
- get_app_logs, get_vercel_logs, get_latest_deployment_logs

### GitHub
- get_github_repo_context, get_github_repo_readme, list_github_repo_files, list_github_pull_requests, list_github_branches, get_github_status_checks, list_github_workflow_runs, list_github_workflow_jobs, rerun_github_workflow_run, cancel_github_workflow_run

### Vercel
- get_vercel_project_context, get_vercel_deployments, get_vercel_deployment_status, get_vercel_deployment_logs, set_vercel_env_var, create_vercel_project, add_vercel_domain, create_vercel_deployment

### Railway
- get_railway_project_context, discover_railway_resources, get_railway_deployments, get_railway_logs, create_railway_deployment, set_railway_env_var

### Namecheap (domains + DNS)
- check_domain_availability, list_namecheap_domains, purchase_domain, get_dns_records, set_dns_records

### Neon
- list_neon_projects, create_neon_project, get_neon_connection_uri

### Upstash (Redis + QStash)
- list_upstash_redis_databases, create_upstash_redis_database, get_upstash_redis_env, get_upstash_qstash_env, list_upstash_qstash_schedules, create_upstash_qstash_schedule

### Cloudflare R2
- list_cloudflare_r2_buckets, create_cloudflare_r2_bucket, get_cloudflare_r2_env, list_cloudflare_r2_objects

### Clerk
- get_clerk_app_env, list_clerk_users, list_clerk_domains, list_clerk_redirect_urls, create_clerk_redirect_url

### Render
- list_render_services, get_render_service, list_render_deploys, get_render_deploy_logs, create_render_deployment, set_render_env_var

### Supabase
- list_supabase_projects, get_supabase_project_context, query_supabase, get_supabase_logs, apply_supabase_migration

### Stripe
- list_stripe_products, list_stripe_customers, list_stripe_subscriptions, list_stripe_invoices, create_stripe_webhook, list_stripe_webhooks, create_stripe_product, create_stripe_price

### Sentry
- list_sentry_projects, create_sentry_project, list_sentry_client_keys, create_sentry_client_key, list_sentry_releases, create_sentry_release, list_sentry_deploys, create_sentry_deploy

### PostHog
- list_posthog_projects, create_posthog_project, get_posthog_project_env, list_posthog_feature_flags, create_posthog_feature_flag

### Resend
- list_resend_domains, create_resend_domain, verify_resend_domain, send_resend_email

### Twilio
- list_twilio_phone_numbers, update_twilio_phone_number_webhooks, send_twilio_sms, create_twilio_call

### Launch plans (local tracking; steps run through the guarded tools above)
- create_launch, get_launch_status, preflight_launch, verify_launch

## Send-tool input shapes (the `launch notify` seam)

`launch notify` writes `.launch/out/notify-payloads.json` entries that are passed verbatim as tool input, so the key sets must match these schemas exactly:

- **send_resend_email** — `environment` (required), `to` **array** of addresses (min 1), `subject`, `html` and/or `text`, optional `project` (selected project if omitted), `from` (falls back to the mapped Resend `defaultFrom`), `cc`, `bcc`, `replyTo`.
- **send_twilio_sms** — `environment` (required), `to` **string** in E.164, `body`, optional `project`, `from`, `messagingServiceSid`, `statusCallback`.

`environment` defaults to `"production"` on `create_launch`; `launch notify` emits the same value.

## Other MCP servers / plugins
- **dashclaw-local** (`mcp__dashclaw-local__*`) — governance the /launch skill calls directly: dashclaw_guard, dashclaw_record, dashclaw_wait_for_approval. Separate server from offlocal, which carries its own governance set (check_policy, simulate_action, approve_action, list_pending_approvals, dashclaw_status, dashclaw_recent_decisions).
- **github plugin** — full GitHub write API (create repo, push files, PRs, releases)
- **stripe plugin** — best-practices skill, test cards, error explainer (+ authenticate flow)
- **vercel plugin** — deploy/env/status skills, marketplace, full platform docs skills
- **context7** — current library docs on demand
- **repowise** — codebase wiki/architecture (useful for reading the TARGET project before marketing copy)
- **chrome-devtools MCP** — full browser automation (navigate, fill forms, click, screenshot) — fallback for platforms with no API (e.g. Hacker News)
- **codex** — second-opinion coding agent

## Claude Code built-ins
- WebSearch / WebFetch (deferred, loadable) — for live platform-algorithm research
- Workflow tool (ultracode on) — multi-agent fan-out for research/copywriting
- Agent tool — subagents incl. Explore, security-reviewer, vercel:* agents
- CronCreate / schedule skill — recurring launch follow-ups
- Skills: frontend-design, impeccable (landing page polish), deep-research, supergoal/goal chain

## Gaps the engine must fill (no existing connector)
- **X (Twitter), Facebook, LinkedIn, Product Hunt, Google Business, Reddit, Hacker News** — no MCP/connector exists. Engine needs its own integration layer: official APIs where keys are provided, chrome-devtools browser automation or prefilled-draft fallback otherwise. HN has NO posting API (browser or manual link only).
- **Marketing copy generation + per-platform algorithm research** — WebSearch-driven research cache + templating (built: `launch research`, `launch copy`).

## Exact MCP tool names used by the /launch skill

Checked against the registry above by `tests/skill.test.ts` — every MCP name in SKILL.md must appear in this file.

- create_project, select_project
- create_launch, preflight_launch, verify_launch, get_launch_status
- check_domain_availability, purchase_domain, get_dns_records, set_dns_records
- create_vercel_project, create_vercel_deployment, add_vercel_domain, get_vercel_deployment_status, set_vercel_env_var
- create_stripe_product, create_stripe_price, create_stripe_webhook
- create_resend_domain, verify_resend_domain, send_resend_email
- send_twilio_sms
- dashclaw_guard, dashclaw_record (dashclaw-local server, not offlocal)
