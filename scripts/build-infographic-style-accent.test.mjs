// node --test scripts/build-infographic-style-accent.test.mjs
// Regression (skeptic finding, 2026-09-01): an unknown textAccent used to pass
// validateBrand and bake the literal string "undefined" into the palette table.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBrand} from './build-infographic-style.mjs';

const FIXTURE = {
  id: 'fx',
  name: 'Fixture',
  tagline: 'A fixture brand',
  url: 'fixture.example',
  voice: 'Plain. Never green.',
  colors: {
    bg: '#101010', surface: '#181818', surface2: '#202020', line: '#303030',
    ink: '#f0f0f0', ink2: '#a0a0a0', ink3: '#707070',
    brand: '#ff8800', profit: '#00cc66', safe: '#0088ff', loss: '#ff3344', info: '#8844ff', rare: '#ffcc00',
  },
  fonts: {display: 'Saira', body: 'Inter', mono: 'JetBrains Mono'},
};

test('validateBrand: accepts every enum value and defaults to brand', () => {
  for (const k of ['brand', 'profit', 'safe', 'loss', 'info', 'rare']) {
    assert.equal(validateBrand({...FIXTURE, textAccent: k}).textAccent, k);
  }
  assert.equal(validateBrand(FIXTURE).textAccent, 'brand');
});

test('validateBrand: rejects a textAccent outside the brand.ts enum instead of baking "undefined"', () => {
  assert.throws(
    () => validateBrand({...FIXTURE, textAccent: 'yellow'}, 'fixture'),
    /textAccent must be one of brand, profit, safe, loss, info, rare, got "yellow"/,
  );
});
