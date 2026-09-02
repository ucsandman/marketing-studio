# Decision log


---

# Recovered decisions (claude-mem archive)

13 decisions recovered 2026-08-11 from the claude-mem store before it was pruned. Source window 2026-04-06 to 2026-06-11. Full archive with observations and session summaries: `C:\Projectsrchives\claude-mem-2026-08-11\`.

## 2026-06-08 — Marketing engine research workflow launched

11-agent research workflow analyzing buy-vs-build landscape for AI marketing/sales orchestration engine

- Workflow "marketing-engine-research" launched with 3 phases: Research (11 parallel agents), Verify (adversarial claim checking), Synthesize (build-vs-buy matrix)
- Research covers 11 capability areas: lead generation, contact enrichment, email sending, social posting, content/creative generation, quotes/proposals, invoicing, payments, CRM/pipeline, orchestration runtime, competitive landscape
- Already-connected tools include Hunter.io MCP (domain search, email finder, campaigns), Stripe MCP (payments, invoicing), windsor.ai (325+ marketing data connectors), agentcash/x402 APIs (enrichment, social data, email, phone, image/video gen), and ~60 marketing-skills library
- Goal is end-to-end revenue workflow orchestration: find customers → enrich contacts → generate content → send emails/post socially → track engagement → generate quotes → invoice → collect payment from multiple sources
- Research prioritizes: (1) already-connected tools, (2) open-source self-hostable, (3) API-first SaaS with real public APIs
- Workflow will adversarially verify 30 load-bearing claims about pricing, API availability, and licensing before synthesizing recommendations

## 2026-06-08 — Invoicing Architecture Decision: Stripe MCP Primary with Invoice Ninja Escape Hatch

Comprehensive invoicing component analysis concludes Stripe Invoicing via connected MCP as default, Invoice Ninja for multi-gateway needs, build-only for orchestration glue

- Stripe Invoicing selected as primary engine via already-connected Stripe MCP, covering one-off/recurring invoices, hosted pages, quotes, 135+ currencies at 0.4-0.5% capped $2/invoice after 25 free monthly
- Invoice Ninja (Elastic License 2.0, Laravel/PHP, v5.13.x June 2026) designated as self-hosted escape hatch for non-Stripe gateways, zero marginal cost at volume, owned branded PDFs
- Crater explicitly avoided due to unmaintained status since March 2022 with unshipped roadmap features including recurring invoices
- Kill Bill (Apache 2.0, Java/MariaDB) evaluated as heavyweight multi-PSP routing solution, recommended only when payment orchestration becomes core product requirement
- Six critical gaps identified requiring custom build: accounting export normalizer, multi-source payment routing, quote->invoice->payment state machine, proactive AR dunning, self-owned PDFs, statutory e-invoicing
- Build surface limited to orchestration glue layer: Stripe->accounting export, quote-to-payment lifecycle state machine, gateway abstraction for multiple payment sources

## 2026-06-08 — Trigger.dev v3 selected as orchestration runtime, n8n blocked by license

Apache 2.0 self-hostable runtime chosen over n8n whose Sustainable Use License prohibits commercial embedding

- Trigger.dev v3 selected as primary orchestration runtime for durable TypeScript workflows with Apache 2.0 license enabling commercial embedding
- n8n Sustainable Use License explicitly restricts making it available to customers or embedding as engine of paid product despite 400+ integrations
- BullMQ (MIT, Redis-only) identified as lightweight fallback requiring manual idempotency and orchestration glue
- Windmill AGPLv3 and Inngest SSPL licenses require compliance when re-exposing in commercial products
- Temporal MIT-licensed but operationally heavy requiring Go cluster plus database, disproportionate for solo builder
- Seven critical gaps identified requiring custom build: marketing-specific orchestration layer, cross-tool idempotency for Stripe/paid APIs, human approval gates, unified engagement tracking, marketing-aware scheduling, cost-aware execution guards, and operational simplicity trade-offs

## 2026-06-08 — Apollo.io and People Data Labs selected for ICP search layer

Apollo search endpoint returns ICP matches without consuming credits; PDL provides storable license-friendly bulk data

- Apollo.io mixed_people/api_search endpoint returns ICP-matching records WITHOUT consuming credits and returns no emails/phones
- Apollo API ToS forbids redistributing data and building competing service but search is free with credits only spent on enrichment/export
- People Data Labs provides storable license-friendly data layer at $98/mo entry with $0.20-0.28/record for warehousing and lookalike modeling
- Hunter is email-first and stableenrich is enrich-first (name→contact); neither provides rich ICP list-search index creating genuine gap
- ZoomInfo economics wrong for solo builder at $15K/yr floor with API access reportedly $50K/yr versus Apollo+PDL at under 1% cost
- Self-host enthec/webappanalyzer (GPLv3) for technographics instead of paying BuiltWith/Wappalyzer $250-995/mo except for reverse tech-stack lookups

## 2026-06-08 — Build quote generator on Stripe Quotes, self-host DocuSeal for e-signature

Stripe already provides Quotes API with auto-invoice and payment links; only customer-facing Accept page needs building

- Stripe Quotes API already connected produces quote PDF and on accept auto-creates payable draft invoice with hosted invoice page plus payment link
- Stripe Quotes provides NO customer-facing hosted accept page; accept happens via API/Dashboard requiring custom Accept UI to be built
- DocuSeal (AGPLv3, 17k+ stars, Ruby/Vue, lightest self-host) selected for legally-binding e-signature with REST API plus webhooks
- DocuSeal API/embedding require Pro license at ~$20/user/mo cloud or ~$240/yr per user on-prem plus $0.20 per signed document option
- PandaDoc API at $40/mo identified as strongest single-vendor doc+e-sign+payment REST API as buy-instead-of-host fallback
- Self-host Gotenberg (MIT, Docker, stateless) for HTML→PDF rendering; explicitly avoid wkhtmltopdf archived January 2023 with unpatched CVEs

## 2026-06-08 — Twenty CRM selected as self-hosted system-of-record with AGPL license

Auto-exposes every object over REST and GraphQL with webhooks; engine owns workflow state in separate Postgres schema

- Twenty CRM (AGPL-3.0) selected as self-hosted system-of-record auto-exposing every object over both REST and GraphQL with OAuth plus webhooks
- Twenty self-hosted via Docker is free with feature parity to cloud avoiding undocumented API rate limits (community reports ~100 tokens/60s)
- Engine maintains separate small Postgres/Supabase schema for run-state, idempotency keys, and tool-event ledger Twenty doesn't model
- Hunter stays as prospecting+sending only with engine syncing accepted leads into Twenty to avoid making email tool system-of-record
- Six critical gaps identified requiring engine build: cross-tool event reconciliation, idempotency+run-state for long-running workflows, multi-source payment reconciliation, bidirectional sync/dedup between Hunter and CRM, attribution joining windsor.ai to deals, and rate-limit handling
- Attio and Pipedrive avoided despite excellent APIs due to no data ownership and API metering conflicting with constantly-writing engine

## 2026-06-08 — Marketing/Sales Engine Architecture - Build vs Buy Strategy

Defined build-vs-buy plan for AI marketing engine: buy/self-host rails, build orchestration glue and quote-to-cash loop

- 42-agent research workflow completed analyzing marketing/sales automation landscape
- Core thesis: ~70% of revenue loop already owned (Hunter, Stripe, agentcash, windsor.ai), product is the orchestration runtime + unified state/event store
- Identified 4-part moat: closed funnel-to-cash loop, code-native git-versioned workflows, self-hosted no-metering, unified cross-tool state with audit trail
- 27 capabilities mapped to specific tools with integrate/self-host/build modes
- 12 build targets defined including Trigger.dev v3 orchestration runtime, Twenty CRM state store, multi-provider enrichment waterfall, unified event ledger
- 8 open questions identified covering own-use vs SaaS, self-host vs managed, MoR choice, channel priorities, budget constraints
- Competitors (Clay, Lindy, Relevance, Artisan, 11x) stop at meeting-booking; closing quote→invoice→collect loop is uncontested whitespace
- Reference architecture: Trigger.dev runtime → 5 layers (discovery/enrich, waterfall, content/LLM, send/post, pay/bill) → unified Twenty CRM + Postgres engine store
- 30 vendor claims fact-checked with 12 corrected or uncertain findings

Files: `.supergoal/research/landscape-brief.md`, `.supergoal/research/build-targets.md`, `.supergoal/research/open-questions.md`, `.supergoal/research/recommended-stack.md`, `.supergoal/research/raw-research.json`

## 2026-06-08 — Marketing/Sales Engine Supergoal Defined

Building comprehensive distribution engine; researching existing solutions before custom development

- Supergoal established to build marketing/sales engine covering posts, emails, customer discovery, contact information, quotes, invoices, and multi-source payments
- Strategic rationale: software development barrier eliminated by AI tools, real competitive moat now in distribution and sales
- Architecture decision: research and integrate existing usable solutions rather than rebuild from scratch
- Multi-agent orchestration (ultracode) requested for comprehensive research phase

## 2026-06-08 — Ports-and-Adapters Pattern with Sandbox-First Testing

Architecture enforces typed port interfaces, mock adapters for testing, and sandbox execution mode preventing live API calls

- Every external integration defined behind typed port interface (EmailSender, SocialPublisher, VoiceCaller, PaymentSource) with multiple concrete adapters per port
- Mock adapters in @engine/adapters/mocks mirror production adapters with invocation counters and canned responses for testing
- EXECUTION_MODE=sandbox default prevents live network calls; adapters honor mode by targeting provider sandboxes or short-circuiting
- No test may place real email send, social post, voice call, or payment charge; all tests wire mock adapters and fake timers
- Integration tests touching real provider sandboxes tagged and skipped unless INTEGRATION=1 environment variable set

Files: `.supergoal/phases/phase-6.md`, `.supergoal/phases/phase-8.md`, `.supergoal/phases/phase-9.md`, `.supergoal/phases/phase-10.md`

## 2026-06-10 — Consolidate Marketing Engine into Practical Systems as Mission Control Platform

Strategic decision to fold the marketing engine project into Practical Systems, making it a unified all-in-one platform.

- The marketing engine project is being merged/integrated into the Practical Systems platform.
- Practical Systems already has an automatic blog post system that the marketing engine will integrate with.
- Goal: Practical Systems becomes a "mission control" — a single hub for both the user and AI agents to operate from.
- The integration target is the existing automatic blog post system inside Practical Systems.
- Motivation is project consolidation to reduce fragmentation and centralize tooling.

## 2026-06-10 — GTM Engine Integration Strategy — Move As-Is Into Practical Systems, No Rewrite

applied-memories.md establishes that the GTM engine moves as-is (no rewrite) into Practical Systems, governed by an active CLAUDE.md rule prohibiting new repos until 2026-07-09.

- Integration strategy: move GTM engine as-is (no rewrite); its .supergoal/CONVENTIONS.md stays authoritative for the engine's internals.
- Source: C:\Projects\marketing (completed 15-phase GTM Revenue Engine) folds into C:\Projects\Practical Systems.
- Active CLAUDE.md rule: no new repos until 2026-07-09 — this consolidation satisfies the rule direction.
- Baseline constraints locked: pytest 260 / vitest 86 green, branch-then-merge-to-main-at-final-phase pattern, frozen send stack must not be extended.
- GTM engine internals (.supergoal/CONVENTIONS.md) remain authoritative for its ports/schema/policies post-integration.
- File created: C:\Projects\Practical Systems\.supergoal\applied-memories.md documenting all three applied memories for the integration run.

Files: `C:\Projects\Practical Systems\.supergoal\applied-memories.md`

## 2026-06-10 — GTM Dashboard Deprecated — Only Worker API Kept; No New Render Service This Run

repo-map.md codifies: GTM dashboard (Next.js 15, port 3000) is deprecated and will not be booted; GTM worker API (port 4010) is kept; Render stays at 3 services.

- GTM engine's apps/dashboard/ (Next.js 15) is DEPRECATED — will not be booted post-integration.
- GTM engine's apps/worker/ (Hono, port 4010) is kept as the live service endpoint.
- render.yaml will NOT get a new GTM service this run — local-first decision; Render stays at 3 services.
- GTM engine last green commit: d05418a (all 4 gates: pnpm build, typecheck, lint/biome, test/vitest).
- Final local port map: 3000 website, 3001 mission-control, 8765 pipeline API, 8766 content-pipeline, 4010 gtm worker.
- Work branch: feat/gtm-fold in Practical Systems; merge to main only at final phase.
- File created: C:\Projects\Practical Systems\.supergoal\repo-map.md as the authoritative two-repo map for the integration run.

Files: `C:\Projects\Practical Systems\.supergoal\repo-map.md`

## 2026-06-10 — Full Integration Architecture Locked — Strangler Fold, HTTP+HMAC Seam, Blog→Distribution Loop

THINKING.md documents the complete integration architecture: GTM engine physically moves to gtm-engine/, databases stay separate, seam is HTTP+HMAC webhook, not shared tables.

- Physical move: C:\Projects\marketing → Practical Systems/gtm-engine/ as a self-contained TS/pnpm service; marketing repo gets a MOVED pointer/freeze notice.
- Blog→distribution loop: when content-pipeline publishes a ContentPost, GTM engine automatically creates social-post drafts and email draft content — approval-gated, sandbox-default.
- Integration seam: HTTP + HMAC shared secret using the engine's existing webhook signature kit; idempotent on content_post_id (dedupe); notifier degrades gracefully when unconfigured.
- Databases stay completely separate: GTM keeps its own Postgres+Redis (Docker Compose); no schema merge with pipeline-tracker's DB.
- DashClaw governance bridge is explicitly OUT OF SCOPE for this run; engine keeps its own approvals/kill-switch surfaced in MC.
- New Mission Control "Marketing" section: approvals, kill-switch, costs, runs, distribution status — proxied to GTM worker API at port 4010 following app/api/company/* proxy pattern.
- launch.py will boot GTM by default with graceful skip when Docker unavailable (--no-gtm flag).
- GTM dashboard kept in tree as gtm-engine/apps/dashboard with DEPRECATED notice, excluded from launch.
- Worker API auth: API-key guard holds server-side in MC proxies; key lives in PS env, never in client code.
- Existing /content calendar page in MC extended (not duplicated) for distribution UI.

Files: `C:\Projects\Practical Systems\.supergoal\THINKING.md`

