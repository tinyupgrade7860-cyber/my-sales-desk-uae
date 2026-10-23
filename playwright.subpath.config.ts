// Runs the e2e suite against a build served under the GitHub Pages sub-path /my-sales-desk-uae/.
// Usage: npm run build:pages && npx playwright test -c playwright.subpath.config.ts
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
const PORT = Number(process.env.PORT || 4190);
export default defineConfig({
  ...base,
  reporter: [['list']],
  use: { ...base.use, baseURL: `http://localhost:${PORT}/my-sales-desk-uae/` },
  webServer: {
    command: `rm -rf .pages-root && mkdir -p .pages-root && cp -r dist .pages-root/my-sales-desk-uae && npx sirv .pages-root --port ${PORT} --host 127.0.0.1`,
    url: `http://localhost:${PORT}/my-sales-desk-uae/`, reuseExistingServer: false, timeout: 30_000
  }
});
