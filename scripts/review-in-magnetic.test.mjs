// node --test scripts/review-in-magnetic.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {
  parseDurationSec,
  videoAssets,
  withCumulativeStarts,
  buildOps,
  runDriver,
} from './review-in-magnetic.mjs';

// --- parseDurationSec ------------------------------------------------------

test('parseDurationSec: parses run.json\'s "<seconds>s" strings', () => {
  assert.equal(parseDurationSec('28.39s'), 28.39);
  assert.equal(parseDurationSec('10.0s'), 10.0);
  assert.equal(parseDurationSec('5.06s'), 5.06);
});

test('parseDurationSec: null for missing/unparseable/non-string values', () => {
  assert.equal(parseDurationSec(undefined), null);
  assert.equal(parseDurationSec(null), null);
  assert.equal(parseDurationSec('a while'), null);
  assert.equal(parseDurationSec(28.39), null);
});

// --- videoAssets ------------------------------------------------------------

test('videoAssets: keeps only single-file .mp4/.webm artifacts, in inventory order', () => {
  const run = {
    assets: [
      {id: 'logo-reveal', artifact: 'out/dashclaw/logo-reveal.mp4', duration: '5.06s'},
      {id: 'og-assets', artifact: 'out/dashclaw/og-image.png + og.mp4 + readme-demo.gif', duration: '5.06s'},
      {id: 'demo', artifact: 'out/dashclaw/demo.webm', duration: '28.39s'},
    ],
  };
  assert.deepEqual(videoAssets(run), [
    {key: 'logo-reveal', file: 'out/dashclaw/logo-reveal.mp4', fileName: 'logo-reveal.mp4', durationSec: 5.06},
    {key: 'demo', file: 'out/dashclaw/demo.webm', fileName: 'demo.webm', durationSec: 28.39},
  ]);
});

test('videoAssets: throws naming a video asset with no parseable duration', () => {
  const run = {assets: [{id: 'broken', artifact: 'out/dashclaw/broken.mp4', duration: null}]};
  assert.throws(() => videoAssets(run), /"broken".*no parseable "duration"/s);
});

test('videoAssets: empty/missing assets array yields no candidates', () => {
  assert.deepEqual(videoAssets({}), []);
  assert.deepEqual(videoAssets({assets: []}), []);
});

// --- withCumulativeStarts ---------------------------------------------------

test('withCumulativeStarts: each atSec is the sum of every earlier duration', () => {
  const assets = [
    {key: 'a', durationSec: 5},
    {key: 'b', durationSec: 10},
    {key: 'c', durationSec: 2.5},
  ];
  assert.deepEqual(withCumulativeStarts(assets).map((a) => a.atSec), [0, 5, 15]);
});

// --- buildOps ----------------------------------------------------------------

test('buildOps: append_clip then a green add_marker (named by key) per asset', () => {
  const assets = [
    {key: 'logo-reveal', atSec: 0, assetId: 'asset-1'},
    {key: 'demo', atSec: 5.06, assetId: 'asset-2'},
  ];
  assert.deepEqual(buildOps(assets), [
    {name: 'append_clip', input: {asset_id: 'asset-1'}},
    {name: 'add_marker', input: {at_sec: 0, text: 'logo-reveal', color: 'green'}},
    {name: 'append_clip', input: {asset_id: 'asset-2'}},
    {name: 'add_marker', input: {at_sec: 5.06, text: 'demo', color: 'green'}},
  ]);
});

// --- runDriver (fixture run.json + stub HTTP sidecar) -----------------------

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'review-in-magnetic-test-'));
}

function writeRunJson(root, brand, run) {
  const dir = join(root, 'out', brand, 'marketing');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run));
}

const FIXTURE_RUN = {
  assets: [
    {id: 'logo-reveal', artifact: 'out/dashclaw/logo-reveal.mp4', duration: '5.06s'},
    {id: 'og-assets', artifact: 'out/dashclaw/og-image.png + og.mp4 + readme-demo.gif', duration: '5.06s'},
    {id: 'demo', artifact: 'out/dashclaw/demo.webm', duration: '28.39s'},
  ],
};

// Minimal stub sidecar: dispatches on body.tool, records every call.
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

test('runDriver: happy path — imports only video assets, proposes once, writes the manifest', async () => {
  const root = tmpRoot();
  writeRunJson(root, 'dashclaw', FIXTURE_RUN);
  const {server, calls} = await startStub({
    import_media: (input) => ({
      status: 200,
      payload: {
        result: {
          assets: input.paths.map((p) => ({
            assetId: `asset-${p.split(/[\\/]/).pop()}`,
            fileName: p.split(/[\\/]/).pop(),
          })),
        },
      },
    }),
    propose_edits: () => ({status: 200, payload: {result: {ghostDiff: true}}}),
  });
  try {
    const {port} = server.address();
    const manifest = await withEnv({MAGNETIC_AGENT_PORT: String(port), MAGNETIC_AGENT_TOKEN: 'x'}, () =>
      runDriver({root, brand: 'dashclaw'}),
    );

    const importCall = calls.find((c) => c.tool === 'import_media');
    assert.equal(importCall.input.paths.length, 2, 'only the 2 VIDEO assets are imported (og-assets excluded)');
    assert.ok(importCall.input.paths.every((p) => /\.(mp4|webm)$/i.test(p)));

    const proposeCalls = calls.filter((c) => c.tool === 'propose_edits');
    assert.equal(proposeCalls.length, 1, 'exactly one propose_edits batch');
    assert.deepEqual(proposeCalls[0].input.ops, [
      {name: 'append_clip', input: {asset_id: 'asset-logo-reveal.mp4'}},
      {name: 'add_marker', input: {at_sec: 0, text: 'logo-reveal', color: 'green'}},
      {name: 'append_clip', input: {asset_id: 'asset-demo.webm'}},
      {name: 'add_marker', input: {at_sec: 5.06, text: 'demo', color: 'green'}},
    ]);

    assert.deepEqual(manifest.assets, [
      {key: 'logo-reveal', file: 'out/dashclaw/logo-reveal.mp4', fileName: 'logo-reveal.mp4', assetId: 'asset-logo-reveal.mp4'},
      {key: 'demo', file: 'out/dashclaw/demo.webm', fileName: 'demo.webm', assetId: 'asset-demo.webm'},
    ]);
    assert.match(manifest.proposedAt, /^\d{4}-\d{2}-\d{2}T/);

    const written = JSON.parse(readFileSync(join(root, 'out', 'dashclaw', 'marketing', 'magnetic-review.json'), 'utf8'));
    assert.deepEqual(written, manifest);
  } finally {
    server.close();
    rmSync(root, {recursive: true, force: true});
  }
});

test('runDriver: allowlist rejection surfaces the sidecar message verbatim and never proposes (whole-call semantics)', async () => {
  const root = tmpRoot();
  writeRunJson(root, 'dashclaw', FIXTURE_RUN);
  const {server, calls} = await startStub({
    import_media: () => ({
      status: 200,
      payload: {error: 'import_media rejected: "out/dashclaw/demo.webm" is outside every allowlisted folder'},
    }),
    propose_edits: () => ({status: 200, payload: {result: {}}}),
  });
  try {
    const {port} = server.address();
    await withEnv({MAGNETIC_AGENT_PORT: String(port), MAGNETIC_AGENT_TOKEN: 'x'}, () =>
      assert.rejects(
        () => runDriver({root, brand: 'dashclaw'}),
        /is outside every allowlisted folder/,
      ),
    );
    assert.equal(calls.filter((c) => c.tool === 'propose_edits').length, 0, 'propose_edits must never run after import_media rejects');
    assert.equal(existsSync(join(root, 'out', 'dashclaw', 'marketing', 'magnetic-review.json')), false);
  } finally {
    server.close();
    rmSync(root, {recursive: true, force: true});
  }
});

test('runDriver: unreachable sidecar rejects with the enable-Agent-Access hint', async () => {
  const root = tmpRoot();
  writeRunJson(root, 'dashclaw', FIXTURE_RUN);
  const appDataDir = mkdtempSync(join(tmpdir(), 'review-in-magnetic-appdata-'));
  try {
    await withEnv({APPDATA: appDataDir}, () =>
      assert.rejects(
        () => runDriver({root, brand: 'dashclaw'}),
        /Magnetic is not reachable.*Agent Access.*sidebar/s,
      ),
    );
    assert.equal(existsSync(join(root, 'out', 'dashclaw', 'marketing', 'magnetic-review.json')), false);
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appDataDir, {recursive: true, force: true});
  }
});

test('runDriver: no VIDEO assets in run.json fails loud, never calls the sidecar', async () => {
  const root = tmpRoot();
  writeRunJson(root, 'dashclaw', {assets: [{id: 'og-assets', artifact: 'out/dashclaw/og-image.png', duration: '1s'}]});
  try {
    await assert.rejects(() => runDriver({root, brand: 'dashclaw'}), /no VIDEO assets/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
