import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the REAL running stack (Vite on :5180 proxying to Spring Boot on :8090).
 * Start both first (see docs/RUNNING.md), then: npm run e2e
 * Uses the locally installed Google Chrome (channel "chrome"), so no browser download is needed.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5180',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    timezoneId: 'Asia/Kathmandu',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } }, testIgnore: /mobile.spec.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' }, testMatch: /mobile\.spec\.ts/ },
  ],
});
