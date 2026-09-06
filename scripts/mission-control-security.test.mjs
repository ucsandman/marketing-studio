import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const script = fileURLToPath(new URL('./mission-control.mjs', import.meta.url));

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

async function waitForServer(url, child, output) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode != null) throw new Error(`Mission Control exited ${child.exitCode}: ${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The child has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Mission Control did not start: ${output()}`);
}

test('live server rejects cross-site and non-JSON POSTs, then accepts its same-origin UI token', async (t) => {
  const productRoot = mkdtempSync(join(tmpdir(), 'mission-control-csrf-'));
  const marketingDir = join(productRoot, 'marketing', 'assets', 'acme', 'marketing');
  mkdirSync(join(productRoot, '.git'));
  mkdirSync(marketingDir, {recursive: true});
  mkdirSync(join(marketingDir, 'proof'), {recursive: true});
  writeFileSync(join(marketingDir, 'proof', 'style.png'), 'style');
  writeFileSync(join(marketingDir, 'proof', 'animatic.mp4'), 'animatic');
  writeFileSync(join(marketingDir, 'direction.json'), JSON.stringify({
    styleFrame: {
      artifact: 'marketing/assets/acme/marketing/proof/style.png',
      review: 'marketing/assets/acme/marketing/reviews/style.json',
    },
    animatic: {
      artifact: 'marketing/assets/acme/marketing/proof/animatic.mp4',
      review: 'marketing/assets/acme/marketing/reviews/animatic.json',
    },
  }));
  const runPath = join(marketingDir, 'run.json');
  writeFileSync(runPath, JSON.stringify({brand: 'acme', assets: [{id: 'proof', status: 'rendered'}]}) + '\n');

  const port = await freePort();
  const child = spawn(process.execPath, [script, 'acme', '--project', productRoot, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  t.after(async () => {
    if (child.exitCode == null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    }
    rmSync(productRoot, {recursive: true, force: true});
  });

  const origin = `http://127.0.0.1:${port}`;
  const page = await waitForServer(`${origin}/`, child, () => output);
  const html = await page.text();
  const token = html.match(/const CSRF_TOKEN = "([A-Za-z0-9_-]+)";/)?.[1];
  assert.ok(token, 'same-origin page receives a process-local token');
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  // Stage buttons read "Approve"/"Revise" (one-click contract change, 2026-09-06), not "Approve stage"/"Revise stage".
  assert.match(html, />Approve</);
  assert.match(html, />Revise</);
  const state = await (await fetch(`${origin}/state`)).json();
  assert.equal(state._stages.length, 2);
  assert.deepEqual(state._stages.map((stage) => stage.ready), [true, true]);

  const request = (requestOrigin, contentType) =>
    fetch(`${origin}/asset/proof`, {
      method: 'POST',
      headers: {origin: requestOrigin, 'content-type': contentType, 'x-mission-control-token': token},
      body: JSON.stringify({action: 'approve'}),
    });

  const forged = await request('https://evil.example', 'application/json');
  assert.equal(forged.status, 403);
  assert.equal(JSON.parse(readFileSync(runPath, 'utf8')).assets[0].status, 'rendered', 'rejected POST does not mutate');

  const wrongType = await request(origin, 'text/plain');
  assert.equal(wrongType.status, 415);
  assert.equal(JSON.parse(readFileSync(runPath, 'utf8')).assets[0].status, 'rendered', 'non-JSON POST does not mutate');

  const bodylessWithoutToken = await fetch(`${origin}/publish-bluesky`, {method: 'POST', headers: {origin}});
  assert.equal(bodylessWithoutToken.status, 403, 'bodyless consequential routes also require the token');

  const accepted = await request(origin, 'application/json; charset=utf-8');
  assert.equal(accepted.status, 200);
  assert.equal(JSON.parse(readFileSync(runPath, 'utf8')).assets[0].status, 'approved');
  assert.equal(output.includes(token), false, 'token is never logged');
});
