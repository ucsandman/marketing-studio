// Source of truth for launch video copy: props/<brand>-launch.json is GENERATED
// by this script; edit copy here, never in the JSON (it gets clobbered).
//
// Usage: node scripts/build-launch-props.mjs [brand]   (default: noban)
//
// If out/<brand>/marketing/brief.json exists and validates, its COPY (headline,
// feature headings + lines, cta) overrides the hardcoded copy below; the
// screenshots/assets/demo structure always stays local. With no valid brief the
// output is byte-identical to the pre-brief builder (the compatibility contract).
import {readFileSync, existsSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const brand = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'noban';

// Per-brand launch composition. Each builder takes the brand's demo props (so the
// demo act's telemetry never drifts from the latest capture) and returns the
// LaunchVideo props. Brands with their own historical builder script
// (build-dashclaw-launch-props.mjs, build-paperroute-launch-props.mjs) are not
// duplicated here.
const BRANDS = {
  noban: (demo) => ({
    brandId: 'noban',
    kicker: 'noban.gg',
    headline: 'CS2 skin arbitrage with guardrails',
    demo: {video: demo.video, telemetry: demo.telemetry},
    features: [
      {
        screenshot: 'noban/governance.webp',
        heading: 'Guardrails, enforced in the backend',
        lines: [
          'Hard spend caps on every trade',
          'Bannable operations never run automatically',
          'Kill switch halts execution instantly',
        ],
      },
      {
        screenshot: 'noban/ledger.webp',
        heading: 'Every trade, accounted for',
        lines: [
          'FIFO cost basis and realized gains',
          'Tax worksheet export for your accountant',
          'Signed provenance and ledger bundles',
        ],
      },
    ],
    cta: 'Simulate free at noban.gg',
    assets: {
      logoSequence: 'noban/logo-reveal',
      logoFrames: 90,
      loopSequence: 'noban/background-loop',
      loopFrames: 240,
    },
  }),

  // Voice (brands/costclaw.json): an honest receipt on white. Terse and technical,
  // leads with real numbers, commands in mono. Clay is graphic-only and never
  // carries text. No hype, no em dashes.
  costclaw: (demo) => ({
    brandId: 'costclaw',
    kicker: 'costclaw.io',
    headline: 'Your invoice is one number. The waste is in the logs.',
    demo: {video: demo.video, telemetry: demo.telemetry},
    // Feature stills are cropped from the approved audit run by
    // scripts/build-costclaw-feature-stills.mjs (real product surfaces only).
    features: [
      {
        screenshot: 'costclaw/feature-leak.png',
        heading: 'The leak, priced',
        lines: [
          'Real spend read from the logs on your disk',
          'Cache-miss exposure priced in dollars',
          'Fixes ranked by what each one recovers',
        ],
      },
      {
        screenshot: 'costclaw/feature-score.png',
        heading: 'No evidence, no score',
        lines: [
          'Six setup pillars scored from logs and settings',
          'Pillars without evidence read n/a, never invented',
          'Model misrouting priced against the cheaper model',
        ],
      },
      {
        screenshot: 'costclaw/feature-local.png',
        heading: 'Nothing leaves your machine',
        lines: [
          'Logs parsed in memory, locally',
          'Output is derived numbers only',
          'A tripwire test asserts nothing sensitive survives',
        ],
      },
    ],
    cta: 'Run the free audit on your own logs',
    command: 'npx costclaw audit',
    // Act lengths widened from the shared defaults so every approved narration line
    // in out/costclaw/marketing/brief.json fits at ~150 wpm plus a beat (the audio
    // pass scores this picture lock later). Defaults would clip hook (17 words in
    // 6.2s), each feature (15-21 words in 6.0s) and end (14 words in 5.0s).
    actLengths: {hook: 225, features: [230, 210, 285], end: 190},
    assets: {
      logoSequence: 'costclaw/logo-reveal',
      logoFrames: 90,
      loopSequence: null,
      loopFrames: 1,
    },
  }),

  // Voice (brands/phoneclaude.json): a hacker tool with real hands on a real iPhone.
  // Terse and technical, honest about limits. Blue is the action color; red is the
  // STOP kill switch ONLY, which is why the one red frame in this video is the
  // feature-stop still cropped straight out of the demo's stop beat. No hype, no
  // em dashes.
  phoneclaude: (demo) => ({
    brandId: 'phoneclaude',
    kicker: 'github.com/ucsandman/phone-claude',
    headline: 'Drive a real iPhone from Windows',
    demo: {video: demo.video, telemetry: demo.telemetry},
    // Feature stills are cropped from the approved demo capture by
    // scripts/build-phoneclaude-feature-stills.mjs (real surfaces only).
    features: [
      {
        screenshot: 'phoneclaude/feature-tree.png',
        heading: 'The real UI element tree',
        lines: [
          'Exact UI element tree, not OCR guesses',
          'tap_text("General") finds the button and taps it',
          'Live viewer streams the phone in your browser',
        ],
      },
      {
        screenshot: 'phoneclaude/feature-stop.png',
        heading: 'A stop button that actually stops it',
        lines: [
          'A red stop button freezes every action',
          'Ambiguous sends abort before typing',
          'Every message lands in an audit log',
        ],
      },
      {
        screenshot: 'phoneclaude/feature-signing.png',
        heading: 'A free Apple ID is enough',
        lines: [
          'Fixes the unsigned bundle Sideloadly leaves',
          'No paid account, no password scripting',
          'Doctor counts down the 7 day re-sign',
        ],
      },
    ],
    cta: 'Clone it free and drive your phone',
    command: 'python launch.py',
    // Act lengths widened from the shared defaults so every approved narration line
    // in out/phoneclaude/marketing/brief.json fits at ~150 wpm plus a beat (the audio
    // pass scores this picture lock later). Defaults would clip feature-0 (15 words
    // in 6.0s), feature-1 (20 words in 6.0s) and end (14 words in 5.0s). logo, hook
    // and the telemetry-derived demo act all fit the shared constants untouched.
    actLengths: {features: [210, 285, 210], end: 198},
    assets: {
      logoSequence: 'phoneclaude/logo-reveal',
      logoFrames: 90,
      loopSequence: null,
      loopFrames: 1,
    },
  }),
};

const build = BRANDS[brand];
if (!build) {
  console.error(
    `build-launch-props: no brand coverage for "${brand}" (have: ${Object.keys(BRANDS).join(', ')})`,
  );
  process.exit(1);
}

const demoPath = join(root, 'props', `${brand}-demo.json`);
if (!existsSync(demoPath)) {
  console.error(`build-launch-props: missing demo props ${demoPath}`);
  process.exit(1);
}
const launch = build(JSON.parse(readFileSync(demoPath, 'utf8')));

// Overlay Content Brief copy when a valid brief exists. Structural checks below
// mirror studio/src/lib/brief.ts (the canonical zod schema, used by the studio +
// tests) — same convention the build-*-audio scripts use to mirror launchTiming.
// A missing or malformed brief falls through to the hardcoded copy untouched, so
// output is byte-identical with no brief present.
const briefPath = join(root, 'out', brand, 'marketing', 'brief.json');
if (existsSync(briefPath)) {
  const brief = validBrief(readFileSync(briefPath, 'utf8'));
  if (!brief) {
    console.warn(`build-launch-props: out/${brand}/marketing/brief.json is invalid; using hardcoded copy`);
  } else {
    if (brief.hook.headline) launch.headline = brief.hook.headline;
    if (brief.cta) launch.cta = brief.cta;
    // Overlay copy by feature index; screenshots/structure stay local.
    brief.features.slice(0, launch.features.length).forEach((bf, i) => {
      if (bf.heading) launch.features[i].heading = bf.heading;
      if (bf.benefitLines.length) launch.features[i].lines = bf.benefitLines.slice(0, 3);
    });
  }
}

// Returns the parsed brief if it structurally matches brief.ts (only the copy
// fields this builder consumes are validated), otherwise null.
function validBrief(text) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return null;
  }
  if (!b || typeof b !== 'object') return null;
  if (typeof b.brandId !== 'string' || b.brandId.length === 0) return null;
  const hook = b.hook ?? {headline: '', altHeadlines: []};
  if (typeof hook.headline !== 'string') return null;
  const features = b.features ?? [];
  if (!Array.isArray(features)) return null;
  for (const f of features) {
    if (!f || typeof f.heading !== 'string') return null;
    if (!Array.isArray(f.benefitLines) || f.benefitLines.length > 3) return null;
    if (!f.benefitLines.every((l) => typeof l === 'string')) return null;
  }
  if (b.cta != null && typeof b.cta !== 'string') return null;
  return {hook, cta: typeof b.cta === 'string' ? b.cta : '', features};
}

writeFileSync(join(root, 'props', `${brand}-launch.json`), JSON.stringify(launch, null, 2) + '\n');
console.log(`wrote props/${brand}-launch.json`);
