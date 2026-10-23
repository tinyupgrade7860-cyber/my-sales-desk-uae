/** Fictional demo data generator (deterministic). No real customers. */
import type { DataSet, Customer, Invoice, Collection, Allocation, GRV, CreditNote, Deduction, FollowUp, StatementRecon, Target, SalesEntry, Plan, Task, TaskStatus, JobRecord, ClaimStatus } from './types';
import { emptyDataSet } from './types';
import { addDays, r2, todayISO, toISODate, parseISO } from './util';
import { customerBalanceAsOf } from './calc';

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

const NAMES = [
  ['DEMO-001', 'Falcon Crest Trading LLC (Demo)', 'Dubai', 60],
  ['DEMO-002', 'Blue Lagoon Supermarket (Demo)', 'Sharjah', 45],
  ['DEMO-003', 'Desert Rose Hypermarket (Demo)', 'Abu Dhabi', 90],
  ['DEMO-004', 'Palm Grove Foodstuff Co. (Demo)', 'Ajman', 30],
  ['DEMO-005', 'Oasis Fresh Mart (Demo)', 'Ras Al Khaimah', 60],
  ['DEMO-006', 'Pearl Bay Retail Group (Demo)', 'Dubai', 90],
  ['DEMO-007', 'Sandstone General Trading (Demo)', 'Fujairah', 30],
  ['DEMO-008', 'Golden Dune Stores (Demo)', 'Umm Al Quwain', 45]
] as const;

export function generateDemo(today = todayISO(), seed = 42): DataSet {
  const rand = rng(seed);
  const now = new Date().toISOString();
  const base = { createdAt: now, updatedAt: now, deleted: false };
  const ds: DataSet = emptyDataSet();
  const start = toISODate(new Date(parseISO(today).getFullYear() - 2, parseISO(today).getMonth() + 1, 1));
  NAMES.forEach(([code, name, emirate, terms], i) => {
    ds.customers.push({ ...base, id: `demo_c${i + 1}`, code, name, emirate, paymentTermsDays: terms, trn: `1000000000000${i}`.slice(0, 15),
      contactPerson: ['A. Buyer', 'S. Manager', 'R. Accounts', 'M. Purchase'][i % 4] + ' (fictional)', phone: `+971 50 000 00${10 + i}`,
      email: `accounts${i + 1}@example.com`, creditLimit: [150000, 80000, 250000, 50000, 100000, 300000, 40000, 60000][i] } as Customer);
  });
  let invN = 1000, rcN = 500, grvN = 100, cnN = 200, dN = 300;
  // invoices: 24 months
  for (let d = start; d <= today; d = addDays(d, 3 + Math.floor(rand() * 4))) {
    const c = ds.customers[Math.floor(rand() * ds.customers.length)];
    const net = r2(2000 + rand() * 38000);
    const vat = r2(net * 0.05);
    ds.invoices.push({ ...base, id: `demo_i${invN}`, invoiceNo: `INV-${invN++}`, customerId: c.id, invoiceDate: d, dueDate: addDays(d, c.paymentTermsDays),
      paymentTermsDays: c.paymentTermsDays, netAmount: net, vatRate: 5, vatAmount: vat, grossAmount: r2(net + vat), lpo: `LPO-${Math.floor(rand() * 90000 + 10000)}` } as Invoice);
  }
  // collections: per customer, pay invoices in order with delays; leave recent ones open
  for (const c of ds.customers) {
    const invs = ds.invoices.filter(i => i.customerId === c.id);
    const slow = c.code === 'DEMO-006' || c.code === 'DEMO-003';
    for (let k = 0; k < invs.length; k += 2) {
      const group = invs.slice(k, k + 2);
      const payDate = addDays(group[group.length - 1].dueDate, Math.floor(rand() * (slow ? 60 : 25)) - 5);
      if (payDate > today) break;
      const allocs = group.map(g => ({ inv: g, amt: rand() < 0.15 ? r2(g.grossAmount * 0.5) : g.grossAmount }));
      const amount = r2(allocs.reduce((a, x) => a + x.amt, 0));
      const id = `demo_r${rcN}`;
      ds.collections.push({ ...base, id, receiptRef: `RCPT-${rcN++}`, customerId: c.id, date: payDate, amount,
        method: (['Cheque', 'Bank Transfer', 'PDC', 'Bank Transfer', 'Cash'] as const)[Math.floor(rand() * 5)], chequeNo: rand() < 0.5 ? String(100000 + Math.floor(rand() * 899999)) : undefined } as Collection);
      allocs.forEach((a, j) => ds.allocations.push({ ...base, id: `demo_al${rcN}_${j}`, collectionId: id, invoiceId: a.inv.id, amount: a.amt } as Allocation));
    }
  }
  // GRVs + credit notes + deductions
  const sample = ds.invoices.filter((_, i) => i % 9 === 4);
  sample.forEach((inv, i) => {
    const gAmt = r2(Math.min(inv.grossAmount * 0.08, 1500 + rand() * 1500));
    const gStatus = i % 5 === 0 ? 'Pending' : i % 7 === 0 ? 'Rejected' : 'Approved';
    const gid = `demo_g${grvN}`;
    const gDate = addDays(inv.invoiceDate, 10);
    if (gDate > today) return;
    ds.grvs.push({ ...base, id: gid, grvRef: `GRV-${grvN++}`, customerId: inv.customerId, invoiceId: inv.id, date: gDate, amount: gAmt,
      reason: ['Damaged in transit', 'Near expiry', 'Wrong item delivered', 'Short shelf life'][i % 4], status: gStatus } as GRV);
    if (gStatus === 'Approved' && i % 4 !== 3) {
      const cnDate = addDays(gDate, 7);
      if (cnDate <= today) ds.creditNotes.push({ ...base, id: `demo_cn${cnN}`, cnRef: `CN-${cnN++}`, customerId: inv.customerId, invoiceId: inv.id, grvId: gid, date: cnDate,
        amount: gAmt, reason: 'Against GRV', status: 'Approved', applied: i % 6 !== 1 } as CreditNote);
    }
  });
  ds.invoices.filter((_, i) => i % 13 === 6).forEach((inv, i) => {
    const amt = r2(300 + rand() * 1200);
    const st = (['Accepted', 'Disputed', 'Claimed', 'Partially Accepted', 'Rejected'] as const)[i % 5];
    const dDate = addDays(inv.invoiceDate, 20);
    if (dDate > today) return;
    ds.deductions.push({ ...base, id: `demo_d${dN}`, ref: `DED-${dN++}`, customerId: inv.customerId, invoiceId: inv.id, date: dDate, claimedAmount: amt,
      acceptedAmount: st === 'Accepted' ? amt : st === 'Partially Accepted' ? r2(amt / 2) : 0,
      reason: ['Listing fee', 'Promotional support', 'Price difference', 'Display rental', 'Late delivery penalty'][i % 5], supportingRef: `PROMO-${i + 10}`, status: st,
      disputeNotes: st === 'Disputed' ? 'Not agreed in trade terms' : undefined } as Deduction);
  });
  // make sure accepted adjustments never exceed remaining: trim allocations on affected invoices
  for (const inv of ds.invoices) {
    const adj = ds.creditNotes.filter(c => c.invoiceId === inv.id && c.status === 'Approved' && c.applied).reduce((a, c) => a + c.amount, 0)
      + ds.deductions.filter(d => d.invoiceId === inv.id && (d.status === 'Accepted' || d.status === 'Partially Accepted')).reduce((a, d) => a + d.acceptedAmount, 0);
    if (!adj) continue;
    for (const a of ds.allocations.filter(a => a.invoiceId === inv.id)) {
      if (a.amount + adj > inv.grossAmount) {
        const newAmt = r2(Math.max(0, inv.grossAmount - adj));
        const col = ds.collections.find(c => c.id === a.collectionId)!;
        col.amount = r2(col.amount - (a.amount - newAmt));
        a.amount = newAmt;
      }
    }
  }
  ds.allocations = ds.allocations.filter(a => a.amount > 0);
  // follow ups on some overdue invoices
  const od = ds.invoices.filter(i => i.dueDate < today && !ds.allocations.some(a => a.invoiceId === i.id)).slice(-6);
  od.forEach((inv, i) => {
    ds.followUps.push({ ...base, id: `demo_f${i}`, customerId: inv.customerId, invoiceId: inv.id, contactDate: addDays(today, -3 - i),
      nextContactDate: addDays(today, i - 2), promisedDate: i % 2 === 0 ? addDays(today, i + 1) : undefined,
      promisedAmount: i % 2 === 0 ? inv.grossAmount : undefined, status: i % 2 === 0 ? 'Promised' : i === 3 ? 'Escalated' : 'Open',
      notes: 'Called accounts team (demo note)' } as FollowUp);
  });
  // a statement reconciliation sample
  const c1 = ds.customers[0];
  const stDate = addDays(today, -15);
  const b = customerBalanceAsOf(ds, c1.id, stDate).balance;
  ds.statements.push({ ...base, id: 'demo_s1', customerId: c1.id, statementDate: stDate, statementRef: 'SOA-DEMO-1', statementBalance: r2(b - 750), recordedBalance: b, difference: 750,
    status: 'Investigating', notes: 'Customer statement lower by 750 - check pending deductions (demo).' } as StatementRecon);
  seedV2(ds, today, base);
  return ds;
}

/** Demo data for schema-v2 tables (targets, plans, tasks, sales entries, My Job). Separate RNG so v1 demo data is unchanged. All amounts fictional. */
function seedV2(ds: DataSet, today: string, base: { createdAt: string; updatedAt: string; deleted: boolean }) {
  const rand = rng(7);
  const SM = ['Salesman A (Demo)', 'Salesman B (Demo)'];
  ds.customers.forEach((c, i) => (c.salesman = SM[i % 3 === 2 ? 1 : 0]));
  const ym = (d: string) => d.slice(0, 7);
  const addM = (m: string, n: number) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const cur = ym(today);
  const byMonth = new Map<string, number>();
  for (const i of ds.invoices) byMonth.set(ym(i.invoiceDate), (byMonth.get(ym(i.invoiceDate)) || 0) + i.netAmount);
  const months = [...byMonth.keys()].sort();
  const avg = [...byMonth.values()].reduce((a, b) => a + b, 0) / Math.max(1, months.length);
  let tn = 0;
  for (const m of months.concat(byMonth.has(addM(cur, 1)) ? [] : [addM(cur, 1)])) {
    const t = Math.round((avg * (0.9 + rand() * 0.3)) / 1000) * 1000;
    ds.targets.push({ ...base, id: `demo_t${tn++}`, month: m, salesTarget: t, collectionTarget: Math.round((t * 0.95) / 1000) * 1000, notes: 'Monthly target (demo)' } as Target);
  }
  for (const m of [addM(cur, -1), cur]) ds.customers.slice(0, 5).forEach(c => {
    const t = Math.round((avg / 6) * (0.7 + rand() * 0.6) / 500) * 500;
    ds.targets.push({ ...base, id: `demo_t${tn++}`, month: m, customerId: c.id, salesTarget: t, collectionTarget: Math.round(t * 0.9 / 500) * 500 } as Target);
  });
  [[-40, 0, 3200, 'Cash van sale (demo)'], [-25, 1, 1850.5, 'Sample order delivered (demo)'], [-12, 2, 4200, 'Promotion stock (demo)'], [-5, 3, 2750, 'Direct delivery (demo)'], [-2, -1, 1500, 'Walk-in counter sales (demo)']]
    .forEach(([off, ci, amt, desc], k) => ds.salesEntries.push({ ...base, id: `demo_se${k}`, date: addDays(today, off as number), customerId: (ci as number) >= 0 ? ds.customers[ci as number].id : undefined, salesman: (ci as number) < 0 ? SM[1] : undefined, amount: amt as number, description: desc as string } as SalesEntry));
  // plans for this month and next month
  const day = (m: string, d: number) => `${m}-${String(d).padStart(2, '0')}`;
  let pn = 0;
  for (const m of [addM(cur, -1), cur, addM(cur, 1)]) ds.customers.slice(0, 6).forEach((c, i) => {
    const visits = [day(m, 3 + i * 2), day(m, 17 + i)].filter(d => d.slice(8) <= '28');
    ds.plans.push({ ...base, id: `demo_p${pn++}`, month: m, customerId: c.id, plannedSales: Math.round((avg / 6) * (0.6 + rand() * 0.7) / 500) * 500,
      plannedCollection: Math.round((avg / 6) * (0.5 + rand() * 0.7) / 500) * 500, visitDates: visits, visitsDone: visits.filter(d => d < today && rand() > 0.25), notes: 'Route plan (demo)' } as Plan);
  });
  const ts = new Date().toISOString();
  const tasks: [string, number, number, Task['priority'], TaskStatus][] = [
    ['Send updated price list (demo)', 0, 0, 'Normal', 'Open'], ['Collect cheque for overdue invoices (demo)', 1, -2, 'High', 'In progress'],
    ['Confirm GRV with store manager (demo)', 2, 2, 'Normal', 'Waiting'], ['Prepare Q4 promotion proposal (demo)', 3, 5, 'Low', 'Open'],
    ['Resolve statement difference (demo)', 0, 1, 'High', 'Open'], ['Deliver credit note copy (demo)', 4, -6, 'Normal', 'Done']
  ];
  tasks.forEach(([title, ci, off, pr, st], k) => ds.tasks.push({ ...base, id: `demo_tk${k}`, title, customerId: ds.customers[ci].id, dueDate: addDays(today, off), priority: pr, status: st,
    updates: [{ ts, text: 'Task created (demo)', status: 'Open' }, ...(st !== 'Open' ? [{ ts, text: `Status changed to ${st} (demo)`, status: st }] : [])] } as Task));
  // My Job records from Dec 2024 (fictional amounts)
  let jn = 0;
  const J = (r: Partial<JobRecord>) => ds.jobRecords.push({ ...base, id: `demo_j${jn++}`, direction: 'in', amount: 0, description: '', ...r } as JobRecord);
  for (let m = '2024-12'; m <= cur; m = addM(m, 1)) {
    const last = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
    const pay = day(m, Math.min(28, last));
    if (pay <= today) {
      J({ category: 'Salary', date: pay, month: m, amount: m < '2025-12' ? 8000 : 8800, description: `Basic salary ${m} (demo)` });
      J({ category: 'Vehicle allowance', date: pay, month: m, amount: 1200, description: 'Vehicle allowance (demo)' });
      J({ category: 'Phone bill', date: day(m, 10), month: m, direction: 'out', amount: r2(120 + rand() * 60), description: 'Mobile bill (demo)' });
      J({ category: 'Fuel / mileage', date: day(m, 15), direction: 'out', amount: r2(350 + rand() * 200), km: Math.round(1800 + rand() * 900), description: 'Fuel for route (demo)' });
      if (+m.slice(5) % 3 === 0) J({ category: 'Incentive', date: pay, month: m, amount: Math.round(1500 + rand() * 2500), description: 'Quarterly sales incentive (demo)' });
    }
  }
  J({ category: 'Advance / loan received', date: '2025-03-05', amount: 5000, description: 'Salary advance (demo)' });
  for (let k = 0; k < 5; k++) J({ category: 'Loan repayment', date: addM('2025-04', k) + '-28', month: addM('2025-04', k), direction: 'out', amount: 1000, description: 'Advance recovery (demo)' });
  J({ category: 'Bonus', date: '2025-12-20', amount: 4000, description: 'Year-end bonus (demo)' });
  J({ category: 'Salary deduction', date: '2025-08-28', month: '2025-08', direction: 'out', amount: 250, description: 'Traffic fine deducted (demo)' });
  const claims: [number, number, ClaimStatus][] = [[-200, 640, 'Paid'], [-120, 385.5, 'Paid'], [-60, 220, 'Approved'], [-45, 910, 'Submitted'], [-8, 150, 'Draft'], [-90, 300, 'Rejected']];
  claims.forEach(([off, amt, st], k) => J({ category: 'Expense claim', date: addDays(today, off), direction: 'out', amount: amt, claimStatus: st, customerId: ds.customers[k % 4].id,
    description: ['Customer lunch meeting', 'Parking & Salik tolls', 'Display material', 'Hotel for Fujairah route', 'Courier charges', 'Personal item'][k] + ' (demo)',
    ...(st === 'Paid' ? { reimbursedAmount: amt, reimbursedDate: addDays(today, off + 20) } : {}) }));
  J({ category: 'Kitha (customer commission)', date: addDays(today, -70), direction: 'out', amount: 500, customerId: ds.customers[1].id, description: 'Listing support commission (demo)' });
  J({ category: 'Kitha (customer commission)', date: addDays(today, -20), direction: 'out', amount: 750, customerId: ds.customers[2].id, description: 'Shelf display commission (demo)' });
  J({ category: 'Other income', date: '2025-06-15', amount: 600, description: 'Referral reward (demo)' });
  J({ category: 'Other expense', date: '2025-09-02', direction: 'out', amount: 180, description: 'Work shoes (demo)' });
  J({ category: 'Leave', date: '2025-07-06', endDate: '2025-07-20', direction: 'none', leaveType: 'Annual', description: 'Annual leave (demo)' });
  J({ category: 'Leave', date: addDays(today, -30), endDate: addDays(today, -29), direction: 'none', leaveType: 'Sick', description: 'Sick leave (demo)' });
  J({ category: 'Document expiry', date: '2024-12-01', direction: 'none', expiryDate: addDays(today, 45), docNumber: 'VISA-DEMO-0001', description: 'Residence visa (demo)' });
  J({ category: 'Document expiry', date: '2024-12-01', direction: 'none', expiryDate: addDays(today, 400), docNumber: '784-0000-0000000-0', description: 'Emirates ID (demo)' });
  J({ category: 'Note / achievement', date: '2025-11-30', direction: 'none', description: 'Opened 3 new outlets in Sharjah (demo)' });
  J({ category: 'Target history', date: addM(cur, -1) + '-01', month: addM(cur, -1), direction: 'none', targetValue: 250000, achievedValue: 236500, description: 'Monthly target given by manager (demo)' });
}
