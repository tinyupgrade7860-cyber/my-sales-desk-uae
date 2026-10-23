import { useState } from 'preact/hooks';
import { useStore, refresh, custName } from '../store';
import { Page, Card, Stat, Money, Field, Input, MoneyInput, Select, Errors, Empty, Chips, BarChart, toast, ask, compact } from '../ui';
import { money, num, monthLabel, todayISO, monthKey, fmtDate } from '../util';
import { go, qp } from '../router';
import { saveRecord, voidRecord } from '../db';
import { monthPerformance, yearPerformance, customerContribution, salesmen, monthsOfYear, addMonths, type PerfFilter } from '../lib/perf';
import { saveCSV } from '../exporter';
import { AuditTrail } from './misc';

const pctTxt = (v: number | null) => (v == null ? '—' : v.toFixed(1) + '%');
const gTxt = (v: number | null) => (v == null ? '—' : (v >= 0 ? '▲ ' : '▼ ') + Math.abs(v).toFixed(1) + '%');
export function Progress({ v }: { v: number | null }) {
  const w = Math.max(0, Math.min(100, v || 0));
  return <div class={'progress ' + ((v || 0) >= 100 ? 'over' : (v || 0) < 60 ? 'low' : '')}><i style={`width:${w}%`} /></div>;
}
export function LineChart({ data, aLabel, bLabel }: { data: { label: string; a: number; b: number }[]; aLabel: string; bLabel: string }) {
  const w = 340, h = 150, pad = 26;
  const max = Math.max(1, ...data.flatMap(d => [d.a, d.b]));
  const x = (i: number) => pad + (i * (w - pad - 6)) / Math.max(1, data.length - 1);
  const y = (v: number) => h - 18 - (v / max) * (h - 30);
  const path = (k: 'a' | 'b') => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');
  return <div class="chart"><svg class="line-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="cumulative chart">
    {[0, 0.5, 1].map(f => <g><line x1={pad} x2={w} y1={y(max * f)} y2={y(max * f)} class="grid" /><text x={0} y={y(max * f) + 3} class="axis">{compact(max * f)}</text></g>)}
    <path d={path('b')} class="lb" /><path d={path('a')} class="la" />
    {data.map((d, i) => <text x={x(i)} y={h - 4} class="axis" text-anchor="middle">{d.label}</text>)}
  </svg><div class="legend"><span><i class="bar-a" />{aLabel}</span><span><i class="bar-b" />{bLabel}</span></div></div>;
}

export function PerformanceScreen() {
  const s = useStore();
  const cur = s.settings.currency;
  const [month, setMonth] = useState(qp('month') || monthKey(s.today));
  const [cust, setCust] = useState(qp('customer'));
  const [sm, setSm] = useState('');
  const f: PerfFilter = { customerId: cust || undefined, salesman: sm || undefined };
  const basis = s.settings.salesBasis || 'net';
  const p = monthPerformance(s.data, month, basis, f, s.today);
  const year = month.slice(0, 4);
  const y = yearPerformance(s.data, year, basis, f, s.today);
  const contrib = customerContribution(s.data, [month], basis, sm || undefined);
  const ytdContrib = customerContribution(s.data, monthsOfYear(year).filter(m => m <= monthKey(s.today)), basis, sm || undefined);
  const cm = monthKey(s.today) === month;
  const sl = (m: string) => monthLabel(m).slice(0, 3);
  return <Page title="Targets & performance" back="/more" actions={<a class="btn sm" href="#/targets">Targets</a>}>
    <div class="filters grid2">
      <Field label="Month"><Input type="month" name="month" value={month} onValue={v => v && setMonth(v)} /></Field>
      <Field label="Customer"><Select aria-label="Customer filter" value={cust} onValue={setCust} placeholder="All customers" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
      <Field label="Salesman"><Select aria-label="Salesman filter" value={sm} onValue={setSm} placeholder="All salesmen" options={salesmen(s.data)} /></Field>
      <Field label="Year"><Select aria-label="Year" value={year} onValue={v => setMonth(v + month.slice(4))} options={[...new Set([...s.data.invoices.map(i => i.invoiceDate.slice(0, 4)), s.today.slice(0, 4)])].sort().reverse()} /></Field>
    </div>
    {sm && <p class="small muted">Targets are set overall or per customer, so achievement % is not shown for a salesman filter.</p>}
    <Card title={`${monthLabel(month)} · sales (${basis === 'net' ? 'net of VAT' : 'incl. VAT'})`} testid="perf-sales">
      <div class="stats">
        <Stat label="Actual sales" value={money(p.sales, cur)} testid="perf-actual" sub={`target ${money(p.salesTarget, cur)}`} />
        <Stat label="Achievement" value={pctTxt(p.salesAch)} testid="perf-ach" tone={(p.salesAch || 0) >= 100 ? 'ok' : 'warn'} sub={`gap ${money(Math.max(0, p.salesGap), cur)}`} />
        {cm && <Stat label="Projected month end" value={money(p.projectedSales, cur)} testid="perf-proj" sub={`run-rate · ${pctTxt(p.projectedSalesAch)} of target`} />}
        {cm && p.requiredPerDay != null && <Stat label="Needed per day" value={money(p.requiredPerDay, cur)} sub={`${p.daysTotal - p.daysElapsed} days left`} />}
        <Stat label="vs last month" value={gTxt(p.salesMoM)} testid="perf-mom" />
        <Stat label="vs same month last year" value={gTxt(p.salesYoY)} testid="perf-yoy" />
      </div>
      <Progress v={p.salesAch} />
    </Card>
    <Card title="Collections" testid="perf-coll">
      <div class="stats">
        <Stat label="Collected" value={money(p.collections, cur)} testid="perf-coll-actual" sub={`target ${money(p.collectionTarget, cur)}`} />
        <Stat label="Achievement" value={pctTxt(p.collAch)} testid="perf-coll-ach" tone={(p.collAch || 0) >= 100 ? 'ok' : 'warn'} sub={`gap ${money(Math.max(0, p.collGap), cur)}`} />
        {cm && <Stat label="Projected" value={money(p.projectedCollections, cur)} sub={pctTxt(p.projectedCollAch) + ' of target'} />}
        <Stat label="vs last month" value={gTxt(p.collMoM)} />
      </div>
      <Progress v={p.collAch} />
    </Card>
    <Card title={`${year} by month`}>
      <BarChart data={y.months.map(m => ({ label: sl(m.month), a: m.sales, b: m.salesTarget }))} aLabel="Sales" bLabel="Target" />
      <LineChart data={y.cumulative.map(c => ({ label: sl(c.month).slice(0, 1), a: c.sales, b: c.target }))} aLabel="Cumulative sales" bLabel="Cumulative target" />
      <dl class="kv" data-testid="perf-year">
        <dt>Year to date sales</dt><dd><Money v={y.ytd} cur={cur} /></dd>
        <dt>Same period last year</dt><dd><Money v={y.ytdLY} cur={cur} /> ({gTxt(y.ytdGrowth)})</dd>
        <dt>Year target / achievement</dt><dd><Money v={y.totals.target} cur={cur} /> · {pctTxt(y.totals.salesAch)}</dd>
        <dt>Collections / target</dt><dd><Money v={y.totals.collections} cur={cur} /> · {pctTxt(y.totals.collAch)}</dd>
        {y.best && <><dt>Best month</dt><dd>{monthLabel(y.best.month)} · {num(y.best.sales)}</dd></>}
        {y.worst && <><dt>Weakest month</dt><dd>{monthLabel(y.worst.month)} · {num(y.worst.sales)}</dd></>}
      </dl>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Month</th><th class="num">Sales</th><th class="num">Target</th><th class="num">Ach.</th><th class="num">MoM</th><th class="num">YoY</th><th class="num">Collected</th><th class="num">Coll. target</th></tr></thead>
        <tbody>{y.months.map(m => <tr onClick={() => setMonth(m.month)}><td>{sl(m.month)}</td><td class="num">{num(m.sales)}</td><td class="num">{num(m.salesTarget)}</td><td class="num">{pctTxt(m.salesAch)}</td><td class="num">{gTxt(m.salesMoM)}</td><td class="num">{gTxt(m.salesYoY)}</td><td class="num">{num(m.collections)}</td><td class="num">{num(m.collectionTarget)}</td></tr>)}</tbody></table></div>
      <button class="btn sm" onClick={() => saveCSV(`performance-${year}.csv`, y.months)}>Export CSV</button>
    </Card>
    {!cust && <Card title="Customer contribution" testid="perf-contrib">
      {contrib.length ? <div class="table-wrap"><table class="tbl"><thead><tr><th>Customer</th><th class="num">Sales</th><th class="num">Share</th><th class="num">Target</th><th class="num">Ach.</th><th class="num">Collected</th><th class="num">YTD</th></tr></thead>
        <tbody>{contrib.map(r => <tr><td><a href={'#/performance?customer=' + r.customer.id + '&month=' + month}>{r.customer.name}</a></td><td class="num">{num(r.sales)}</td><td class="num">{r.share.toFixed(1)}%</td><td class="num">{num(r.salesTarget)}</td><td class="num">{pctTxt(r.salesAch)}</td><td class="num">{num(r.collections)}</td><td class="num">{num(ytdContrib.find(x => x.customer.id === r.customer.id)?.sales || 0)}</td></tr>)}</tbody></table></div> : <Empty>No sales this month.</Empty>}
    </Card>}
  </Page>;
}

export function TargetsList() {
  const s = useStore();
  const [year, setYear] = useState(s.today.slice(0, 4));
  const ts = s.data.targets.filter(t => !t.deleted && t.month.startsWith(year)).sort((a, b) => b.month.localeCompare(a.month) || (a.customerId ? 1 : -1));
  return <Page title="Monthly targets" back="/performance" actions={<a class="btn sm primary" href="#/target-form" data-testid="new-target">+ Target</a>}>
    <Field label="Year"><Input type="number" name="year" value={year} onValue={setYear} /></Field>
    {ts.length ? <div class="list">{ts.map(t => <a class="list-row" href={'#/target-form/' + t.id} data-testid="target-row"><div class="grow"><b>{monthLabel(t.month)}</b> · {t.customerId ? custName(s, t.customerId) : 'Overall'}<div class="muted small">{t.notes}</div></div><div class="right small">Sales {num(t.salesTarget)}<br />Coll. {num(t.collectionTarget)}</div></a>)}</div> : <Empty>No targets for {year}.</Empty>}
    <p class="small muted">Overall target: if no overall target is set for a month, the sum of customer targets is used.</p>
    <a class="btn block" href="#/sales-entries">Manual sales entries</a>
  </Page>;
}

export function TargetForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.targets.find(t => t.id === id) : undefined;
  const [f, setF] = useState<any>(ex ? { ...ex } : { month: qp('month') || monthKey(s.today), customerId: qp('customer') || '', salesTarget: '', collectionTarget: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const save = async () => {
    const e: string[] = [];
    if (!/^\d{4}-\d{2}$/.test(f.month || '')) e.push('Month is required.');
    const st = Number(f.salesTarget), ct = Number(f.collectionTarget);
    if (!(st >= 0) || f.salesTarget === '') e.push('Sales target must be 0 or more.');
    if (!(ct >= 0) || f.collectionTarget === '') e.push('Collection target must be 0 or more.');
    const dup = s.data.targets.find(t => !t.deleted && t.id !== id && t.month === f.month && (t.customerId || '') === (f.customerId || ''));
    if (dup) e.push(`A target for ${monthLabel(f.month)} / ${f.customerId ? custName(s, f.customerId) : 'Overall'} already exists – edit that one.`);
    setErrors(e); if (e.length) return;
    await saveRecord('targets', { ...f, customerId: f.customerId || undefined, salesTarget: st, collectionTarget: ct } as any, `target ${f.month}`);
    await refresh(); toast('Target saved'); go('/targets');
  };
  return <Page title={ex ? 'Edit target' : 'New target'} back="/targets">
    <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
      <Errors errors={errors} />
      <Field label="Month *"><Input type="month" name="month" value={f.month} onValue={v => setF({ ...f, month: v })} /></Field>
      <Field label="Customer (blank = overall)"><Select name="customerId" aria-label="Target customer" value={f.customerId} onValue={v => setF({ ...f, customerId: v })} placeholder="Overall (all customers)" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
      <Field label={`Sales target (${s.settings.currency}) *`}><MoneyInput name="salesTarget" value={f.salesTarget} onValue={v => setF({ ...f, salesTarget: v })} /></Field>
      <Field label={`Collection target (${s.settings.currency}) *`}><MoneyInput name="collectionTarget" value={f.collectionTarget} onValue={v => setF({ ...f, collectionTarget: v })} /></Field>
      <Field label="Notes" full><Input name="notes" value={f.notes} onValue={v => setF({ ...f, notes: v })} /></Field>
      <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save target</button></div>
      {ex && <button type="button" class="btn danger ghost block" onClick={async () => { if (await ask('Delete this target?', { danger: true, okText: 'Delete' })) { await voidRecord('targets', ex.id, '', 'target ' + ex.month); await refresh(); go('/targets'); } }}>Delete target</button>}
    </form>
    {ex && <Card title="Correction history"><AuditTrail filter={a => a.entityId === ex.id} /></Card>}
  </Page>;
}

export function SalesEntries() {
  const s = useStore();
  const es = s.data.salesEntries.filter(e => !e.deleted).sort((a, b) => b.date.localeCompare(a.date));
  return <Page title="Manual sales entries" back="/targets" actions={<a class="btn sm primary" href="#/sales-form" data-testid="new-sales">+ Entry</a>}>
    <p class="small muted">Sales value not captured as an invoice in this app (e.g. cash/van sales). Added to actual sales in Targets & performance.</p>
    {es.length ? <div class="list">{es.map(e => <a class="list-row" href={'#/sales-form/' + e.id}><div class="grow"><b>{e.description}</b><div class="muted small">{fmtDate(e.date)} · {e.customerId ? custName(s, e.customerId) : e.salesman || 'No customer'}</div></div><Money v={e.amount} cur={s.settings.currency} /></a>)}</div> : <Empty>No manual entries.</Empty>}
  </Page>;
}
export function SalesForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.salesEntries.find(t => t.id === id) : undefined;
  const [f, setF] = useState<any>(ex ? { ...ex } : { date: todayISO(), amount: '', description: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const save = async () => {
    const e: string[] = [];
    if (!f.date) e.push('Date is required.');
    if (!(Number(f.amount) > 0)) e.push('Amount must be more than 0.');
    if (!f.description?.trim()) e.push('Description is required.');
    setErrors(e); if (e.length) return;
    await saveRecord('salesEntries', { ...f, amount: Number(f.amount), customerId: f.customerId || undefined } as any, 'sales entry');
    await refresh(); toast('Sales entry saved'); go('/sales-entries');
  };
  return <Page title={ex ? 'Edit sales entry' : 'New sales entry'} back="/sales-entries">
    <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
      <Errors errors={errors} />
      <Field label="Date *"><Input type="date" name="date" value={f.date} onValue={v => setF({ ...f, date: v })} /></Field>
      <Field label={`Amount (${s.settings.currency}) *`}><MoneyInput name="amount" value={f.amount} onValue={v => setF({ ...f, amount: v })} /></Field>
      <Field label="Customer"><Select name="customerId" aria-label="Sales customer" value={f.customerId} onValue={v => setF({ ...f, customerId: v })} placeholder="None" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
      <Field label="Salesman"><Input name="salesman" value={f.salesman} onValue={v => setF({ ...f, salesman: v })} /></Field>
      <Field label="Description *" full><Input name="description" value={f.description} onValue={v => setF({ ...f, description: v })} /></Field>
      <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save entry</button></div>
      {ex && <button type="button" class="btn danger ghost block" onClick={async () => { if (await ask('Delete this entry?', { danger: true, okText: 'Delete' })) { await voidRecord('salesEntries', ex.id, '', 'sales entry'); await refresh(); go('/sales-entries'); } }}>Delete entry</button>}
    </form>
    {ex && <Card title="Correction history"><AuditTrail filter={a => a.entityId === ex.id} /></Card>}
  </Page>;
}
export { addMonths };
