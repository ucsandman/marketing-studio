// Unit tests for the pure helpers in build-cards.mjs plus one end-to-end
// --dry-run run over a fixture brief in a temp dir (no render, no out/ needed).
// Run: node --test scripts/build-cards.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {cardsFor, displaySource, splitClaim} from './build-cards.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'build-cards.mjs');

const fixtureBrief = {
  brandId: 'sidetap',
  hook: {headline: 'Your iPhone, driven from Windows', altHeadlines: [], strategies: []},
  positioning: {differentiator: 'Real hands on a real device'},
  proofPoints: [
    {claim: 'Cuts the tap loop to 1.4s on device', source: 'measured, iPhone 15'},
    {claim: 'Drives every installed app', source: 'README'},
  ],
};

test('splitClaim lifts the first figure out and keeps the rest as the label', () => {
  assert.deepEqual(splitClaim('Cuts the tap loop to 1.4s on device'), {
    value: '1.4s',
    label: 'Cuts the tap loop to on device',
  });
  assert.deepEqual(splitClaim('Cut cloud spend 31% in week one'), {
    value: '31%',
    label: 'Cut cloud spend in week one',
  });
});

test('splitClaim keeps a figureless claim as the hero rather than dropping it', () => {
  assert.deepEqual(splitClaim('Drives every installed app'), {
    value: 'Drives every installed app',
    label: '',
  });
});

test('cardsFor emits one stat card per proof point plus the hook quote card', () => {
  const cards = cardsFor(fixtureBrief, 'sidetap');
  assert.deepEqual(
    cards.map((c) => c.id),
    ['stat-1', 'stat-2', 'quote-hook'],
  );
  assert.deepEqual(cards[0].props, {
    brandId: 'sidetap',
    kind: 'stat',
    value: '1.4s',
    label: 'Cuts the tap loop to on device',
    source: 'measured, iPhone 15',
    kicker: 'sidetap',
    ctaUrl: null,
  });
  assert.equal(cards[2].props.kind, 'quote');
  assert.equal(cards[2].props.value, 'Your iPhone, driven from Windows');
  assert.equal(cards[2].props.label, 'Real hands on a real device');
});

test('cardsFor emits nothing for an empty brief', () => {
  assert.deepEqual(cardsFor({}, 'sidetap'), []);
});

test('--dry-run writes one props JSON per card and prints the counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cards-'));
  mkdirSync(join(dir, '.git'));
  const briefPath = join(dir, 'brief.json');
  writeFileSync(briefPath, JSON.stringify(fixtureBrief));
  const outDir = join(dir, 'cards');
  const stdout = execFileSync(
    process.execPath,
    [script, 'sidetap', '--project', dir, '--brief', briefPath, '--out', outDir, '--dry-run'],
    {encoding: 'utf8'},
  );
  assert.deepEqual(readdirSync(outDir).sort(), [
    'quote-hook-props.json',
    'stat-1-props.json',
    'stat-2-props.json',
  ]);
  assert.equal(JSON.parse(readFileSync(join(outDir, 'stat-1-props.json'), 'utf8')).value, '1.4s');
  assert.match(stdout, /3 props written from 2 proof points/);
});

test('a missing brief is a clean skip, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cards-'));
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, 'empty'));
  const stdout = execFileSync(
    process.execPath,
    [script, 'sidetap', '--project', dir, '--brief', join(dir, 'nope.json'), '--out', join(dir, 'empty'), '--dry-run'],
    {encoding: 'utf8'},
  );
  assert.match(stdout, /skipping \(0 cards from 0 proof points\)/);
  assert.deepEqual(readdirSync(join(dir, 'empty')), []);
});

test('a figureless proof point becomes a quote card, not a stat block', () => {
  const cards = cardsFor(
    {proofPoints: [{claim: 'Solved strategies are bit-identical for every thread count', source: 'README'}]},
    'postflop',
  );
  assert.equal(cards[0].props.kind, 'quote');
  assert.equal(cards[0].props.value, 'Solved strategies are bit-identical for every thread count');
});

test('displaySource replaces a Windows absolute path with a sanitized brand line', () => {
  assert.equal(
    displaySource('C:/Projects/tradesdesk/src/app/page.tsx (Get Truckside section)', 'Truckside'),
    'Verified in the Truckside source',
  );
});

test('displaySource replaces a repo-relative path with line numbers', () => {
  assert.equal(
    displaySource(
      'src/vendor/callclaw/booking.ts lines 85-119 (walks business hours and the lead-time cutoff; no appointment query)',
      'Truckside',
    ),
    'Verified in the Truckside source',
  );
});

test('displaySource passes a plain human citation through unchanged', () => {
  assert.equal(displaySource('measured, iPhone 15', 'Truckside'), 'measured, iPhone 15');
});

test('cardsFor with skipFigureless drops figureless proof points but keeps the hook', () => {
  const cards = cardsFor(fixtureBrief, 'sidetap', {skipFigureless: true});
  // fixtureBrief: '...1.4s...' carries a figure (kept); 'Drives every installed app' has none (dropped).
  assert.deepEqual(cards.map((c) => c.id), ['stat-1', 'quote-hook']);
});

test('--skip-figureless drops every figureless proof point, reports the count, and leaves other brands unaffected without it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cards-'));
  mkdirSync(join(dir, '.git'));
  const briefPath = join(dir, 'brief.json');
  writeFileSync(briefPath, JSON.stringify(fixtureBrief));
  const outDir = join(dir, 'cards');
  const stdout = execFileSync(
    process.execPath,
    [script, 'sidetap', '--project', dir, '--brief', briefPath, '--out', outDir, '--dry-run', '--skip-figureless'],
    {encoding: 'utf8'},
  );
  assert.match(stdout, /skipped 1 figureless proof points/);
  assert.deepEqual(readdirSync(outDir).sort(), ['quote-hook-props.json', 'stat-1-props.json']);
  assert.match(stdout, /2 props written from 2 proof points/);
});

test('the CLI routes every card source through displaySource before writing props', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cards-'));
  mkdirSync(join(dir, '.git'));
  const briefPath = join(dir, 'brief.json');
  writeFileSync(briefPath, JSON.stringify(fixtureBrief));
  const outDir = join(dir, 'cards');
  execFileSync(
    process.execPath,
    [script, 'sidetap', '--project', dir, '--brief', briefPath, '--out', outDir, '--dry-run'],
    {encoding: 'utf8'},
  );
  assert.equal(JSON.parse(readFileSync(join(outDir, 'stat-1-props.json'), 'utf8')).source, 'measured, iPhone 15');
  assert.equal(JSON.parse(readFileSync(join(outDir, 'stat-2-props.json'), 'utf8')).source, 'Verified in the sidetap source');
});
