import { test, expect } from '@playwright/test';
import { open, nav, save, idFromUrl } from './helpers';

test('service worker installs; app loads and accepts data entry while offline; data persists', async ({ page, context, browserName }) => {
  await open(page);
  // wait for SW to install + control the page
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15000 }).toBe(true);
  const cached = await page.evaluate(async () => { const ks = await caches.keys(); let n = 0; for (const k of ks) n += (await (await caches.open(k)).keys()).length; return n; });
  expect(cached).toBeGreaterThan(10);

  await context.setOffline(true);
  await expect(page.getByTestId('net-status')).toContainText('Offline');
  await page.reload(); // full reload with no network – served from SW cache
  await expect(page.getByTestId('net-status')).toContainText('Offline');
  await expect(page.getByRole('button', { name: '+ Add first customer' })).toBeVisible();

  // data entry offline
  await page.getByRole('button', { name: '+ Add first customer' }).click();
  await page.locator('input[name=name]').fill('Offline Entry Co (Fictional)');
  await save(page);
  const custId = idFromUrl(page);
  await nav(page, '/invoice-form?customer=' + custId);
  await page.locator('input[name=invoiceNo]').fill('INV-OFF-1');
  await page.locator('input[name=amount]').fill('1000');
  await save(page);
  await expect(page.getByTestId('inv-remaining')).toContainText('1,050.00');
  // PDF library (lazy chunk) also works offline
  await nav(page, '/customers/' + custId);
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cust-pdf').click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);

  await page.reload();
  await nav(page, '/customers/' + custId);
  await expect(page.getByTestId('cust-balance')).toContainText('1,050.00');
  await context.setOffline(false);
  await expect(page.getByTestId('net-status')).toContainText('Online');
  console.log(`[${browserName}] SW controlled, ${cached} cached entries, offline reload + entry OK`);
});
