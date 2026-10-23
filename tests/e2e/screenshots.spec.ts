import { test, expect } from '@playwright/test';
import { nav, loadDemo } from './helpers';

const dir = 'screenshots/';
test('capture mobile screenshots (402x874, fictional demo data)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'screenshots captured once, from the 402x874 Chromium project');
  await loadDemo(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: dir + '01-dashboard.png' });
  await page.screenshot({ path: dir + '01-dashboard-full.png', fullPage: true });

  await nav(page, '/customers/demo_c1');
  await expect(page.getByTestId('cust-balance')).toBeVisible();
  await page.screenshot({ path: dir + '02-customer-profile.png' });
  await page.screenshot({ path: dir + '02-customer-profile-full.png', fullPage: true });

  // pick the demo customer with the most open invoices so the multi-invoice allocation is visible
  let best = 'demo_c1', most = 0;
  for (let i = 1; i <= 8; i++) {
    await nav(page, '/collection-form?customer=demo_c' + i);
    const n = await page.getByLabel(/^Allocate to /).count();
    if (n > most) { most = n; best = 'demo_c' + i; }
  }
  await nav(page, '/collection-form?customer=' + best);
  await page.locator('input[name=receiptRef], input[name=ref]').first().fill('RCPT-DEMO-77').catch(() => {});
  const first = await page.getByLabel(/^Allocate to /).nth(0).getAttribute('aria-label');
  await page.locator('input[name=amount]').fill('30000');
  await page.getByTestId('auto-alloc').click();
  await page.getByTestId('auto-alloc').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await page.screenshot({ path: dir + '03-collection-allocation.png' });
  await page.screenshot({ path: dir + '03-collection-allocation-full.png', fullPage: true });

  await nav(page, '/reports');
  await expect(page.getByTestId('report-tabs')).toBeVisible();
  await page.screenshot({ path: dir + '04-reports-periods.png' });
  await page.getByTestId('report-tabs').getByText('Ageing').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: dir + '05-reports-ageing.png' });
  await page.getByTestId('report-tabs').getByText(/2.?year|Two/i).first().click().catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: dir + '06-reports-two-year.png' });

  await nav(page, '/invoices');
  await page.screenshot({ path: dir + '07-invoices.png' });
  await nav(page, '/recon');
  await page.getByTestId('recon-row').first().click().catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: dir + '08-reconciliation.png', fullPage: true });

  // v2 screens
  const shot = async (h: string, name: string, full = false) => { await nav(page, h); await page.waitForTimeout(300); await page.screenshot({ path: dir + name, fullPage: full }); };
  await shot('/more', '09-more-menu.png', true);
  await shot('/performance', '10-performance.png', true);
  await shot('/plans', '11-monthly-plan.png', true);
  await shot('/alerts', '12-alert-centre.png', true);
  await shot('/tasks', '13-tasks.png');
  await shot('/statements?customer=demo_c1', '14-statement.png', true);
  await shot('/statements?mode=bulk', '15-statement-bulk.png');
  await shot('/job', '16-my-job-ledger.png', true);
  await shot('/job?tab=summary', '17-my-job-summary.png', true);
  await nav(page, '/import');
  await page.locator('input[name=statementDate]').fill('2026-10-22');
  await page.getByTestId('statement-file').setInputFiles('samples/sample-statement-with-errors.csv');
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: dir + '18-import-preview-validation.png', fullPage: true });
  await page.getByTestId('statement-file').setInputFiles('samples/sample-statement-2026-10.xlsx');
  await expect(page.getByTestId('import-summary')).toContainText('12 rows');
  await page.screenshot({ path: dir + '19-import-preview-xlsx.png', fullPage: true });
  await page.getByTestId('apply-import').click();
  if (await page.getByTestId('sheet-ok').isVisible().catch(() => false)) await page.getByTestId('sheet-ok').click();
  await expect(page.getByTestId('batch-card')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: dir + '20-import-batch.png', fullPage: true });
});
