# Launch strategy layer — channels, phasing, cadence

Strategy-level guidance sitting above the per-channel mechanics in SKILL.md and
virality.md. Framework distilled from Corey Haines' marketingskills `launch` skill
(github.com/coreyhaines31/marketingskills, MIT); evidence notes from the 2026-07-12
campaign-effectiveness research (see the marketing skill's
references/campaign-evidence.md for sources and the debunked-myths list).

## ORB: classify every channel before spending on it

- **Owned** (email list, blog, changelog, community you run): compounds, no
  algorithm risk. The end state every other channel funnels into.
- **Rented** (X, LinkedIn, app stores, YouTube): speed and reach, zero stability —
  the algorithm owns the relationship. Use for spikes; convert followers to owned.
- **Borrowed** (guest posts, collabs, influencer/reviewer sends, podcasts): instant
  credibility transfer. One well-aimed unit beats broad blasts (the TRMNL case: one
  free device to a YouTuber → ~500K views → ~$500K sales).

Portfolio rule: a launch that is 100% rented is a spike with a 72-hour half-life
(observed 80-90% PH traffic drop within 72h). Every rented/borrowed push carries a
CTA into an owned channel.

## Five-phase rollout (not one launch day)

1. **Internal** — team/friends; catch the embarrassing bugs.
2. **Alpha** — hand-picked users; collect verbatim reactions (they feed the brief's
   customerLanguage).
3. **Beta** — wider invite; testimonials and case material accumulate here.
4. **Early access** — waitlist converts; scarcity does real work.
5. **Full launch** — the public burst (PH/HN/social), aimed at an audience that
   already exists.

Evidence note: pre-built audience is the strongest single predictor of launch
outcomes found (waitlist 400+ correlating 3-5x top-5 odds on PH; third-party data,
directional). The asset engine's job in phases 1-4 is teasers and access emails;
the full suite lands at phase 5.

## Product Hunt / HN, honestly weighted

- Featured status dominates PH outcomes and only ~10% get featured; 89% of surveyed
  founders wouldn't relaunch there. Treat PH/HN as one rented channel among several,
  not the campaign's success metric.
- PH tactics that still matter: launch-day availability (the comment thread IS the
  launch), a real demo video over a sizzle reel, hunter network warmed beforehand.
- Never solicit upvotes or seed comments — vote-ring detection kills the post
  (SKILL.md rule; applies here too).

## Launch repeatedly — the cadence plan

One announcement is the weakest strategy. Re-announce on real milestones: feature
ships, revenue/user numbers, build-in-public lessons, integrations. Evidence:
repetition effects peak around ~10 varied exposures (inverted-U; see
campaign-evidence.md §7 — and ignore the debunked "rule of 7").

Practical cadence from one /marketing asset suite:
- Week 0: full launch (hero video, winning hook variant).
- Week 1-2: feature-act cutdowns as standalone posts (different hook category).
- Week 2-3: results/receipts post (fetch-results numbers make this honest),
  vertical short from the matrix.
- Week 3-4: story post (what broke, what we learned) + README gif refresh.

Update-weighting: major updates get a mini-launch (new brief, new hook A/B);
medium updates get a social clip; minor updates get a changelog line. Do not
re-run the full pipeline for a patch note.

## Measurement closes the loop

After publishing, record post URLs + variant ids in
out/<brand>/marketing/posts.json and run `node scripts/fetch-results.mjs <brand>`
(X metrics via API, LinkedIn entered manually). Mission Control shows engagement
per hook variant; the winning CATEGORY (not just the winning sentence) feeds the
next brief's hook.strategies choice.
