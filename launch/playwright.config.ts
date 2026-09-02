import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'ui-smoke.spec.ts',
  timeout: 60_000,
  retries: 0,
  use: {
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  reporter: [['line']],
});
