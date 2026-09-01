---
name: ship
description: Use when finished work needs to go out — the user says "ship it", "update docs commit and push", "commit and push", or asks "anything else we need to update?" before a release or at the end of a work session.
---

# Ship

Every ship is the same ritual: verify → docs → marketing site → sync surfaces → knowledge → version → secrets → de-vibe spot-check → self-check → commit → push. Work through the checklist in order; report what shipped and what was skipped.

**If the repo has its own ship skill (e.g. `/dashclaw-ship`), use that instead.**

## Checklist

1. **Scope check.** `git status`. If other agents are working in this repo or a scope lock is active, stage only files you changed this session — never `git add -A` blindly.
2. **Verify.** Run the repo's test/lint/build (discover from package.json / pyproject / CI config). Read the output. Failures block the ship — fix first, don't push red.
3. **Docs.** Update every doc the change touches, in this commit and not a later sweep: README run steps, changelog, and internal docs (`docs/`, ADRs, runbooks, architecture notes, the repo's own `CLAUDE.md` if a convention changed). New env vars → `.env.example` + docs. New scripts and APIs get request/response examples.
4. **Marketing site.** If a public surface exists — a `site/`, `web/`, `www/`, or `landing/` dir here, a separate site repo, or a URL in the README — open the pages this change affects and fix drift: feature lists, screenshots, pricing, version numbers, docs pages, changelog/release page. Rendered proof, not a grep. Say "no public site" out loud when there isn't one; never leave it unstated.
5. **Sync other surfaces.** Anything else this repo publishes beyond the code: SDK/CLI version references, skills/plugins/MCP manifests, generated docs, dashboards, package registry metadata. List each surface as checked or n/a.
6. **Knowledge capture.** Write down what this session learned, before it evaporates:
   - Durable architecture/product/stack decision → `docs/DECISIONS.md`.
   - Failure or lesson → `docs/ERRORS.md`. Full entry (symptom, root cause, fix, date) when debugging took multiple attempts; one line every time you broke something or Wes corrected you, even if the fix was instant. First occurrences must be logged or repeats are never countable.
   - Fact a future session needs and cannot derive from the code → a memory file in `~/.claude/projects/<project-slug>/memory/` plus its one-line pointer in that dir's `MEMORY.md`. That is a different repo, so it gets its own commit.
   - A lesson that has now repeated → promote it to a rule in this repo's `CLAUDE.md`.
   - Nothing durable this session? Say that explicitly.
7. **Version bump.** If a publishable package changed behavior, bump the version and changelog. Print the publish command for the user to run — never publish without explicit approval.
8. **Secrets scan.** Review the staged diff for secrets, tokens, private paths, `.env` files. Anything sensitive → unstage and flag.
9. **De-vibe spot-check.** Run the CRITICAL security greps and repo/git-tell checks from the de-vibe skill (`~/.claude/skills/de-vibe/references/code-tells.md` §1 and §5) against the staged diff and tracked files — committed `.env`, wildcard CORS, hardcoded keys, tracked AI artifacts (`.claude/`, `CLAUDE.md`, `.cursorrules`), attribution trailers not disabled, default title/favicon on web apps. Hits block the ship like a failed test. This is the spot-check only — for a project's first ship, or when the diff touches UI/marketing copy, suggest a full `/de-vibe` instead (audit + identity pass) and let the user decide.
10. **Assumption self-check. NEVER QUIZ WES (his explicit order, 2026-08-14).** Ask yourself the 3–5 questions a reviewer would probe — invariants relied on, rollback path, surfaces affected — and ANSWER THEM YOURSELF from the diff. Anything you cannot answer, investigate until you can. State the load-bearing assumptions as facts in the post-ship report, never as blocking questions. The only pre-ship questions allowed are the CLAUDE.md hard-stop categories (auth, billing, prod infra, prod-data migrations, destructive actions).
11. **Commit and push.** Message follows repo convention. Push, then confirm CI kicked off (and passes, if it's fast). Memory-dir changes get their own commit in `~/.claude`.
12. **Report.** State what shipped, docs updated, the marketing site verdict, surfaces synced, what you logged to DECISIONS/ERRORS/memory, version state, the assumptions you self-checked, and anything intentionally skipped.

## Common mistakes

- Claiming shipped while tests were never run — verify means reading the output, not launching the command.
- Committing another agent's in-flight changes.
- Forgetting non-code surfaces (marketing site, SDK version references) — steps 4 and 5 exist because these drifted repeatedly.
- Leaving the site, the internal docs, or the changelog for "a later sweep." There is no later sweep.
- Shipping a hard-won lesson with no ERRORS.md line and no memory file, so the next session pays for it again.
- Grepping the marketing copy instead of loading the page. A stale screenshot greps clean.
