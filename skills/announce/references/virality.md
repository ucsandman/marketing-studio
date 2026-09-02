# Virality playbook — research notes behind the draft rules

Distilled from web research (2026-07): Berger & Milkman (Journal of Marketing Research 2012), Berger's STEPPS, Sprout Social / Hootsuite algorithm breakdowns, Buffer's thread experiment, lucasfcosta + markepear HN launch guides, Product Hunt / Indie Hackers / Reddit self-promo analyses.

## Why people share (platform-independent)

- **Arousal, not positivity** (Berger & Milkman, ~7,000 NYT articles): high-arousal emotions (awe, anger, anxiety) drive sharing; low-arousal ones (sadness, mild interest) suppress it even when the content is good. Flat, safe, informational posts fail regardless of accuracy.
- **Social currency** (STEPPS): people share what makes them look smart or in-the-know. Give the sharer insider knowledge — a stat most people don't know, a contrarian take with receipts — not consensus takes.
- **Practical value**: a usable takeaway (a number, a step, a resource) gives people a non-self-serving reason to share. Arousal gets the click; utility justifies the share.
- **Identity signaling**: people share things that say "this is who I am." A stance or in-group marker outperforms a neutral fact.
- **Curiosity gap** (Loewenstein): a specific unresolved claim ("I lost 40 clients before I figured out why") beats a generic tease ("here's a mistake to avoid"). Vague hooks get scrolled past; hooks the content doesn't deliver on tank completion rate, which algorithms then punish.

Common failure modes: no emotional charge; interchangeable-with-a-thousand-others content; reads-as-an-ad; trend-chasing after the peak; engagement bait ("like if you agree" — now algorithmically penalized on every major platform).

## X/Twitter

- Weighted engagement (open-sourced algorithm analyses): reply-then-author-replies-back ≈ 150x a like; repost ≈ 20x; reply ≈ 13.5x; bookmark ≈ 10x; like = 1x. Conversation is the ranking currency.
- **External links in the post body cut reach 50-90%** — the most consistent finding across sources. Put the link in the first reply, or lean on profile-link + screenshot.
- Distribution is decided in the first 30-60 minutes; visibility halves roughly every 6 hours. Reply to every early comment within 2-3 hours to keep the conversation signal firing.
- Native media wins: attached image ≈ 150% more reposts than text-only; native video > linked video. Threads: Buffer's experiment found +63% impressions vs single link-tweets — use threads for depth, single posts for speed.
- X Premium accounts get a structural 2-4x reach multiplier.

## LinkedIn

- Dwell time dominates: 15+ seconds of reading ≈ 40% reach bonus. Document/PDF carousels get 2-3x the dwell of text posts — currently the strongest native format.
- Comments ≈ 15x a like, and substance matters: sentence-length comments outrank one-word ones; a bait classifier halves reach on "comment YES if you agree" posts.
- First 30-60 minutes ("golden hour") of real discussion expands distribution to 2nd/3rd-degree connections. Reply to comments substantively in the first hour.
- Personal profiles get ~70% more reach than company pages. External links deprioritized. Keep ≥12 hours between posts. Tagging >5 people trips spam filters.

## Short-form video (TikTok/Reels/Shorts)

- Completion rate is king (TikTok's viral bar is now ~70%+ completion); hook must land in the first 3 seconds, but value must be sustained — front-load-then-coast is penalized.
- DM shares/sends are among the strongest signals (~3-5x a like on Reels). Burned-in captions (30%+ watch muted) and keyword-rich on-screen text feed content categorization.
- Unoriginal/watermarked content is ineligible for recommendation. TikTok caps hashtags at 5. YouTube Shorts is search-indexed — title/description SEO gives weeks of long-tail discovery, unlike TikTok/IG's 24-48h window.

## Show HN (Hacker News)

- Prefix "Show HN:", link straight to the product or repo (never a marketing page), title direct and specific — superlatives ("fastest", "best") get the tab closed.
- Structure that works (markepear): who you are → one-sentence what → problem → origin story → technical solution → what's technically different → ask for feedback. Engineer-to-engineer, not pitch deck.
- The comments ARE the launch: answer everything fast and technically (Fly.io's founder answered 53 comments). Treat critics as allies — find common ground first.
- Never solicit upvotes or seed friend comments; vote-ring detection kills the post. Timing optimization is mostly a myth — preparation and response speed matter more.

## Product Hunt / Indie Hackers

- Cold PH launches rarely break top 5 now; winners have a seeded audience engaging in the first hours. Reply to every comment on launch day.
- Conversion data (OpenHunts 2024): Indie Hackers ≈ 23% conversion per engaged post vs PH ≈ 3% per launch — IH brings buyers, PH brings traffic. Sequence: IH trust-building first, PH for the spike.

## Reddit

- "It's fine to be a Redditor with a website; it's not okay to be a website with a Reddit account." ~9:1 genuine-contribution-to-promo ratio, tracked account-wide.
- Standalone "check out my app" posts get auto-removed in r/SaaS, r/SideProject, etc. — frame around a story (tech decision, pricing experiment, pivot) with the product as supporting detail, or use the designated weekly threads.
- AutoModerator gates: account 30+ days old, 100+ comment karma, activity across 5+ subs. A pre-post modmail asking where the product fits often gets whitelisting.

## Launch cadence

- One big launch day is the weakest strategy. Re-announce the same product on a cadence: new features, milestones, revenue numbers, build-in-public moments — each is a fresh viral shot (the Pieter Levels model). Expect 6-8 weeks of consistent posting before meaningful traffic.
- Pre-launch seeding: 4-8 weeks of problem-focused content building toward the product beats "coming soon" teasers (one cited case: 450 demo requests pre-launch). A 72-hour warmup email sequence (teaser → reminder → launch) converts 3-5x better than a single cold launch email.
- Authenticity beats polish in the post itself: a real scene/moment (screenshot of the thing working, the messy desk, the actual Stripe dashboard) out-spreads marketing copy. Receipts beat claims — "$X MRR in Y days" without screenshots now reads as fake.
