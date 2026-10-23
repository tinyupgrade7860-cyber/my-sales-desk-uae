import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 4180);
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: { baseURL: `http://localhost:${PORT}/`, acceptDownloads: true, trace: 'retain-on-failure', serviceWorkers: 'allow' },
  webServer: { command: `npx sirv dist --port ${PORT} --host 127.0.0.1 --single`, url: `http://localhost:${PORT}/`, reuseExistingServer: true, timeout: 30_000 },
  projects: [
    { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 15 Pro'], browserName: 'webkit' } }
  ]
});
