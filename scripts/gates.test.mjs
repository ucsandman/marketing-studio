// node --test scripts/gates.test.mjs
//
// Uses small fake gate scripts written to a temp dir; never runs the real
// judges (those are slow, need ffmpeg/rendered assets, and are covered by
// their own *.test.mjs files).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  GATE_NAMES,
  HARD_GATES,
  buildPlan,
  pickPaletteInput,
  extractJson,
  summarize,
  runGate,
  formatRow,
  decideExit,
} from './gates.mjs';

function tmpScript(dir, name, source) {
  const path = join(dir, `${name}.mjs`);
  writeFileSync(path, source);
  return path;
}

// --- extractJson: pulls the JSON blob out of a gate's stdout ---------------

test('extractJson parses a stdout that is nothing but the JSON report', () => {
  assert.deepEqual(extractJson('{"verdict":"PASS","findings":[]}'), {verdict: 'PASS', findings: []});
});

test('extractJson tolerates trailing lines after the JSON blob (check-audio prints per-file lines after --json)', () => {
  const text = '{"checked":3,"failed":0,"skipped":1}\n  PASS  file.mp4\ncheck-audio [x]: PASS — checked=3 failed=0 skipped=1\n';
  assert.deepEqual(extractJson(text), {checked: 3, failed: 0, skipped: 1});
});

test('extractJson does not get confused by a brace inside a JSON string value', () => {
  assert.deepEqual(extractJson('{"message":"a { b } c"}'), {message: 'a { b } c'});
});

test('extractJson returns null for garbage with no JSON object', () => {
  assert.equal(extractJson('boom: something broke\nstack trace\n'), null);
});

test('extractJson returns null for an unterminated object', () => {
  assert.equal(extractJson('{"verdict":"PASS"'), null);
});

// --- summarize: verdict + counts line, per gate's own report shape --------

test('summarize: a judge report with only WARN findings is WARN, not PASS (spec example "3 findings, 0 FAIL")', () => {
  const json = {verdict: 'PASS', findings: [{level: 'WARN'}, {level: 'WARN'}, {level: 'WARN'}]};
  assert.deepEqual(summarize('av-sync', json), {verdict: 'WARN', counts: '3 findings, 0 FAIL'});
});

test('summarize: a judge report with a FAIL finding is FAIL', () => {
  const json = {verdict: 'FAIL', findings: [{level: 'FAIL'}, {level: 'WARN'}]};
  assert.deepEqual(summarize('motion', json), {verdict: 'FAIL', counts: '2 findings, 1 FAIL'});
});

test('summarize: a clean judge report with no findings is PASS', () => {
  assert.deepEqual(summarize('drift', {verdict: 'PASS', findings: []}), {verdict: 'PASS', counts: '0 findings, 0 FAIL'});
});

test('summarize: palette reports which input file the gate picked', () => {
  const json = {verdict: 'PASS', findings: [], input: {path: 'C:\\out\\truckside\\launch-final.mp4'}};
  assert.deepEqual(summarize('palette', json), {verdict: 'PASS', counts: '0 findings, 0 FAIL, input=launch-final.mp4'});
});

test('summarize: check-budgets has no verdict field — derived from overCount', () => {
  assert.deepEqual(summarize('budgets', {checked: 12, overCount: 0}), {verdict: 'PASS', counts: '12 checked, 0 over budget'});
  assert.deepEqual(summarize('budgets', {checked: 12, overCount: 2}), {verdict: 'FAIL', counts: '12 checked, 2 over budget'});
});

test('summarize: check-audio verdict is derived from failed, with a WARN for a recorded music-only film', () => {
  assert.deepEqual(summarize('audio', {checked: 3, failed: 0, skipped: 1}), {verdict: 'PASS', counts: 'checked=3 failed=0 skipped=1'});
  assert.deepEqual(summarize('audio', {checked: 3, failed: 1, skipped: 0}), {verdict: 'FAIL', counts: 'checked=3 failed=1 skipped=0'});
  assert.deepEqual(
    summarize('audio', {checked: 1, failed: 0, skipped: 0, film: {verdict: 'WARN'}}),
    {verdict: 'WARN', counts: 'checked=1 failed=0 skipped=0'},
  );
});

// --- buildPlan: canonical order, hard/judge classification, palette input --

test('buildPlan runs the seven gates in canonical order with drift last, regardless of --only order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  const plan = buildPlan({brand: 'x', project: dir, brandOut: dir, only: ['drift', 'av-sync', 'budgets']});
  assert.deepEqual(plan.map((p) => p.name), ['av-sync', 'budgets', 'drift']);
  assert.equal(plan.at(-1).name, 'drift');
});

test('buildPlan --skip removes a gate but keeps the rest in canonical order, drift still last', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  const plan = buildPlan({brand: 'x', project: dir, brandOut: dir, skip: ['palette', 'motion']});
  assert.deepEqual(plan.map((p) => p.name), GATE_NAMES.filter((n) => n !== 'palette' && n !== 'motion'));
  assert.equal(plan.at(-1).name, 'drift');
});

test('buildPlan with no filters covers all seven names in GATE_NAMES order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  const plan = buildPlan({brand: 'x', project: dir, brandOut: dir});
  assert.deepEqual(plan.map((p) => p.name), GATE_NAMES);
});

test('buildPlan marks only budgets and audio as hard gates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  const plan = buildPlan({brand: 'x', project: dir, brandOut: dir});
  for (const item of plan) assert.equal(item.hard, HARD_GATES.has(item.name), item.name);
});

test('buildPlan gives judge-palette an absolute video-or-png positional, never --strict to any child', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  writeFileSync(join(dir, 'launch-final.mp4'), 'x');
  const plan = buildPlan({brand: 'truckside', project: 'P', brandOut: dir});
  const palette = plan.find((p) => p.name === 'palette');
  assert.equal(palette.args[0], 'truckside');
  assert.equal(palette.args[1], join(dir, 'launch-final.mp4'));
  assert.deepEqual(palette.args.slice(2), ['--project', 'P', '--json']);
  for (const item of plan) assert.ok(!item.args.includes('--strict'), `${item.name} must never receive --strict`);
});

test('pickPaletteInput prefers launch-final.mp4, then launch.mp4, then falls back to og.png', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  assert.equal(pickPaletteInput(dir), 'og.png');
  writeFileSync(join(dir, 'launch.mp4'), 'x');
  assert.equal(pickPaletteInput(dir), 'launch.mp4');
  writeFileSync(join(dir, 'launch-final.mp4'), 'x');
  assert.equal(pickPaletteInput(dir), 'launch-final.mp4');
});

// --- runGate: real child process, fake script ------------------------------

test('runGate: a judge script printing valid JSON on stdout is classified from that JSON, log+json written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  const logDir = join(dir, 'logs');
  const script = tmpScript(dir, 'fake-judge', "console.log(JSON.stringify({verdict:'PASS',findings:[]}));\n");
  const row = runGate({name: 'motion', scriptPath: script, args: [], hard: false}, logDir);
  assert.equal(row.verdict, 'PASS');
  assert.equal(row.counts, '0 findings, 0 FAIL');
  assert.ok(existsSync(join(logDir, 'motion.log')));
  assert.deepEqual(JSON.parse(readFileSync(join(logDir, 'motion.json'), 'utf8')), {verdict: 'PASS', findings: []});
});

test('runGate: a hard gate that exits non-zero on a REAL fail is FAIL, not ERROR, as long as its JSON parses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  const logDir = join(dir, 'logs');
  const script = tmpScript(
    dir,
    'fake-budgets',
    "console.log(JSON.stringify({checked:5,overCount:2}));\nprocess.exit(1);\n",
  );
  const row = runGate({name: 'budgets', scriptPath: script, args: [], hard: true}, logDir);
  assert.equal(row.verdict, 'FAIL');
  assert.equal(row.counts, '5 checked, 2 over budget');
});

test('runGate: a crash with no parseable JSON is ERROR, carrying the last 3 lines, and still writes a log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  const logDir = join(dir, 'logs');
  const script = tmpScript(
    dir,
    'fake-crash',
    "console.error('boom: something broke');\nconsole.error('stack trace line 2');\nconsole.error('stack trace line 3');\nprocess.exit(2);\n",
  );
  const row = runGate({name: 'drift', scriptPath: script, args: [], hard: false}, logDir);
  assert.equal(row.verdict, 'ERROR');
  assert.equal(row.counts, 'boom: something broke | stack trace line 2 | stack trace line 3');
  assert.ok(existsSync(join(logDir, 'drift.log')));
  const errJson = JSON.parse(readFileSync(join(logDir, 'drift.json'), 'utf8'));
  assert.equal(errJson.error, true);
  assert.equal(errJson.status, 2);
});

test('runGate: check-audio-style trailing text after the JSON blob still parses cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  const logDir = join(dir, 'logs');
  const script = tmpScript(
    dir,
    'fake-audio',
    "console.log(JSON.stringify({checked:3,failed:0,skipped:1}));\nconsole.log('  PASS  file.mp4');\nconsole.log('check-audio [x]: PASS');\n",
  );
  const row = runGate({name: 'audio', scriptPath: script, args: [], hard: true}, logDir);
  assert.equal(row.verdict, 'PASS');
  assert.equal(row.counts, 'checked=3 failed=0 skipped=1');
});

// --- drift-last ordering, end to end through buildPlan + runGate ----------

test('the gates actually run in canonical order with drift last (fake scripts record their own invocation order)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gates-test-'));
  const orderFile = join(dir, 'order.log');
  writeFileSync(orderFile, '');
  const scriptOverrides = {};
  for (const name of GATE_NAMES) {
    scriptOverrides[name] = tmpScript(
      dir,
      `fake-${name}`,
      `import {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(orderFile)}, ${JSON.stringify(name)} + '\\n');\nconsole.log(JSON.stringify({verdict:'PASS',findings:[]}));\n`,
    );
  }
  const plan = buildPlan({brand: 'x', project: dir, brandOut: dir, scriptOverrides});
  const logDir = join(dir, 'logs');
  for (const item of plan) runGate(item, logDir);
  const order = readFileSync(orderFile, 'utf8').trim().split('\n');
  assert.deepEqual(order, GATE_NAMES);
  assert.equal(order.at(-1), 'drift');
});

// --- formatRow: fixed-width columns ----------------------------------------

test('formatRow pads the gate name and verdict columns', () => {
  const row = {name: 'audio', verdict: 'PASS', counts: 'checked=1 failed=0 skipped=0', seconds: 0.3};
  const line = formatRow(row, 'marketing/reports/gates/audio.log');
  assert.equal(line, 'audio       PASS  checked=1 failed=0 skipped=0 0.3s marketing/reports/gates/audio.log');
});

// --- decideExit: exit-code policy ------------------------------------------

test('decideExit: a hard gate FAIL exits 1 even without --strict', () => {
  const rows = [{name: 'budgets', hard: true, verdict: 'FAIL'}, {name: 'av-sync', hard: false, verdict: 'PASS'}];
  assert.equal(decideExit(rows, false), 1);
});

test('decideExit: a hard gate ERROR exits 1 even without --strict', () => {
  const rows = [{name: 'audio', hard: true, verdict: 'ERROR'}];
  assert.equal(decideExit(rows, false), 1);
});

test('decideExit: a judge FAIL is advisory — exits 0 without --strict', () => {
  const rows = [{name: 'motion', hard: false, verdict: 'FAIL'}];
  assert.equal(decideExit(rows, false), 0);
});

test('decideExit: a judge FAIL exits 1 WITH --strict', () => {
  const rows = [{name: 'motion', hard: false, verdict: 'FAIL'}];
  assert.equal(decideExit(rows, true), 1);
});

test('decideExit: a judge ERROR exits 1 WITH --strict, same as a FAIL', () => {
  const rows = [{name: 'motion', hard: false, verdict: 'ERROR'}];
  assert.equal(decideExit(rows, true), 1);
});

test('decideExit: WARN never fails the run, strict or not', () => {
  const rows = [{name: 'audio', hard: true, verdict: 'WARN'}, {name: 'motion', hard: false, verdict: 'WARN'}];
  assert.equal(decideExit(rows, false), 0);
  assert.equal(decideExit(rows, true), 0);
});

test('decideExit: an all-clean run exits 0', () => {
  const rows = GATE_NAMES.map((name) => ({name, hard: HARD_GATES.has(name), verdict: 'PASS'}));
  assert.equal(decideExit(rows, true), 0);
});
