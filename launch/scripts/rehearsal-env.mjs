// Rehearsal helper: run a launch-engine CLI command with obviously-fake
// placeholder credentials so dry-run payloads print for every provider.
// Dry-run only — these values never reach a network call.
import { spawnSync } from 'node:child_process';

const FAKE_ENV = {
  X_API_KEY: 'fake', X_API_SECRET: 'fake', X_ACCESS_TOKEN: 'fake', X_ACCESS_SECRET: 'fake',
  FB_PAGE_ID: '123456', FB_PAGE_ACCESS_TOKEN: 'fake',
  LINKEDIN_ACCESS_TOKEN: 'fake', LINKEDIN_PERSON_URN: 'urn:li:person:fake',
  LINKEDIN_VERSION: '202506', LINKEDIN_TOKEN_ISSUED_AT: '2026-06-12',
  REDDIT_CLIENT_ID: 'fake', REDDIT_CLIENT_SECRET: 'fake', REDDIT_USERNAME: 'fake',
  REDDIT_PASSWORD: 'fake', REDDIT_USER_AGENT: 'launch-engine-rehearsal/0.1',
  GOOGLE_APPLICATION_CREDENTIALS: 'C:/fake/sa.json', GSC_SITE_URL: 'sc-domain:demoapp.io',
};

const args = process.argv.slice(2);
if (!args.includes('--dry-run')) {
  console.error('rehearsal-env.mjs only runs --dry-run commands (fake creds must never hit the network).');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['dist/index.js', ...args], {
  env: { ...process.env, ...FAKE_ENV },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
