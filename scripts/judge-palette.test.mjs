// Unit tests for the pure helpers in judge-palette.mjs (import-safe: main()
// only runs when executed directly, matching build-magnetic-demo-media.mjs's
// isMain convention).
//
// Coverage gap under test: parseForbiddenColors only matches the literal
// pattern `never <color-word>` (regex /never\s+([a-z]+)/gi). noban's voice
// ("Profit is gold, never green.") hits that pattern directly. postflop's
// voice forbids yellow with a longer sentence — "never as a glow, wash,
// outline, or yellow text on paper" — where the word right after "never" is
// "as", not a color, so the whole rule is silently dropped. This is a real
// gap in a brand already in the repo, not a hypothetical: see the follow-up
// proposal in the coordinator handoff (structural forbiddenColors array).
//
// Run: node --test scripts/judge-palette.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseForbiddenColors} from './judge-palette.mjs';

const NOBAN_VOICE =
  'Instrument-grade trading terminal that speaks CS2. Terse, factual, no hype. Profit is gold, never green. Green means simulation/safe only. Red means loss/live/danger. Not esports-neon.';

// Verbatim from brands/postflop.json's voice field.
const POSTFLOP_VOICE =
  'BONE & RULE: an open-source heads-up NLHE GTO solver whose whole identity is a printed spec sheet. Bone paper #e9e5da chrome, ink #101010 with hard 3px black rules, zero radius, zero shadows, zero gradients. Yellow #ffe000 appears ONLY as a filled block carrying black text: never as a glow, wash, outline, or yellow text on paper. Magenta #ff2d9b is selection/focus only, never decoration. Display type is Archivo 900 uppercase; every figure is JetBrains Mono tabular. Voice: measured, exacting, printed. Every number is a real benchmark with provenance; convergence is measured, never asserted. No hype, no hedging, no exclamation marks. Anti-references: GTO-training-site gloss (glassy purple gradients, poker-chip stock photos, crush-your-opponents copy), generic SaaS hero templates, neon-felt crypto-casino gold. The product is the imagery: real workbench screenshots and real CLI output.';

test('parseForbiddenColors: noban voice hits the literal "never <color>" pattern', () => {
  assert.deepEqual(parseForbiddenColors(NOBAN_VOICE), ['green']);
});

test('parseForbiddenColors: postflop voice forbids yellow in a longer sentence and yields nothing TODAY (documents the gap; brand JSON is not the fix)', () => {
  assert.deepEqual(parseForbiddenColors(POSTFLOP_VOICE), []);
});

test('parseForbiddenColors: synthetic "never green" voice yields green', () => {
  assert.deepEqual(parseForbiddenColors('This palette must never green out under any circumstance.'), ['green']);
});
