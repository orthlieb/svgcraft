// @ts-check
import { defineConfig, devices } from '@playwright/test';

// The app is static files with no build step, so tests open index.html
// straight from disk (see tests/fixtures.js) — no web server needed.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 900 },
    colorScheme: 'dark',
    trace: 'retain-on-failure',
  },
});
