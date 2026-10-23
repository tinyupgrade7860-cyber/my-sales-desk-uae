import { expect, type Page } from '@playwright/test';

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

export async function open(page: Page, hash = '') {
  await page.goto('./' + (hash ? '#' + hash : ''));
  await expect(page.locator('.splash')).toHaveCount(0);
}
export async function nav(page: Page, hash: string) {
  await page.evaluate(h => { location.hash = h; }, hash);
  await page.waitForTimeout(150);
}
/** Click Save and wait until the app has written to IndexedDB and reloaded its state. */
export async function save(page: Page) {
  const v = await page.evaluate(() => (globalThis as any).__msdVersion || 0);
  await page.getByTestId('save').click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).__msdVersion || 0), { timeout: 8000 }).toBeGreaterThan(v);
  await page.waitForTimeout(50);
}
export const saveExpectError = (page: Page) => page.getByTestId('save').click();
export async function selectByLabel(page: Page, name: string, label: string | RegExp) {
  const sel = page.locator(`select[name=${name}]`);
  const opts = await sel.locator('option').allTextContents();
  const match = opts.find(o => typeof label === 'string' ? o.includes(label) : label.test(o));
  if (!match) throw new Error(`option ${label} not in ${name}: ${opts.join('|')}`);
  await sel.selectOption({ label: match });
}
export const idFromUrl = (page: Page) => page.url().split('/').pop()!.split('?')[0];
export async function loadDemo(page: Page) {
  await open(page);
  await page.getByTestId('load-demo').click();
  await expect(page.getByTestId('dash-stats')).toBeVisible();
}
