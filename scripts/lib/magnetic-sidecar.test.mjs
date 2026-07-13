// node --test scripts/lib/magnetic-sidecar.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {discoverSidecar, callTool} from './magnetic-sidecar.mjs';

// Snapshots + restores the env vars every test in this file might touch, so
// tests never leak state into each other (node:test runs this file's tests
// in the same process).
const ENV_KEYS = ['MAGNETIC_AGENT_PORT', 'MAGNETIC_AGENT_TOKEN', 'APPDATA', 'HOME'];
function withEnv(overrides, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, overrides);
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}

// --- discoverSidecar ---------------------------------------------------

test('discoverSidecar: env vars win outright, even over a discovery file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magnetic-sidecar-test-'));
  try {
    mkdirSync(join(dir, 'magnetic'), {recursive: true});
    writeFileSync(join(dir, 'magnetic', 'agent-sidecar.json'), JSON.stringify({port: 9999, token: 'file-token'}));
    const result = withEnv(
      {MAGNETIC_AGENT_PORT: '5050', MAGNETIC_AGENT_TOKEN: 'env-token', APPDATA: dir},
      discoverSidecar,
    );
    assert.deepEqual(result, {port: 5050, token: 'env-token'});
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('discoverSidecar: falls back to the discovery file when no env vars are set ("magnetic" casing)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magnetic-sidecar-test-'));
  try {
    mkdirSync(join(dir, 'magnetic'), {recursive: true});
    writeFileSync(join(dir, 'magnetic', 'agent-sidecar.json'), JSON.stringify({port: 4242, token: 'file-token'}));
    const result = withEnv({APPDATA: dir}, discoverSidecar);
    assert.deepEqual(result, {port: 4242, token: 'file-token'});
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('discoverSidecar: falls back to the packaged "Magnetic" casing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magnetic-sidecar-test-'));
  try {
    mkdirSync(join(dir, 'Magnetic'), {recursive: true});
    writeFileSync(join(dir, 'Magnetic', 'agent-sidecar.json'), JSON.stringify({port: 4343, token: 'packaged-token'}));
    const result = withEnv({APPDATA: dir}, discoverSidecar);
    assert.deepEqual(result, {port: 4343, token: 'packaged-token'});
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('discoverSidecar: null when neither env vars nor a discovery file exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magnetic-sidecar-test-'));
  try {
    const result = withEnv({APPDATA: dir}, discoverSidecar);
    assert.equal(result, null);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('discoverSidecar: a malformed discovery file is treated as absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magnetic-sidecar-test-'));
  try {
    mkdirSync(join(dir, 'magnetic'), {recursive: true});
    writeFileSync(join(dir, 'magnetic', 'agent-sidecar.json'), 'not json');
    const result = withEnv({APPDATA: dir}, discoverSidecar);
    assert.equal(result, null);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// --- callTool ------------------------------------------------------------

test('callTool: no discovery -> "not reachable" hint naming the enable step', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magnetic-sidecar-test-'));
  try {
    await withEnv({APPDATA: dir}, () =>
      assert.rejects(() => callTool('read_timeline', {}), /Magnetic is not reachable.*Agent Access.*sidebar/s),
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('callTool: fetch reject (nothing listening on the discovered port) -> "Agent Access is switched off" hint', async () => {
  // A port nothing listens on causes fetch() to reject (ECONNREFUSED), the
  // same as the real bridge when Agent Access is toggled off mid-session.
  await withEnv({MAGNETIC_AGENT_PORT: '1', MAGNETIC_AGENT_TOKEN: 'x'}, () =>
    assert.rejects(() => callTool('read_timeline', {}), /Magnetic refused the connection.*Agent Access is switched off/),
  );
});

// Minimal stub sidecar: records every request it receives and replies with
// whatever handler() returns for that request.
function startStub(handler) {
  return new Promise((resolvePromise) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        const {status, payload} = handler(parsed, req);
        res.writeHead(status, {'content-type': 'application/json'});
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

test('callTool: success -> resolves with payload.result, sends {tool, input} + bearer token', async () => {
  let seen = null;
  const server = await startStub((body, req) => {
    seen = {body, authorization: req.headers.authorization};
    return {status: 200, payload: {result: {ok: true, echoedTool: body.tool}}};
  });
  try {
    const {port} = server.address();
    const result = await withEnv(
      {MAGNETIC_AGENT_PORT: String(port), MAGNETIC_AGENT_TOKEN: 'secret-token'},
      () => callTool('read_timeline', {foo: 'bar'}),
    );
    assert.deepEqual(result, {ok: true, echoedTool: 'read_timeline'});
    assert.deepEqual(seen.body, {tool: 'read_timeline', input: {foo: 'bar'}});
    assert.equal(seen.authorization, 'Bearer secret-token');
  } finally {
    server.close();
  }
});

test('callTool: payload.error -> throws that message verbatim (whole-call reject, e.g. allowlist)', async () => {
  const server = await startStub(() => ({
    status: 200,
    payload: {error: 'import_media rejected: "C:\\evil\\file.mp4" is outside every allowlisted folder'},
  }));
  try {
    const {port} = server.address();
    await withEnv({MAGNETIC_AGENT_PORT: String(port), MAGNETIC_AGENT_TOKEN: 'x'}, () =>
      assert.rejects(
        () => callTool('import_media', {paths: ['C:\\evil\\file.mp4']}),
        /is outside every allowlisted folder/,
      ),
    );
  } finally {
    server.close();
  }
});

test('callTool: non-ok HTTP status with no error field -> generic sidecar-answered-HTTP message', async () => {
  const server = await startStub(() => ({status: 500, payload: {}}));
  try {
    const {port} = server.address();
    await withEnv({MAGNETIC_AGENT_PORT: String(port), MAGNETIC_AGENT_TOKEN: 'x'}, () =>
      assert.rejects(() => callTool('read_timeline', {}), /sidecar answered HTTP 500/),
    );
  } finally {
    server.close();
  }
});
