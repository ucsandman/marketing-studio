---
name: launch
description: Use when a product or feature is ready to go public — after shipping, when the user says "launch it", "announce it", "go live", or wants a release marketed end to end.
---

# Launch: ship → announce → measure

Chains existing capabilities into one launch pass. Draft everything, send nothing without approval — external comms are a CLAUDE.md Hard Stop.

The announcement rules below are distilled from sharing research and current platform-algorithm behavior; the full notes (per-platform signal weights, HN/PH/Reddit norms, sources) are in `references/virality.md` — read it when drafting for a channel not covered here or when the user asks why a rule exists. For strategy above the per-post mechanics (ORB channel portfolio, five-phase rollout, relaunch cadence, measurement loop), read `references/strategy.md` — especially when planning a launch rather than executing one.

## 1. Pre-flight (verify, don't assume)

- Uncommitted work? Run `/ship` first.
- Prod deploy live: check latest deployment status/logs (offlocal `get_latest_deployment_logs` / Vercel tools).
- Domain resolves, HTTPS works, OG meta + title + favicon present: fetch the live page and look.
- UI-facing? Run `/de-vibe` if it hasn't had a pass.

## 2. Assets

- Changelog entry (one contiguous pasteable block).
- Screenshot or demo GIF: chrome-devtools `take_screenshot` or claude-in-chrome `gif_creator` against the live site. This is not optional garnish — visual proof of the thing working is the single most shared element of an indie launch post, and image posts get ~150% more reposts than text-only on X.
- Landing copy sanity: does the page pass the 10-second first-glance test?

## 3. Announcement drafts (draft only — approval gate before ANY send)

Write all of these, then stop and present for approval.

**What makes a draft spread (apply to every channel):**

- **Lead with a hook that opens a specific curiosity gap.** "I lost 40 hours to X before finding why" works; "here's a mistake to avoid" doesn't. Vague hooks get scrolled past; hooks the post doesn't deliver on burn trust and completion rate.
- **Emotional charge over safe-and-informational.** Research on 7,000 viral articles: high-arousal emotion (awe, anger, surprise) drives sharing; flat announcement copy fails regardless of accuracy. Find the surprising angle — the number, the contrarian take, the before/after — not "we're excited to announce."
- **Give the sharer social currency.** People share what makes them look in-the-know. Include one insider fact or usable takeaway that the reader can pass along as their own discovery.
- **Receipts beat claims.** A screenshot of the thing actually working (or the real dashboard number) out-spreads polished marketing copy. "Fast" is a claim; a 3-second GIF is proof.
- **No engagement bait** ("like if you agree", "comment YES") — every major platform now classifies and halves it.

**Per-channel drafts:**

- **X/Twitter**: hook first, attach the image/GIF natively. Put the link in the first reply, not the post body — external links in the body cut reach 50-90%. Thread for depth (adds ~60% impressions), single post for speed.
- **LinkedIn**: optimize for dwell time — a story with a real arc (problem → what broke → what shipped) that takes 15+ seconds to read gets a reach bonus. Post from the personal profile (~70% more reach than company pages). Link in comments, not the post.
- **Show HN** (dev-facing products): title "Show HN: <name> – <plain one-liner>", no superlatives, link to the product or repo, never a marketing page. Body: who you are → what it is in one sentence → the problem → how it works technically → ask for feedback. Engineer-to-engineer, not pitch deck.
- **Reddit** (only where the user has account history — 9:1 contribution ratio is tracked account-wide): frame as a story post (tech decision, pricing experiment, what went wrong) with the product as supporting detail. Standalone "check out my app" posts get auto-removed.
- **Discord/Telegram announcement.**
- **Email to list** (Resend) if one exists. If there's lead time, a 72-hour teaser → reminder → launch sequence converts 3-5x better than one cold send — offer it.

Copy rules (from CLAUDE.md, non-negotiable): no em dashes, no "delve/elevate/seamless" AI slop, write like a person, pasteable blocks with no mid-sentence newlines.

## 4. Publish (only after explicit approval, channel by channel)

- X/LinkedIn: claude-in-chrome through the logged-in browser session.
- Discord/Telegram: existing webhooks (curl).
- Email: Resend via offlocal (governed — DashClaw guard applies).

**The first hour decides distribution.** On X and LinkedIn, early replies weigh ~15-150x a like and visibility halves every ~6 hours; on HN, the comment thread IS the launch. So publishing is not the end of the step: tell the user to stay reachable for 1-2 hours, and monitor + draft substantive replies to early comments for their approval (sentence-length, technical, treat critics as allies). Never solicit upvotes or seed friendly comments — vote-ring detection on HN/PH kills the post.

## 5. Post-launch loop

- Offer a next-day check: PostHog funnel/pageviews + Stripe events + Sentry errors for the new surface. `/schedule` a one-time run if the user wants it automated.
- **A launch is a cadence, not a day.** One announcement is the weakest strategy; re-announcing the same product on milestones (new feature, revenue number, build-in-public moment) gives repeated shots at spread. Offer to draft a 2-4 week follow-up post plan from the roadmap/changelog.

## Failure modes

- Announcing before the deploy is verified live — pre-flight is not optional.
- Sending anything without the per-channel approval gate.
- Marketing copy that reads AI-generated — apply the copy rules to every draft, not just finals.
- Putting the link in the X/LinkedIn post body — it's the most reliable way to kill reach.
- Publishing and walking away — the unanswered first hour wastes the launch.
- "We're excited to announce" openers — zero curiosity gap, zero social currency, scrolled past.
