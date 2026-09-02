import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const FAKE_KEYS = [
  'X_API_KEY',
  'X_API_SECRET',
  'X_ACCESS_TOKEN',
  'X_ACCESS_SECRET',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GSC_SITE_URL',
] as const;

const FAKE_ENV: NodeJS.ProcessEnv = { ...process.env };
for (const key of FAKE_KEYS) {
  FAKE_ENV[key] = ['pw', 'fake', key.toLowerCase()].join('-');
}

let child: ChildProcess;
let baseUrl: string;
let target: string;

test.beforeAll(async () => {
  target = await mkdtemp(join(tmpdir(), 'launch-smoke-'));
  await cp(join(HERE, 'fixtures', 'demo-app'), target, {
    recursive: true,
    filter: (src) => !src.includes('.launch'),
  });

  child = spawn(process.execPath, [join(HERE, '..', 'dist', 'index.js'), 'ui', '--no-open', '--port', '0'], {
    env: FAKE_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  baseUrl = await new Promise<string>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('launch ui did not print its URL in 15s')), 15_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      const match = /Launch dashboard: (\S+)/.exec(chunk.toString('utf8'));
      if (match?.[1]) {
        clearTimeout(timer);
        resolvePromise(match[1]);
      }
    });
    child.on('error', reject);
  });
});

test.afterAll(async () => {
  child?.kill();
  await rm(target, { recursive: true, force: true });
});

test('smoke: boot, pick, init, drafts, preview, confirm gate', async ({ page }) => {
  // --- boot: tokenized URL loads the shell, token never persists in the URL
  await page.goto(baseUrl);
  await expect(page.locator('.header__mark')).toContainText('LAUNCH');
  await expect(page.getByTestId('connection')).toContainText('console linked');
  expect(page.url()).not.toContain('token=');
  // --- pick the product via the folder browser
  await page.getByTestId('browse-button').click();
  await expect(page.getByTestId('folder-browser')).toBeVisible();
  for (const segment of target.split(sep).filter(Boolean)) {
    const entryName = segment.endsWith(':') ? segment + sep : segment;
    await page.getByTestId('fs-entry-' + entryName).click();
    await expect(page.getByTestId('browser-path')).toContainText(segment);
  }
  await page.getByTestId('select-folder').click();

  // --- init form: inline validation blocks, then a valid submit transitions
  await expect(page.getByTestId('init-form')).toBeVisible();
  await page.getByTestId('init-name').fill('');
  await page.getByTestId('init-submit').click();
  await expect(page.getByTestId('init-error-name')).toBeVisible();
  await expect(page.getByTestId('init-error-domain')).toBeVisible();

  await page.getByTestId('init-name').fill('demo-app');
  await page.getByTestId('init-domain').fill('smoke.dev');
  await page.getByTestId('init-price').fill('$1/mo');
  await page.getByTestId('init-submit').click();
  await expect(page.getByTestId('initialized-badge')).toBeVisible();

  // --- drafts: live counter + server rule violation rendered inline
  await page.getByTestId('tab-drafts').click();
  await page.getByTestId('draft-tab-hackernews').click();
  await page.getByTestId('hn-title').fill('smoke test title without the prefix');
  await expect(page.getByTestId('charcount').first()).toContainText('/80');
  await page.getByTestId('draft-save').click();
  await expect(page.getByTestId('violation-hn-title-prefix')).toBeVisible();

  // --- preview: $KEY_NAME placeholders, never env values
  await page.getByTestId('tab-preview').click();
  await expect(page.getByTestId('preview-google')).toContainText('$GSC_SITE_URL', { timeout: 20_000 });
  const bodyText = await page.locator('body').innerText();
  for (const key of FAKE_KEYS) {
    expect(bodyText, key + ' env value must not reach the DOM').not.toContain(FAKE_ENV[key] ?? '');
  }

  // --- post: type-to-confirm gate; assist-only platforms have no live control
  await page.getByTestId('tab-post').click();
  await expect(page.getByTestId('post-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('post-live-hackernews')).toHaveCount(0);
  await expect(page.getByTestId('post-live-producthunt')).toHaveCount(0);
  await expect(page.getByTestId('assist-open-hackernews')).toBeVisible();

  await page.getByTestId('post-live-x').click();
  const confirm = page.getByTestId('confirm-submit');
  await expect(confirm).toBeDisabled();
  await page.getByTestId('confirm-input').fill('smoke');
  await expect(confirm).toBeDisabled();
  await page.getByTestId('confirm-input').fill('smoke.dev');
  await expect(confirm).toBeEnabled();
  // Escape closes the modal — nothing was posted.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('confirm-modal')).toHaveCount(0);
});
