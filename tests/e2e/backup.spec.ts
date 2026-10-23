import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDemo, nav, open } from './helpers';

test('export JSON backup → erase DB → restore → data identical; tampered backup rejected', async ({ page }, info) => {
  await loadDemo(page);
  const before = await page.getByTestId('stat-outstanding').textContent();
  await nav(page, '/data');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  const file1 = info.outputPath('backup1.json');
  await dl.saveAs(file1);
  const b1 = JSON.parse(readFileSync(file1, 'utf8'));
  expect(b1.app).toBe('my-sales-desk-uae');
  expect(b1.counts.customers).toBe(8);
  expect(b1.counts.invoices).toBeGreaterThan(100);

  // erase everything
  await page.getByTestId('wipe').click();
  await page.getByTestId('sheet-input').fill('DELETE');
  await page.getByTestId('sheet-ok').click();
  await expect(page.getByTestId('toast')).toContainText('All data erased');
  await nav(page, '/');
  await expect(page.getByTestId('load-demo')).toBeVisible();

  // tampered file is rejected
  const bad = JSON.parse(JSON.stringify(b1)); bad.data.invoices[0].grossAmount = 1;
  const badFile = info.outputPath('tampered.json'); writeFileSync(badFile, JSON.stringify(bad));
  await nav(page, '/data');
  await page.getByTestId('import-file').setInputFiles(badFile);
  await expect(page.getByTestId('form-errors')).toContainText('Checksum mismatch');
  const junk = info.outputPath('junk.json'); writeFileSync(junk, '{not json');
  await page.getByTestId('import-file').setInputFiles(junk);
  await expect(page.getByTestId('form-errors')).toContainText('Could not read file as JSON');

  // valid file: preview + confirm
  await page.getByTestId('import-file').setInputFiles(file1);
  await expect(page.getByTestId('restore-preview')).toContainText('valid backup');
  await expect(page.getByTestId('restore-preview')).toContainText('customers: 8');
  await page.getByTestId('confirm-restore').click();
  await expect(page.getByTestId('toast')).toContainText('Backup restored');

  // re-export and compare all business tables record-for-record
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  const file2 = info.outputPath('backup2.json'); await dl2.saveAs(file2);
  const b2 = JSON.parse(readFileSync(file2, 'utf8'));
  for (const t of ['customers', 'invoices', 'collections', 'allocations', 'grvs', 'creditNotes', 'deductions', 'statements', 'followUps', 'settings']) {
    const sort = (xs: any[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    expect(sort(b2.data[t]), t).toEqual(sort(b1.data[t]));
  }
  expect(b2.data.auditLog.length).toBe(b1.data.auditLog.length + 1); // + "Restored backup" entry
  await nav(page, '/');
  await expect(page.getByTestId('stat-outstanding')).toHaveText(before!);
  // survives reload
  await page.reload();
  await expect(page.getByTestId('stat-outstanding')).toHaveText(before!);
});

test('CSV and PDF exports (customer history, monthly report, period report)', async ({ page }, info) => {
  await loadDemo(page);
  await nav(page, '/customers/demo_c1');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cust-csv').click()]);
  const csvPath = info.outputPath(csv.suggestedFilename()); await csv.saveAs(csvPath);
  const text = readFileSync(csvPath, 'utf8');
  expect(text).toContain('Date,Type,Reference,Note,Debit (AED),Credit (AED),Balance (AED)');
  expect(text.split('\n').length).toBeGreaterThan(10);
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cust-pdf').click()]);
  const pdfPath = info.outputPath(pdf.suggestedFilename()); await pdf.saveAs(pdfPath);
  expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');
  await nav(page, '/reports');
  await page.getByTestId('report-tabs').getByText('Monthly', { exact: true }).click();
  const [m] = await Promise.all([page.waitForEvent('download'), page.getByTestId('monthly-pdf').click()]);
  expect(m.suggestedFilename()).toMatch(/^monthly-report-\d{4}-\d{2}\.pdf$/);
  const mp = info.outputPath('m.pdf'); await m.saveAs(mp);
  expect(readFileSync(mp).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByTestId('report-tabs').getByText('Periods', { exact: true }).click();
  await page.getByTestId('period-chips').getByText('quarter', { exact: true }).click();
  await expect(page.getByTestId('period-table')).toContainText('-Q');
  const [q] = await Promise.all([page.waitForEvent('download'), page.getByTestId('period-csv').click()]);
  expect(q.suggestedFilename()).toMatch(/report-quarter/);
});

test('search and filters across records', async ({ page }) => {
  await loadDemo(page);
  await nav(page, '/search');
  await page.getByPlaceholder(/Invoice no, receipt/).fill('INV-1003');
  await expect(page.getByTestId('search-hit').first()).toContainText('INV-1003');
  await page.getByPlaceholder(/Invoice no, receipt/).fill('');
  await page.getByLabel('Record type').selectOption('GRV');
  await page.getByLabel('GRV status').selectOption('Approved');
  const n = await page.getByTestId('search-hit').count();
  expect(n).toBeGreaterThan(0);
  for (const t of await page.getByTestId('search-hit').allTextContents()) expect(t).toContain('Approved');
  await nav(page, '/invoices');
  await page.getByTestId('inv-status').getByText('Overdue', { exact: true }).click();
  const rows = page.getByTestId('invoice-row');
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(rows.first()).toHaveClass(/overdue/);
});
