// node --test scripts/mission-control.test.mjs
//
// Importing mission-control.mjs must never bind a port or touch argv: the
// module gates its server bootstrap behind an isMain check (matching
// review-in-magnetic.mjs / pull-magnetic-verdicts.mjs) precisely so this file
// can import its pure handler logic without starting the real HTTP server.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  latestVerdictsByAsset,
  runCliScript,
  applyPosted,
  readJudges,
  snapshotApproved,
  EXPECTED_JUDGES,
} from './mission-control.mjs';

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

// --- applyPosted (POST /posted) ----------------------------------------------
// posts.json is the file scripts/fetch-results.mjs reads, so a bad row here
// becomes a metric that can never be fetched, and a duplicate row becomes a
// platform counted twice in the variant stats.

const postsDir = () => mkdtempSync(join(tmpdir(), 'mission-control-posts-'));

test('applyPosted: a url that is not http(s) is rejected with 400 and writes nothing', () => {
  const dir = postsDir();
  try {
    const path = join(dir, 'posts.json');
    for (const url of ['not-a-url', 'ftp://example.com/p', 'javascript:alert(1)', '', undefined]) {
      const r = applyPosted(path, {platform: 'x', url});
      assert.equal(r.status, 400, `${String(url)} must be rejected`);
      assert.match(r.body.error, /http or https/);
    }
    assert.equal(existsSync(path), false, 'a rejected post must not create posts.json');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('applyPosted: a valid url appends exactly one row, creating posts.json', () => {
  const dir = postsDir();
  try {
    const path = join(dir, 'posts.json');
    const r = applyPosted(path, {platform: 'x', url: 'https://x.com/acme/status/1', variant: 'hook-b'});
    assert.equal(r.status, 200);
    const rows = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].platform, 'x');
    assert.equal(rows[0].url, 'https://x.com/acme/status/1');
    assert.equal(rows[0].variant, 'hook-b');
    assert.ok(rows[0].postedAt, 'the row records when it was marked');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('applyPosted: a second post for the same platform replaces the row, never duplicates it', () => {
  const dir = postsDir();
  try {
    const path = join(dir, 'posts.json');
    // A hand-recorded row for another platform, already carrying metrics.
    writeFileSync(
      path,
      JSON.stringify([{platform: 'linkedin', url: 'https://linkedin.com/p/1', metrics: {likes: 9}}]) + '\n',
    );
    applyPosted(path, {platform: 'x', url: 'https://x.com/acme/status/typo', variant: 'hook-a'});
    applyPosted(path, {platform: 'x', url: 'https://x.com/acme/status/2', variant: 'hook-b'});

    const rows = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(rows.length, 2, 'correcting a URL must replace the row, not double the platform');
    const x = rows.find((r) => r.platform === 'x');
    assert.equal(x.url, 'https://x.com/acme/status/2');
    assert.equal(x.variant, 'hook-b');
    const li = rows.find((r) => r.platform === 'linkedin');
    assert.deepEqual(li.metrics, {likes: 9}, 'other platforms and their metrics survive untouched');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('applyPosted: an existing row keeps metrics already fetched for that platform', () => {
  const dir = postsDir();
  try {
    const path = join(dir, 'posts.json');
    writeFileSync(path, JSON.stringify([{platform: 'x', url: 'https://x.com/a/1', metrics: {likes: 4}}]) + '\n');
    applyPosted(path, {platform: 'x', url: 'https://x.com/a/2'});
    const rows = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].metrics, {likes: 4});
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// --- readJudges: the denominator is declared, not discovered -----------------
// A directory listing can only show the judges that RAN. Four green chips look
// identical whether the other three passed, were skipped, or crashed — so the
// full expected set has to be listed, missing ones included.

test('readJudges: 2 of 7 reports on disk still yields 7 rows, 5 of them never ran', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-control-judges-'));
  try {
    writeFileSync(
      join(dir, 'judge-drift.json'),
      JSON.stringify({
        judge: 'drift',
        verdict: 'PASS',
        generatedAt: '2026-07-04T00:00:00.000Z',
        input: {scored: 22},
        findings: [],
      }),
    );
    writeFileSync(
      join(dir, 'judge-motion.json'),
      JSON.stringify({
        judge: 'motion',
        verdict: 'FAIL',
        generatedAt: '2026-08-30T00:00:00.000Z',
        input: {sourceFiles: 9},
        findings: [{level: 'FAIL', message: 'tempo out of band'}, {level: 'WARN', message: 'easing'}],
      }),
    );

    const judges = readJudges(dir);
    assert.equal(judges.length, 7, 'every expected judge gets a row, present or not');
    assert.equal(judges.length, EXPECTED_JUDGES.length);
    assert.equal(judges.filter((j) => !j.ran).length, 5);

    const byName = Object.fromEntries(judges.map((j) => [j.judge, j]));
    assert.equal(byName.palette.verdict, 'NEVER RAN');
    assert.equal(byName['av-sync'].verdict, 'NEVER RAN');
    // check-budgets is exit-code only: it can never write a report, so calling
    // it "never ran" would be a lie the operator learns to ignore.
    assert.equal(byName['check-budgets'].verdict, 'NOT REPORTED');

    // The volume each verdict covered rides along, read back out of the report.
    assert.equal(byName.drift.volume, '22 scored');
    assert.equal(byName.motion.volume, '9 source files');
    // Age is rendered from generatedAt, so a July verdict beside an August one
    // reads stale — the timestamp must survive the read.
    assert.equal(byName.drift.generatedAt, '2026-07-04T00:00:00.000Z');
    assert.equal(byName.motion.fails, 1);
    assert.equal(byName.motion.warns, 1);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('readJudges: a judge report not in EXPECTED_JUDGES still gets a row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-control-judges-'));
  try {
    writeFileSync(join(dir, 'judge-newthing.json'), JSON.stringify({verdict: 'PASS', findings: []}));
    const judges = readJudges(dir);
    assert.equal(judges.length, EXPECTED_JUDGES.length + 1);
    assert.ok(judges.find((j) => j.judge === 'newthing'));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// --- snapshotApproved --------------------------------------------------------

test('snapshotApproved: copies the artifact into approved/<YYYY-MM-DD>/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-control-approved-'));
  try {
    mkdirSync(join(dir, 'social'), {recursive: true});
    writeFileSync(join(dir, 'social', 'clip.mp4'), 'render');
    const dest = snapshotApproved(dir, 'social/clip.mp4', {now: new Date('2026-09-01T12:00:00.000Z')});
    assert.equal(dest, join(dir, 'approved', '2026-09-01', 'social-clip.mp4'));
    assert.equal(readFileSync(dest, 'utf8'), 'render');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('snapshotApproved: two artifacts sharing a basename both land in the reference set', () => {
  // social/x/clip.mp4 and social/li/clip.mp4 are one collision away from
  // silently dropping an approved asset — the shrinking denominator judge-drift
  // exists to catch, reintroduced by the tool that feeds it.
  const dir = mkdtempSync(join(tmpdir(), 'mission-control-approved-'));
  try {
    mkdirSync(join(dir, 'social', 'x'), {recursive: true});
    mkdirSync(join(dir, 'social', 'li'), {recursive: true});
    writeFileSync(join(dir, 'social', 'x', 'clip.mp4'), 'x');
    writeFileSync(join(dir, 'social', 'li', 'clip.mp4'), 'li');
    const now = new Date('2026-09-01T12:00:00.000Z');
    const a = snapshotApproved(dir, 'social/x/clip.mp4', {now});
    const b = snapshotApproved(dir, 'social/li/clip.mp4', {now});
    assert.notEqual(a, b);
    assert.equal(readFileSync(a, 'utf8'), 'x');
    assert.equal(readFileSync(b, 'utf8'), 'li');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('snapshotApproved: a missing or escaping artifact returns null instead of failing the approval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-control-approved-'));
  try {
    assert.equal(snapshotApproved(dir, 'never-rendered.mp4'), null);
    assert.equal(snapshotApproved(dir, '../outside.mp4'), null);
    assert.equal(snapshotApproved(dir, null), null);
    assert.equal(existsSync(join(dir, 'approved')), false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test.after(() => {
  rmSync(tmp, {recursive: true, force: true});
});
