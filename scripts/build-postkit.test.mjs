import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trimToBudget, buildCaption, buildAlt, manifestEntry, buildManifest, PLATFORM_MAP} from './build-postkit.mjs';

// --- trimToBudget ---

test('text within budget is returned unchanged (after trim)', () => {
  assert.equal(trimToBudget('Hard spend caps on every trade', 280), 'Hard spend caps on every trade');
});

test('text at exactly the budget is unchanged', () => {
  const text = 'a'.repeat(50);
  assert.equal(trimToBudget(text, 50), text);
});

test('text over budget is cut at the last whitespace, never mid-word', () => {
  const text = 'CS2 skin arbitrage with guardrails and a live trading desk';
  const result = trimToBudget(text, 20);
  assert.ok(result.length <= 20, `expected <= 20 chars, got ${result.length}`);
  assert.equal(text.startsWith(result), true);
  assert.equal(text[result.length], ' '); // cut landed on a word boundary
});

test('a single word longer than the budget hard-cuts at the budget', () => {
  const text = 'a'.repeat(300);
  const result = trimToBudget(text, 280);
  assert.equal(result.length, 280);
});

test('leading/trailing whitespace is trimmed even when under budget', () => {
  assert.equal(trimToBudget('  hello world  ', 280), 'hello world');
});

test('empty/null/undefined input returns empty string', () => {
  assert.equal(trimToBudget('', 280), '');
  assert.equal(trimToBudget(null, 280), '');
  assert.equal(trimToBudget(undefined, 280), '');
});

test('never exceeds the requested budget across a range of lengths', () => {
  const text = 'Detected opportunities ranked by net dollars across every simulated trade in the ledger';
  for (const budget of [5, 10, 15, 22, 40, 100]) {
    const result = trimToBudget(text, budget);
    assert.ok(result.length <= budget, `budget ${budget}: got length ${result.length}`);
  }
});

// --- buildCaption ---

const brand = {name: 'noban.gg', tagline: 'CS2 skin arbitrage with guardrails'};

test('buildCaption falls back to brand tagline when brief is null', () => {
  const caption = buildCaption('x', null, brand);
  assert.equal(caption, brand.tagline);
});

test('buildCaption falls back to tagline when the platform sourceKey has no brief entry', () => {
  const brief = {hook: 'headline', social: {x: null, linkedin: null, vertical: null}};
  assert.equal(buildCaption('x', brief, brand), brand.tagline);
});

test('buildCaption always falls back to tagline for youtube (no sourceKey)', () => {
  const brief = {hook: 'headline', social: {x: {hook: 'h', headline: 'H'}, linkedin: null, vertical: null}};
  assert.equal(buildCaption('youtube', brief, brand), brand.tagline);
});

test('buildCaption uses the brief social entry when present', () => {
  const brief = {hook: 'headline', social: {x: {hook: 'Live trading, guardrails on', headline: 'Simulate free today'}, linkedin: null, vertical: null}};
  const caption = buildCaption('x', brief, brand);
  assert.match(caption, /Live trading, guardrails on/);
  assert.match(caption, /Simulate free today/);
});

test('buildCaption trims to the platform charBudget', () => {
  const longHook = 'x'.repeat(400);
  const brief = {hook: 'headline', social: {x: {hook: longHook, headline: 'H'}, linkedin: null, vertical: null}};
  const caption = buildCaption('x', brief, brand);
  assert.ok(caption.length <= PLATFORM_MAP.x.charBudget);
});

// --- buildAlt ---

test('buildAlt uses the brief hook when present', () => {
  const alt = buildAlt({hook: 'CS2 skin arbitrage with guardrails'}, brand);
  assert.match(alt, /noban\.gg/);
  assert.match(alt, /CS2 skin arbitrage with guardrails/);
});

test('buildAlt falls back to brand tagline when brief is null', () => {
  const alt = buildAlt(null, brand);
  assert.match(alt, new RegExp(brand.tagline));
});

// --- manifest ---

test('manifestEntry maps assembled artifacts to kit-relative paths', () => {
  const entry = manifestEntry('x', PLATFORM_MAP.x, {hasVideo: true, thumbFile: 'thumb.jpg', srtCopied: false, vttCopied: false});
  assert.deepEqual(entry, {
    video: 'x/social-16x9.mp4',
    caption: 'x/caption.txt',
    alt: 'x/alt.txt',
    thumb: 'x/thumb.jpg',
    srt: null,
    vtt: null,
    note: PLATFORM_MAP.x.note,
  });
});

test('manifestEntry uses null for missing artifacts (partial kit)', () => {
  const entry = manifestEntry('linkedin', PLATFORM_MAP.linkedin, {hasVideo: false, thumbFile: null, srtCopied: true, vttCopied: true});
  assert.equal(entry.video, null);
  assert.equal(entry.thumb, null);
  assert.equal(entry.srt, 'linkedin/launch.srt');
  assert.equal(entry.vtt, 'linkedin/launch.vtt');
});

test('buildManifest wraps platforms with version and brand', () => {
  const m = buildManifest('noban', '2026-07-11T00:00:00.000Z', {x: manifestEntry('x', PLATFORM_MAP.x, {hasVideo: false, thumbFile: null, srtCopied: false, vttCopied: false})});
  assert.equal(m.version, 1);
  assert.equal(m.brand, 'noban');
  assert.equal(m.generatedAt, '2026-07-11T00:00:00.000Z');
  assert.ok(m.platforms.x);
});
