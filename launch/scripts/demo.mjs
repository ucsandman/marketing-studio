// One-command demo: installs/builds if needed, stages a sample product with
// filled drafts + research briefs + contacts, then opens the launch dashboard
// pointed at it. Everything is fake/dry-run — nothing posts, nothing sends.
//
//   npm run demo            # build + stage + open the dashboard
//   npm run demo -- --no-open --port 4500   # flags pass through to `launch ui`
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, command, args, opts = {}) {
  console.log(`\n▲ ${label}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts });
  if (result.status !== 0) {
    console.error(`${label} failed (exit ${result.status ?? 'spawn error'}).`);
    process.exit(result.status ?? 1);
  }
}

// 1. Dependencies + build (skipped when already present and fresh enough).
if (!existsSync(join(ROOT, 'node_modules'))) {
  run('Installing dependencies (npm ci)', npmCmd, ['ci'], { shell: process.platform === 'win32' });
}
run('Building CLI + dashboard', npmCmd, ['run', 'build'], { shell: process.platform === 'win32' });

// 2. Stage a demo product in the system temp dir (re-created on every run).
const demoDir = join(tmpdir(), 'launch-engine-demo');
console.log(`\n▲ Staging demo product at ${demoDir}`);
await rm(demoDir, { recursive: true, force: true });
await mkdir(demoDir, { recursive: true });
await cp(join(ROOT, 'tests', 'fixtures', 'demo-app'), demoDir, {
  recursive: true,
  filter: (src) => !src.includes('.launch'),
});

const cli = join(ROOT, 'dist', 'index.js');
run('launch init', process.execPath, [cli, 'init', demoDir, '--domain', 'demoapp.io', '--price', '$9/mo']);
run('launch research --offline', process.execPath, [cli, 'research', demoDir, '--offline']);
run('launch copy --scaffold', process.execPath, [cli, 'copy', demoDir, '--scaffold']);
run('fill sample drafts', process.execPath, [join(ROOT, 'scripts', 'fill-sample-drafts.mjs'), demoDir]);

await writeFile(
  join(demoDir, '.launch', 'contacts.json'),
  JSON.stringify(
    {
      email: [
        { address: 'ada@example.com', name: 'Ada (demo)', consent: true },
        { address: 'grace@example.com', name: 'Grace (demo)', consent: false },
      ],
      sms: [{ number: '+15551230000', name: 'Demo SMS', consent: true }],
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

// 3. Open the dashboard. Fake creds make providers look configured so every
//    screen has content; they are not real and dry-run previews never send.
console.log('\n▲ Starting the dashboard (Ctrl+C stops it)');
console.log(`  In the app: "+ Browse…" to ${demoDir}, or it may already be in recents.\n`);
const fakeEnv = { ...process.env };
for (const key of ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET', 'FB_PAGE_ACCESS_TOKEN', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USERNAME', 'REDDIT_PASSWORD']) {
  fakeEnv[key] ??= ['demo', 'placeholder', key.toLowerCase()].join('-');
}
fakeEnv.FB_PAGE_ID ??= '123456';
fakeEnv.REDDIT_USER_AGENT ??= 'launch-engine-demo/0.1';
fakeEnv.GOOGLE_APPLICATION_CREDENTIALS ??= join(demoDir, 'no-real-key.json');
fakeEnv.GSC_SITE_URL ??= 'sc-domain:demoapp.io';

const ui = spawn(process.execPath, [cli, 'ui', ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: fakeEnv,
});
ui.on('close', (code) => process.exit(code ?? 0));
