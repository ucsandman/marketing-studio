---
name: ship
description: Use when finished work needs to go out — the user says "ship it", "update docs commit and push", "commit and push", or asks "anything else we need to update?" before a release or at the end of a work session.
---

# Ship

Every ship is the same ritual: verify → docs → sync surfaces → version → secrets → de-vibe spot-check → quiz → commit → push. Work through the checklist in order; report what shipped and what was skipped.

**If the repo has its own ship skill (e.g. a repo-specific `/<repo>-ship`), use that instead.**

## Checklist

1. **Scope check.** `git status`. If other agents are working in this repo or a scope lock is active, stage only files you changed this session — never `git add -A` blindly.
2. **Verify.** Run the repo's test/lint/build (discover from package.json / pyproject / CI config). Read the output. Failures block the ship — fix first, don't push red.
3. **Docs.** Update README, changelog, and docs affected by the change. New env vars → `.env.example` + docs. New scripts and APIs documented.
4. **Sync surfaces.** If this repo publishes beyond the code, check each surface for drift: SDK/CLI version references, marketing site claims, skills/plugins/MCP manifests, generated docs. List each surface as checked or n/a.
5. **Version bump.** If a publishable package changed behavior, bump the version and changelog. Print the publish command for the user to run — never publish without explicit approval.
6. **Secrets scan.** Review the staged diff for secrets, tokens, private paths, `.env` files. Anything sensitive → unstage and flag.
7. **De-vibe spot-check.** Run the CRITICAL security greps and repo/git-tell checks from the de-vibe skill (`~/.claude/skills/de-vibe/references/code-tells.md` §1 and §5) against the staged diff and tracked files — committed `.env`, wildcard CORS, hardcoded keys, tracked AI artifacts (`.claude/`, `CLAUDE.md`, `.cursorrules`), attribution trailers not disabled, default title/favicon on web apps. Hits block the ship like a failed test. This is the spot-check only — for a project's first ship, or when the diff touches UI/marketing copy, suggest a full `/de-vibe` instead (audit + identity pass) and let the user decide.
8. **Merge quiz.** Before committing, quiz the user with 3–5 questions on what the diff assumes — invariants relied on, rollback path, surfaces affected, behavior changes a reviewer would probe. Each question cites `file:line` in the staged diff. A wrong or unsure answer means investigate before pushing, not push anyway. Skip (and say so) for trivial mechanical diffs.
9. **Commit and push.** Message follows repo convention. Push, then confirm CI kicked off (and passes, if it's fast).
10. **Report.** State what shipped, surfaces synced, version state, quiz outcome, and anything intentionally skipped.

## Common mistakes

- Claiming shipped while tests were never run — verify means reading the output, not launching the command.
- Committing another agent's in-flight changes.
- Forgetting non-code surfaces (marketing site, SDK version references) — step 4 exists because these drifted repeatedly.
