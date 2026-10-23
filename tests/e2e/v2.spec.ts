import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import { open, nav, save, idFromUrl, loadDemo, iso } from './helpers';

const SAMPLE = (f: string) => 'samples/' + f;
const ST_DATE = '2026-10-22';
const today = iso(new Date());
const month = today.slice(0, 7);

async function download(page: Page, click: () => Promise<any>, info: any, name: string) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const p = info.outputPath(name + '-' + dl.suggestedFilename());
  await dl.saveAs(p);
  return { path: p, name: dl.suggestedFilename() };
}
const readXlsx = (p: string) => XLSX.read(readFileSync(p), { type: 'buffer' });
const sheetRows = (wb: XLSX.WorkBook, n: string) => XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1, raw: true });
const pdfText = (p: string) => execFileSync('pdftotext', ['-layout', p, '-']).toString();

async function importFile(page: Page, file: string) {
  await nav(page, '/import');
  await page.locator('input[name=statementDate]').fill(ST_DATE);
  await page.getByTestId('statement-file').setInputFiles(SAMPLE(file));
  await expect(page.getByTestId('import-preview')).toBeVisible({ timeout: 15000 });
}
async function applyAndWait(page: Page) {
  const v = await page.evaluate(() => (globalThis as any).__msdVersion || 0);
  await page.getByTestId('apply-import').click();
  if (await page.getByTestId('sheet-ok').isVisible().catch(() => false)) await page.getByTestId('sheet-ok').click();
  await expect.poll(() => page.evaluate(() => (globalThis as any).__msdVersion || 0), { timeout: 15000 }).toBeGreaterThan(v);
  await expect(page.getByTestId('batch-card')).toBeVisible();
}

test('Excel statement import: preview + validation → import → idempotent re-import → undo whole batch', async ({ page }) => {
  await open(page);
  // file with deliberate errors: validation shown in preview
  await importFile(page, 'sample-statement-with-errors.csv');
  await expect(page.getByTestId('import-summary')).toContainText('6 rows');
  await expect(page.getByTestId('prow-BT-26-0201')).toContainText('Grand Total mismatch');
  await expect(page.getByTestId('prow-BT-26-0202')).toContainText('Bad billing date');
  await expect(page.getByTestId('prow-BT-26-0203')).toContainText('Missing customer');
  await expect(page.getByTestId('prow-BT-26-0204').nth(1)).toContainText('Duplicate invoice number');

  await importFile(page, 'sample-statement-2026-10.xlsx');
  await expect(page.getByTestId('import-summary')).toContainText('12 rows');
  await expect(page.getByTestId('import-summary')).toContainText('0 with errors');
  await expect(page.getByTestId('prow-BT-26-0142')).toContainText('16,013.03');
  await expect(page.getByTestId('prow-BT-26-0142')).toContainText('72'); // ageing recomputed to statement date
  await expect(page.getByTestId('act-BT-26-0142')).toHaveValue('create');
  await page.getByTestId('act-BT-26-0101').selectOption('skip'); // per-row choice
  await applyAndWait(page);
  await expect(page.getByTestId('batch-summary')).toContainText('11 invoices created');
  await expect(page.getByTestId('batch-summary')).toContainText('3 customers created');
  const batch1 = idFromUrl(page);
  // reconciliation: receipts not synced, so app balance is higher than file for customers with payments
  await expect(page.getByTestId('batch-recon')).toContainText('difference(s)');
  await nav(page, '/customers');
  await expect(page.getByText('Al Noor Grocery LLC (Fictional)')).toBeVisible();

  // re-import the same file: nothing duplicates
  await importFile(page, 'sample-statement-2026-10.xlsx');
  await expect(page.getByTestId('reimport-warning')).toBeVisible();
  await expect(page.getByTestId('act-BT-26-0142')).toHaveValue('none');
  await applyAndWait(page);
  await expect(page.getByTestId('batch-summary')).toContainText(/No changes|1 invoices created/);
  await nav(page, '/invoices');
  await expect(page.getByTestId('invoice-row').filter({ hasText: 'BT-26-0142' })).toHaveCount(1);

  // undo first batch
  await nav(page, '/imports/' + batch1);
  await page.getByTestId('undo-import').click();
  await page.getByTestId('sheet-ok').click();
  await expect(page.getByTestId('toast')).toContainText(/Import undone|Cannot undo/);
  await expect(page.getByTestId('batch-card')).toContainText(/Undone|Active/);
  await nav(page, '/imports');
  await expect(page.getByTestId('batch-row')).toHaveCount(2);
});

test('PDF statement import (text PDF) and undo restores everything', async ({ page }) => {
  await open(page);
  await importFile(page, 'sample-statement-2026-10.pdf');
  await expect(page.getByTestId('import-summary')).toContainText('(PDF): 12 rows');
  await expect(page.getByTestId('import-summary')).toContainText('0 with errors');
  await expect(page.getByTestId('prow-BT-26-0142')).toContainText('Al Noor Grocery LLC (Fictional)');
  await page.getByTestId('opt-sync').check();
  await applyAndWait(page);
  await expect(page.getByTestId('batch-summary')).toContainText('12 invoices created');
  await expect(page.getByTestId('batch-recon')).toContainText('0 difference(s)');
  await nav(page, '/');
  await expect(page.getByTestId('stat-outstanding')).toContainText('69,853.45');
  await page.goBack();
  await page.getByTestId('undo-import').click();
  await page.getByTestId('sheet-ok').click();
  await expect(page.getByTestId('toast')).toContainText('Import undone');
  await expect(page.getByTestId('batch-card')).toContainText('Undone');
  await nav(page, '/invoices');
  await expect(page.getByTestId('invoice-row')).toHaveCount(0);
});

test('edit invoice and collection: history kept, balance recalculated, collection reflected on statement + exports', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: '+ Add first customer' }).click();
  await page.locator('input[name=name]').fill('Statement Test Co (Fictional)');
  await save(page);
  const cid = idFromUrl(page);
  for (const [no, amt] of [['ST-1', '1000'], ['ST-2', '2000']]) {
    await nav(page, '/invoice-form?customer=' + cid);
    await page.locator('input[name=invoiceNo]').fill(no);
    await page.locator('input[name=invoiceDate]').fill('2026-09-01');
    await page.locator('input[name=amount]').fill(amt);
    await save(page);
  }
  const inv2 = idFromUrl(page);
  // edit invoice ST-2 amount 2000 -> 3000 net
  await page.getByTestId('edit-invoice').click();
  await expect(page.locator('h1')).toHaveText('Edit invoice');
  await page.locator('input[name=amount]').fill('3000');
  await save(page);
  await expect(page.getByTestId('inv-remaining')).toContainText('3,150.00');
  await expect(page.getByTestId('audit')).toContainText('Edited invoice ST-2');
  await expect(page.getByTestId('audit')).toContainText('2100 → 3150');
  // payment allocated to both, then edited (re-allocated)
  await nav(page, '/collection-form?customer=' + cid);
  await page.locator('input[name=receiptRef]').fill('RC-ST1');
  await page.locator('input[name=date]').fill('2026-10-05');
  await page.locator('input[name=amount]').fill('2000');
  await page.getByLabel('Allocate to ST-1').fill('1050');
  await page.getByLabel('Allocate to ST-2').fill('950');
  await save(page);
  const col = idFromUrl(page);
  await nav(page, '/collection-form/' + col);
  await expect(page.locator('h1')).toHaveText('Edit payment');
  await page.locator('input[name=amount]').fill('2500');
  await page.getByLabel('Allocate to ST-2').fill('1450');
  await save(page);
  await nav(page, '/invoices/' + inv2);
  await expect(page.getByTestId('inv-remaining')).toContainText('1,700.00');
  await nav(page, '/history');
  await expect(page.getByTestId('audit')).toContainText('amount: 2000 → 2500');

  // statement on screen: running balance and allocations
  await nav(page, '/statements?customer=' + cid + '&from=2026-09-15&to=' + today);
  await expect(page.getByTestId('st-opening')).toContainText('4,200.00');
  await expect(page.getByTestId('st-line-RC-ST1')).toContainText('ST-1 1050.00; ST-2 1450.00');
  await expect(page.getByTestId('st-line-RC-ST1')).toContainText('1,700.00');
  await expect(page.getByTestId('st-closing')).toHaveText('1,700.00');
  await expect(page.getByTestId('st-open-ST-2')).toContainText('RC-ST1');
  await expect(page.getByTestId('st-open-ST-1')).toHaveCount(0);

  const x = await download(page, () => page.getByTestId('st-xlsx').click(), info, 'one');
  expect(x.name).toMatch(/^Statement_.*\.xlsx$/);
  const wb = readXlsx(x.path);
  const rows = sheetRows(wb, wb.SheetNames[0]);
  expect(String(rows[0][0])).toBe('Bisbelluk Trading LLC');
  expect(rows.find(r => r[0] === 'Opening balance')![6]).toBe(4200);
  expect(rows.find(r => r[2] === 'RC-ST1')![5]).toBe(2500);
  expect(rows.find(r => r[0] === 'Totals')![6]).toBe(1700);
  const p = await download(page, () => page.getByTestId('st-pdf').click(), info, 'one');
  const t = pdfText(p.path);
  expect(t).toContain('Bisbelluk Trading LLC'); expect(t).toContain('STATEMENT OF ACCOUNT'); expect(t).toContain('Statement Test Co (Fictional)');
  expect(t).toContain('RC-ST1'); expect(t).toMatch(/Closing balance: AED 1,700\.00/);
});

test('bulk statement export: one xlsx with sheet per customer, one multi-page PDF, zip of files', async ({ page }, info) => {
  await loadDemo(page);
  await nav(page, '/statements?mode=bulk');
  await page.getByTestId('st-mode').getByText('Bulk').click();
  const count = await page.getByTestId('bulk-list').locator('input[type=checkbox]').count();
  expect(count).toBeGreaterThan(2);
  const x = await download(page, () => page.getByTestId('bulk-xlsx').click(), info, 'bulk');
  const wb = readXlsx(x.path);
  expect(wb.SheetNames[0]).toBe('Summary');
  expect(wb.SheetNames.length).toBe(count + 1);
  const sum = sheetRows(wb, 'Summary');
  expect(sum.find(r => r[0] === 'Total')).toBeTruthy();
  const p = await download(page, () => page.getByTestId('bulk-pdf').click(), info, 'bulk');
  const t = pdfText(p.path);
  expect((t.match(/STATEMENT OF ACCOUNT/g) || []).length).toBe(count);
  expect(t).toContain('Falcon Crest Trading LLC (Demo)');
  // filtered + zip
  await page.getByTestId('pick-DEMO-001').uncheck();
  await page.getByTestId('bulk-as').getByText('ZIP of files').click();
  const z = await download(page, () => page.getByTestId('bulk-pdf').click(), info, 'zip');
  expect(z.name).toMatch(/\.zip$/);
  const files = Object.keys(unzipSync(readFileSync(z.path)));
  expect(files.length).toBe(count - 1);
  expect(files.every(f => f.endsWith('.pdf'))).toBe(true);
  expect(files.some(f => f.includes('DEMO-001'))).toBe(false);
});

test('targets achievement, plan vs actual, alert centre with badge and .ics export', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: '+ Add first customer' }).click();
  await page.locator('input[name=name]').fill('Target Co (Fictional)');
  await save(page);
  const cid = idFromUrl(page);
  await nav(page, '/invoice-form?customer=' + cid);
  await page.locator('input[name=invoiceNo]').fill('TG-1');
  await page.locator('input[name=invoiceDate]').fill(today);
  await page.locator('input[name=amount]').fill('5000');
  await save(page);
  // overall target 20,000 → 25%
  await nav(page, '/target-form');
  await page.locator('input[name=salesTarget]').fill('20000');
  await page.locator('input[name=collectionTarget]').fill('10000');
  await save(page);
  await expect(page.getByTestId('target-row')).toHaveCount(1);
  await nav(page, '/performance');
  await expect(page.getByTestId('perf-actual')).toContainText('5,000.00');
  await expect(page.getByTestId('perf-ach')).toContainText('25.0%');
  await expect(page.getByTestId('perf-ach')).toContainText('15,000.00');
  // manual sales entry adds to actual
  await nav(page, '/sales-form');
  await page.locator('input[name=amount]').fill('1000');
  await page.locator('input[name=description]').fill('Van sale (fictional)');
  await save(page);
  await nav(page, '/performance');
  await expect(page.getByTestId('perf-ach')).toContainText('30.0%');
  // edit target → recalculated + history
  await nav(page, '/targets');
  await page.getByTestId('target-row').click();
  await page.locator('input[name=salesTarget]').fill('12000');
  await save(page);
  await nav(page, '/performance');
  await expect(page.getByTestId('perf-ach')).toContainText('50.0%');

  // plan vs actual with a visit today
  await nav(page, '/plan-form?month=' + month + '&customer=' + cid);
  await page.locator('input[name=plannedSales]').fill('8000');
  await page.locator('input[name=plannedCollection]').fill('4000');
  await page.locator('input[name=newVisit]').fill(today);
  await page.getByTestId('add-visit').click();
  await save(page);
  await expect(page.getByTestId('plan-sales-ach')).toContainText('63%'); // 5000 / 8000 (manual entry has no customer)
  await expect(page.getByTestId('plan-visits')).toContainText('0 / 1');

  // alerts: visit today + task due today → badge
  await nav(page, '/task-form?customer=' + cid);
  await page.locator('input[name=title]').fill('Call about TG-1');
  await page.locator('input[name=dueDate]').fill(today);
  await save(page);
  await nav(page, '/');
  await expect(page.getByTestId('bell-count')).toHaveText('2');
  await expect(page.getByTestId('more-badge')).toHaveText('2');
  await page.getByTestId('bell').click();
  await expect(page.getByTestId('alerts-today')).toContainText('Call about TG-1');
  await expect(page.getByTestId('alerts-today')).toContainText('Visit Target Co (Fictional)');
  const ics = await download(page, () => page.getByTestId('export-ics').click(), info, 'cal');
  const txt = readFileSync(ics.path, 'utf8');
  expect(txt).toContain('BEGIN:VCALENDAR'); expect(txt).toContain('SUMMARY:Task: Call about TG-1'); expect(txt).toContain('DTSTART;VALUE=DATE:' + today.replace(/-/g, ''));
  // mark visit done → badge drops
  await nav(page, '/plans');
  await page.getByTestId('visit-' + today).click();
  await expect(page.getByTestId('plan-visits')).toContainText('1 / 1');
  // complete task with an update → history
  await nav(page, '/tasks');
  await page.getByTestId('task-row').click();
  await page.locator('select[name=status]').selectOption('Done');
  await page.getByTestId('task-update').fill('Customer confirmed payment date');
  await save(page);
  await expect(page.getByTestId('task-history')).toContainText('Status Open → Done: Customer confirmed payment date');
  await nav(page, '/');
  await expect(page.getByTestId('bell-count')).toHaveCount(0);
});

test('My Job: records, claim reimbursement, ledger totals, exports', async ({ page }, info) => {
  await open(page);
  await nav(page, '/job');
  await expect(page.locator('.topbar')).toContainText('Bisbelluk Trading LLC');
  await expect(page.locator('.topbar')).toContainText('01 Dec 2024');
  const add = async (cat: string, fill: Record<string, string>, extra?: () => Promise<void>) => {
    await nav(page, '/job-form');
    await page.locator('select[name=category]').selectOption(cat);
    for (const [k, v] of Object.entries(fill)) await page.locator(`input[name=${k}],select[name=${k}],textarea[name=${k}]`).fill(v);
    if (extra) await extra();
    await save(page);
  };
  await add('Salary', { date: '2025-01-28', amount: '8000', description: 'Salary Jan (fictional)' });
  await add('Vehicle allowance', { date: '2025-01-28', amount: '1200', description: 'Car allowance (fictional)' });
  await add('Kitha (customer commission)', { date: '2025-01-15', amount: '300', description: 'Kitha (fictional)' });
  await add('Expense claim', { date: '2025-01-10', amount: '450', description: 'Parking claim (fictional)' }, async () => {
    await page.locator('select[name=claimStatus]').selectOption('Paid');
    await page.locator('input[name=reimbursedAmount]').fill('450');
    await page.locator('input[name=reimbursedDate]').fill('2025-02-05');
  });
  // validation: date before job start
  await nav(page, '/job-form');
  await page.locator('input[name=date]').fill('2024-06-01');
  await page.locator('input[name=amount]').fill('10');
  await page.locator('input[name=description]').fill('x');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('form-errors')).toContainText('before your job start date');
  await nav(page, '/job');
  await expect(page.getByTestId('job-in')).toContainText('9,650.00'); // 8000 + 1200 + 450 reimbursed
  await expect(page.getByTestId('job-out')).toContainText('750.00'); // 300 + 450
  await expect(page.getByTestId('job-net')).toContainText('8,900.00');
  await expect(page.getByTestId('job-monthly')).toContainText('Feb 25');
  // edit salary → recalculated + correction history
  await page.getByTestId('job-tabs').getByText('Records').click();
  await page.getByTestId('job-row').filter({ hasText: 'Salary Jan' }).click();
  await page.locator('input[name=amount]').fill('8500');
  await save(page);
  await expect(page.getByTestId('job-in')).toContainText('10,150.00');
  await page.getByTestId('job-tabs').getByText('Records').click();
  await page.getByTestId('job-row').filter({ hasText: 'Salary Jan' }).click();
  await expect(page.getByTestId('audit')).toContainText('8000 → 8500');
  await nav(page, '/job');
  const csv = await download(page, () => page.getByTestId('job-csv').click(), info, 'job');
  expect(readFileSync(csv.path, 'utf8')).toContain('Parking claim (fictional)');
  const x = await download(page, () => page.getByTestId('job-xlsx').click(), info, 'job');
  expect(readXlsx(x.path).SheetNames).toEqual(['Monthly', 'Ledger', 'Records']);
  const p = await download(page, () => page.getByTestId('job-pdf').click(), info, 'job');
  expect(pdfText(p.path)).toContain('Salary Jan (fictional)');
});

test('DB migration v1 → v2 keeps existing data', async ({ page, baseURL }) => {
  await page.route('**/migration-blank.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }));
  await page.goto(baseURL + 'migration-blank.html');
  await page.evaluate(() => new Promise<void>((res, rej) => {
    const req = indexedDB.open('my-sales-desk-uae', 10); // Dexie version 1 == IDB version 10
    req.onupgradeneeded = () => {
      const db = req.result;
      const spec: Record<string, string[]> = { customers: ['code', 'name', 'updatedAt'], invoices: ['invoiceNo', 'customerId', 'invoiceDate', 'dueDate'], collections: ['receiptRef', 'customerId', 'date'], allocations: ['collectionId', 'invoiceId'], grvs: ['grvRef', 'customerId', 'invoiceId', 'date', 'status'], creditNotes: ['cnRef', 'customerId', 'invoiceId', 'grvId', 'date', 'status'], deductions: ['ref', 'customerId', 'invoiceId', 'date', 'status'], statements: ['customerId', 'statementDate', 'status'], followUps: ['customerId', 'invoiceId', 'nextContactDate', 'status'], auditLog: ['ts', 'entity', 'entityId'], settings: [] };
      for (const [t, idx] of Object.entries(spec)) { const os = db.createObjectStore(t, { keyPath: 'id' }); idx.forEach(i => os.createIndex(i, i)); }
      const b = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deleted: false };
      const tx = req.transaction!;
      tx.objectStore('customers').add({ ...b, id: 'v1c', code: 'V1', name: 'Version One Co (Fictional)', paymentTermsDays: 30 });
      tx.objectStore('invoices').add({ ...b, id: 'v1i', invoiceNo: 'V1-INV', customerId: 'v1c', invoiceDate: '2026-09-01', dueDate: '2026-10-01', paymentTermsDays: 30, netAmount: 1000, vatRate: 5, vatAmount: 50, grossAmount: 1050 });
      tx.objectStore('settings').add({ id: 'settings', defaultVatRate: 5, currency: 'AED', defaultTermsDays: 30, upcomingDays: 7, ownerName: 'V1 user' });
    };
    req.onsuccess = () => { req.result.close(); res(); };
    req.onerror = () => rej(req.error);
  }));
  await open(page);
  await expect(page.getByTestId('stat-outstanding')).toContainText('1,050.00');
  await nav(page, '/customers');
  await expect(page.getByText('Version One Co (Fictional)')).toBeVisible();
  await nav(page, '/settings');
  await expect(page.locator('input[name=companyName]')).toHaveValue('Bisbelluk Trading LLC');
  await expect(page.locator('input[name=owner]')).toHaveValue('V1 user');
  const info = await page.evaluate(() => new Promise<any>(res => { const r = indexedDB.open('my-sales-desk-uae'); r.onsuccess = () => { const d = r.result; res({ v: d.version, stores: [...d.objectStoreNames] }); d.close(); }; }));
  expect(info.v).toBe(20);
  for (const t of ['importBatches', 'statementLines', 'targets', 'salesEntries', 'plans', 'tasks', 'jobRecords']) expect(info.stores).toContain(t);
  // new tables usable after migration
  await nav(page, '/job-form');
  await page.locator('input[name=date]').fill('2025-01-28');
  await page.locator('input[name=amount]').fill('100');
  await page.locator('input[name=description]').fill('After migration (fictional)');
  await save(page);
  await nav(page, '/history');
  await expect(page.getByTestId('audit')).toContainText('Database upgraded to schema v2');
});

test('backup → wipe → restore includes all new tables', async ({ page }, info) => {
  await loadDemo(page);
  await nav(page, '/data');
  const b = await download(page, () => page.getByTestId('export-json').click(), info, 'b1');
  const b1 = JSON.parse(readFileSync(b.path, 'utf8'));
  expect(b1.schemaVersion).toBe(2);
  for (const t of ['targets', 'salesEntries', 'plans', 'tasks', 'jobRecords']) expect(b1.counts[t], t).toBeGreaterThan(0);
  await page.getByTestId('wipe').click();
  await page.getByTestId('sheet-input').fill('DELETE');
  await page.getByTestId('sheet-ok').click();
  await expect(page.getByTestId('toast')).toContainText('All data erased');
  await page.getByTestId('import-file').setInputFiles(b.path);
  await expect(page.getByTestId('restore-preview')).toContainText('jobRecords: ' + b1.counts.jobRecords);
  await page.getByTestId('confirm-restore').click();
  await expect(page.getByTestId('toast')).toContainText('Backup restored');
  const b2 = JSON.parse(readFileSync((await download(page, () => page.getByTestId('export-json').click(), info, 'b2')).path, 'utf8'));
  const sort = (xs: any[]) => [...xs].sort((a, c) => a.id.localeCompare(c.id));
  for (const t of ['importBatches', 'statementLines', 'targets', 'salesEntries', 'plans', 'tasks', 'jobRecords', 'customers', 'invoices']) expect(sort(b2.data[t]), t).toEqual(sort(b1.data[t]));
  await nav(page, '/job');
  await expect(page.getByTestId('job-in')).not.toContainText('AED 0.00');
});

test('offline: statement import (xlsx + pdf) and statement export work with no network', async ({ page, context }, info) => {
  await open(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15000 }).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('net-status')).toContainText('Offline');
  await importFile(page, 'sample-statement-2026-10.xlsx');
  await applyAndWait(page);
  await expect(page.getByTestId('batch-summary')).toContainText('12 invoices created');
  await importFile(page, 'sample-statement-2026-10.pdf'); // pdf.js + worker from the SW cache
  await expect(page.getByTestId('import-summary')).toContainText('(PDF): 12 rows');
  await nav(page, '/statements?mode=bulk');
  await page.getByTestId('st-mode').getByText('Bulk').click();
  const x = await download(page, () => page.getByTestId('bulk-xlsx').click(), info, 'off');
  const names = readXlsx(x.path).SheetNames;
  expect(names[0]).toBe('Summary'); expect(names).toHaveLength(4);
  expect(names.some(n => n.startsWith('Marina Mini Mart'))).toBe(true);
  const p = await download(page, () => page.getByTestId('bulk-pdf').click(), info, 'off');
  expect(pdfText(p.path)).toContain('Marina Mini Mart (Fictional)');
  await context.setOffline(false);
});
