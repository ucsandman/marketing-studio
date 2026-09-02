// Dashboard rehearsal: boots `launch ui` against a temp fixture copy with
// obviously-fake placeholder credentials, exercises every read endpoint plus a
// dry-run preview over HTTP, and exits non-zero on any failure.
// Dry-run only — these values never reach a network call.
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'tests', 'fixtures', 'demo-app');

const FAKE_ENV = {
  X_API_KEY: 'fake', X_API_SECRET: 'fake', X_ACCESS_TOKEN: 'fake', X_ACCESS_SECRET: 'fake',
  GOOGLE_APPLICATION_CREDENTIALS: 'C:/fake/sa.json', GSC_SITE_URL: 'sc-domain:demoapp.io',
};

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const target = await mkdtemp(join(tmpdir(), 'launch-rehearsal-ui-'));
await cp(FIXTURE, target, { recursive: true, filter: (src) => !src.includes('.launch') });

const child = spawn(process.execPath, [join(HERE, '..', 'dist', 'index.js'), 'ui', '--no-open', '--port', '0'], {
  env: { ...process.env, ...FAKE_ENV },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const baseUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('launch ui did not start in 15s')), 15000);
  child.stdout.on('data', (chunk) => {
    const match = /Launch dashboard: (\S+)/.exec(String(chunk));
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  });
  child.on('error', reject);
});

const url = new URL(baseUrl);
const token = url.searchParams.get('token');
const origin = url.origin;

async function api(method, path, body) {
  const res = await fetch(origin + path, {
    method,
    headers: {
      'X-Launch-Token': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

try {
  const health = await api('GET', '/api/health');
  check('GET /api/health', health.status === 200 && health.json.data.name === '@marketing-studio/launch');

  const noToken = await fetch(origin + '/api/health');
  check('token guard (no token -> 403)', noToken.status === 403);

  const init = await api('POST', '/api/target/init', {
    dir: target, domain: 'rehearsal.dev', price: 'free',
  });
  check('POST /api/target/init', init.status === 200 && init.json.data.config.domain === 'rehearsal.dev');

  for (const path of [
    '/api/meta/platforms',
    '/api/products',
    '/api/fs',
    `/api/target?dir=${encodeURIComponent(target)}`,
    `/api/target/status?dir=${encodeURIComponent(target)}`,
    '/api/target/doctor',
    `/api/target/briefs?dir=${encodeURIComponent(target)}`,
    `/api/target/drafts?dir=${encodeURIComponent(target)}`,
  ]) {
    const res = await api('GET', path);
    check(`GET ${path.split('?')[0]}`, res.status === 200 && res.json.ok === true);
  }

  const preview = await api('POST', '/api/target/preview', { dir: target, platforms: ['google'] });
  const googlePreview = preview.json.data?.results?.[0];
  check(
    'POST /api/target/preview (google dry-run)',
    preview.status === 200 && googlePreview?.outcome === 'dry-run',
  );
  check(
    'preview uses $GSC_SITE_URL, never the env value',
    JSON.stringify(preview.json).includes('$GSC_SITE_URL') &&
      !JSON.stringify(preview.json).includes('sc-domain:demoapp.io'),
  );
} finally {
  child.kill();
  await rm(target, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nDashboard rehearsal: all green.' : `\nDashboard rehearsal: ${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
