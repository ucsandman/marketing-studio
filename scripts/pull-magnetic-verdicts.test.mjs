// node --test scripts/pull-magnetic-verdicts.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {mapVerdicts, runPull} from './pull-magnetic-verdicts.mjs';

// --- mapVerdicts -------------------------------------------------------------

const MANIFEST = {
  proposedAt: '2026-07-13T00:00:00.000Z',
  assets: [
    {key: 'logo-reveal', file: 'out/dashclaw/logo-reveal.mp4', fileName: 'logo-reveal.mp4', assetId: 'asset-1'},
    {key: 'demo', file: 'out/dashclaw/demo.webm', fileName: 'demo.webm', assetId: 'asset-2'},
    {key: 'social-x', file: 'out/dashclaw/social-x.mp4', fileName: 'social-x.mp4', assetId: 'asset-3'},
    {key: 'launch-video', file: 'out/dashclaw/launch.mp4', fileName: 'launch.mp4'}, // import failed: no assetId
    {key: 'audio-track', skipped: true},
  ],
};

test('mapVerdicts: fileName present on the timeline -> approved', () => {
  const timeline = '1. logo-reveal.mp4 [id=c1] [file=logo-reveal.mp4] — 0:0.0 to 0:5.1 (5.1s), source in 0:0.0';
  const verdicts = mapVerdicts(MANIFEST, timeline);
  assert.equal(verdicts['logo-reveal'], 'approved');
});

test('mapVerdicts: fileName absent from the timeline -> rejected', () => {
  const timeline = '1. logo-reveal.mp4 [id=c1] [file=logo-reveal.mp4] — 0:0.0 to 0:5.1 (5.1s), source in 0:0.0';
  const verdicts = mapVerdicts(MANIFEST, timeline);
  assert.equal(verdicts['demo'], 'rejected');
});

test('mapVerdicts: manifest asset with no assetId (import failed) -> unreviewed', () => {
  const timeline = '1. launch.mp4 [id=c1] [file=launch.mp4] — 0:0.0 to 0:10.0 (10.0s), source in 0:0.0';
  const verdicts = mapVerdicts(MANIFEST, timeline);
  assert.equal(verdicts['launch-video'], 'unreviewed');
});

test('mapVerdicts: skipped asset -> unreviewed', () => {
  const verdicts = mapVerdicts(MANIFEST, '');
  assert.equal(verdicts['audio-track'], 'unreviewed');
});

test('mapVerdicts: trimmed clip (same fileName, shorter duration) still -> approved', () => {
  // Manifest asset had a 28.39s source; the timeline shows a much shorter trim
  // of the same file. Presence is the test, not duration.
  const timeline = '2. demo.webm [id=c2] [file=demo.webm] — 5:0.0 to 5:8.0 (8.0s), source in 0:2.0';
  const verdicts = mapVerdicts(MANIFEST, timeline);
  assert.equal(verdicts['demo'], 'approved');
});

test('mapVerdicts: extra clips the user added themselves (fileName not in manifest) are ignored', () => {
  const timeline = [
    '1. logo-reveal.mp4 [id=c1] [file=logo-reveal.mp4] — 0:0.0 to 0:5.1 (5.1s), source in 0:0.0',
    '2. my-own-clip.mov [id=c2] [file=my-own-clip.mov] — 5:0.0 to 5:12.0 (12.0s), source in 0:0.0',
  ].join('\n');
  const verdicts = mapVerdicts(MANIFEST, timeline);
  assert.deepEqual(Object.keys(verdicts).sort(), [
    'audio-track',
    'demo',
    'launch-video',
    'logo-reveal',
    'social-x',
  ]);
  assert.equal(verdicts['logo-reveal'], 'approved');
});

test('mapVerdicts: connected-clip [file=] tags also count as survival', () => {
  const timeline = '- social-x.mp4 [id=c9] [file=social-x.mp4], lane 1, 4.0s attached to c1';
  const verdicts = mapVerdicts(MANIFEST, timeline);
  assert.equal(verdicts['social-x'], 'approved');
});

test('mapVerdicts: empty/missing manifest assets yields no verdicts', () => {
  assert.deepEqual(mapVerdicts({}, ''), {});
  assert.deepEqual(mapVerdicts({assets: []}, ''), {});
});

// --- runPull (fixture manifest + stub HTTP sidecar) --------------------------

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'pull-magnetic-verdicts-test-'));
}

function writeManifest(root, brand, manifest) {
  const dir = join(root, 'out', brand, 'marketing');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'magnetic-review.json'), JSON.stringify(manifest));
  return dir;
}

function startStub(handlers) {
  const calls = [];
  return new Promise((resolvePromise) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        calls.push(parsed);
        const {status, payload} = handlers[parsed.tool]
          ? handlers[parsed.tool](parsed.input)
          : {status: 500, payload: {error: `stub: no handler for tool "${parsed.tool}"`}};
        res.writeHead(status, {'content-type': 'application/json'});
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(0, '127.0.0.1', () => resolvePromise({server, calls}));
  });
}

const ENV_KEYS = ['MAGNETIC_AGENT_PORT', 'MAGNETIC_AGENT_TOKEN', 'APPDATA'];
async function withEnv(overrides, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}

const SIMPLE_MANIFEST = {
  proposedAt: '2026-07-13T00:00:00.000Z',
  assets: [
    {key: 'logo-reveal', file: 'out/dashclaw/logo-reveal.mp4', fileName: 'logo-reveal.mp4', assetId: 'asset-1'},
    {key: 'demo', file: 'out/dashclaw/demo.webm', fileName: 'demo.webm', assetId: 'asset-2'},
    {key: 'audio-track', skipped: true},
  ],
};

const TIMELINE_TEXT =
  '1. logo-reveal.mp4 [id=c1] [file=logo-reveal.mp4] — 0:0.0 to 0:5.1 (5.1s), source in 0:0.0';

test('runPull: happy path — writes review.json in Mission Control\'s exact array/atomic-write shape', async () => {
  const root = tmpRoot();
  const marketingDir = writeManifest(root, 'dashclaw', SIMPLE_MANIFEST);
  const {server} = await startStub({
    read_timeline: () => ({status: 200, payload: {result: {ok: true, text: TIMELINE_TEXT}}}),
  });
  try {
    const {port} = server.address();
    const verdicts = await withEnv({MAGNETIC_AGENT_PORT: String(port), MAGNETIC_AGENT_TOKEN: 'x'}, () =>
      runPull({root, brand: 'dashclaw'}),
    );

    assert.deepEqual(verdicts, {
      'logo-reveal': 'approved',
      demo: 'rejected',
      'audio-track': 'unreviewed',
    });

    const reviewPath = join(marketingDir, 'review.json');
    assert.ok(existsSync(reviewPath));
    const raw = readFileSync(reviewPath, 'utf8');
    assert.ok(raw.endsWith('\n'), 'byte convention: trailing newline like mission-control.mjs writes');
    const written = JSON.parse(raw);
    assert.ok(Array.isArray(written), 'review.json is an array, same as mission-control\'s redo log');
    assert.deepEqual(
      written.map((e) => ({assetId: e.assetId, action: e.action, note: e.note})),
      [
        {assetId: 'logo-reveal', action: 'approved', note: ''},
        {assetId: 'demo', action: 'rejected', note: ''},
        {assetId: 'audio-track', action: 'unreviewed', note: ''},
      ],
    );
    for (const entry of written) {
      assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/, 'entry carries an ISO "at" timestamp field, same as mission-control');
      assert.deepEqual(Object.keys(entry).sort(), ['action', 'assetId', 'at', 'note'], 'no invented fields');
    }
  } finally {
    server.close();
    rmSync(root, {recursive: true, force: true});
  }
});

test('runPull: merges onto an existing review.json (mission-control\'s own redo entries survive)', async () => {
  const root = tmpRoot();
  const marketingDir = writeManifest(root, 'dashclaw', SIMPLE_MANIFEST);
  const existing = [{assetId: 'logo-reveal', action: 'redo', note: 'too dark', at: '2026-07-01T00:00:00.000Z'}];
  writeFileSync(join(marketingDir, 'review.json'), JSON.stringify(existing, null, 2) + '\n');
  const {server} = await startStub({
    read_timeline: () => ({status: 200, payload: {result: {ok: true, text: TIMELINE_TEXT}}}),
  });
  try {
    const {port} = server.address();
    await withEnv({MAGNETIC_AGENT_PORT: String(port), MAGNETIC_AGENT_TOKEN: 'x'}, () =>
      runPull({root, brand: 'dashclaw'}),
    );
    const written = JSON.parse(readFileSync(join(marketingDir, 'review.json'), 'utf8'));
    assert.equal(written.length, 4, 'the prior redo entry plus 3 new verdict entries');
    assert.deepEqual(written[0], existing[0], 'prior entries are preserved untouched');
  } finally {
    server.close();
    rmSync(root, {recursive: true, force: true});
  }
});

test('runPull: missing manifest fails loud with the review-in-magnetic hint, never calls the sidecar', async () => {
  const root = tmpRoot();
  mkdirSync(join(root, 'out', 'dashclaw', 'marketing'), {recursive: true});
  try {
    await assert.rejects(
      () => runPull({root, brand: 'dashclaw'}),
      /run review-in-magnetic first/,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('runPull: unreachable sidecar rejects with the enable-Agent-Access hint, review.json untouched', async () => {
  const root = tmpRoot();
  const marketingDir = writeManifest(root, 'dashclaw', SIMPLE_MANIFEST);
  const appDataDir = mkdtempSync(join(tmpdir(), 'pull-magnetic-verdicts-appdata-'));
  try {
    await withEnv({APPDATA: appDataDir}, () =>
      assert.rejects(
        () => runPull({root, brand: 'dashclaw'}),
        /Magnetic is not reachable.*Agent Access.*sidebar/s,
      ),
    );
    assert.equal(existsSync(join(marketingDir, 'review.json')), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appDataDir, {recursive: true, force: true});
  }
});
