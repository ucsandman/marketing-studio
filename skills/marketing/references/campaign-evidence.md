# Campaign effectiveness evidence — engine rules

What the strongest available evidence says makes campaigns work, distilled to rules
this engine can act on (researched 2026-07-12; sources inline). Read this when
synthesizing a brief, picking hook variants, or judging a storyboard. Numbers are
directional: platform data shifts, but the rankings have replicated for years.

## 1. Creative quality is the dominant lever — spend iteration there

NCSolutions/Nielsen (~450 sales-effect studies, 2023): creative drives ~49% of ad
sales contribution; targeting ~11%. Kantar (Link database + WARC ROMI): the most
creative ads generate ~4x the profit. Marketers systematically overrate targeting
and underrate creative.

**Engine rule:** hook A/B variants, copy iteration, and the quality-judge gates are
the highest-ROI machinery in this repo. Never skip the judges to save a render; never
spend a session tuning platform targeting while shipping one untested hook.

## 2. The hook decision window is 1.5-3 seconds, and most viewing is silent

Meta: winning Reels hooks land inside 1.5s. TikTok: 63% of highest-CTR videos hook
within 3s. Average thumb-stop rate is 25-35% (65-75% of views end before second 3).
~85% of Facebook video plays sound-off.

**Engine rules:**
- The hook act's FIRST frames must show motion/product, never a slow logo fade-in.
  Logo reveals open the logo-reveal asset, not the social clips.
- Burned captions are load-bearing, not garnish — the muted-autoplay captioned
  variants (render-matrix) are the primary deliverable for 9:16/1:1, and the video
  must communicate with the sound off (VO is additive).
- Judge the hook on a 3-second still sequence: would a scroller stop?

## 3. Emotional and rational cuts both matter — weight ~60/40

Binet & Field (IPA Databank, ~1,000 cases): optimal spend ≈ 60% brand/emotional,
40% activation/rational; emotional campaigns ~2x more likely to drive profit growth;
high-salience campaigns ~2x more likely to hit BOTH short- and long-term targets.
System1 (40k+ ads): 92% of ads scoring high on emotional response also spike
short-term sales — emotion is not a tradeoff against conversion.

**Engine rule:** an asset slate must not be 100% feature-demo. The launch video's
hook and end acts carry the emotional arc (problem tension → relief/ambition);
feature acts carry the rational proof. Hook A/B should include at least one
emotion-forward variant (story/contrarian categories) against a value variant.

## 4. Distinctiveness compounds — never reset the brand signature

Ehrenberg-Bass: consistent distinctive brand assets (mark, color, motion, audio
signature) raise attribution and recognition per exposure; brands grow through
broad reach, not loyalty deepening.

**Engine rules:** this is why brands/<id>.json + marks.ts + the motion personality
block exist — every asset in a launch reuses the SAME mark, palette, motion feel,
and music bed so exposures compound instead of resetting. judge-palette and
judge-motion enforce it mechanically. Distribute wide (all platforms in
platforms.json) rather than deep on one channel.

## 5. Sub-15s cutdowns are their own deliverable

TikTok clips under 15s average ~92% completion (2025 platform benchmarks;
directional). A trimmed long cut is not a short — shorts front-load the payoff
(tutorial-shaped content shows the END RESULT first).

**Engine rule:** when building vertical social clips, storyboard them as
payoff-first shorts, not compressed launch videos.

## 6. Design clips to be forwardable

Earned media is the most trusted ad form (Nielsen-family trust surveys, ~88-92%);
WOM-acquired customers show ~16% higher LTV; 10% more WOM ≈ 1.5% more sales
(Trusov et al. 2009).

**Engine rule:** every clip must work as a standalone repost — punchline inside the
clip (text overlay + first 3 seconds), no dependence on the surrounding post's
caption for the point to land.

## 7. Cadence: repetition works as an inverted U, not a magic number

Schmidt & Eisend meta-analysis (J. Advertising 2015): ad attitude peaks around ~10
exposures; recall grows roughly linearly through ~8; wear-out follows. Plan ~6-10
varied touches per channel over a campaign window — varied creative, same brand
signature.

**Engine rule:** the post kit and export matrix exist to make re-posting varied
creative cheap. A launch is a cadence: schedule follow-up posts from the same asset
suite (different hook variant, different aspect, feature highlight) rather than one
launch-day burst.

## Debunked — do not let these back into copy, briefs, or skills

- **"Rule of 7"** (7 exposures to convert): 1850s-era sales folklore; zero controlled
  studies. Use the inverted-U evidence above instead.
- **"8-second attention span / goldfish"**: fabricated stat (Microsoft Canada 2015
  citing an untraceable source; debunked by BBC 2017). Justify short hooks with
  platform thumb-stop data, never attention-span claims.

## Weakly-sourced (use as hypotheses, not facts)

- "Featured status = 70% of Product Hunt outcome variance" and "waitlist 400+ = 3-5x
  top-5 odds" — third-party PH analyses, plausible but not authoritative.
- "Sustained community presence converts 17x better than a PH spike" — single-blog
  funnel data; directionally consistent with the well-documented 80-90% traffic drop
  within 72h of a PH launch.
