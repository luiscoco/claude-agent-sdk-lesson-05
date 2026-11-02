import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  use: {
    baseURL: 'http://127.0.0.1:4352',
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm start',
    env: { PORT: '4352' },
    url: 'http://127.0.0.1:4352/api/meta',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
  timeout: 30_000,
});
