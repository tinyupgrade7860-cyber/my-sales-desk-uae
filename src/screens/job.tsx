import { useState } from 'preact/hooks';
import { useStore, refresh, custName } from '../store';
import { Page, Card, Stat, Money, Badge, Field, Input, MoneyInput, Select, Errors, Empty, Chips, SearchBox, BarChart, toast, ask, Warn } from '../ui';
import { money, num, monthLabel, fmtDate, todayISO, norm, daysBetween, addDays } from '../util';
import { go, qp } from '../router';
import { saveRecord, voidRecord } from '../db';
import { JOB_CATEGORIES, JOB_CATS, jobLedger, jobSummary } from '../lib/job';
import { saveCSV, saveFile, savePDF } from '../exporter';
import { AuditTrail } from './misc';
import type { JobRecord, JobCategory, ClaimStatus } from '../types';

const TABS = ['Ledger', 'Summary', 'Records', 'Claims', 'Docs & leave'] as const;
type Tab = typeof TABS[number];

export function JobScreen() {
  const s = useStore();
  const cur = s.settings.currency;
  const [tab, setTab] = useState<Tab>((qp('tab') as Tab) || 'Ledger');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const start = s.settings.jobStartDate || '2024-12-01';
  const all = s.data.jobRecords.filter(r => !r.deleted);
  const recs = all.filter(r => (!year || r.date.startsWith(year)) && (!month || r.date.startsWith(month)) && (!cat || r.category === cat) && (!q || norm(`${r.description} ${r.category} ${r.notes || ''} ${r.ref || ''} ${custName(s, r.customerId)}`).includes(norm(q))));
  const L = jobLedger(recs);
  const S = jobSummary(all, year || undefined);
  const years = [...new Set([start.slice(0, 4), ...all.map(r => r.date.slice(0, 4)), s.today.slice(0, 4)])].sort().reverse();
  const exportRows = () => recs.sort((a, b) => a.date.localeCompare(b.date)).map(r => ({ date: r.date, category: r.category, direction: r.direction, amount: r.amount, description: r.description, customer: r.customerId ? custName(s, r.customerId) : '', claimStatus: r.claimStatus || '', reimbursed: r.reimbursedAmount || '', reimbursedDate: r.reimbursedDate || '', month: r.month || '', km: r.km || '', endDate: r.endDate || '', expiryDate: r.expiryDate || '', docNumber: r.docNumber || '', notes: r.notes || '' }));
  const xlsx = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(L.monthly.map(m => ({ Month: m.month, In: m.in, Out: m.out, Net: m.net }))), 'Monthly');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(L.rows.map(r => ({ Date: r.date, Type: r.label, Description: r.record.description, In: r.type === 'in' ? r.amount : '', Out: r.type === 'out' ? r.amount : '', Balance: r.balance }))), 'Ledger');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows()), 'Records');
    await saveFile(`my-job-${s.today}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const pdf = () => savePDF(`my-job-${s.today}.pdf`, `My Job – ${s.settings.companyName}`, `Since ${fmtDate(start)}${year ? ' · ' + year : ''}${cat ? ' · ' + cat : ''} · ${s.settings.ownerName || ''}`, [
    { heading: 'Monthly in / out', head: ['Month', 'In', 'Out', 'Net'], body: L.monthly.map(m => [monthLabel(m.month), num(m.in), num(m.out), num(m.net)]), foot: ['Total', num(L.totalIn), num(L.totalOut), num(L.totalIn - L.totalOut)] },
    { heading: 'Ledger', head: ['Date', 'Type', 'Description', 'In', 'Out', 'Balance'], body: L.rows.map(r => [fmtDate(r.date), r.label, r.record.description, r.type === 'in' ? num(r.amount) : '', r.type === 'out' ? num(r.amount) : '', num(r.balance)]) }
  ]);
  const since = daysBetween(start, s.today);
  return <Page title="My Job" sub={`${s.settings.companyName} · since ${fmtDate(start)} (${Math.floor(since / 30.44)} months)`} back="/more" actions={<a class="btn sm primary" href="#/job-form" data-testid="new-job">+ Record</a>}>
    <div class="tabs scroll-x" data-testid="job-tabs">{TABS.map(t => <button class={'tabbtn' + (t === tab ? ' on' : '')} onClick={() => setTab(t)}>{t}</button>)}</div>
    <div class="filters grid2">
      <Field label="Year"><Select aria-label="Job year" value={year} onValue={v => { setYear(v); setMonth(''); }} placeholder="All years" options={years} /></Field>
      <Field label="Month"><Input type="month" name="jobMonth" value={month} onValue={setMonth} /></Field>
      <Field label="Category"><Select aria-label="Job category" value={cat} onValue={setCat} placeholder="All categories" options={JOB_CATS} /></Field>
      <Field label="Search"><SearchBox value={q} onValue={setQ} placeholder="Search records…" /></Field>
    </div>
    <div class="stats" data-testid="job-totals">
      <Stat label="Money in" value={money(L.totalIn, cur)} tone="ok" testid="job-in" />
      <Stat label="Money out" value={money(L.totalOut, cur)} tone="bad" testid="job-out" />
      <Stat label="Net" value={money(L.totalIn - L.totalOut, cur)} testid="job-net" />
      <Stat label="Claims pending" value={money(S.claimsPending, cur)} tone="warn" onClick={() => setTab('Claims')} testid="job-claims-pending" />
    </div>
    {tab === 'Ledger' && <>
      <Card title="Monthly in / out"><BarChart data={L.monthly.slice(-12).map(m => ({ label: monthLabel(m.month).slice(0, 3), a: m.in, b: m.out }))} aLabel="In" bLabel="Out" />
        <div class="table-wrap"><table class="tbl" data-testid="job-monthly"><thead><tr><th>Month</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th></tr></thead><tbody>{[...L.monthly].reverse().map(m => <tr onClick={() => setMonth(m.month)}><td>{monthLabel(m.month)}</td><td class="num">{num(m.in)}</td><td class="num">{num(m.out)}</td><td class="num">{num(m.net)}</td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td class="num">{num(L.totalIn)}</td><td class="num">{num(L.totalOut)}</td><td class="num">{num(L.totalIn - L.totalOut)}</td></tr></tfoot></table></div></Card>
      <Card title="Ledger" testid="job-ledger">{L.rows.length ? [...L.rows].reverse().slice(0, 200).map(r => <a class="list-row" href={'#/job-form/' + r.record.id}><div class="grow"><b>{r.record.description}</b><div class="muted small">{fmtDate(r.date)} · {r.label}{r.record.customerId ? ' · ' + custName(s, r.record.customerId) : ''}</div></div><div class="right"><span class={r.type === 'in' ? 'pill-in' : 'pill-out'}>{r.type === 'in' ? '+' : '−'}{num(r.amount)}</span><div class="muted small">bal {num(r.balance)}</div></div></a>) : <Empty>No money records.</Empty>}</Card>
    </>}
    {tab === 'Summary' && <Card title={year ? `Summary ${year}` : 'Summary (all years)'} testid="job-summary">
      <dl class="kv"><dt>Salary</dt><dd><Money v={S.salary} cur={cur} /></dd><dt>Incentives & bonuses</dt><dd><Money v={S.incentives} cur={cur} /></dd><dt>Allowances</dt><dd><Money v={S.allowances} cur={cur} /></dd>
        <dt>Kitha paid to customers</dt><dd><Money v={S.kitha} cur={cur} /></dd><dt>Expense claims (total)</dt><dd><Money v={S.claimsTotal} cur={cur} /></dd><dt>Claims reimbursed</dt><dd><Money v={S.claimsReimbursed} cur={cur} /></dd>
        <dt>Claims pending</dt><dd><Money v={S.claimsPending} cur={cur} /></dd><dt>Claims rejected</dt><dd><Money v={S.claimsRejected} cur={cur} /></dd><dt>Fuel km logged</dt><dd>{num(S.fuelKm)}</dd>
        <dt>Advance / loan outstanding</dt><dd><Money v={S.loanOutstanding} cur={cur} /></dd><dt>Leave days</dt><dd>{S.leaveDays}</dd></dl>
      <h3 class="small">By year</h3>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Year</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th></tr></thead><tbody>{L.yearly.map(y => <tr><td>{y.year}</td><td class="num">{num(y.in)}</td><td class="num">{num(y.out)}</td><td class="num">{num(y.net)}</td></tr>)}</tbody></table></div>
      <h3 class="small">Targets history & notes</h3>
      {all.filter(r => r.category === 'Target history' || r.category === 'Note / achievement').sort((a, b) => b.date.localeCompare(a.date)).map(r => <a class="list-row" href={'#/job-form/' + r.id}><div class="grow"><b>{r.description}</b><div class="muted small">{fmtDate(r.date)} · {r.category}{r.targetValue ? ` · target ${num(r.targetValue)} / achieved ${num(r.achievedValue || 0)} (${((100 * (r.achievedValue || 0)) / r.targetValue).toFixed(0)}%)` : ''}</div></div></a>)}
    </Card>}
    {tab === 'Records' && <Card title={`${recs.length} records`} testid="job-records">{recs.length ? [...recs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300).map(r => <a class="list-row" href={'#/job-form/' + r.id} data-testid="job-row"><div class="grow"><b>{r.description}</b><div class="muted small">{fmtDate(r.date)} · {r.category}{r.claimStatus ? ' · ' + r.claimStatus : ''}</div></div>{r.direction !== 'none' && <span class={r.direction === 'in' ? 'pill-in' : 'pill-out'}>{r.direction === 'in' ? '+' : '−'}{num(r.amount)}</span>}</a>) : <Empty>No records match.</Empty>}</Card>}
    {tab === 'Claims' && <Card title="Expense claims" testid="job-claims">{all.filter(r => r.category === 'Expense claim').sort((a, b) => b.date.localeCompare(a.date)).map(r => <a class="list-row" href={'#/job-form/' + r.id}><div class="grow"><b>{r.description}</b><div class="muted small">{fmtDate(r.date)}{r.reimbursedDate ? ' · paid ' + fmtDate(r.reimbursedDate) : ''}{(r.claimStatus === 'Submitted' || r.claimStatus === 'Approved') ? ` · waiting ${daysBetween(r.date, s.today)} days` : ''}</div></div><div class="right"><Money v={r.amount} cur={cur} /><Badge s={r.claimStatus || 'Draft'} tone={r.claimStatus === 'Paid' ? 'ok' : r.claimStatus === 'Rejected' ? 'muted' : 'warn'} /></div></a>)}</Card>}
    {tab === 'Docs & leave' && <>
      <Card title="Document expiry">{all.filter(r => r.category === 'Document expiry').sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || '')).map(r => { const d = r.expiryDate ? daysBetween(s.today, r.expiryDate) : null; return <a class="list-row" href={'#/job-form/' + r.id} data-testid="doc-row"><div class="grow"><b>{r.description}</b><div class="muted small">{r.docNumber} · expires {fmtDate(r.expiryDate)}</div></div><Badge s={d == null ? '?' : d < 0 ? 'Expired' : `${d} days`} tone={d != null && d <= 30 ? 'bad' : d != null && d <= 60 ? 'warn' : 'ok'} /></a>; })}</Card>
      <Card title="Leave">{all.filter(r => r.category === 'Leave').sort((a, b) => b.date.localeCompare(a.date)).map(r => <a class="list-row" href={'#/job-form/' + r.id}><div class="grow"><b>{r.leaveType || 'Leave'}</b> · {r.description}<div class="muted small">{fmtDate(r.date)} – {fmtDate(r.endDate || r.date)}</div></div><span>{r.endDate ? daysBetween(r.date, r.endDate) + 1 : 1} d</span></a>)}</Card>
    </>}
    <Card title="Export">
      <div class="row gap"><button class="btn sm" data-testid="job-csv" onClick={() => saveCSV(`my-job-${s.today}.csv`, exportRows())}>CSV</button><button class="btn sm" data-testid="job-xlsx" onClick={xlsx}>Excel</button><button class="btn sm" data-testid="job-pdf" onClick={pdf}>PDF</button></div>
      <p class="muted small">Exports use the current filters. My Job records are included in the full JSON backup.</p>
    </Card>
  </Page>;
}

const CLAIM: ClaimStatus[] = ['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected'];
export function JobForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.jobRecords.find(r => r.id === id) : undefined;
  const c0 = (qp('category') as JobCategory) || 'Salary';
  const [f, setF] = useState<any>(ex ? { ...ex } : { category: c0, date: todayISO(), direction: JOB_CATEGORIES[c0].dir, amount: '', description: '', month: todayISO().slice(0, 7), claimStatus: 'Submitted' });
  const [errors, setErrors] = useState<string[]>([]);
  const cfg = JOB_CATEGORIES[f.category as JobCategory];
  const has = (k: string) => cfg.fields.includes(k);
  const save = async () => {
    const e: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) e.push('Date is required.');
    if (!f.description?.trim()) e.push('Description is required.');
    const amt = f.amount === '' || f.amount == null ? 0 : Number(f.amount);
    if (f.direction !== 'none' && !(amt > 0)) e.push('Amount must be more than 0.');
    if (!(amt >= 0)) e.push('Amount cannot be negative.');
    if (f.category === 'Expense claim' && f.claimStatus === 'Paid') {
      if (!(Number(f.reimbursedAmount) > 0)) e.push('Enter the reimbursed amount for a paid claim.');
      if (Number(f.reimbursedAmount) > amt + 0.005) e.push('Reimbursed amount cannot exceed the claim amount.');
      if (!f.reimbursedDate) e.push('Enter the reimbursement date.');
    }
    if (f.category === 'Leave' && f.endDate && f.endDate < f.date) e.push('Leave end date is before the start date.');
    if (f.category === 'Document expiry' && !f.expiryDate) e.push('Expiry date is required.');
    if (f.date < (s.settings.jobStartDate || '') && !['Document expiry', 'Note / achievement'].includes(f.category)) e.push(`Date is before your job start date (${fmtDate(s.settings.jobStartDate)}). Change the start date in Settings if needed.`);
    setErrors(e); if (e.length) return;
    const n = (k: string) => (f[k] === '' || f[k] == null ? undefined : Number(f[k]));
    const rec = { ...f, description: f.description.trim(), amount: amt, reimbursedAmount: n('reimbursedAmount'), km: n('km'), targetValue: n('targetValue'), achievedValue: n('achievedValue'), customerId: f.customerId || undefined };
    if (rec.category !== 'Expense claim') { delete rec.claimStatus; }
    await saveRecord('jobRecords', rec as JobRecord, `job record (${f.category})`);
    await refresh(); toast('Saved'); go('/job');
  };
  return <Page title={ex ? 'Edit job record' : 'New job record'} back="/job">
    <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
      <Errors errors={errors} />
      <Field label="Category *"><Select name="category" aria-label="Category" value={f.category} onValue={v => setF({ ...f, category: v, direction: JOB_CATEGORIES[v as JobCategory].dir })} options={JOB_CATS} /></Field>
      {cfg.hint && <p class="small muted full">{cfg.hint}</p>}
      <Field label={f.category === 'Leave' ? 'Start date *' : f.category === 'Document expiry' ? 'Issue / record date *' : 'Date *'}><Input type="date" name="date" value={f.date} onValue={v => setF({ ...f, date: v })} /></Field>
      <Field label="Money direction"><Select name="direction" aria-label="Direction" value={f.direction} onValue={v => setF({ ...f, direction: v })} options={[['in', 'In (received)'], ['out', 'Out (spent / deducted)'], ['none', 'No money']]} /></Field>
      {f.direction !== 'none' && <Field label={`Amount (${s.settings.currency}) *`}><MoneyInput name="amount" value={f.amount} onValue={v => setF({ ...f, amount: v })} /></Field>}
      <Field label="Description *" full><Input name="description" value={f.description} onValue={v => setF({ ...f, description: v })} /></Field>
      {has('month') && <Field label="For month"><Input type="month" name="forMonth" value={f.month} onValue={v => setF({ ...f, month: v })} /></Field>}
      {has('customer') && <Field label="Customer (optional)"><Select name="customerId" aria-label="Job customer" value={f.customerId} onValue={v => setF({ ...f, customerId: v })} placeholder="None" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>}
      {has('claim') && <>
        <Field label="Claim status"><Select name="claimStatus" aria-label="Claim status" value={f.claimStatus} onValue={v => setF({ ...f, claimStatus: v, ...(v === 'Paid' && !f.reimbursedAmount ? { reimbursedAmount: f.amount, reimbursedDate: todayISO() } : {}) })} options={CLAIM} /></Field>
        {f.claimStatus === 'Paid' && <><Field label="Reimbursed amount"><MoneyInput name="reimbursedAmount" value={f.reimbursedAmount} onValue={v => setF({ ...f, reimbursedAmount: v })} /></Field>
          <Field label="Reimbursed on"><Input type="date" name="reimbursedDate" value={f.reimbursedDate} onValue={v => setF({ ...f, reimbursedDate: v })} /></Field></>}
      </>}
      {has('km') && <Field label="Kilometres"><Input type="number" name="km" value={f.km} onValue={v => setF({ ...f, km: v })} /></Field>}
      {has('leave') && <><Field label="End date"><Input type="date" name="endDate" value={f.endDate} onValue={v => setF({ ...f, endDate: v })} /></Field>
        <Field label="Leave type"><Select name="leaveType" aria-label="Leave type" value={f.leaveType} onValue={v => setF({ ...f, leaveType: v })} placeholder="Select" options={['Annual', 'Sick', 'Emergency', 'Unpaid', 'Public holiday', 'Other']} /></Field></>}
      {has('document') && <><Field label="Expiry date *"><Input type="date" name="expiryDate" value={f.expiryDate} onValue={v => setF({ ...f, expiryDate: v })} /></Field>
        <Field label="Document number"><Input name="docNumber" value={f.docNumber} onValue={v => setF({ ...f, docNumber: v })} /></Field></>}
      {has('target') && <><Field label="Target value"><MoneyInput name="targetValue" value={f.targetValue} onValue={v => setF({ ...f, targetValue: v })} /></Field>
        <Field label="Achieved value"><MoneyInput name="achievedValue" value={f.achievedValue} onValue={v => setF({ ...f, achievedValue: v })} /></Field></>}
      <Field label="Reference"><Input name="ref" value={f.ref} onValue={v => setF({ ...f, ref: v })} /></Field>
      <Field label="Notes" full><textarea value={f.notes || ''} onInput={e => setF({ ...f, notes: (e.target as HTMLTextAreaElement).value })} /></Field>
      <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save record</button></div>
      {ex && <button type="button" class="btn danger ghost block" onClick={async () => { if (await ask('Delete this record?', { body: 'It is kept in history and can be found in Correction history.', danger: true, okText: 'Delete' })) { await voidRecord('jobRecords', ex.id, '', 'job record'); await refresh(); go('/job'); } }}>Delete record</button>}
    </form>
    {ex && ex.category === 'Document expiry' && ex.expiryDate && ex.expiryDate <= addDays(s.today, 60) && <Warn>Renew soon – expires {fmtDate(ex.expiryDate)}.</Warn>}
    {ex && <Card title="Correction history"><AuditTrail filter={a => a.entityId === ex.id} /></Card>}
  </Page>;
}
