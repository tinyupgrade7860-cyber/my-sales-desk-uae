import type { DataSet } from './types';
import { cnEffective, deductionEffective } from './calc';
import { r2 } from './util';

export interface LedgerRow { date: string; type: string; ref: string; debit: number; credit: number; balance: number; link: string; note?: string }

/** Customer statement of account (only balance-affecting entries) with running balance. */
export function customerLedger(ds: DataSet, cid: string, from?: string, to?: string): { opening: number; rows: LedgerRow[]; closing: number } {
  const raw: Omit<LedgerRow, 'balance'>[] = [];
  for (const i of ds.invoices) if (!i.deleted && i.customerId === cid) raw.push({ date: i.invoiceDate, type: 'Invoice', ref: i.invoiceNo, debit: i.grossAmount, credit: 0, link: '#/invoices/' + i.id });
  for (const c of ds.collections) if (!c.deleted && c.customerId === cid) raw.push({ date: c.date, type: 'Payment', ref: c.receiptRef, debit: 0, credit: c.amount, link: '#/collections/' + c.id, note: c.method });
  for (const c of ds.creditNotes) if (c.customerId === cid && cnEffective(c)) raw.push({ date: c.date, type: 'Credit note', ref: c.cnRef, debit: 0, credit: cnEffective(c), link: '#/cn-form/' + c.id });
  for (const d of ds.deductions) if (d.customerId === cid && deductionEffective(d)) raw.push({ date: d.date, type: 'Deduction', ref: d.ref, debit: 0, credit: deductionEffective(d), link: '#/deduction-form/' + d.id, note: d.status });
  raw.sort((a, b) => a.date.localeCompare(b.date) || (a.debit ? -1 : 1));
  let bal = 0, opening = 0;
  const rows: LedgerRow[] = [];
  for (const r of raw) {
    bal = r2(bal + r.debit - r.credit);
    if (from && r.date < from) { opening = bal; continue; }
    if (to && r.date > to) continue;
    rows.push({ ...r, balance: bal });
  }
  return { opening, rows, closing: rows.length ? rows[rows.length - 1].balance : opening };
}
