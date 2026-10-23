import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Dexie from 'dexie';
import * as XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import type { DataSet } from '../../src/types';
import { emptyDataSet } from '../../src/types';
import { monthlyActuals, monthPerformance, yearPerformance, customerContribution, targetFor, planVsActual } from '../../src/lib/perf';
import { computeAlerts, badgeCount, buildICS, calendarEvents } from '../../src/lib/alerts';
import { jobLedger, jobSummary } from '../../src/lib/job';
import { buildStatement, statementsXlsx, statementsPdf, zipFiles } from '../../src/lib/statementExport';
import { SalesDB } from '../../src/db';
import { makeBackup, validateBackup } from '../../src/backup';
import { generateDemo } from '../../src/seed';

const b = { createdAt: '', updatedAt: '', deleted: false };
const TODAY = '2026-10-23';
function fx(): DataSet {
  const ds = emptyDataSet();
  ds.customers.push({ ...b, id: 'c1', code: 'T1', name: 'Test Co (Fictional)', paymentTermsDays: 30, salesman: 'Ali' } as any, { ...b, id: 'c2', code: 'T2', name: 'Other Co (Fictional)', paymentTermsDays: 30, salesman: 'Sara' } as any);
  const inv = (id: string, no: string, cid: string, d: string, net: number) => ({ ...b, id, invoiceNo: no, customerId: cid, invoiceDate: d, dueDate: new Date(Date.parse(d) + 30 * 864e5).toISOString().slice(0, 10), paymentTermsDays: 30, netAmount: net, vatRate: 5, vatAmount: net * 0.05, grossAmount: net * 1.05 });
  ds.invoices.push(inv('i1', 'INV-1', 'c1', '2025-10-05', 8000) as any, inv('i2', 'INV-2', 'c1', '2026-09-10', 10000) as any, inv('i3', 'INV-3', 'c1', '2026-10-05', 6000) as any, inv('i4', 'INV-4', 'c2', '2026-10-12', 4000) as any);
  ds.collections.push({ ...b, id: 'p1', customerId: 'c1', receiptRef: 'RC-1', date: '2026-10-15', amount: 9000, method: 'Cheque' } as any);
  ds.allocations.push({ ...b, id: 'a1', collectionId: 'p1', invoiceId: 'i2', amount: 8000 } as any);
  ds.salesEntries.push({ ...b, id: 's1', date: '2026-10-20', customerId: 'c2', amount: 1000, description: 'manual' } as any);
  ds.targets.push({ ...b, id: 't1', month: '2026-10', salesTarget: 20000, collectionTarget: 12000 } as any, { ...b, id: 't2', month: '2026-10', customerId: 'c1', salesTarget: 8000, collectionTarget: 10000 } as any);
  return ds;
}

describe('targets & performance', () => {
  it('actuals = invoices (net) + manual sales entries; collections by month', () => {
    const a = monthlyActuals(fx()).get('2026-10')!;
    expect(a.sales).toBe(11000); expect(a.invoiced).toBe(10000); expect(a.manual).toBe(1000); expect(a.collections).toBe(9000);
    expect(monthlyActuals(fx(), 'gross').get('2026-10')!.invoiced).toBe(10500);
  });
  it('achievement, gap, run-rate projection, MoM and YoY', () => {
    const p = monthPerformance(fx(), '2026-10', 'net', {}, TODAY);
    expect(p.salesAch).toBe(55); expect(p.salesGap).toBe(9000); expect(p.collAch).toBe(75);
    expect(p.daysElapsed).toBe(23); expect(p.projectedSales).toBe(14826.09); // 11000/23*31
    expect(p.salesMoM).toBe(10); // 11000 vs 10000
    expect(p.salesYoY).toBe(37.5); // vs 8000 in Oct 2025
    expect(p.requiredPerDay).toBe(1125); // 9000 / 8 days left
  });
  it('per-customer target, salesman filter and contribution', () => {
    const c1 = monthPerformance(fx(), '2026-10', 'net', { customerId: 'c1' }, TODAY);
    expect(c1.sales).toBe(6000); expect(c1.salesAch).toBe(75); expect(c1.collAch).toBe(90);
    expect(monthlyActuals(fx(), 'net', { salesman: 'Sara' }).get('2026-10')!.sales).toBe(5000);
    expect(monthlyActuals(fx(), 'net', { salesman: 'Ali' }).get('2026-10')!.collections).toBe(9000); // 8000 allocated + 1000 on account
    const ds = fx(); ds.targets = ds.targets.filter(t => t.customerId); // no overall -> sum of customer targets
    expect(targetFor(ds, '2026-10').sales).toBe(8000);
    const cc = customerContribution(fx(), ['2026-10']);
    expect(cc[0].customer.id).toBe('c1'); expect(cc[0].share).toBe(54.55); expect(cc[1].share).toBe(45.45);
  });
  it('year view: cumulative series, best/worst, YTD growth', () => {
    const y = yearPerformance(fx(), '2026', 'net', {}, TODAY);
    expect(y.cumulative[9].sales).toBe(21000); expect(y.best!.month).toBe('2026-10'); expect(y.worst!.month).toBe('2026-09');
    expect(y.ytd).toBe(21000); expect(y.ytdLY).toBe(8000);
  });
});

describe('monthly plan vs actual', () => {
  it('compares planned sales/collection/visits with actuals and lists unplanned', () => {
    const ds = fx();
    ds.plans.push({ ...b, id: 'pl1', month: '2026-10', customerId: 'c1', plannedSales: 12000, plannedCollection: 9000, visitDates: ['2026-10-04', '2026-10-18', '2026-10-28'], visitsDone: ['2026-10-04'] } as any);
    const r = planVsActual(ds, '2026-10', 'net', TODAY);
    const p = r.rows.find(x => x.customerId === 'c1')!;
    expect(p.actualSales).toBe(6000); expect(p.salesAch).toBe(50); expect(p.collAch).toBe(100); expect(p.visitsDone).toBe(1); expect(p.nextVisit).toBe('2026-10-28');
    expect(r.rows.find(x => x.customerId === 'c2')!.plannedSales).toBe(0); // unplanned actual
    expect(r.totals.actualSales).toBe(11000);
  });
});

describe('alert centre & calendar', () => {
  it('collects overdue, due today, promises, visits, tasks, claims and documents; badge counts actionable', () => {
    const ds = fx();
    ds.invoices[0].dueDate = TODAY;
    ds.followUps.push({ ...b, id: 'f1', customerId: 'c1', contactDate: '2026-10-20', status: 'Promised', promisedDate: TODAY, promisedAmount: 500, nextContactDate: '2026-10-25' } as any);
    ds.plans.push({ ...b, id: 'pl1', month: '2026-10', customerId: 'c2', plannedSales: 1, plannedCollection: 1, visitDates: ['2026-10-25'], visitsDone: [] } as any);
    ds.tasks.push({ ...b, id: 'tk1', title: 'Late task', dueDate: '2026-10-20', priority: 'High', status: 'Open', updates: [] } as any, { ...b, id: 'tk2', title: 'Done', dueDate: '2026-10-20', priority: 'Low', status: 'Done', updates: [] } as any);
    ds.jobRecords.push({ ...b, id: 'j1', category: 'Expense claim', date: '2026-08-01', direction: 'out', amount: 300, description: 'Old claim', claimStatus: 'Submitted' } as any,
      { ...b, id: 'j2', category: 'Document expiry', date: '2025-01-01', direction: 'none', amount: 0, description: 'Visa', expiryDate: '2026-11-10' } as any);
    const al = computeAlerts(ds, { upcomingDays: 7, currency: 'AED' }, TODAY);
    const kinds = al.map(a => a.kind);
    for (const k of ['due-today', 'promise', 'visit', 'task', 'claim', 'document']) expect(kinds).toContain(k);
    expect(al.filter(a => a.kind === 'task')).toHaveLength(1);
    expect(badgeCount(al)).toBe(5); // due today, promise, task, claim, document(<=30d) – visit is upcoming
  });
  it('builds a valid .ics with CRLF, all-day events and alarms', () => {
    const ds = generateDemo(TODAY);
    const ev = calendarEvents(ds, TODAY);
    expect(ev.length).toBeGreaterThan(3);
    const ics = buildICS(ev, new Date('2026-10-23T05:00:00Z'));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0')).toBe(true);
    expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}\r\n/); expect(ics).toContain('BEGIN:VALARM');
    expect(ics.split('\r\n').every(l => l.length <= 75)).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(ev.length);
  });
});

describe('My Job ledger', () => {
  it('in/out ledger with claim reimbursements, monthly/yearly summaries', () => {
    const r = (o: any) => ({ ...b, id: Math.random().toString(36), description: 'x', amount: 0, direction: 'in', ...o });
    const recs = [r({ category: 'Salary', date: '2024-12-28', amount: 8000 }), r({ category: 'Vehicle allowance', date: '2024-12-28', amount: 1200 }),
      r({ category: 'Expense claim', date: '2024-12-10', direction: 'out', amount: 500, claimStatus: 'Paid', reimbursedAmount: 500, reimbursedDate: '2025-01-05' }),
      r({ category: 'Expense claim', date: '2025-01-10', direction: 'out', amount: 300, claimStatus: 'Submitted' }),
      r({ category: 'Kitha (customer commission)', date: '2025-01-12', direction: 'out', amount: 250, customerId: 'c1' }),
      r({ category: 'Leave', date: '2025-01-20', endDate: '2025-01-24', direction: 'none' }), r({ category: 'Salary', date: '2025-01-28', amount: 8000, deleted: true })];
    const l = jobLedger(recs as any);
    expect(l.monthly).toEqual([{ month: '2024-12', in: 9200, out: 500, net: 8700, byCat: expect.any(Object) }, { month: '2025-01', in: 500, out: 550, net: -50, byCat: expect.any(Object) }]);
    expect(l.rows.at(-1)!.balance).toBe(8650); expect(l.yearly.map(y => y.year)).toEqual(['2024', '2025']);
    const s = jobSummary(recs as any);
    expect(s.claimsPending).toBe(300); expect(s.claimsReimbursed).toBe(500); expect(s.kitha).toBe(250); expect(s.leaveDays).toBe(5); expect(s.salary).toBe(8000);
  });
  it('demo job data starts Dec 2024 and is fictional', () => {
    const ds = generateDemo(TODAY);
    expect(ds.jobRecords.map(j => j.date).sort()[0]).toBe('2024-12-01');
    expect(ds.jobRecords.every(j => /demo/i.test(j.description))).toBe(true);
  });
});

describe('customer statement export', () => {
  const opts = { company: 'Bisbelluk Trading LLC', from: '2026-10-01', to: TODAY, today: TODAY };
  it('collections reflect on the statement: running balance and allocations', () => {
    const st = buildStatement(fx(), 'c1', opts);
    expect(st.opening).toBe(18900); // INV-1 8400 + INV-2 10500 before Oct
    expect(st.lines.map(l => [l.ref, l.debit, l.credit, l.balance])).toEqual([['INV-3', 6300, 0, 25200], ['RC-1', 0, 9000, 16200]]);
    expect(st.lines[1].description).toContain('INV-2 8000.00'); expect(st.lines[1].description).toContain('on account 1000.00');
    expect(st.closing).toBe(16200);
    const inv2 = st.openInvoices.find(o => o.invoiceNo === 'INV-2')!;
    expect(inv2.paid).toBe(8000); expect(inv2.balance).toBe(2500); expect(inv2.receipts).toContain('RC-1');
    expect(st.unallocated).toBe(1000);
    expect(Object.values(st.ageing).reduce((a, b) => a + b, 0)).toBe(17200);
    // a statement dated before the payment ignores it
    expect(buildStatement(fx(), 'c1', { ...opts, to: '2026-10-14' }).closing).toBe(25200);
  });
  it('xlsx (single + bulk) reads back with SheetJS; PDF text checked with pdftotext; zip', async () => {
    const st1 = buildStatement(fx(), 'c1', opts), st2 = buildStatement(fx(), 'c2', opts);
    const wb = XLSX.read(await statementsXlsx([st1]), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
    const flat = rows.map(r => r.join('|'));
    expect(flat[0]).toContain('Bisbelluk Trading LLC'); expect(flat.some(r => r.includes('Test Co (Fictional)'))).toBe(true);
    expect(rows.find(r => r[0] === 'Opening balance')![6]).toBe(18900);
    expect(rows.find(r => r[2] === 'RC-1')![6]).toBe(16200);
    expect(rows.find(r => r[0] === 'Totals')!.slice(4, 7)).toEqual([6300, 9000, 16200]);
    const bulk = XLSX.read(await statementsXlsx([st1, st2]), { type: 'array' });
    expect(bulk.SheetNames).toEqual(['Summary', 'Test Co (Fictional)', 'Other Co (Fictional)']);
    const sum = XLSX.utils.sheet_to_json<any[]>(bulk.Sheets.Summary, { header: 1 });
    expect(sum.find(r => r[0] === 'Total')![5]).toBe(16200 + 4200);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
    const pdf = path.join(dir, 's.pdf');
    fs.writeFileSync(pdf, Buffer.from(await statementsPdf([st1, st2])));
    const txt = execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
    expect(txt).toContain('Bisbelluk Trading LLC'); expect(txt).toContain('STATEMENT OF ACCOUNT'); expect(txt).toContain('Test Co (Fictional)'); expect(txt).toContain('Other Co (Fictional)');
    expect(txt).toContain('RC-1'); expect(txt).toMatch(/Closing balance: AED 16,200\.00/); expect(txt).toMatch(/Closing balance: AED 4,200\.00/);
    const z = unzipSync(await zipFiles({ 'a.xlsx': await statementsXlsx([st1]), 'b.pdf': new Uint8Array(await statementsPdf([st2])) }));
    expect(Object.keys(z)).toEqual(['a.xlsx', 'b.pdf']);
  }, 30000);
});

describe('schema v1 → v2 migration', () => {
  it('keeps v1 data and adds new tables + settings defaults', async () => {
    const name = 'migr-test-' + Date.now();
    const v1 = new Dexie(name);
    v1.version(1).stores({ customers: 'id, code, name, updatedAt', invoices: 'id, invoiceNo, customerId, invoiceDate, dueDate', collections: 'id, receiptRef, customerId, date', allocations: 'id, collectionId, invoiceId',
      grvs: 'id, grvRef, customerId, invoiceId, date, status', creditNotes: 'id, cnRef, customerId, invoiceId, grvId, date, status', deductions: 'id, ref, customerId, invoiceId, date, status',
      statements: 'id, customerId, statementDate, status', followUps: 'id, customerId, invoiceId, nextContactDate, status', auditLog: 'id, ts, entity, entityId', settings: 'id' });
    await v1.table('customers').add({ ...b, id: 'old1', code: 'OLD', name: 'Legacy Co (Fictional)', paymentTermsDays: 30 });
    await v1.table('invoices').add({ ...b, id: 'oi1', invoiceNo: 'OLD-1', customerId: 'old1', invoiceDate: '2026-01-01', dueDate: '2026-01-31', grossAmount: 100, netAmount: 95.24, vatAmount: 4.76, vatRate: 5, paymentTermsDays: 30 });
    await v1.table('settings').put({ id: 'settings', currency: 'AED', upcomingDays: 9 });
    v1.close();
    const v2 = new SalesDB(name);
    await v2.open();
    expect(v2.verno).toBe(2);
    expect((await v2.customers.get('old1')).name).toBe('Legacy Co (Fictional)');
    expect(await v2.invoices.where('invoiceNo').equals('OLD-1').count()).toBe(1);
    const s: any = await v2.settings.get('settings');
    expect(s.upcomingDays).toBe(9); expect(s.companyName).toBe('Bisbelluk Trading LLC'); expect(s.jobStartDate).toBe('2024-12-01');
    for (const t of ['importBatches', 'statementLines', 'targets', 'salesEntries', 'plans', 'tasks', 'jobRecords']) expect(await (v2 as any)[t].count()).toBe(0);
    await v2.jobRecords.add({ id: 'j', date: '2025-01-01', category: 'Salary' });
    expect(await v2.auditLog.filter((a: any) => /schema v2/.test(a.summary)).count()).toBe(1);
    v2.close();
  });
  it('backup validation covers new tables; v1 backups accepted with warning', () => {
    const ds = generateDemo(TODAY);
    const bk = makeBackup({ ...ds, auditLog: [], settings: [] } as any);
    const v = validateBackup(bk);
    expect(v.ok).toBe(true); expect(v.counts.jobRecords).toBeGreaterThan(20); expect(v.counts.targets).toBeGreaterThan(5);
    const bad = JSON.parse(JSON.stringify(bk)); bad.data.targets[0].month = '2026/10'; bad.checksum = undefined;
    expect(validateBackup(bad).ok).toBe(false);
  });
});
