// node --test scripts/mission-control.test.mjs
//
// Importing mission-control.mjs must never bind a port or touch argv: the
// module gates its server bootstrap behind an isMain check (matching
// review-in-magnetic.mjs / pull-magnetic-verdicts.mjs) precisely so this file
// can import its pure handler logic without starting the real HTTP server.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {latestVerdictsByAsset, runCliScript} from './mission-control.mjs';

// --- latestVerdictsByAsset ---------------------------------------------------
// review.json is APPEND-ONLY: Task 6's reviewer flagged that displaying it
// means reading the LATEST entry per assetId, never counting entries.

test('latestVerdictsByAsset: single entry per assetId', () => {
  const review = [{assetId: 'logo-reveal', action: 'approved', note: '', at: '2026-07-12T00:00:00.000Z'}];
  const byAsset = latestVerdictsByAsset(review);
  assert.equal(byAsset['logo-reveal'].action, 'approved');
});

test('latestVerdictsByAsset: same assetId appended twice -> latest entry wins, not the first', () => {
  const review = [
    {assetId: 'audio-track', action: 'redo', note: 'change the music', at: '2026-07-11T02:42:46.828Z'},
    {assetId: 'audio-track', action: 'approved', note: '', at: '2026-07-12T09:00:00.000Z'},
  ];
  const byAsset = latestVerdictsByAsset(review);
  assert.equal(byAsset['audio-track'].action, 'approved');
  assert.equal(byAsset['audio-track'].at, '2026-07-12T09:00:00.000Z');
});

test('latestVerdictsByAsset: never counts entries — 3 redo entries for one asset still yield exactly one verdict', () => {
  const review = [
    {assetId: 'launch-video', action: 'redo', note: 'a', at: '2026-07-10T00:00:00.000Z'},
    {assetId: 'launch-video', action: 'redo', note: 'b', at: '2026-07-11T00:00:00.000Z'},
    {assetId: 'launch-video', action: 'rejected', note: '', at: '2026-07-12T00:00:00.000Z'},
  ];
  const byAsset = latestVerdictsByAsset(review);
  assert.equal(Object.keys(byAsset).length, 1);
  assert.equal(byAsset['launch-video'].action, 'rejected');
});

test('latestVerdictsByAsset: distinct assetIds each keep their own latest entry', () => {
  const review = [
    {assetId: 'logo-reveal', action: 'approved', note: '', at: '2026-07-12T00:00:00.000Z'},
    {assetId: 'demo', action: 'rejected', note: '', at: '2026-07-12T00:00:01.000Z'},
  ];
  const byAsset = latestVerdictsByAsset(review);
  assert.equal(byAsset['logo-reveal'].action, 'approved');
  assert.equal(byAsset['demo'].action, 'rejected');
});

test('latestVerdictsByAsset: non-array input returns an empty map instead of throwing', () => {
  assert.deepEqual(latestVerdictsByAsset(null), {});
  assert.deepEqual(latestVerdictsByAsset(undefined), {});
});

test('latestVerdictsByAsset: entries missing a string assetId are skipped', () => {
  const review = [{action: 'approved'}, {assetId: 42, action: 'approved'}, {assetId: 'ok', action: 'approved'}];
  const byAsset = latestVerdictsByAsset(review);
  assert.deepEqual(Object.keys(byAsset), ['ok']);
});

// --- runCliScript -------------------------------------------------------------
// Task 7's brief: the inline error surface must show the CLI's stderr/exit
// message verbatim (the enable-Agent-Access hint has to reach the human's
// eyes). Fixture scripts stand in for review-in-magnetic.mjs / pull-magnetic-
// verdicts.mjs so this never touches the real out/ tree or a live sidecar.

const tmp = mkdtempSync(join(tmpdir(), 'mission-control-test-'));

test('runCliScript: successful child process -> {ok: true, stdout}', () => {
  const script = join(tmp, 'ok.mjs');
  writeFileSync(script, "console.log('review-in-magnetic: wrote out/x/marketing/magnetic-review.json');\n");
  const result = runCliScript(script, []);
  assert.equal(result.ok, true);
  assert.match(result.stdout, /magnetic-review\.json/);
});

test('runCliScript: failing child process -> {ok: false, error} carries stderr verbatim', () => {
  const script = join(tmp, 'fail.mjs');
  writeFileSync(
    script,
    "console.error('Magnetic is not reachable — open the editor and enable Agent Access in the sidebar (or set MAGNETIC_AGENT_PORT / MAGNETIC_AGENT_TOKEN).');\nprocess.exit(1);\n",
  );
  const result = runCliScript(script, []);
  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    'Magnetic is not reachable — open the editor and enable Agent Access in the sidebar (or set MAGNETIC_AGENT_PORT / MAGNETIC_AGENT_TOKEN).',
  );
});

test('runCliScript: forwards args to the child process', () => {
  const script = join(tmp, 'echo-args.mjs');
  writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  const result = runCliScript(script, ['dashclaw']);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.stdout), ['dashclaw']);
});

test('runCliScript: a hung child is killed at the timeout and reported loud, not waited on forever', () => {
  // Stands in for a sidecar that accepted the connection but never answers:
  // the child sleeps far past the injected timeout. execFileSync must kill it
  // and runCliScript must surface the timeout message (which the inline
  // error box renders) — never block mission-control's event loop unbounded.
  const script = join(tmp, 'hang.mjs');
  writeFileSync(script, 'setTimeout(() => {}, 60_000);\n'); // keeps the child alive 60s if not killed
  const started = Date.now();
  const result = runCliScript(script, [], {timeoutMs: 500});
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.match(result.error, /review CLI timed out after \ds — is Magnetic responding\?/);
  assert.ok(elapsed < 10_000, `child should be killed near the 500ms timeout, took ${elapsed}ms`);
});

test.after(() => {
  rmSync(tmp, {recursive: true, force: true});
});
