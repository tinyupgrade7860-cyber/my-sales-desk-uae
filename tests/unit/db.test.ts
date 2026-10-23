import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, saveRecord, saveCollection, voidRecord, loadAll, exportBackup, restoreBackup, clearAll } from '../../src/db';
import { calcAllInvoices } from '../../src/calc';

async function setup() {
  const c = await saveRecord('customers', { code: 'UT01', name: 'Unit Test Co (Fictional)', paymentTermsDays: 30 } as any, 'Created customer');
  const mk = (no: string, gross: number) => saveRecord('invoices', { invoiceNo: no, customerId: c, invoiceDate: '2026-09-01', dueDate: '2026-10-01', netAmount: gross / 1.05, vatRate: 5, vatAmount: gross - gross / 1.05, grossAmount: gross, paymentTermsDays: 30 } as any, 'Created invoice ' + no);
  return { c, i1: await mk('U-1', 1050), i2: await mk('U-2', 525) };
}

describe('IndexedDB layer (fake-indexeddb)', () => {
  beforeEach(async () => { await clearAll(); });

  it('saves a multi-invoice collection atomically, re-allocation replaces old allocations, void reopens', async () => {
    const { c, i1, i2 } = await setup();
    const col = await saveCollection({ customerId: c, receiptRef: 'R-1', date: '2026-10-05', amount: 1200, method: 'Cheque' } as any, [{ invoiceId: i1, amount: 1050 }, { invoiceId: i2, amount: 150 }], 'Created payment R-1');
    let { data } = await loadAll();
    let inv = calcAllInvoices(data, '2026-10-20').map;
    expect(inv.get(i1)!.remaining).toBe(0);
    expect(inv.get(i2)!.remaining).toBe(375);
    // re-allocate
    await saveCollection({ ...data.collections[0] }, [{ invoiceId: i2, amount: 525 }], 'Edited payment R-1');
    ({ data } = await loadAll());
    expect(data.allocations.filter(a => !a.deleted)).toHaveLength(1);
    inv = calcAllInvoices(data, '2026-10-20').map;
    expect(inv.get(i1)!.remaining).toBe(1050);
    expect(inv.get(i2)!.remaining).toBe(0);
    await voidRecord('collections', col, 'Cheque bounced', 'Voided R-1');
    ({ data } = await loadAll());
    inv = calcAllInvoices(data, '2026-10-20').map;
    expect([...inv.values()].reduce((s, x) => s + x.remaining, 0)).toBe(1575);
    expect(data.collections[0].deleted).toBe(true); // soft delete – record kept
    const audit = await db.auditLog.toArray();
    expect(audit.some(a => /Voided/.test(a.summary || JSON.stringify(a)))).toBe(true);
  });

  it('export → clear → restore round-trips every table', async () => {
    const { c, i1 } = await setup();
    await saveCollection({ customerId: c, receiptRef: 'R-2', date: '2026-10-05', amount: 100, method: 'Cash' } as any, [{ invoiceId: i1, amount: 100 }], 'Created payment');
    const b1 = await exportBackup();
    await clearAll();
    expect((await loadAll()).data.invoices).toHaveLength(0);
    await restoreBackup(JSON.parse(JSON.stringify(b1)));
    const b2 = await exportBackup();
    expect(b2.data.customers).toEqual(b1.data.customers);
    expect(b2.data.invoices).toEqual(b1.data.invoices);
    expect(b2.data.allocations).toEqual(b1.data.allocations);
    await expect(restoreBackup({ ...b1, checksum: 'bad' })).rejects.toThrow();
  });
});
