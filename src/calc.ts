/**
 * Pure financial calculation engine. No I/O - fully unit tested.
 *
 * BALANCE RULES (single source of truth):
 *  Invoice remaining = gross
 *                     - allocated payments (allocation rows of non-voided collections)
 *                     - approved & applied credit notes linked to the invoice
 *                     - accepted deductions (status Accepted / Partially Accepted -> acceptedAmount)
 *  GRVs NEVER reduce a balance by themselves. A GRV is a goods-return document; its financial
 *  effect happens only through the credit note issued against it (CreditNote.grvId). This
 *  prevents a return from being counted twice (GRV + CN).
 *  Pending/rejected credit notes, approved-but-not-applied credit notes, and Claimed / Disputed /
 *  Rejected deductions have ZERO effect on balances. They are shown as "pending items" only.
 *  Customer balance = invoices gross - collections received - effective adjustments.
 *  (Unallocated receipt money therefore still reduces the customer balance, as on-account credit.)
 *  Voided (soft-deleted) records are excluded everywhere.
 */
import type {
  DataSet, Invoice, CreditNote, Deduction, Collection, Customer, GRV, FollowUp
} from './types';
import { sum, r2, EPS, daysBetween, todayISO, monthKey, weekKey, quarterKey, yearKey, addDays } from './util';

const live = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter(x => !x.deleted);

export function cnEffective(cn: CreditNote): number {
  return !cn.deleted && cn.status === 'Approved' && cn.applied ? r2(cn.amount) : 0;
}
export function deductionEffective(d: Deduction): number {
  if (d.deleted) return 0;
  if (d.status === 'Accepted') return r2(d.acceptedAmount > 0 ? d.acceptedAmount : d.claimedAmount);
  if (d.status === 'Partially Accepted') return r2(d.acceptedAmount);
  return 0; // Claimed / Disputed / Rejected never reduce balances
}

export type PayStatus = 'Paid' | 'Partially Paid' | 'Unpaid' | 'Over-credited';

export interface InvoiceCalc {
  invoice: Invoice;
  allocated: number;
  creditNotes: number;
  deductions: number;
  adjustments: number;
  remaining: number;
  status: PayStatus;
  overdue: boolean;
  daysOverdue: number;
  daysToDue: number;
}

export interface Index {
  liveCollections: Map<string, Collection>;
  allocByInvoice: Map<string, number>;
  allocByCollection: Map<string, number>;
  cnByInvoice: Map<string, number>;
  dedByInvoice: Map<string, number>;
}

export function buildIndex(ds: DataSet): Index {
  const liveCollections = new Map(live(ds.collections).map(c => [c.id, c]));
  const allocByInvoice = new Map<string, number>();
  const allocByCollection = new Map<string, number>();
  for (const a of live(ds.allocations)) {
    if (!liveCollections.has(a.collectionId)) continue;
    allocByInvoice.set(a.invoiceId, r2((allocByInvoice.get(a.invoiceId) || 0) + a.amount));
    allocByCollection.set(a.collectionId, r2((allocByCollection.get(a.collectionId) || 0) + a.amount));
  }
  const cnByInvoice = new Map<string, number>();
  for (const cn of ds.creditNotes) {
    const e = cnEffective(cn);
    if (e && cn.invoiceId) cnByInvoice.set(cn.invoiceId, r2((cnByInvoice.get(cn.invoiceId) || 0) + e));
  }
  const dedByInvoice = new Map<string, number>();
  for (const d of ds.deductions) {
    const e = deductionEffective(d);
    if (e && d.invoiceId) dedByInvoice.set(d.invoiceId, r2((dedByInvoice.get(d.invoiceId) || 0) + e));
  }
  return { liveCollections, allocByInvoice, allocByCollection, cnByInvoice, dedByInvoice };
}

export function calcInvoice(inv: Invoice, ix: Index, today = todayISO()): InvoiceCalc {
  const allocated = ix.allocByInvoice.get(inv.id) || 0;
  const creditNotes = ix.cnByInvoice.get(inv.id) || 0;
  const deductions = ix.dedByInvoice.get(inv.id) || 0;
  const adjustments = r2(creditNotes + deductions);
  const remaining = r2(inv.grossAmount - allocated - adjustments);
  let status: PayStatus;
  if (remaining < -EPS) status = 'Over-credited';
  else if (remaining <= EPS) status = 'Paid';
  else if (allocated + adjustments > EPS) status = 'Partially Paid';
  else status = 'Unpaid';
  const daysToDue = daysBetween(today, inv.dueDate);
  const overdue = remaining > EPS && daysToDue < 0;
  return { invoice: inv, allocated, creditNotes, deductions, adjustments, remaining, status, overdue, daysOverdue: overdue ? -daysToDue : 0, daysToDue };
}

export function calcAllInvoices(ds: DataSet, today = todayISO()) {
  const ix = buildIndex(ds);
  const map = new Map<string, InvoiceCalc>();
  for (const inv of live(ds.invoices)) map.set(inv.id, calcInvoice(inv, ix, today));
  return { ix, map };
}

export interface CustomerCalc {
  customer: Customer;
  invoiced: number;
  collected: number;
  allocated: number;
  unallocated: number;
  creditNotes: number;
  deductions: number;
  adjustments: number;
  balance: number;
  overdue: number;
  overdueCount: number;
  openInvoices: number;
  pendingCN: number;
  disputedDeductions: number;
  claimedDeductions: number;
  grvAwaitingCN: number;
  paymentStatus: 'Clear' | 'Outstanding' | 'Overdue' | 'Credit';
}

/** Balance for one customer, optionally as at a date (inclusive). */
export function customerBalanceAsOf(ds: DataSet, customerId: string, asOf?: string) {
  const inDate = (d: string) => !asOf || d <= asOf;
  const invoiced = sum(live(ds.invoices).filter(i => i.customerId === customerId && inDate(i.invoiceDate)).map(i => i.grossAmount));
  const collected = sum(live(ds.collections).filter(c => c.customerId === customerId && inDate(c.date)).map(c => c.amount));
  const cns = sum(ds.creditNotes.filter(c => c.customerId === customerId && inDate(c.date)).map(cnEffective));
  const deds = sum(ds.deductions.filter(d => d.customerId === customerId && inDate(d.date)).map(deductionEffective));
  return { invoiced, collected, creditNotes: cns, deductions: deds, balance: r2(invoiced - collected - cns - deds) };
}

export function calcCustomers(ds: DataSet, today = todayISO()) {
  const { ix, map } = calcAllInvoices(ds, today);
  const out = new Map<string, CustomerCalc>();
  for (const c of live(ds.customers)) {
    const b = customerBalanceAsOf(ds, c.id);
    const invs = [...map.values()].filter(x => x.invoice.customerId === c.id);
    const cols = live(ds.collections).filter(x => x.customerId === c.id);
    const allocated = sum(cols.map(x => ix.allocByCollection.get(x.id) || 0));
    const od = invs.filter(x => x.overdue);
    const pendingCN = sum(live(ds.creditNotes).filter(x => x.customerId === c.id && cnEffective(x) === 0 && x.status !== 'Rejected').map(x => x.amount));
    const myDed = live(ds.deductions).filter(x => x.customerId === c.id);
    const disputedDeductions = sum(myDed.filter(x => x.status === 'Disputed').map(x => x.claimedAmount));
    const claimedDeductions = sum(myDed.filter(x => x.status === 'Claimed').map(x => x.claimedAmount));
    const grvAwaitingCN = sum(grvsAwaitingCN(ds).filter(g => g.customerId === c.id).map(g => g.amount));
    const overdue = sum(od.map(x => x.remaining));
    const balance = b.balance;
    out.set(c.id, {
      customer: c, invoiced: b.invoiced, collected: b.collected, allocated,
      unallocated: r2(b.collected - allocated), creditNotes: b.creditNotes, deductions: b.deductions,
      adjustments: r2(b.creditNotes + b.deductions), balance, overdue, overdueCount: od.length,
      openInvoices: invs.filter(x => x.remaining > EPS).length, pendingCN, disputedDeductions, claimedDeductions, grvAwaitingCN,
      paymentStatus: balance < -EPS ? 'Credit' : overdue > EPS ? 'Overdue' : balance > EPS ? 'Outstanding' : 'Clear'
    });
  }
  return { ix, invoices: map, customers: out };
}

/** Approved GRVs that do not yet have an approved credit note issued against them. */
export function grvsAwaitingCN(ds: DataSet): GRV[] {
  const covered = new Set(live(ds.creditNotes).filter(c => c.grvId && c.status === 'Approved').map(c => c.grvId));
  return live(ds.grvs).filter(g => g.status === 'Approved' && !covered.has(g.id));
}

export function collectionUnallocated(col: Collection, ix: Index) {
  return r2(col.amount - (ix.allocByCollection.get(col.id) || 0));
}

export interface Dashboard {
  invoiced: number; collections: number; outstanding: number; overdue: number; collectionPct: number;
  overdueCount: number; openCount: number; grvTotal: number; grvPending: number; grvApproved: number;
  cnTotal: number; cnApplied: number; cnPending: number;
  dedClaimed: number; dedDisputed: number; dedAccepted: number; unallocated: number;
  trend: { month: string; invoiced: number; collected: number }[];
}

export function dashboard(ds: DataSet, today = todayISO(), months = 12, from?: string, to?: string): Dashboard {
  const inR = (d: string) => (!from || d >= from) && (!to || d <= to);
  const { ix, map } = calcAllInvoices(ds, today);
  const invs = live(ds.invoices).filter(i => inR(i.invoiceDate));
  const cols = live(ds.collections).filter(c => inR(c.date));
  const invoiced = sum(invs.map(i => i.grossAmount));
  const collections = sum(cols.map(c => c.amount));
  const cnApplied = sum(ds.creditNotes.filter(c => inR(c.date)).map(cnEffective));
  const dedAccepted = sum(ds.deductions.filter(d => inR(d.date)).map(deductionEffective));
  const calcs = invs.map(i => map.get(i.id)!);
  const overdueC = calcs.filter(c => c.overdue);
  // Outstanding is always all-time (balances are cumulative)
  const allInvoiced = sum(live(ds.invoices).map(i => i.grossAmount));
  const allCollected = sum(live(ds.collections).map(c => c.amount));
  const allAdj = sum(ds.creditNotes.map(cnEffective)) + sum(ds.deductions.map(deductionEffective));
  const outstanding = r2(allInvoiced - allCollected - allAdj);
  const allOverdue = [...map.values()].filter(c => c.overdue);
  const grvs = live(ds.grvs).filter(g => inR(g.date));
  const cnsL = live(ds.creditNotes).filter(c => inR(c.date));
  const deds = live(ds.deductions).filter(d => inR(d.date));
  const base = invoiced - cnApplied - dedAccepted;
  // trend: last N months ending at today's month
  const trend: Dashboard['trend'] = [];
  const end = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1);
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(end.getFullYear(), end.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    trend.push({
      month: key,
      invoiced: sum(live(ds.invoices).filter(i => monthKey(i.invoiceDate) === key).map(i => i.grossAmount)),
      collected: sum(live(ds.collections).filter(c => monthKey(c.date) === key).map(c => c.amount))
    });
  }
  return {
    invoiced, collections, outstanding,
    overdue: from || to ? sum(overdueC.map(c => c.remaining)) : sum(allOverdue.map(c => c.remaining)),
    collectionPct: base > EPS ? r2((collections / base) * 100) : 0,
    overdueCount: from || to ? overdueC.length : allOverdue.length,
    openCount: [...map.values()].filter(c => c.remaining > EPS).length,
    grvTotal: sum(grvs.map(g => g.amount)),
    grvPending: sum(grvs.filter(g => g.status === 'Pending').map(g => g.amount)),
    grvApproved: sum(grvs.filter(g => g.status === 'Approved').map(g => g.amount)),
    cnTotal: sum(cnsL.filter(c => c.status !== 'Rejected').map(c => c.amount)), cnApplied,
    cnPending: sum(cnsL.filter(c => c.status !== 'Rejected' && cnEffective(c) === 0).map(c => c.amount)),
    dedClaimed: sum(deds.map(d => d.claimedAmount)),
    dedDisputed: sum(deds.filter(d => d.status === 'Disputed').map(d => d.claimedAmount)),
    dedAccepted,
    unallocated: sum(live(ds.collections).map(c => collectionUnallocated(c, ix))),
    trend
  };
}

export const AGE_BUCKETS = ['Not due', '1-30', '31-60', '61-90', '91-120', '120+'] as const;
export function ageBucket(c: InvoiceCalc): typeof AGE_BUCKETS[number] {
  const d = c.daysOverdue;
  if (!c.overdue) return 'Not due';
  if (d <= 30) return '1-30';
  if (d <= 60) return '31-60';
  if (d <= 90) return '61-90';
  if (d <= 120) return '91-120';
  return '120+';
}

export function ageing(ds: DataSet, today = todayISO()) {
  const { map } = calcAllInvoices(ds, today);
  const rows = new Map<string, Record<string, number>>();
  const totals: Record<string, number> = Object.fromEntries([...AGE_BUCKETS, 'Total'].map(b => [b, 0]));
  for (const c of map.values()) {
    if (c.remaining <= EPS) continue;
    const b = ageBucket(c);
    const cid = c.invoice.customerId;
    if (!rows.has(cid)) rows.set(cid, Object.fromEntries([...AGE_BUCKETS, 'Total'].map(x => [x, 0])));
    const r = rows.get(cid)!;
    r[b] = r2(r[b] + c.remaining); r.Total = r2(r.Total + c.remaining);
    totals[b] = r2(totals[b] + c.remaining); totals.Total = r2(totals.Total + c.remaining);
  }
  return { rows, totals };
}

export type Period = 'week' | 'month' | 'quarter' | 'year';
const keyFn: Record<Period, (s: string) => string> = { week: weekKey, month: monthKey, quarter: quarterKey, year: yearKey };

export interface PeriodRow {
  period: string; invoiceCount: number; net: number; vat: number; gross: number;
  collected: number; receiptCount: number; creditNotes: number; deductions: number; grv: number;
}

export function periodReport(ds: DataSet, period: Period, from?: string, to?: string, customerId?: string): PeriodRow[] {
  const f = keyFn[period];
  const inR = (d: string, cid: string) => (!from || d >= from) && (!to || d <= to) && (!customerId || cid === customerId);
  const rows = new Map<string, PeriodRow>();
  const row = (k: string) => {
    if (!rows.has(k)) rows.set(k, { period: k, invoiceCount: 0, net: 0, vat: 0, gross: 0, collected: 0, receiptCount: 0, creditNotes: 0, deductions: 0, grv: 0 });
    return rows.get(k)!;
  };
  for (const i of live(ds.invoices)) if (inR(i.invoiceDate, i.customerId)) {
    const r = row(f(i.invoiceDate)); r.invoiceCount++; r.net = r2(r.net + i.netAmount); r.vat = r2(r.vat + i.vatAmount); r.gross = r2(r.gross + i.grossAmount);
  }
  for (const c of live(ds.collections)) if (inR(c.date, c.customerId)) { const r = row(f(c.date)); r.receiptCount++; r.collected = r2(r.collected + c.amount); }
  for (const c of ds.creditNotes) if (inR(c.date, c.customerId) && cnEffective(c)) { const r = row(f(c.date)); r.creditNotes = r2(r.creditNotes + cnEffective(c)); }
  for (const d of ds.deductions) if (inR(d.date, d.customerId) && deductionEffective(d)) { const r = row(f(d.date)); r.deductions = r2(r.deductions + deductionEffective(d)); }
  for (const g of live(ds.grvs)) if (inR(g.date, g.customerId) && g.status !== 'Rejected') { const r = row(f(g.date)); r.grv = r2(r.grv + g.amount); }
  return [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function customerWiseReport(ds: DataSet, from?: string, to?: string) {
  const inR = (d: string) => (!from || d >= from) && (!to || d <= to);
  const { customers } = calcCustomers(ds);
  return live(ds.customers).map(c => {
    const inv = live(ds.invoices).filter(i => i.customerId === c.id && inR(i.invoiceDate));
    const col = live(ds.collections).filter(x => x.customerId === c.id && inR(x.date));
    const adj = sum(ds.creditNotes.filter(x => x.customerId === c.id && inR(x.date)).map(cnEffective)) +
      sum(ds.deductions.filter(x => x.customerId === c.id && inR(x.date)).map(deductionEffective));
    const sales = sum(inv.map(i => i.grossAmount));
    const collected = sum(col.map(x => x.amount));
    const base = sales - adj;
    return {
      customer: c, invoiceCount: inv.length, sales, collected, adjustments: r2(adj),
      collectionPct: base > EPS ? r2(collected / base * 100) : 0,
      balance: customers.get(c.id)?.balance || 0, overdue: customers.get(c.id)?.overdue || 0
    };
  }).sort((a, b) => b.sales - a.sales);
}

/** Two-year summary: the 24 calendar months ending with the month of `today`, split into two 12-month years. */
export function twoYearSummary(ds: DataSet, today = todayISO()) {
  const end = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1);
  const keys: string[] = [];
  for (let k = 23; k >= 0; k--) {
    const d = new Date(end.getFullYear(), end.getMonth() - k, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const from = keys[0] + '-01';
  const rep = new Map(periodReport(ds, 'month', from, today).map(r => [r.period, r]));
  const monthly: PeriodRow[] = keys.map(k => rep.get(k) || { period: k, invoiceCount: 0, net: 0, vat: 0, gross: 0, collected: 0, receiptCount: 0, creditNotes: 0, deductions: 0, grv: 0 });
  const tot = (rs: PeriodRow[]) => {
    const gross = sum(rs.map(r => r.gross)), collected = sum(rs.map(r => r.collected));
    const adjustments = sum(rs.map(r => r.creditNotes + r.deductions));
    return { gross, collected, adjustments, invoices: rs.reduce((a, r) => a + r.invoiceCount, 0),
      collectionPct: gross - adjustments > EPS ? r2(collected / (gross - adjustments) * 100) : 0 };
  };
  const first12 = tot(monthly.slice(0, 12)), last12 = tot(monthly.slice(12));
  const growthPct = first12.gross > EPS ? r2((last12.gross - first12.gross) / first12.gross * 100) : 0;
  return { from, to: today, monthly, first12, last12, growthPct };
}

// ---------- Validation helpers ----------
export interface AllocationInput { invoiceId: string; amount: number }

/** Validate a collection with its allocations. editingCollectionId excludes the collection's own existing allocations. */
export function validateCollection(ds: DataSet, col: Partial<Collection>, allocs: AllocationInput[], editingCollectionId?: string): string[] {
  const errs: string[] = [];
  if (!col.customerId) errs.push('Select a customer.');
  if (!col.receiptRef?.trim()) errs.push('Receipt reference is required.');
  if (!col.date) errs.push('Payment date is required.');
  if (!(Number(col.amount) > 0)) errs.push('Payment amount must be greater than 0.');
  const totalAlloc = sum(allocs.map(a => a.amount));
  if (allocs.some(a => !(a.amount > 0))) errs.push('Each allocation amount must be greater than 0.');
  if (totalAlloc - (Number(col.amount) || 0) > EPS) errs.push(`Allocated total (${totalAlloc.toFixed(2)}) exceeds the payment amount (${Number(col.amount || 0).toFixed(2)}).`);
  const seen = new Set<string>();
  const others: DataSet = editingCollectionId
    ? { ...ds, allocations: ds.allocations.filter(a => a.collectionId !== editingCollectionId) } : ds;
  const ix = buildIndex(others);
  for (const a of allocs) {
    if (seen.has(a.invoiceId)) errs.push('The same invoice is allocated twice.');
    seen.add(a.invoiceId);
    const inv = ds.invoices.find(i => i.id === a.invoiceId && !i.deleted);
    if (!inv) { errs.push('Allocated invoice not found.'); continue; }
    if (inv.customerId !== col.customerId) errs.push(`Invoice ${inv.invoiceNo} belongs to a different customer.`);
    const rem = calcInvoice(inv, ix).remaining;
    if (a.amount - rem > EPS) errs.push(`Allocation to ${inv.invoiceNo} (${a.amount.toFixed(2)}) exceeds its remaining balance (${rem.toFixed(2)}).`);
  }
  return errs;
}

export function validateInvoice(inv: Partial<Invoice>): string[] {
  const e: string[] = [];
  if (!inv.invoiceNo?.trim()) e.push('Invoice number is required.');
  if (!inv.customerId) e.push('Select a customer.');
  if (!inv.invoiceDate) e.push('Invoice date is required.');
  if (!inv.dueDate) e.push('Due date is required.');
  if (inv.invoiceDate && inv.dueDate && inv.dueDate < inv.invoiceDate) e.push('Due date cannot be before the invoice date.');
  if (!(Number(inv.netAmount) > 0)) e.push('Net amount must be greater than 0.');
  if (Number(inv.vatRate) < 0 || Number(inv.vatRate) > 100) e.push('VAT rate must be between 0 and 100%.');
  if (inv.netAmount != null && inv.vatAmount != null && inv.grossAmount != null &&
    Math.abs(r2(Number(inv.netAmount) + Number(inv.vatAmount)) - Number(inv.grossAmount)) > EPS) e.push('Gross must equal Net + VAT.');
  return e;
}

/** Remaining balance of an invoice excluding a given adjustment (for edit validation). */
export function remainingExcluding(ds: DataSet, invoiceId: string, exclude: { cnId?: string; dedId?: string }) {
  const d2: DataSet = {
    ...ds,
    creditNotes: ds.creditNotes.filter(c => c.id !== exclude.cnId),
    deductions: ds.deductions.filter(d => d.id !== exclude.dedId)
  };
  const inv = ds.invoices.find(i => i.id === invoiceId);
  if (!inv) return 0;
  return calcInvoice(inv, buildIndex(d2)).remaining;
}

export function validateCreditNote(ds: DataSet, cn: Partial<CreditNote>): string[] {
  const e: string[] = [];
  if (!cn.cnRef?.trim()) e.push('Credit note reference is required.');
  if (!cn.customerId) e.push('Select a customer.');
  if (!cn.date) e.push('Date is required.');
  if (!(Number(cn.amount) > 0)) e.push('Amount must be greater than 0.');
  if (cn.applied && cn.status !== 'Approved') e.push('Only an Approved credit note can be marked as applied.');
  if (cn.invoiceId) {
    const inv = ds.invoices.find(i => i.id === cn.invoiceId);
    if (inv && inv.customerId !== cn.customerId) e.push('Invoice belongs to a different customer.');
    if (inv && cn.applied && cn.status === 'Approved') {
      const rem = remainingExcluding(ds, inv.id, { cnId: cn.id });
      if (Number(cn.amount) - rem > EPS) e.push(`Credit note exceeds invoice remaining balance (${rem.toFixed(2)}).`);
    }
  }
  if (cn.grvId) {
    const g = ds.grvs.find(x => x.id === cn.grvId);
    if (g && g.customerId !== cn.customerId) e.push('GRV belongs to a different customer.');
    if (g && Number(cn.amount) - g.amount > EPS) e.push(`Credit note exceeds the GRV amount (${g.amount.toFixed(2)}).`);
    const other = ds.creditNotes.find(x => !x.deleted && x.grvId === cn.grvId && x.id !== cn.id && x.status !== 'Rejected');
    if (other) e.push(`GRV already has credit note ${other.cnRef} - this would double count the return.`);
  }
  return e;
}

export function validateDeduction(ds: DataSet, d: Partial<Deduction>): string[] {
  const e: string[] = [];
  if (!d.ref?.trim()) e.push('Deduction reference is required.');
  if (!d.customerId) e.push('Select a customer.');
  if (!d.date) e.push('Date is required.');
  if (!(Number(d.claimedAmount) > 0)) e.push('Claimed amount must be greater than 0.');
  if (d.status === 'Partially Accepted' && !(Number(d.acceptedAmount) > 0)) e.push('Enter the accepted amount for a partially accepted claim.');
  if (Number(d.acceptedAmount) - Number(d.claimedAmount) > EPS) e.push('Accepted amount cannot exceed the claimed amount.');
  if (d.invoiceId) {
    const inv = ds.invoices.find(i => i.id === d.invoiceId);
    if (inv && inv.customerId !== d.customerId) e.push('Invoice belongs to a different customer.');
    const eff = deductionEffective({ ...(d as Deduction), deleted: false });
    if (inv && eff > 0) {
      const rem = remainingExcluding(ds, inv.id, { dedId: d.id });
      if (eff - rem > EPS) e.push(`Accepted deduction exceeds invoice remaining balance (${rem.toFixed(2)}).`);
    }
  }
  return e;
}

// ---------- Reconciliation ----------
export interface ReconHint { label: string; amount: number; matches: boolean }
export function reconcile(ds: DataSet, customerId: string, statementDate: string, statementBalance: number) {
  const b = customerBalanceAsOf(ds, customerId, statementDate);
  const difference = r2(b.balance - statementBalance); // + means my records show more owed than customer statement
  const hints: ReconHint[] = [];
  const add = (label: string, amount: number) => { if (Math.abs(amount) > EPS) hints.push({ label, amount: r2(amount), matches: Math.abs(Math.abs(amount) - Math.abs(difference)) <= EPS }); };
  const mine = <T extends { customerId: string; deleted?: boolean }>(xs: T[]) => live(xs).filter(x => x.customerId === customerId);
  const upto = (d: string) => d <= statementDate;
  add('Credit notes pending approval / not yet applied', sum(mine(ds.creditNotes).filter(c => upto(c.date) && c.status !== 'Rejected' && cnEffective(c) === 0).map(c => c.amount)));
  add('Disputed deductions (not reducing my balance)', sum(mine(ds.deductions).filter(d => upto(d.date) && d.status === 'Disputed').map(d => d.claimedAmount)));
  add('Claimed deductions awaiting decision', sum(mine(ds.deductions).filter(d => upto(d.date) && d.status === 'Claimed').map(d => d.claimedAmount)));
  add('Approved GRVs without a credit note', sum(grvsAwaitingCN(ds).filter(g => g.customerId === customerId && upto(g.date)).map(g => g.amount)));
  add('Pending GRVs', sum(mine(ds.grvs).filter(g => upto(g.date) && g.status === 'Pending').map(g => g.amount)));
  add('Invoices in last 7 days (may not be booked by customer yet)', sum(mine(ds.invoices).filter(i => upto(i.invoiceDate) && i.invoiceDate > addDays(statementDate, -7)).map(i => i.grossAmount)));
  add('Payments in last 7 days (cheques in transit)', -sum(mine(ds.collections).filter(c => upto(c.date) && c.date > addDays(statementDate, -7)).map(c => c.amount)));
  // single-item matches
  for (const d of mine(ds.deductions).filter(d => upto(d.date) && (d.status === 'Disputed' || d.status === 'Claimed')))
    if (Math.abs(d.claimedAmount - Math.abs(difference)) <= EPS) hints.push({ label: `Deduction ${d.ref} (${d.status})`, amount: d.claimedAmount, matches: true });
  for (const c of mine(ds.creditNotes).filter(c => upto(c.date) && c.status !== 'Rejected' && cnEffective(c) === 0))
    if (Math.abs(c.amount - Math.abs(difference)) <= EPS) hints.push({ label: `Credit note ${c.cnRef} (${c.status}${c.applied ? '' : ', not applied'})`, amount: c.amount, matches: true });
  for (const i of mine(ds.invoices).filter(i => upto(i.invoiceDate)))
    if (Math.abs(i.grossAmount - Math.abs(difference)) <= EPS) hints.push({ label: `Invoice ${i.invoiceNo} (possibly missing on statement)`, amount: i.grossAmount, matches: true });
  return { ...b, recordedBalance: b.balance, statementBalance: r2(statementBalance), difference, status: Math.abs(difference) <= EPS ? 'Matched' as const : 'Discrepancy' as const, hints };
}

// ---------- Follow ups ----------
export function followUpQueue(ds: DataSet, today = todayISO(), upcomingDays = 7) {
  const { map } = calcAllInvoices(ds, today);
  const fus = live(ds.followUps);
  const latestFor = (invId: string) => fus.filter(f => f.invoiceId === invId).sort((a, b) => b.contactDate.localeCompare(a.contactDate))[0];
  const overdue = [...map.values()].filter(c => c.overdue).sort((a, b) => b.daysOverdue - a.daysOverdue)
    .map(c => ({ calc: c, followUp: latestFor(c.invoice.id) as FollowUp | undefined }));
  const dueSoon = [...map.values()].filter(c => c.remaining > EPS && c.daysToDue >= 0 && c.daysToDue <= upcomingDays).sort((a, b) => a.daysToDue - b.daysToDue);
  const promises = fus.filter(f => f.status === 'Promised' && f.promisedDate && f.promisedDate <= addDays(today, upcomingDays)).sort((a, b) => a.promisedDate!.localeCompare(b.promisedDate!));
  const contactsDue = fus.filter(f => (f.status === 'Open' || f.status === 'Promised' || f.status === 'Escalated') && f.nextContactDate && f.nextContactDate <= today);
  return { overdue, dueSoon, promises, contactsDue };
}

// ---------- Duplicate detection ----------
export function findDuplicate<T extends { id: string; deleted?: boolean }>(xs: T[], field: keyof T, value: string, selfId?: string): T | undefined {
  const v = (value || '').trim().toLowerCase();
  if (!v) return undefined;
  return xs.find(x => !x.deleted && x.id !== selfId && String(x[field] ?? '').trim().toLowerCase() === v);
}
