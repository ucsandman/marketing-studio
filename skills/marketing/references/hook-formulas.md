# Hook formulas and CTA rules for brief synthesis

Adapted from Corey Haines' marketingskills (github.com/coreyhaines31/marketingskills,
MIT): `social` and `copywriting` skills. Read this when synthesizing `brief.json`
(hook.headline, hook.altHeadlines, cta, social.*) so hook A/B variants compare
STRATEGIES, not three phrasings of the same idea.

## The rule for altHeadlines

`hook.altHeadlines` gets up to two alternates (render-hook-variants caps at 3 total).
Draw the headline and each alternate from a DIFFERENT category below, and record the
category names in `hook.strategies` (index-aligned with [headline, ...altHeadlines]) —
the storyboard, hook picker, and Mission Control variant radio all display them.
A/B between two curiosity hooks teaches nothing; curiosity vs value vs contrarian does.

## Hook categories (with the source's formula lines)

**Curiosity** (open a specific gap the video then closes):
- "I was wrong about [common belief]."
- "The real reason [outcome] happens isn't what you think."
- "[Impressive result], and it only took [surprisingly short time]."

**Story** (arc compressed to one line):
- "Last week, [unexpected thing] happened."
- "I almost [big mistake/failure]."
- "3 years ago, I [past state]. Today, [current state]."

**Value** (the outcome, minus the pain):
- "How to [desirable outcome] (without [common pain])"
- "[Number] [things] that [outcome]"
- "Stop [common mistake]. Do this instead:"

**Contrarian** (bold claim the demo backs up):
- "Unpopular opinion: [bold statement]"
- "[Common advice] is wrong. Here's why:"
- "I stopped [common practice] and [positive result]."

**Landing-style headline formulas** (from the copywriting skill, good for the
launch video's hook act and OG statics):
- "{Achieve outcome} without {pain point}"
- "The {category} for {audience}"
- "Never {unpleasant event} again"
- "{Question highlighting the main pain point}"

Ground every bracket fill in the brief's `audience.painPoints`,
`customerLanguage.use`, and `switchingForces` sections; a formula filled with
generic praise is worse than no formula.

## Vertical/short-form: the 3-second rule

The first second of a 9:16 clip needs three hooks at once:
`[VISUAL HOOK] + [VERBAL HOOK] + [TEXT OVERLAY]`. In this pipeline that means the
hook act's first frames already show the product moving (visual), the `hook`-act
narration line opens with the problem or result (verbal), and the headline text is
on screen (overlay). Tutorial-shaped demos show the END RESULT first.

## CTA formula

`[Action Verb] + [What They Get] + [Qualifier if needed]`

- Weak (lint-copy WARNs on these): Submit, Sign Up, Learn More, Click Here, Get Started
- Strong: "Start Free Trial", "See [Product] in Action", "Create Your First [Thing]",
  "Simulate your first trade free"

The CTA says what they GET, not what to do. End-card and `brief.cta` both follow it;
`switchingForces.anxiety` tells you which reassurance the qualifier should carry
(free, no signup, local-only, etc.).

## Style rules the linter cannot fully check

- Specificity over vagueness: "Cut weekly reporting from 4 hours to 15 minutes"
  beats "Save time on your workflow". Every number needs a `proofPoints` source.
- Customer language over company language: mirror `customerLanguage.use` verbatim;
  never emit `customerLanguage.avoid` words.
- Active over passive, confident over qualified, one idea per act.
- Honest over sensational: a fabricated stat or testimonial is a hard stop
  (trust and legal liability), never a style tradeoff.
