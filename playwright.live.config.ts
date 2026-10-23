// Runs the e2e suite against the live GitHub Pages deployment (no local server).
// Usage: npx playwright test -c playwright.live.config.ts [tests/e2e/offline.spec.ts]
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  reporter: [['list']],
  use: { ...base.use, baseURL: process.env.LIVE_URL || 'https://tinyupgrade7860-cyber.github.io/my-sales-desk-uae/' },
  webServer: undefined
});
