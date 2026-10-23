// Renders public/icons/icon.svg to PNG icons using Playwright Chromium (no external services).
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const b = await chromium.launch();
const p = await b.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0], ['icon-512-maskable.png', 512, 0.1], ['favicon-32.png', 32, 0]]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:#0f766e"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
    <div style="width:${size * (1 - 2 * pad)}px;height:${size * (1 - 2 * pad)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body></html>`);
  await p.screenshot({ path: new URL('../public/icons/' + name, import.meta.url).pathname, omitBackground: false });
}
await b.close();
console.log('icons done');
