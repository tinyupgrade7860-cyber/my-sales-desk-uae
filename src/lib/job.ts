/** My Job: personal employment records ledger (pure, unit tested). */
import type { JobCategory, JobRecord } from '../types';
import { r2, sum, monthKey, daysBetween } from '../util';

export interface CatCfg { dir: JobRecord['direction']; group: 'Income' | 'Outflow' | 'Claims' | 'Loans' | 'Records'; fields: string[]; hint?: string }
export const JOB_CATEGORIES: Record<JobCategory, CatCfg> = {
  Salary: { dir: 'in', group: 'Income', fields: ['month'] },
  Incentive: { dir: 'in', group: 'Income', fields: ['month'] },
  Bonus: { dir: 'in', group: 'Income', fields: ['month'] },
  'Vehicle allowance': { dir: 'in', group: 'Income', fields: ['month'] },
  'Other allowance': { dir: 'in', group: 'Income', fields: ['month'] },
  'Other income': { dir: 'in', group: 'Income', fields: [] },
  'Salary deduction': { dir: 'out', group: 'Outflow', fields: ['month'], hint: 'Amount deducted from your salary (fines, advances recovered, etc.)' },
  'Kitha (customer commission)': { dir: 'out', group: 'Outflow', fields: ['customer'], hint: 'Commission paid to a customer; optionally link the customer.' },
  'Other expense': { dir: 'out', group: 'Outflow', fields: [] },
  'Other outflow': { dir: 'out', group: 'Outflow', fields: [] },
  'Fuel / mileage': { dir: 'out', group: 'Outflow', fields: ['km'] },
  'Phone bill': { dir: 'out', group: 'Outflow', fields: ['month'] },
  'Expense claim': { dir: 'out', group: 'Claims', fields: ['claim', 'customer'], hint: 'Money you spent for the company; track approval and reimbursement.' },
  'Advance / loan received': { dir: 'in', group: 'Loans', fields: [] },
  'Loan repayment': { dir: 'out', group: 'Loans', fields: ['month'] },
  Leave: { dir: 'none', group: 'Records', fields: ['leave'] },
  'Document expiry': { dir: 'none', group: 'Records', fields: ['document'], hint: 'Visa, Emirates ID, labour card, driving licence, passport…' },
  'Note / achievement': { dir: 'none', group: 'Records', fields: [] },
  'Target history': { dir: 'none', group: 'Records', fields: ['month', 'target'] }
};
export const JOB_CATS = Object.keys(JOB_CATEGORIES) as JobCategory[];

export interface JobMove { date: string; record: JobRecord; type: 'in' | 'out'; amount: number; label: string }
/** Money movements: each record by direction, plus reimbursement inflow for expense claims. */
export function jobMoves(recs: JobRecord[]): JobMove[] {
  const out: JobMove[] = [];
  for (const r of recs) {
    if (r.deleted) continue;
    if (r.direction === 'in' && r.amount) out.push({ date: r.date, record: r, type: 'in', amount: r.amount, label: r.category });
    if (r.direction === 'out' && r.amount) out.push({ date: r.date, record: r, type: 'out', amount: r.amount, label: r.category });
    if (r.category === 'Expense claim' && r.reimbursedAmount && r.claimStatus === 'Paid') out.push({ date: r.reimbursedDate || r.date, record: r, type: 'in', amount: r.reimbursedAmount, label: 'Claim reimbursed' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
export function jobLedger(recs: JobRecord[], from?: string, to?: string) {
  const moves = jobMoves(recs).filter(m => (!from || m.date >= from) && (!to || m.date <= to));
  let bal = 0;
  const rows = moves.map(m => ({ ...m, balance: (bal = r2(bal + (m.type === 'in' ? m.amount : -m.amount))) }));
  const months = new Map<string, { in: number; out: number; byCat: Record<string, number> }>();
  for (const m of moves) {
    const g = months.get(monthKey(m.date)) || months.set(monthKey(m.date), { in: 0, out: 0, byCat: {} }).get(monthKey(m.date))!;
    g[m.type] = r2(g[m.type] + m.amount);
    g.byCat[m.label] = r2((g.byCat[m.label] || 0) + (m.type === 'in' ? m.amount : -m.amount));
  }
  const monthly = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, g]) => ({ month, in: g.in, out: g.out, net: r2(g.in - g.out), byCat: g.byCat }));
  const years = new Map<string, { in: number; out: number }>();
  for (const m of monthly) { const y = years.get(m.month.slice(0, 4)) || years.set(m.month.slice(0, 4), { in: 0, out: 0 }).get(m.month.slice(0, 4))!; y.in = r2(y.in + m.in); y.out = r2(y.out + m.out); }
  const yearly = [...years.entries()].sort().map(([year, y]) => ({ year, in: y.in, out: y.out, net: r2(y.in - y.out) }));
  return { rows, monthly, yearly, totalIn: sum(moves.filter(m => m.type === 'in').map(m => m.amount)), totalOut: sum(moves.filter(m => m.type === 'out').map(m => m.amount)) };
}
export function jobSummary(recs: JobRecord[], year?: string) {
  const live = recs.filter(r => !r.deleted && (!year || r.date.startsWith(year)));
  const byCat = (c: JobCategory) => sum(live.filter(r => r.category === c).map(r => r.amount));
  const claims = live.filter(r => r.category === 'Expense claim');
  const pendingClaims = claims.filter(r => r.claimStatus === 'Submitted' || r.claimStatus === 'Approved' || r.claimStatus === 'Draft');
  const loansIn = sum(recs.filter(r => !r.deleted && r.category === 'Advance / loan received').map(r => r.amount));
  const loansOut = sum(recs.filter(r => !r.deleted && r.category === 'Loan repayment').map(r => r.amount));
  const leaveDays = sum(live.filter(r => r.category === 'Leave').map(r => (r.endDate ? daysBetween(r.date, r.endDate) + 1 : 1)));
  return {
    salary: byCat('Salary'), incentives: r2(byCat('Incentive') + byCat('Bonus')), allowances: r2(byCat('Vehicle allowance') + byCat('Other allowance')),
    kitha: byCat('Kitha (customer commission)'), claimsTotal: sum(claims.map(r => r.amount)), claimsReimbursed: sum(claims.filter(r => r.claimStatus === 'Paid').map(r => r.reimbursedAmount || 0)),
    claimsPending: sum(pendingClaims.map(r => r.amount - (r.reimbursedAmount || 0))), claimsRejected: sum(claims.filter(r => r.claimStatus === 'Rejected').map(r => r.amount)),
    fuelKm: sum(live.filter(r => r.category === 'Fuel / mileage').map(r => r.km || 0)), loanOutstanding: r2(loansIn - loansOut), leaveDays
  };
}
