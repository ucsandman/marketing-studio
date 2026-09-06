// node --test scripts/verify.test.mjs
//
// Exercises the pure parsers, row formatting, suite selection, and exit-code
// policy directly. Never runs the real four suites here — that is what
// `node scripts/verify.mjs` itself does; this file would otherwise take
// minutes and re-render the smoke stills on every test run.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sep} from 'node:path';
import {
  SUITE_NAMES,
  parseTapCounts,
  parseVitestCounts,
  parseLintCounts,
  parseSmokeCounts,
  formatRow,
  selectSuites,
  decideExit,
} from './verify.mjs';

// --- parseTapCounts: node --test's own tap summary -------------------------

test('parseTapCounts reads the real tap summary shape (node --test --test-reporter=tap)', () => {
  const text = '1..14\n# tests 14\n# suites 0\n# pass 14\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 398\n';
  assert.deepEqual(parseTapCounts(text), {tests: 14, pass: 14, fail: 0});
});

test('parseTapCounts reads a suite with real failures', () => {
  const text = '# tests 5\n# pass 3\n# fail 2\n';
  assert.deepEqual(parseTapCounts(text), {tests: 5, pass: 3, fail: 2});
});

test('parseTapCounts on empty/garbage output yields NaN tests, not a false zero-fail pass', () => {
  const counts = parseTapCounts('nothing here');
  assert.ok(Number.isNaN(counts.tests));
});

// --- parseVitestCounts -------------------------------------------------------

test('parseVitestCounts reads a clean vitest run summary', () => {
  const text = ' RUN  v4.1.10\n\n Test Files  24 passed (24)\n      Tests  232 passed (232)\n   Start at  04:48:31\n';
  assert.deepEqual(parseVitestCounts(text), {tests: 232, pass: 232, fail: 0});
});

test('parseVitestCounts reads a failing vitest run summary', () => {
  const text = ' Test Files  1 failed | 23 passed (24)\n      Tests  3 failed | 229 passed (232)\n';
  assert.deepEqual(parseVitestCounts(text), {tests: 232, pass: 229, fail: 3});
});

test('parseVitestCounts returns null when there is no Tests summary line', () => {
  assert.equal(parseVitestCounts('some unrelated crash output'), null);
});

// --- parseLintCounts ----------------------------------------------------------

test('parseLintCounts reads eslint\'s problems summary', () => {
  assert.deepEqual(parseLintCounts('\n✖ 5 problems (3 errors, 2 warnings)\n'), {problems: 5, errors: 3, warnings: 2});
});

test('parseLintCounts returns null on a clean run with no summary line', () => {
  assert.equal(parseLintCounts('> studio@1.0.0 lint\n> eslint src && tsc\n'), null);
});

// --- parseSmokeCounts -----------------------------------------------------

test('parseSmokeCounts reads the smoke OK line', () => {
  assert.deepEqual(parseSmokeCounts('smoke coverage: registry=13 smoke=13\nsmoke OK: 13 compositions rendered to C:\\out\n'), {
    compositions: 13,
    summary: '13 compositions rendered',
  });
});

test('parseSmokeCounts reads a smoke FAILED line as the summary', () => {
  const result = parseSmokeCounts('smoke FAILED: registry=13 smoke=12 missing=Foo stale=none');
  assert.equal(result.compositions, 0);
  assert.equal(result.summary, 'smoke FAILED: registry=13 smoke=12 missing=Foo stale=none');
});

// --- formatRow --------------------------------------------------------------

test('formatRow pads name and PASS/FAIL columns', () => {
  const row = {name: 'root', pass: true, summary: '605 passed, 0 failed', seconds: 2.8};
  assert.equal(formatRow(row), `root        PASS 605 passed, 0 failed 2.8s out${sep}verify${sep}root.log`);
});

test('formatRow marks a failing suite FAIL', () => {
  const row = {name: 'studio-lint', pass: false, summary: '2 errors, 0 warnings', seconds: 14.8};
  assert.match(formatRow(row), /^studio-lint FAIL 2 errors, 0 warnings 14\.8s /);
});

// --- selectSuites: order + filters ------------------------------------------

test('selectSuites with no options runs all four suites in the fixed order', () => {
  assert.deepEqual(selectSuites({}), SUITE_NAMES);
});

test('selectSuites --no-smoke drops smoke but keeps the other three in order', () => {
  assert.deepEqual(selectSuites({noSmoke: true}), ['root', 'studio-test', 'studio-lint']);
});

test('selectSuites --only picks a subset in SUITE_NAMES order, not the order given', () => {
  assert.deepEqual(selectSuites({only: ['smoke', 'root']}), ['root', 'smoke']);
});

test('selectSuites --only overrides --no-smoke (only wins when both given)', () => {
  assert.deepEqual(selectSuites({only: ['smoke'], noSmoke: true}), ['smoke']);
});

// --- decideExit: exit-code policy -------------------------------------------

test('decideExit: all suites passing exits 0', () => {
  const rows = SUITE_NAMES.map((name) => ({name, pass: true}));
  assert.equal(decideExit(rows), 0);
});

test('decideExit: any suite failing exits 1', () => {
  const rows = [{name: 'root', pass: true}, {name: 'studio-lint', pass: false}];
  assert.equal(decideExit(rows), 1);
});

test('decideExit: a suite that ran zero tests must have been marked pass:false upstream to fail the run', () => {
  // This is the L2 contract: parseTapCounts/parseVitestCounts/parseSmokeCounts
  // feed a pass:false row when their count is zero; decideExit just has to
  // honor that flag, which this asserts directly.
  const rows = [{name: 'root', pass: false}];
  assert.equal(decideExit(rows), 1);
});
