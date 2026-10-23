/** Targets, sales value and monthly planning calculations (pure, unit tested). */
import type { DataSet, Invoice, Plan, Settings } from '../types';
import { r2, sum, EPS, todayISO, parseISO, monthKey, daysBetween } from '../util';

const live = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter(x => !x.deleted);
export interface PerfFilter { customerId?: string; salesman?: string }
export type Basis = Settings['salesBasis'];

export const addMonths = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const daysInMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
export const monthsOfYear = (y: string | number) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
export const pct = (a: number, b: number) => (Math.abs(b) > EPS ? r2((a / b) * 100) : null);
export const growth = (cur: number, prev: number) => (Math.abs(prev) > EPS ? r2(((cur - prev) / Math.abs(prev)) * 100) : null);

export function invoiceSalesman(ds: DataSet, inv: Invoice) {
  return inv.salesman || ds.customers.find(c => c.id === inv.customerId)?.salesman || '';
}
export function salesmen(ds: DataSet): string[] {
  const s = new Set<string>();
  for (const i of live(ds.invoices)) if (i.salesman) s.add(i.salesman);
  for (const c of live(ds.customers)) if (c.salesman) s.add(c.salesman);
  for (const e of live(ds.salesEntries)) if (e.salesman) s.add(e.salesman);
  return [...s].sort();
}

/** Actual sales and collections per month (YYYY-MM). Sales = invoices (net or gross per setting) + manual sales entries. */
export function monthlyActuals(ds: DataSet, basis: Basis = 'net', f: PerfFilter = {}) {
  const out = new Map<string, { sales: number; invoiced: number; manual: number; collections: number; invoices: number }>();
  const get = (m: string) => out.get(m) || out.set(m, { sales: 0, invoiced: 0, manual: 0, collections: 0, invoices: 0 }).get(m)!;
  const custSm = new Map(ds.customers.map(c => [c.id, c.salesman || '']));
  for (const i of live(ds.invoices)) {
    if (f.customerId && i.customerId !== f.customerId) continue;
    if (f.salesman && invoiceSalesman(ds, i) !== f.salesman) continue;
    const g = get(monthKey(i.invoiceDate));
    const v = basis === 'gross' ? i.grossAmount : i.netAmount;
    g.invoiced = r2(g.invoiced + v); g.sales = r2(g.sales + v); g.invoices++;
  }
  for (const e of live(ds.salesEntries)) {
    if (f.customerId && e.customerId !== f.customerId) continue;
    if (f.salesman && (e.salesman || (e.customerId ? custSm.get(e.customerId) : '')) !== f.salesman) continue;
    const g = get(monthKey(e.date)); g.manual = r2(g.manual + e.amount); g.sales = r2(g.sales + e.amount);
  }
  const invById = new Map(ds.invoices.map(i => [i.id, i]));
  const allocByCol = new Map<string, { invoiceId: string; amount: number }[]>();
  for (const a of live(ds.allocations)) (allocByCol.get(a.collectionId) || allocByCol.set(a.collectionId, []).get(a.collectionId)!).push(a);
  for (const c of live(ds.collections)) {
    if (f.customerId && c.customerId !== f.customerId) continue;
    let amt = c.amount;
    if (f.salesman) {
      // attribute receipts to the salesman of the invoices they pay; unallocated money -> customer's salesman
      const als = allocByCol.get(c.id) || [];
      const allocated = sum(als.map(a => a.amount));
      amt = sum(als.filter(a => { const inv = invById.get(a.invoiceId); return inv && invoiceSalesman(ds, inv) === f.salesman; }).map(a => a.amount));
      if (custSm.get(c.customerId) === f.salesman) amt = r2(amt + c.amount - allocated);
      if (amt <= EPS) continue;
    }
    const g = get(monthKey(c.date)); g.collections = r2(g.collections + amt);
  }
  return out;
}

/** Target for a month. Overall = explicit overall target, else the sum of customer targets. */
export function targetFor(ds: DataSet, month: string, customerId?: string) {
  const ts = live(ds.targets).filter(t => t.month === month);
  if (customerId) {
    const t = ts.find(t => t.customerId === customerId);
    return { sales: t?.salesTarget || 0, collection: t?.collectionTarget || 0, explicit: !!t, record: t };
  }
  const o = ts.find(t => !t.customerId);
  if (o) return { sales: o.salesTarget, collection: o.collectionTarget, explicit: true, record: o };
  const cs = ts.filter(t => t.customerId);
  return { sales: sum(cs.map(t => t.salesTarget)), collection: sum(cs.map(t => t.collectionTarget)), explicit: false, record: undefined };
}

export interface MonthPerf {
  month: string; sales: number; collections: number; salesTarget: number; collectionTarget: number;
  salesAch: number | null; collAch: number | null; salesGap: number; collGap: number;
  projectedSales: number; projectedCollections: number; projectedSalesAch: number | null; projectedCollAch: number | null;
  salesMoM: number | null; salesYoY: number | null; collMoM: number | null; collYoY: number | null;
  daysElapsed: number; daysTotal: number; requiredPerDay: number | null;
}
export function monthPerformance(ds: DataSet, month: string, basis: Basis = 'net', f: PerfFilter = {}, today = todayISO(), act = monthlyActuals(ds, basis, f)): MonthPerf {
  const a = act.get(month) || { sales: 0, collections: 0 };
  const prev = act.get(addMonths(month, -1)) || { sales: 0, collections: 0 };
  const ly = act.get(addMonths(month, -12)) || { sales: 0, collections: 0 };
  const t = f.salesman ? { sales: 0, collection: 0 } : targetFor(ds, month, f.customerId);
  const total = daysInMonth(month);
  const cur = monthKey(today);
  const elapsed = month < cur ? total : month > cur ? 0 : parseISO(today).getDate();
  // run-rate: actual so far / days elapsed * days in month (only meaningful for the current month)
  const proj = (v: number) => (elapsed === 0 ? 0 : elapsed >= total ? v : r2((v / elapsed) * total));
  const ps = proj(a.sales), pc = proj(a.collections);
  const remainingDays = total - elapsed;
  return {
    month, sales: a.sales, collections: a.collections, salesTarget: t.sales, collectionTarget: t.collection,
    salesAch: pct(a.sales, t.sales), collAch: pct(a.collections, t.collection), salesGap: r2(t.sales - a.sales), collGap: r2(t.collection - a.collections),
    projectedSales: ps, projectedCollections: pc, projectedSalesAch: pct(ps, t.sales), projectedCollAch: pct(pc, t.collection),
    salesMoM: growth(a.sales, prev.sales), salesYoY: growth(a.sales, ly.sales), collMoM: growth(a.collections, prev.collections), collYoY: growth(a.collections, ly.collections),
    daysElapsed: elapsed, daysTotal: total, requiredPerDay: remainingDays > 0 && t.sales > a.sales ? r2((t.sales - a.sales) / remainingDays) : null
  };
}

export function yearPerformance(ds: DataSet, year: string, basis: Basis = 'net', f: PerfFilter = {}, today = todayISO()) {
  const act = monthlyActuals(ds, basis, f);
  const months = monthsOfYear(year).map(m => monthPerformance(ds, m, basis, f, today, act));
  let cs = 0, ct = 0, cc = 0, cct = 0;
  const cumulative = months.map(m => ({ month: m.month, sales: (cs = r2(cs + m.sales)), target: (ct = r2(ct + m.salesTarget)), collections: (cc = r2(cc + m.collections)), collTarget: (cct = r2(cct + m.collectionTarget)) }));
  const done = months.filter(m => m.month <= monthKey(today) && (m.sales > EPS || m.salesTarget > EPS));
  const best = done.length ? done.reduce((a, b) => (b.sales > a.sales ? b : a)) : undefined;
  const worst = done.length ? done.reduce((a, b) => (b.sales < a.sales ? b : a)) : undefined;
  const totals = { sales: cs, target: ct, collections: cc, collTarget: cct, salesAch: pct(cs, ct), collAch: pct(cc, cct) };
  const prevYear = monthsOfYear(+year - 1).reduce((a, m) => a + (act.get(m)?.sales || 0), 0);
  // YTD vs same period last year
  const ytdMonths = monthsOfYear(year).filter(m => m <= monthKey(today));
  const ytd = r2(ytdMonths.reduce((a, m) => a + (act.get(m)?.sales || 0), 0));
  const ytdLY = r2(ytdMonths.reduce((a, m) => a + (act.get(addMonths(m, -12))?.sales || 0), 0));
  return { months, cumulative, best, worst, totals, prevYearSales: r2(prevYear), ytd, ytdLY, ytdGrowth: growth(ytd, ytdLY) };
}

/** Per-customer contribution for a set of months. */
export function customerContribution(ds: DataSet, months: string[], basis: Basis = 'net', salesman?: string) {
  const ms = new Set(months);
  const rows = live(ds.customers).map(c => {
    const act = monthlyActuals(ds, basis, { customerId: c.id, salesman });
    let sales = 0, coll = 0, st = 0, ctg = 0;
    for (const m of ms) { const a = act.get(m); sales += a?.sales || 0; coll += a?.collections || 0; const t = targetFor(ds, m, c.id); st += t.sales; ctg += t.collection; }
    return { customer: c, sales: r2(sales), collections: r2(coll), salesTarget: r2(st), collectionTarget: r2(ctg), salesAch: pct(sales, st), share: 0 };
  }).filter(r => r.sales > EPS || r.collections > EPS || r.salesTarget > EPS);
  const tot = sum(rows.map(r => r.sales));
  rows.forEach(r => (r.share = pct(r.sales, tot) || 0));
  return rows.sort((a, b) => b.sales - a.sales);
}

// ---------- Monthly plan vs actual ----------
export interface PlanRowCalc { plan?: Plan; customerId: string; plannedSales: number; actualSales: number; plannedCollection: number; actualCollection: number; salesAch: number | null; collAch: number | null; visitsPlanned: number; visitsDone: number; nextVisit?: string }
export function planVsActual(ds: DataSet, month: string, basis: Basis = 'net', today = todayISO()) {
  const plans = live(ds.plans).filter(p => p.month === month);
  const ids = new Set(plans.map(p => p.customerId));
  const rows: PlanRowCalc[] = [];
  const acts = new Map<string, { sales: number; collections: number }>();
  for (const c of live(ds.customers)) {
    const a = monthlyActuals(ds, basis, { customerId: c.id }).get(month);
    if (a && (a.sales > EPS || a.collections > EPS)) acts.set(c.id, a);
  }
  for (const p of plans) {
    const a = acts.get(p.customerId) || { sales: 0, collections: 0 };
    rows.push({ plan: p, customerId: p.customerId, plannedSales: p.plannedSales, actualSales: a.sales, plannedCollection: p.plannedCollection, actualCollection: a.collections,
      salesAch: pct(a.sales, p.plannedSales), collAch: pct(a.collections, p.plannedCollection), visitsPlanned: p.visitDates.length, visitsDone: p.visitDates.filter(d => p.visitsDone.includes(d)).length,
      nextVisit: p.visitDates.filter(d => d >= today && !p.visitsDone.includes(d)).sort()[0] });
  }
  // unplanned actuals are shown too (sales you made without a plan)
  for (const [cid, a] of acts) if (!ids.has(cid)) rows.push({ customerId: cid, plannedSales: 0, actualSales: a.sales, plannedCollection: 0, actualCollection: a.collections, salesAch: null, collAch: null, visitsPlanned: 0, visitsDone: 0 });
  const t = (k: keyof PlanRowCalc) => sum(rows.map(r => r[k] as number));
  const totals = { plannedSales: t('plannedSales'), actualSales: t('actualSales'), plannedCollection: t('plannedCollection'), actualCollection: t('actualCollection'), visitsPlanned: t('visitsPlanned'), visitsDone: t('visitsDone') };
  return { rows, totals: { ...totals, salesAch: pct(totals.actualSales, totals.plannedSales), collAch: pct(totals.actualCollection, totals.plannedCollection) } };
}
export const dayDiff = daysBetween;
