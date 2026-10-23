import { test, expect } from '@playwright/test';
import { open, nav, save, saveExpectError, selectByLabel, idFromUrl, daysAgo, iso } from './helpers';

const CUST = 'Test Trading LLC (Fictional)';

test('core workflow: customer → invoices → partial & multi-invoice payment → GRV → credit note → disputed deduction → reconciliation → reload persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page);

  // 1. Create customer
  await page.getByRole('button', { name: '+ Add first customer' }).click();
  await page.locator('input[name=name]').fill(CUST);
  await page.locator('input[name=terms]').fill('30');
  await page.locator('input[name=trn]').fill('123'); // invalid TRN -> clear error message
  await saveExpectError(page);
  await expect(page.getByTestId('form-errors')).toContainText('UAE TRN must be 15 digits');
  await page.locator('input[name=trn]').fill('100200300400500');
  await save(page);
  await expect(page.locator('h1')).toHaveText(CUST);
  const custId = idFromUrl(page);

  // duplicate customer warning
  await nav(page, '/customer-form');
  await page.locator('input[name=name]').fill(CUST.toLowerCase());
  await expect(page.getByTestId('dup-warning')).toBeVisible();

  // 2. Record invoices (VAT auto-calc, due date from terms)
  const inv = async (no: string, date: string, net: string) => {
    await nav(page, '/invoice-form?customer=' + custId);
    await page.locator('input[name=invoiceNo]').fill(no);
    await page.locator('input[name=invoiceDate]').fill(date);
    await page.locator('input[name=amount]').fill(net);
  };
  await inv('INV-T1', '2026-08-01', '1000');
  await expect(page.getByTestId('inv-gross')).toHaveText('1,050.00');
  await expect(page.locator('input[name=dueDate]')).toHaveValue('2026-08-31');
  await save(page);
  await expect(page.getByTestId('inv-remaining')).toContainText('1,050.00');
  await expect(page.getByTestId('invoice-balance')).toContainText('Overdue');
  await inv('INV-T2', '2026-09-15', '2000'); await save(page);
  await expect(page.getByTestId('inv-remaining')).toContainText('2,100.00');
  await inv('INV-T3', iso(new Date()), '500'); await save(page);
  await expect(page.getByTestId('inv-remaining')).toContainText('525.00');
  const inv3 = idFromUrl(page);
  // duplicate invoice number blocked until acknowledged
  await inv('inv-t1', '2026-09-01', '10');
  await expect(page.getByTestId('dup-warning')).toContainText('Duplicate invoice number');
  await saveExpectError(page);
  await expect(page.getByTestId('form-errors')).toContainText('already exists');

  // 3. Partial payment
  await nav(page, '/collection-form?customer=' + custId);
  await page.locator('input[name=receiptRef]').fill('RC-1');
  await page.locator('input[name=amount]').fill('400');
  await page.getByLabel('Allocate to INV-T1').fill('400');
  await expect(page.getByTestId('alloc-left')).toHaveText('0.00');
  await save(page);
  await expect(page.getByTestId('col-unallocated')).toContainText('0.00');
  await page.getByTestId('alloc-row').click();
  await expect(page.getByTestId('inv-remaining')).toContainText('650.00');
  await expect(page.getByTestId('invoice-balance')).toContainText('Partially Paid');

  // 4. One payment across multiple invoices (+ on-account remainder)
  await nav(page, '/collection-form?customer=' + custId);
  await page.locator('input[name=receiptRef]').fill('RC-2');
  await page.locator('select[name=method]').selectOption('Cheque');
  await page.locator('input[name=chequeNo]').fill('000123');
  await page.locator('input[name=amount]').fill('2900');
  await page.getByLabel('Allocate to INV-T1').fill('650');
  await page.getByLabel('Allocate to INV-T2').fill('2100');
  await expect(page.getByTestId('alloc-total')).toHaveText('2,750.00');
  await expect(page.getByTestId('alloc-left')).toHaveText('150.00');
  await save(page);
  await expect(page.getByTestId('alloc-row')).toHaveCount(2);
  await expect(page.getByTestId('col-unallocated')).toContainText('150.00');
  await nav(page, '/customers/' + custId);
  await expect(page.getByTestId('cust-invoice').filter({ hasText: 'INV-T1' })).toContainText('Paid');
  await expect(page.getByTestId('cust-invoice').filter({ hasText: 'INV-T2' })).toContainText('Paid');

  // over-allocation and duplicate receipt are rejected with clear messages
  await nav(page, '/collection-form?customer=' + custId);
  await page.locator('input[name=receiptRef]').fill('rc-2');
  await expect(page.getByTestId('dup-warning')).toBeVisible();
  await page.locator('input[name=receiptRef]').fill('RC-3');
  await page.locator('input[name=amount]').fill('100');
  await page.getByLabel('Allocate to INV-T3').fill('200');
  await saveExpectError(page);
  await expect(page.getByTestId('form-errors')).toContainText('exceeds the payment amount');

  // 5. GRV (no direct effect on balance)
  await nav(page, `/grv-form?customer=${custId}&invoice=${inv3}`);
  await page.locator('input[name=ref]').fill('GRV-T1');
  await page.locator('input[name=amount]').fill('100');
  await page.locator('input[name=reason]').fill('Damaged in transit');
  await page.locator('select[name=status]').selectOption('Approved');
  await expect(page.getByTestId('effect')).toContainText('does not change the balance');
  await save(page);
  await nav(page, '/invoices/' + inv3);
  await expect(page.getByTestId('inv-remaining')).toContainText('525.00');

  // 6. Approved credit note against the GRV, applied
  await nav(page, '/grvs');
  await page.getByTestId('adj-row').filter({ hasText: 'GRV-T1' }).click();
  await page.getByTestId('cn-from-grv').click();
  await expect(page.locator('h1')).toHaveText('New credit note');
  await expect(page.locator('input[name=amount]')).toHaveValue('100');
  await page.locator('input[name=ref]').fill('CN-T1');
  await page.locator('select[name=status]').selectOption('Approved');
  await expect(page.getByTestId('effect')).toContainText('No effect');
  await page.getByTestId('cn-applied').check();
  await expect(page.getByTestId('effect')).toContainText('from 525.00 to 425.00');
  await save(page);
  await nav(page, '/invoices/' + inv3);
  await expect(page.getByTestId('inv-cn')).toContainText('100.00');
  await expect(page.getByTestId('inv-remaining')).toContainText('425.00');
  // a second CN on the same GRV is blocked (double counting)
  await nav(page, '/grvs');
  await page.getByTestId('adj-row').filter({ hasText: 'GRV-T1' }).click();
  await expect(page.getByTestId('cn-from-grv')).toHaveCount(0);

  // 7. Disputed deduction does NOT reduce the balance
  await nav(page, `/deduction-form?customer=${custId}&invoice=${inv3}`);
  await page.locator('input[name=ref]').fill('DED-T1');
  await page.locator('input[name=amount]').fill('75');
  await page.locator('input[name=reason]').fill('Promotional support');
  await page.locator('select[name=status]').selectOption('Disputed');
  await page.locator('textarea[name=disputeNotes]').fill('Not in agreed trade terms');
  await expect(page.getByTestId('effect')).toContainText('No effect');
  await save(page);
  const dedId = idFromUrl(page);
  await nav(page, '/invoices/' + inv3);
  await expect(page.getByTestId('inv-remaining')).toContainText('425.00');
  await expect(page.getByTestId('inv-ded')).toContainText('0.00');
  // customer balance = 3675 invoiced - 3300 collected - 100 CN = 275 (disputed 75 excluded)
  await nav(page, '/customers/' + custId);
  await expect(page.getByTestId('cust-balance')).toContainText('AED 275.00');
  await expect(page.getByTestId('cust-pending')).toContainText('Disputed 75.00');

  // 8. Statement reconciliation: customer statement shows 200 (they deducted the disputed 75)
  await nav(page, '/recon-form?customer=' + custId);
  await page.locator('input[name=statementBalance]').fill('200');
  await page.locator('input[name=statementRef]').fill('SOA-OCT');
  await expect(page.getByTestId('recon-mine')).toHaveText('275.00');
  await expect(page.getByTestId('recon-diff')).toHaveText('75.00');
  await expect(page.getByTestId('recon-hints')).toContainText('Deduction DED-T1 (Disputed): 75.00 — matches the difference');
  await save(page);
  await nav(page, '/recon');
  await expect(page.getByTestId('recon-row').first()).toContainText('Discrepancy');

  // accepting the deduction later reduces the balance and the statement then matches
  await nav(page, '/deduction-form/' + dedId);
  await page.locator('select[name=status]').selectOption('Accepted');
  await expect(page.getByTestId('effect')).toContainText('from 425.00 to 350.00');
  await save(page);
  await nav(page, '/recon-form?customer=' + custId);
  await page.locator('input[name=statementBalance]').fill('200');
  await expect(page.getByTestId('recon-diff')).toHaveText('0.00');
  await expect(page.getByTestId('recon-result')).toContainText('Matched');

  // correction history recorded the status change
  await nav(page, '/deduction-form/' + dedId);
  await expect(page.getByTestId('audit')).toContainText('status');
  await expect(page.getByTestId('audit')).toContainText('Disputed → Accepted');

  // 9. Persists across reload (IndexedDB)
  await page.reload();
  await nav(page, '/customers/' + custId);
  await expect(page.getByTestId('cust-balance')).toContainText('AED 200.00');
  await nav(page, '/');
  await expect(page.getByTestId('stat-invoiced')).toContainText('3,675.00');
  await expect(page.getByTestId('stat-collections')).toContainText('3,300.00');
  await expect(page.getByTestId('stat-outstanding')).toContainText('200.00');
  expect(errors).toEqual([]);
});

test('voiding a bounced cheque re-opens its invoices', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '+ Add first customer' }).click();
  await page.locator('input[name=name]').fill('Bounce Test Co (Fictional)');
  await save(page);
  const custId = idFromUrl(page);
  await nav(page, '/invoice-form?customer=' + custId);
  await page.locator('input[name=invoiceNo]').fill('INV-B1');
  await page.locator('input[name=invoiceDate]').fill(daysAgo(10));
  await page.locator('input[name=amount]').fill('100');
  await save(page);
  const invId = idFromUrl(page);
  await page.getByRole('link', { name: '+ Payment' }).click();
  await expect(page.locator('input[name=amount]')).toHaveValue('105');
  await page.locator('input[name=receiptRef]').fill('RC-B1');
  await save(page);
  await page.getByRole('button', { name: /Void receipt/ }).click();
  await page.getByTestId('sheet-input').fill('Cheque bounced');
  await page.getByTestId('sheet-ok').click();
  await expect(page.getByText('VOIDED').first()).toBeVisible();
  await nav(page, '/invoices/' + invId);
  await expect(page.getByTestId('inv-remaining')).toContainText('105.00');
  await expect(page.getByTestId('audit')).toContainText('Created invoice INV-B1');
});
