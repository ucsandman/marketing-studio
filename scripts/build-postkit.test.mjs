import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {trimToBudget, buildCaption, buildAlt, buildPostCaption, PLATFORM_MAP, resolvePostkitOutputDirectory} from './build-postkit.mjs';

const platforms = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'platforms.json'), 'utf8'));
const platformById = new Map(platforms.map((p) => [p.id, p]));

// --- trimToBudget ---

test('text within budget is returned unchanged (after trim)', () => {
  assert.equal(trimToBudget('Hard spend caps on every trade', 280), 'Hard spend caps on every trade');
});

test('text at exactly the budget is unchanged', () => {
  const text = 'a'.repeat(50);
  assert.equal(trimToBudget(text, 50), text);
});

test('text over budget is cut at the last whitespace, never mid-word', () => {
  const text = 'Buy, sell, and rent synthesizers with people who know the difference.';
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

const brand = {name: 'Synthacon', tagline: 'Gear near you, from people who play'};

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

test('buildPostCaption uses the selected post headline and caption', () => {
  const caption = buildPostCaption('x', {
    headline: 'Every synth has a next owner.',
    caption: 'Buy, sell, and rent synthesizers with people who know the difference.',
  });
  assert.match(caption, /Every synth has a next owner/);
  assert.match(caption, /Buy, sell, and rent synthesizers/);
});

test('a selected post kit writes below out/<brand>/posts/<id>/postkit', () => {
  assert.equal(
    resolvePostkitOutputDirectory('/repo', 'synthacon', 'next-owner'),
    join('/repo', 'out', 'synthacon', 'posts', 'next-owner', 'postkit'),
  );
});

// --- buildAlt ---

test('buildAlt uses the brief hook when present', () => {
  const alt = buildAlt({hook: 'Every synth has a next owner.'}, brand);
  assert.match(alt, /Synthacon/);
  assert.match(alt, /Every synth has a next owner\./);
});

test('buildAlt falls back to brand tagline when brief is null', () => {
  const alt = buildAlt(null, brand);
  assert.match(alt, new RegExp(brand.tagline));
});

// --- PLATFORM_MAP / platforms.json consistency ---

test('every PLATFORM_MAP videoSource resolves to an existing id in scripts/platforms.json', () => {
  for (const [platformKey, cfg] of Object.entries(PLATFORM_MAP)) {
    const baseId = cfg.videoSource.replace(/-captioned$/, '');
    assert.ok(platformById.has(baseId), `${platformKey}: videoSource '${cfg.videoSource}' has no matching platforms.json id`);
  }
});

test('no PLATFORM_MAP entry sources a LaunchVideo-backed row', () => {
  for (const [platformKey, cfg] of Object.entries(PLATFORM_MAP)) {
    const baseId = cfg.videoSource.replace(/-captioned$/, '');
    const row = platformById.get(baseId);
    assert.notEqual(row?.comp, 'LaunchVideo', `${platformKey}: videoSource '${cfg.videoSource}' is LaunchVideo-backed`);
  }
});
