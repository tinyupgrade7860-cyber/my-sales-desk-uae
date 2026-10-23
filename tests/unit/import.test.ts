import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { parseStatementFile, parseDate, parseNum, matchHeader, rowsToStatement } from '../../src/lib/statementParse';
import { planImport, applyImport, undoImport } from '../../src/lib/statementImport';
import { clearAll, loadAll, saveCollection } from '../../src/db';
import { calcAllInvoices, customerBalanceAsOf } from '../../src/calc';

const buf = (f: string) => { const b = fs.readFileSync('samples/' + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const AS_OF = '2026-10-22';

describe('statement parsing helpers', () => {
  it('matches header variants', () => {
    expect(matchHeader('Invoice No')).toBe('invoiceNo'); expect(matchHeader(' invoice  NO. ')).toBe('invoiceNo');
    expect(matchHeader('Sales Man')).toBe('salesman'); expect(matchHeader('SALESMAN')).toBe('salesman');
    expect(matchHeader('Grand Total')).toBe('grand'); expect(matchHeader('Total Amount')).toBe('total'); expect(matchHeader('Ageing Days')).toBe('ageing'); expect(matchHeader('Aging days')).toBe('ageing');
  });
  it('parses UAE dates and amounts', () => {
    expect(parseDate('05/08/2026')).toBe('2026-08-05'); expect(parseDate('2026-08-05')).toBe('2026-08-05'); expect(parseDate('5-Aug-2026')).toBe('2026-08-05');
    expect(parseDate('05 Sept 2026')).toBe('2026-09-05'); expect(parseDate(46239)).toBe('2026-08-05'); expect(parseDate('31/02/2026')).toBeNull(); expect(parseDate('abc')).toBeNull();
    expect(parseNum('AED 1,234.50')).toBe(1234.5); expect(parseNum('(200.00)')).toBe(-200); expect(parseNum('-')).toBeNull(); expect(parseNum('12x')).toBeNull();
  });
  it('validates rows: mismatch, bad date, missing customer, duplicates, recomputed ageing', async () => {
    const p = await parseStatementFile(buf('sample-statement-with-errors.csv'), 'x.csv', AS_OF);
    const by = (no: string, i = 0) => p.rows.filter(r => r.invoiceNo === no)[i];
    expect(p.rows).toHaveLength(6);
    expect(by('BT-26-0201').warnings.join()).toMatch(/Grand Total mismatch/);
    expect(by('BT-26-0202').errors.join()).toMatch(/Bad billing date/);
    expect(by('BT-26-0203').errors.join()).toMatch(/Missing customer/);
    expect(by('BT-26-0204').warnings.join()).toMatch(/Balance mismatch/);
    expect(by('BT-26-0204', 1).errors.join()).toMatch(/Duplicate invoice number/);
    expect(by('BT-26-0205').errors).toEqual([]); expect(by('BT-26-0205').ageing).toBe(14);
  });
});

describe('Excel / PDF import end-to-end (fake IndexedDB)', () => {
  beforeEach(async () => { await clearAll(); });

  for (const [file, kind] of [['sample-statement-2026-10.xlsx', 'xlsx'], ['sample-statement-2026-10.pdf', 'pdf'], ['sample-statement-variants.xls', 'xls']] as const) {
    it(`parses ${kind}`, async () => {
      const p = await parseStatementFile(buf(file), file, AS_OF);
      expect(p.rows.length).toBe(kind === 'xls' ? 4 : 12);
      expect(p.rows.every(r => r.errors.length === 0 && r.warnings.length === 0)).toBe(true);
      const r = p.rows.find(r => r.invoiceNo === 'BT-26-0142')!;
      expect(r).toMatchObject({ billingDate: '2026-08-11', customer: 'Al Noor Grocery LLC (Fictional)', salesman: 'Sample Salesman', total: 15250.5, tax: 762.53, grand: 16013.03, received: 0, balance: 16013.03, ageing: 72 });
    });
  }

  it('import creates customers/invoices/snapshot, re-import is idempotent, undo reverts the batch', async () => {
    const p = await parseStatementFile(buf('sample-statement-2026-10.xlsx'), 'a.xlsx', AS_OF);
    let { data } = await loadAll();
    const plan = planImport(data, p.rows, AS_OF, 'hash1', AS_OF);
    expect(plan.newCustomers).toHaveLength(3);
    const res = await applyImport(plan, { fileName: 'a.xlsx', fileHash: 'hash1', fileType: 'xlsx', autoCreateCustomers: true, syncReceived: true, defaultTerms: 60 });
    expect(res.counts).toMatchObject({ customersCreated: 3, invoicesCreated: 12, collectionsCreated: 5, linesCreated: 12, statements: 3 });
    ({ data } = await loadAll());
    const alNoor = data.customers.find(c => c.name.startsWith('Al Noor'))!;
    expect(customerBalanceAsOf(data, alNoor.id).balance).toBe(25453.03);
    expect(data.statements.find(s => s.customerId === alNoor.id)).toMatchObject({ statementBalance: 25453.03, recordedBalance: 25453.03, difference: 0, status: 'Matched' });
    const { map } = calcAllInvoices(data, AS_OF);
    const i118 = data.invoices.find(i => i.invoiceNo === 'BT-26-0118')!;
    expect(map.get(i118.id)!.remaining).toBe(4925);
    // re-import same file (and the PDF version of the same statement): nothing doubles
    for (const [f, h] of [['sample-statement-2026-10.xlsx', 'hash1'], ['sample-statement-2026-10.pdf', 'hash2']]) {
      const p2 = await parseStatementFile(buf(f), f, AS_OF);
      const plan2 = planImport(data, p2.rows, AS_OF, h, AS_OF);
      if (h === 'hash1') expect(plan2.previous?.id).toBe(res.batchId);
      expect(plan2.rows.every(r => r.proposed === 'none' && r.snapshotState === 'same')).toBe(true);
      const res2 = await applyImport(plan2, { fileName: f, fileHash: h, fileType: 'xlsx', autoCreateCustomers: true, syncReceived: true, defaultTerms: 60 });
      expect(res2.counts).toMatchObject({ customersCreated: 0, invoicesCreated: 0, invoicesUpdated: 0, collectionsCreated: 0, linesCreated: 0, linesUpdated: 0, statements: 0 });
      expect(res2.summary).toMatch(/No changes/);
    }
    ({ data } = await loadAll());
    expect(data.invoices.filter(i => !i.deleted)).toHaveLength(12);
    expect(data.collections.filter(i => !i.deleted)).toHaveLength(5);
    expect(customerBalanceAsOf(data, alNoor.id).balance).toBe(25453.03);
    expect(data.importBatches).toHaveLength(3);

    // a payment added later against an imported invoice blocks the undo
    const later = await saveCollection({ receiptRef: 'R-LATER', customerId: alNoor.id, date: AS_OF, amount: 100, method: 'Cash' } as any, [{ invoiceId: i118.id, amount: 100 }], 'later');
    await expect(undoImport(res.batchId)).rejects.toThrow(/Cannot undo/);
    const { voidRecord } = await import('../../src/db');
    await voidRecord('collections', later, 'test', 'later');
    const u = await undoImport(res.batchId);
    expect(u.reverted).toBeGreaterThan(30);
    ({ data } = await loadAll());
    expect(data.invoices.filter(i => !i.deleted)).toHaveLength(0);
    expect(data.customers.filter(i => !i.deleted)).toHaveLength(0);
    expect(data.statementLines.filter(i => !i.deleted)).toHaveLength(0);
    expect(data.importBatches.find(b => b.id === res.batchId)!.status).toBe('Undone');
    await expect(undoImport(res.batchId)).rejects.toThrow(/already undone/);
  });

  it('import updates a changed invoice and flags the statement difference', async () => {
    const p = await parseStatementFile(buf('sample-statement-2026-10.xlsx'), 'a.xlsx', AS_OF);
    let { data } = await loadAll();
    await applyImport(planImport(data, p.rows, AS_OF, 'h', AS_OF), { fileName: 'a.xlsx', fileHash: 'h', fileType: 'xlsx', autoCreateCustomers: true, syncReceived: false, defaultTerms: 60 });
    ({ data } = await loadAll());
    const al = data.statements.find(s => s.statementRef === 'a.xlsx' && data.customers.find(c => c.id === s.customerId)!.name.startsWith('Al Noor'))!;
    expect(al.status).toBe('Discrepancy'); // receipts not synced -> app higher than statement
    expect(al.difference).toBe(16600);
    const rows = p.rows.map(r => r.invoiceNo === 'BT-26-0156' ? { ...r, total: 5000, tax: 250, grand: 5250, balance: 5250 } : r);
    const plan = planImport(data, rows, AS_OF, 'h2', AS_OF);
    const row = plan.rows.find(r => r.r.invoiceNo === 'BT-26-0156')!;
    expect(row.proposed).toBe('update'); expect(row.diffs.join()).toMatch(/gross 4515.00 → 5250.00/); expect(row.snapshotState).toBe('update');
    const res = await applyImport(plan, { fileName: 'b.xlsx', fileHash: 'h2', fileType: 'xlsx', autoCreateCustomers: true, syncReceived: false, defaultTerms: 60 });
    expect(res.counts).toMatchObject({ invoicesUpdated: 1, linesUpdated: 1, invoicesCreated: 0 });
    ({ data } = await loadAll());
    expect(data.invoices.find(i => i.invoiceNo === 'BT-26-0156')!.grossAmount).toBe(5250);
    await undoImport(res.batchId);
    ({ data } = await loadAll());
    expect(data.invoices.find(i => i.invoiceNo === 'BT-26-0156')!.grossAmount).toBe(4515);
  });

  it('rowsToStatement rejects files without a header', () => {
    expect(() => rowsToStatement([['a', 'b'], [1, 2]])).toThrow(/header row/);
  });
});
