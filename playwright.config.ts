import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://127.0.0.1:8790' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node scripts/dev.mjs --e2e',
      url: 'http://127.0.0.1:8790/widget.js',
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 3000 },
      timeout: 60000,
    },
    {
      command: 'node scripts/dev-host.mjs --e2e',
      url: 'http://127.0.0.1:8791/',
      reuseExistingServer: false,
    },
  ],
});
