import { describe, it, expect } from 'vitest';
import type { DataSet } from '../../src/types';
import {
  calcAllInvoices, calcCustomers, dashboard, validateCollection, validateCreditNote, validateDeduction,
  reconcile, ageing, periodReport, twoYearSummary, findDuplicate, grvsAwaitingCN, validateInvoice, customerBalanceAsOf
} from '../../src/calc';
import { r2, sum, weekKey } from '../../src/util';
import { generateDemo } from '../../src/seed';

const b = { createdAt: '', updatedAt: '', deleted: false };
const TODAY = '2026-10-23';
function fixture(): DataSet {
  return {
    customers: [{ ...b, id: 'c1', code: 'T1', name: 'Test Co', paymentTermsDays: 30 }, { ...b, id: 'c2', code: 'T2', name: 'Other Co', paymentTermsDays: 30 }],
    invoices: [
      { ...b, id: 'i1', invoiceNo: 'INV-1', customerId: 'c1', invoiceDate: '2026-08-01', dueDate: '2026-08-31', paymentTermsDays: 30, netAmount: 1000, vatRate: 5, vatAmount: 50, grossAmount: 1050 },
      { ...b, id: 'i2', invoiceNo: 'INV-2', customerId: 'c1', invoiceDate: '2026-09-01', dueDate: '2026-10-01', paymentTermsDays: 30, netAmount: 2000, vatRate: 5, vatAmount: 100, grossAmount: 2100 },
      { ...b, id: 'i3', invoiceNo: 'INV-3', customerId: 'c1', invoiceDate: '2026-10-10', dueDate: '2026-11-09', paymentTermsDays: 30, netAmount: 500, vatRate: 5, vatAmount: 25, grossAmount: 525 },
      { ...b, id: 'i4', invoiceNo: 'INV-4', customerId: 'c2', invoiceDate: '2026-10-10', dueDate: '2026-11-09', paymentTermsDays: 30, netAmount: 100, vatRate: 5, vatAmount: 5, grossAmount: 105 }
    ],
    collections: [], allocations: [], grvs: [], creditNotes: [], deductions: [], statements: [], followUps: [], importBatches: [], statementLines: [], targets: [], salesEntries: [], plans: [], tasks: [], jobRecords: []
  } as any;
}

describe('money helpers', () => {
  it('rounds and sums without float drift', () => {
    expect(r2(0.1 + 0.2)).toBe(0.3);
    expect(sum([0.1, 0.2, 0.3])).toBe(0.6);
    expect(r2(1.005)).toBe(1.01);
    expect(weekKey('2026-01-01')).toBe('2026-W01');
  });
});

describe('invoice balances', () => {
  it('unpaid invoice is overdue after due date', () => {
    const { map } = calcAllInvoices(fixture(), TODAY);
    const c = map.get('i1')!;
    expect(c.remaining).toBe(1050); expect(c.status).toBe('Unpaid'); expect(c.overdue).toBe(true); expect(c.daysOverdue).toBe(53);
    expect(map.get('i3')!.overdue).toBe(false);
  });
  it('partial payment', () => {
    const ds = fixture();
    ds.collections.push({ ...b, id: 'r1', receiptRef: 'R1', customerId: 'c1', date: '2026-09-15', amount: 400, method: 'Cash' } as any);
    ds.allocations.push({ ...b, id: 'a1', collectionId: 'r1', invoiceId: 'i1', amount: 400 } as any);
    const c = calcAllInvoices(ds, TODAY).map.get('i1')!;
    expect(c.remaining).toBe(650); expect(c.status).toBe('Partially Paid');
  });
  it('one payment allocated across multiple invoices + unallocated remainder', () => {
    const ds = fixture();
    ds.collections.push({ ...b, id: 'r1', receiptRef: 'R1', customerId: 'c1', date: '2026-10-05', amount: 3500, method: 'Cheque' } as any);
    ds.allocations.push({ ...b, id: 'a1', collectionId: 'r1', invoiceId: 'i1', amount: 1050 } as any, { ...b, id: 'a2', collectionId: 'r1', invoiceId: 'i2', amount: 2100 } as any);
    const { invoices, customers } = calcCustomers(ds, TODAY);
    expect(invoices.get('i1')!.status).toBe('Paid'); expect(invoices.get('i2')!.status).toBe('Paid');
    const cc = customers.get('c1')!;
    expect(cc.unallocated).toBe(350);
    expect(cc.balance).toBe(r2(1050 + 2100 + 525 - 3500)); // 175 (unallocated cash offsets open invoice)
  });
  it('voided collection stops reducing balance', () => {
    const ds = fixture();
    ds.collections.push({ ...b, id: 'r1', receiptRef: 'R1', customerId: 'c1', date: '2026-10-05', amount: 1050, method: 'Cheque', deleted: true } as any);
    ds.allocations.push({ ...b, id: 'a1', collectionId: 'r1', invoiceId: 'i1', amount: 1050 } as any);
    expect(calcAllInvoices(ds, TODAY).map.get('i1')!.remaining).toBe(1050);
    expect(customerBalanceAsOf(ds, 'c1').balance).toBe(3675);
  });
});

describe('adjustments: GRV / credit notes / deductions', () => {
  it('GRV alone does not reduce balance; its approved+applied CN does exactly once', () => {
    const ds = fixture();
    ds.grvs.push({ ...b, id: 'g1', grvRef: 'GRV-1', customerId: 'c1', invoiceId: 'i2', date: '2026-09-10', amount: 300, reason: 'Damaged', status: 'Approved' } as any);
    let c = calcAllInvoices(ds, TODAY).map.get('i2')!;
    expect(c.remaining).toBe(2100);
    expect(grvsAwaitingCN(ds).map(g => g.id)).toEqual(['g1']);
    ds.creditNotes.push({ ...b, id: 'cn1', cnRef: 'CN-1', customerId: 'c1', invoiceId: 'i2', grvId: 'g1', date: '2026-09-12', amount: 300, reason: 'GRV', status: 'Pending', applied: false } as any);
    expect(calcAllInvoices(ds, TODAY).map.get('i2')!.remaining).toBe(2100); // pending CN no effect
    ds.creditNotes[0].status = 'Approved';
    expect(calcAllInvoices(ds, TODAY).map.get('i2')!.remaining).toBe(2100); // approved but not applied no effect
    ds.creditNotes[0].applied = true;
    c = calcAllInvoices(ds, TODAY).map.get('i2')!;
    expect(c.remaining).toBe(1800); expect(c.creditNotes).toBe(300);
    expect(grvsAwaitingCN(ds)).toEqual([]);
    expect(customerBalanceAsOf(ds, 'c1').balance).toBe(r2(3675 - 300));
  });
  it('second CN against same GRV is rejected by validation (double count)', () => {
    const ds = fixture();
    ds.grvs.push({ ...b, id: 'g1', grvRef: 'GRV-1', customerId: 'c1', invoiceId: 'i2', date: '2026-09-10', amount: 300, reason: 'x', status: 'Approved' } as any);
    ds.creditNotes.push({ ...b, id: 'cn1', cnRef: 'CN-1', customerId: 'c1', invoiceId: 'i2', grvId: 'g1', date: '2026-09-12', amount: 300, reason: 'x', status: 'Approved', applied: true } as any);
    const e = validateCreditNote(ds, { cnRef: 'CN-2', customerId: 'c1', invoiceId: 'i2', grvId: 'g1', date: '2026-09-13', amount: 100, status: 'Approved', applied: true });
    expect(e.join(' ')).toMatch(/double count/);
    expect(validateCreditNote(ds, { cnRef: 'CN-3', customerId: 'c1', date: '2026-09-13', amount: 10, status: 'Pending', applied: true }).join(' ')).toMatch(/Only an Approved/);
  });
  it('disputed and claimed deductions never reduce balance; accepted ones do', () => {
    const ds = fixture();
    ds.deductions.push({ ...b, id: 'd1', ref: 'D1', customerId: 'c1', invoiceId: 'i1', date: '2026-09-01', claimedAmount: 200, acceptedAmount: 0, reason: 'Promo', status: 'Disputed' } as any);
    ds.deductions.push({ ...b, id: 'd2', ref: 'D2', customerId: 'c1', invoiceId: 'i1', date: '2026-09-01', claimedAmount: 100, acceptedAmount: 0, reason: 'Promo', status: 'Claimed' } as any);
    ds.deductions.push({ ...b, id: 'd3', ref: 'D3', customerId: 'c1', invoiceId: 'i1', date: '2026-09-01', claimedAmount: 100, acceptedAmount: 0, reason: 'Promo', status: 'Rejected' } as any);
    expect(calcAllInvoices(ds, TODAY).map.get('i1')!.remaining).toBe(1050);
    const cc = calcCustomers(ds, TODAY).customers.get('c1')!;
    expect(cc.disputedDeductions).toBe(200); expect(cc.claimedDeductions).toBe(100); expect(cc.balance).toBe(3675);
    ds.deductions[0].status = 'Partially Accepted'; ds.deductions[0].acceptedAmount = 80;
    expect(calcAllInvoices(ds, TODAY).map.get('i1')!.remaining).toBe(970);
    ds.deductions[1].status = 'Accepted';
    expect(calcAllInvoices(ds, TODAY).map.get('i1')!.remaining).toBe(870);
  });
  it('deduction validation', () => {
    const ds = fixture();
    expect(validateDeduction(ds, { ref: 'D', customerId: 'c1', date: '2026-01-01', claimedAmount: 100, acceptedAmount: 150, status: 'Partially Accepted' }).join(' ')).toMatch(/cannot exceed/);
    expect(validateDeduction(ds, { ref: 'D', customerId: 'c1', invoiceId: 'i3', date: '2026-01-01', claimedAmount: 600, acceptedAmount: 600, status: 'Accepted' }).join(' ')).toMatch(/exceeds invoice remaining/);
    expect(validateDeduction(ds, { ref: 'D', customerId: 'c1', invoiceId: 'i3', date: '2026-01-01', claimedAmount: 600, acceptedAmount: 0, status: 'Disputed' })).toEqual([]);
  });
});

describe('collection validation', () => {
  it('blocks over-allocation, wrong customer, and exceeding remaining', () => {
    const ds = fixture();
    expect(validateCollection(ds, { customerId: 'c1', receiptRef: 'R', date: '2026-10-01', amount: 100 }, [{ invoiceId: 'i1', amount: 150 }]).join(' ')).toMatch(/exceeds the payment amount/);
    expect(validateCollection(ds, { customerId: 'c1', receiptRef: 'R', date: '2026-10-01', amount: 5000 }, [{ invoiceId: 'i1', amount: 1100 }]).join(' ')).toMatch(/exceeds its remaining/);
    expect(validateCollection(ds, { customerId: 'c1', receiptRef: 'R', date: '2026-10-01', amount: 105 }, [{ invoiceId: 'i4', amount: 105 }]).join(' ')).toMatch(/different customer/);
    expect(validateCollection(ds, { customerId: 'c1', receiptRef: 'R', date: '2026-10-01', amount: 1500 }, [{ invoiceId: 'i1', amount: 1050 }, { invoiceId: 'i2', amount: 450 }])).toEqual([]);
  });
  it('editing a collection excludes its own previous allocations', () => {
    const ds = fixture();
    ds.collections.push({ ...b, id: 'r1', receiptRef: 'R1', customerId: 'c1', date: '2026-09-15', amount: 1050, method: 'Cash' } as any);
    ds.allocations.push({ ...b, id: 'a1', collectionId: 'r1', invoiceId: 'i1', amount: 1050 } as any);
    expect(validateCollection(ds, { customerId: 'c1', receiptRef: 'R1', date: '2026-09-15', amount: 1050 }, [{ invoiceId: 'i1', amount: 1050 }], 'r1')).toEqual([]);
  });
  it('invoice validation', () => {
    expect(validateInvoice({ invoiceNo: 'X', customerId: 'c1', invoiceDate: '2026-10-10', dueDate: '2026-10-01', netAmount: 10, vatRate: 5, vatAmount: 0.5, grossAmount: 10.5 }).join(' ')).toMatch(/Due date/);
    expect(validateInvoice({ invoiceNo: 'X', customerId: 'c1', invoiceDate: '2026-10-10', dueDate: '2026-11-01', netAmount: 10, vatRate: 5, vatAmount: 0.5, grossAmount: 11 }).join(' ')).toMatch(/Gross must equal/);
  });
});

describe('reconciliation, reports, dashboard', () => {
  it('statement discrepancy explained by disputed deduction', () => {
    const ds = fixture();
    ds.deductions.push({ ...b, id: 'd1', ref: 'D-77', customerId: 'c1', invoiceId: 'i1', date: '2026-09-01', claimedAmount: 250, acceptedAmount: 0, reason: 'Promo', status: 'Disputed' } as any);
    const r = reconcile(ds, 'c1', '2026-09-30', 1050 + 2100 - 250);
    expect(r.recordedBalance).toBe(3150); expect(r.difference).toBe(250); expect(r.status).toBe('Discrepancy');
    expect(r.hints.some(h => h.matches && /D-77/.test(h.label))).toBe(true);
    expect(reconcile(ds, 'c1', '2026-09-30', 3150).status).toBe('Matched');
  });
  it('ageing buckets and dashboard totals', () => {
    const ds = fixture();
    const a = ageing(ds, TODAY);
    expect(a.totals['31-60']).toBe(1050); expect(a.totals['1-30']).toBe(2100); expect(a.totals['Not due']).toBe(630); expect(a.totals.Total).toBe(3780);
    ds.collections.push({ ...b, id: 'r1', receiptRef: 'R1', customerId: 'c1', date: '2026-10-05', amount: 1050, method: 'Cheque' } as any);
    ds.allocations.push({ ...b, id: 'a1', collectionId: 'r1', invoiceId: 'i1', amount: 1050 } as any);
    const d = dashboard(ds, TODAY);
    expect(d.invoiced).toBe(3780); expect(d.collections).toBe(1050); expect(d.outstanding).toBe(2730);
    expect(d.overdue).toBe(2100); expect(d.overdueCount).toBe(1); expect(d.collectionPct).toBe(27.78);
    expect(d.trend.length).toBe(12); expect(d.trend[11]).toEqual({ month: '2026-10', invoiced: 630, collected: 1050 });
  });
  it('period reports group correctly', () => {
    const ds = fixture();
    const m = periodReport(ds, 'month');
    expect(m.map(r => r.period)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(periodReport(ds, 'quarter').map(r => [r.period, r.gross])).toEqual([['2026-Q3', 3150], ['2026-Q4', 630]]);
    expect(periodReport(ds, 'year')[0].invoiceCount).toBe(4);
    expect(periodReport(ds, 'month', undefined, undefined, 'c2')[0].gross).toBe(105);
  });
  it('duplicate detection is case-insensitive and ignores self/voided', () => {
    const ds = fixture();
    expect(findDuplicate(ds.invoices, 'invoiceNo', ' inv-1 ')?.id).toBe('i1');
    expect(findDuplicate(ds.invoices, 'invoiceNo', 'INV-1', 'i1')).toBeUndefined();
    ds.invoices[0].deleted = true;
    expect(findDuplicate(ds.invoices, 'invoiceNo', 'INV-1')).toBeUndefined();
  });
});

describe('demo data integrity', () => {
  it('no invoice is over-allocated and two-year summary has 24 months', () => {
    const ds = generateDemo(TODAY);
    const { map } = calcAllInvoices(ds, TODAY);
    for (const c of map.values()) expect(c.remaining).toBeGreaterThanOrEqual(-0.005);
    for (const col of ds.collections) {
      const al = sum(ds.allocations.filter(a => a.collectionId === col.id).map(a => a.amount));
      expect(al).toBeLessThanOrEqual(col.amount + 0.005);
    }
    const t = twoYearSummary(ds, TODAY);
    expect(t.monthly.length).toBe(24);
    expect(t.first12.gross).toBeGreaterThan(0); expect(t.last12.gross).toBeGreaterThan(0);
    expect(ds.customers.every(c => /Demo/.test(c.name))).toBe(true);
  });
});
