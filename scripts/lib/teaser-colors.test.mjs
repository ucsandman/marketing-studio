// F11: render-teaser.mjs did its color math at module top level next to a fetch,
// a mkdir and two execSync calls, so `node --test scripts/*.test.mjs` covered 0%
// of it. These are the pure parts, extracted so a bad mix() or a broken #rgb
// expansion fails here instead of in a client's rendered teaser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {norm, mix, luminance, groundFromLogoFills, teaserColors} from './teaser-colors.mjs';

// --- norm ---

test('norm accepts a 6-digit hex with or without the leading #', () => {
  assert.equal(norm('#3B82F6'), '#3b82f6');
  assert.equal(norm('3b82f6'), '#3b82f6');
  assert.equal(norm('  #3b82f6  '), '#3b82f6');
});

test('norm expands #rgb shorthand by doubling each digit', () => {
  assert.equal(norm('#f80'), '#ff8800');
  assert.equal(norm('#abc'), '#aabbcc');
  assert.equal(norm('000'), '#000000');
});

test('norm rejects anything that is not a hex color', () => {
  for (const bad of ['#ff', '#12345', 'rebeccapurple', '#gggggg', '']) {
    assert.throws(() => norm(bad), /bad hex/, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

// --- mix ---

test('mix at t=0 and t=1 returns the endpoints exactly', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
});

test('mix interpolates each channel and always pads to two digits', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  // 0x00 -> 0x0f at t=0.5 rounds to 0x08: the channel MUST keep its leading zero.
  assert.equal(mix('#000000', '#0f0f0f', 0.5), '#080808');
  assert.match(mix('#0e1014', '#3b82f6', 0.06), /^#[0-9a-f]{6}$/);
});

// --- luminance ---

test('luminance is 0 for black and 1 for white', () => {
  assert.equal(luminance('#000000'), 0);
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9);
});

test('luminance weights green above red above blue (WCAG coefficients)', () => {
  assert.ok(luminance('#00ff00') > luminance('#ff0000'));
  assert.ok(luminance('#ff0000') > luminance('#0000ff'));
});

// --- ground selection from an SVG logo ---

test('a dark wordmark asks for a light ground (it would vanish on near-black)', () => {
  const svg = '<svg><path fill="#0b1d33"/><path fill="#12233d"/></svg>';
  assert.equal(groundFromLogoFills(svg).theme, 'light');
});

test('a bright wordmark keeps the dark ground', () => {
  const svg = '<svg><path fill="#6fc3ff"/></svg>';
  assert.equal(groundFromLogoFills(svg).theme, 'dark');
});

test('pure black and pure white fills are ignored as uninformative', () => {
  const svg = '<svg><path fill="#000"/><path fill="#FFFFFF"/></svg>';
  const {theme, sampled, meanLuminance} = groundFromLogoFills(svg);
  assert.equal(sampled, 0);
  assert.equal(meanLuminance, null);
  assert.equal(theme, 'dark'); // no signal -> documented default
});

test('stroke and stop-color fills are sampled too, not just fill', () => {
  const svg = '<svg><stop stop-color="#0a1422"/><path stroke="#0c1626"/></svg>';
  assert.equal(groundFromLogoFills(svg).sampled, 2);
});

// --- the full palette ---

test('teaserColors derives a complete brandSchema colors object on a dark ground', () => {
  const colors = teaserColors({accent: '#3b82f6', dark: true});
  assert.deepEqual(Object.keys(colors).sort(), [
    'bg', 'brand', 'info', 'ink', 'ink2', 'ink3', 'line', 'loss', 'profit', 'rare', 'safe', 'surface', 'surface2',
  ]);
  for (const [key, value] of Object.entries(colors)) {
    assert.match(value, /^#[0-9a-f]{6}$/, `${key} is not a normalized hex: ${value}`);
  }
  assert.equal(colors.brand, '#3b82f6');
});

test('an explicit --bg overrides the derived ground but the neutral ramp follows it', () => {
  const colors = teaserColors({accent: '#3b82f6', dark: true, bg: '#0a2a1e'});
  assert.equal(colors.bg, '#0a2a1e');
  assert.notEqual(colors.surface, colors.bg); // ramp still moves toward ink
  assert.ok(luminance(colors.surface) > luminance(colors.bg));
});

// The CTA line is set in `profit`. These two guards are the whole reason the
// contrast pass exists, and neither was covered before.
test('a too-dark accent is lifted so the CTA stays legible on a dark ground', () => {
  const colors = teaserColors({accent: '#101a3a', dark: true});
  assert.ok(
    luminance(colors.profit) >= 0.25,
    `CTA luminance ${luminance(colors.profit)} is below the 0.25 floor on a dark ground`,
  );
});

test('a too-light accent is darkened so the CTA stays legible on a light ground', () => {
  const colors = teaserColors({accent: '#fff8d0', dark: false});
  assert.ok(
    luminance(colors.profit) <= 0.35,
    `CTA luminance ${luminance(colors.profit)} is above the 0.35 ceiling on a light ground`,
  );
});

test('ink flips with the ground', () => {
  assert.equal(teaserColors({accent: '#3b82f6', dark: true}).ink, '#fafafa');
  assert.equal(teaserColors({accent: '#3b82f6', dark: false}).ink, '#14181d');
});
