import { useState } from 'preact/hooks';
import { useStore, custName } from '../store';
import { Page, Card, Chips, Field, Select, BarChart, Money, Empty, mLabel } from '../ui';
import { num, todayISO, fmtDate, monthKey, sum, r2 } from '../util';
import { periodReport, customerWiseReport, ageing, twoYearSummary, AGE_BUCKETS, cnEffective, deductionEffective, type Period } from '../calc';
import { saveCSV, savePDF } from '../exporter';

const TABS = ['Periods', 'Customers', 'Ageing', '2-Year', 'Monthly'] as const;

export function Reports() {
  const s = useStore();
  const [tab, setTab] = useState<typeof TABS[number]>('Periods');
  return (
    <Page title="Reports" back="/more">
      <Chips value={tab} options={[...TABS]} onValue={setTab} testid="report-tabs" />
      {tab === 'Periods' && <PeriodTab />}
      {tab === 'Customers' && <CustomerTab />}
      {tab === 'Ageing' && <AgeingTab />}
      {tab === '2-Year' && <TwoYearTab />}
      {tab === 'Monthly' && <MonthlyTab />}
      {!s.data.invoices.length && <Empty>No data yet.</Empty>}
    </Page>
  );
}

function Range({ from, to, setFrom, setTo }: any) {
  return <>
    <Field label="From"><input type="date" value={from} onInput={e => setFrom((e.target as HTMLInputElement).value)} /></Field>
    <Field label="To"><input type="date" value={to} onInput={e => setTo((e.target as HTMLInputElement).value)} /></Field>
  </>;
}

function PeriodTab() {
  const s = useStore();
  const [p, setP] = useState<Period>('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [cust, setCust] = useState('');
  const rows = periodReport(s.data, p, from || undefined, to || undefined, cust || undefined).reverse();
  const T = { gross: sum(rows.map(r => r.gross)), net: sum(rows.map(r => r.net)), vat: sum(rows.map(r => r.vat)), col: sum(rows.map(r => r.collected)), cn: sum(rows.map(r => r.creditNotes)), ded: sum(rows.map(r => r.deductions)), grv: sum(rows.map(r => r.grv)) };
  const lbl = (k: string) => p === 'month' ? mLabel(k) : k;
  const title = `${p[0].toUpperCase() + p.slice(1)}ly sales & collections`;
  const cols = ['Period', 'Inv #', 'Net', 'VAT', 'Gross', 'Collected', 'CN applied', 'Ded. accepted', 'GRV'];
  const body = rows.map(r => [lbl(r.period), r.invoiceCount, num(r.net), num(r.vat), num(r.gross), num(r.collected), num(r.creditNotes), num(r.deductions), num(r.grv)]);
  return <>
    <Chips value={p} options={['week', 'month', 'quarter', 'year']} onValue={setP} testid="period-chips" />
    <div class="filters grid2">
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <Field label="Customer"><Select value={cust} onValue={setCust} placeholder="All customers" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
      <div class="row gap end">
        <button class="btn sm" data-testid="period-csv" onClick={() => saveCSV(`report-${p}-${todayISO()}.csv`, rows, [{ key: 'period', label: 'Period' }, { key: 'invoiceCount', label: 'Invoices' }, { key: 'net', label: 'Net' }, { key: 'vat', label: 'VAT' }, { key: 'gross', label: 'Gross' }, { key: 'collected', label: 'Collected' }, { key: 'creditNotes', label: 'CN applied' }, { key: 'deductions', label: 'Deductions accepted' }, { key: 'grv', label: 'GRV' }])}>CSV</button>
        <button class="btn sm" data-testid="period-pdf" onClick={() => savePDF(`report-${p}-${todayISO()}.pdf`, title, `${cust ? custName(s, cust) : 'All customers'} · ${from || 'start'} to ${to || 'today'} · AED`, [{ heading: title, head: cols, body, foot: ['Total', sum(rows.map(r => r.invoiceCount)), num(T.net), num(T.vat), num(T.gross), num(T.col), num(T.cn), num(T.ded), num(T.grv)] }], true)}>PDF</button>
      </div>
    </div>
    <Card title={title}>
      <BarChart data={rows.slice(0, 12).reverse().map(r => ({ label: p === 'month' ? mLabel(r.period).split(' ')[0] : r.period.slice(-3), a: r.gross, b: r.collected }))} aLabel="Gross sales" bLabel="Collected" />
      <div class="table-wrap"><table class="tbl" data-testid="period-table"><thead><tr><th>Period</th><th class="num">Inv</th><th class="num">Gross</th><th class="num">Collected</th><th class="num">CN</th><th class="num">Ded.</th></tr></thead>
        <tbody>{rows.map(r => <tr><td>{lbl(r.period)}</td><td class="num">{r.invoiceCount}</td><td class="num">{num(r.gross)}</td><td class="num">{num(r.collected)}</td><td class="num">{num(r.creditNotes)}</td><td class="num">{num(r.deductions)}</td></tr>)}</tbody>
        <tfoot><tr><td>Total</td><td class="num">{sum(rows.map(r => r.invoiceCount))}</td><td class="num">{num(T.gross)}</td><td class="num">{num(T.col)}</td><td class="num">{num(T.cn)}</td><td class="num">{num(T.ded)}</td></tr></tfoot></table></div>
    </Card>
  </>;
}

function CustomerTab() {
  const s = useStore();
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const rows = customerWiseReport(s.data, from || undefined, to || undefined);
  const cols = ['Customer', 'Invoices', 'Sales', 'Collected', 'Adjustments', 'Coll. %', 'Balance', 'Overdue'];
  const body = rows.map(r => [r.customer.name, r.invoiceCount, num(r.sales), num(r.collected), num(r.adjustments), r.collectionPct.toFixed(1) + '%', num(r.balance), num(r.overdue)]);
  return <>
    <div class="filters grid2"><Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <div class="row gap end"><button class="btn sm" onClick={() => saveCSV(`customer-report-${todayISO()}.csv`, rows.map(r => ({ customer: r.customer.name, code: r.customer.code, invoices: r.invoiceCount, sales: r.sales, collected: r.collected, adjustments: r.adjustments, collectionPct: r.collectionPct, balance: r.balance, overdue: r.overdue })))}>CSV</button>
        <button class="btn sm" onClick={() => savePDF(`customer-report-${todayISO()}.pdf`, 'Customer-wise sales & collections', `${from || 'start'} to ${to || 'today'} · balances as at today`, [{ heading: 'Customers', head: cols, body }], true)}>PDF</button></div></div>
    <Card title="Customer-wise sales & collections">
      <div class="table-wrap"><table class="tbl" data-testid="cust-report"><thead><tr><th>Customer</th><th class="num">Sales</th><th class="num">Collected</th><th class="num">%</th><th class="num">Balance</th></tr></thead>
        <tbody>{rows.map(r => <tr onClick={() => (location.hash = '#/customers/' + r.customer.id)}><td>{r.customer.name}</td><td class="num">{num(r.sales)}</td><td class="num">{num(r.collected)}</td><td class="num">{r.collectionPct.toFixed(0)}</td><td class={'num' + (r.overdue > 0 ? ' bad-text' : '')}>{num(r.balance)}</td></tr>)}</tbody></table></div>
    </Card>
  </>;
}

function AgeingTab() {
  const s = useStore();
  const a = ageing(s.data, s.today);
  const rows: any[] = [...a.rows.entries()].map(([cid, r]) => ({ cid, name: custName(s, cid), ...r })).sort((x: any, y: any) => y.Total - x.Total);
  const heads = ['Customer', ...AGE_BUCKETS, 'Total'];
  return <>
    <div class="row gap end">
      <button class="btn sm" onClick={() => saveCSV(`ageing-${todayISO()}.csv`, rows.map(r => ({ Customer: r.name, ...Object.fromEntries([...AGE_BUCKETS, 'Total'].map(b => [b, (r as any)[b]])) })))}>CSV</button>
      <button class="btn sm" onClick={() => savePDF(`ageing-${todayISO()}.pdf`, 'Outstanding ageing analysis', `As at ${fmtDate(s.today)} · days past due date · AED`, [{ heading: 'Ageing by customer', head: heads, body: rows.map(r => [r.name, ...[...AGE_BUCKETS, 'Total'].map(b => num((r as any)[b]))]), foot: ['Total', ...[...AGE_BUCKETS, 'Total'].map(b => num(a.totals[b]))] }], true)}>PDF</button>
    </div>
    <Card title={`Ageing as at ${fmtDate(s.today)}`}>
      <BarChart data={AGE_BUCKETS.map(b => ({ label: b, a: a.totals[b] }))} aLabel="Outstanding by days overdue" />
      <div class="table-wrap"><table class="tbl" data-testid="ageing-table"><thead><tr><th>Customer</th>{AGE_BUCKETS.map(b => <th class="num">{b}</th>)}<th class="num">Total</th></tr></thead>
        <tbody>{rows.map(r => <tr><td>{r.name}</td>{AGE_BUCKETS.map(b => <td class={'num' + (b !== 'Not due' && (r as any)[b] > 0 ? ' bad-text' : '')}>{(r as any)[b] ? num((r as any)[b]) : '–'}</td>)}<td class="num"><b>{num(r.Total)}</b></td></tr>)}</tbody>
        <tfoot><tr><td>Total</td>{AGE_BUCKETS.map(b => <td class="num">{num(a.totals[b])}</td>)}<td class="num">{num(a.totals.Total)}</td></tr></tfoot></table></div>
    </Card>
  </>;
}

function TwoYearTab() {
  const s = useStore();
  const t = twoYearSummary(s.data, s.today);
  const cur = s.settings.currency;
  const y1 = `${mLabel(t.monthly[0].period)} – ${mLabel(t.monthly[11].period)}`, y2 = `${mLabel(t.monthly[12].period)} – ${mLabel(t.monthly[23].period)}`;
  return <>
    <div class="row gap end">
      <button class="btn sm" onClick={() => saveCSV(`two-year-summary-${todayISO()}.csv`, t.monthly)}>CSV</button>
      <button class="btn sm" onClick={() => savePDF(`two-year-summary-${todayISO()}.pdf`, 'Two-year performance summary', `${t.from} to ${t.to}`, [
        { heading: 'Year comparison', head: ['Period', 'Invoices', 'Gross sales', 'Collected', 'Adjustments', 'Collection %'], body: [[y1, t.first12.invoices, num(t.first12.gross), num(t.first12.collected), num(t.first12.adjustments), t.first12.collectionPct + '%'], [y2, t.last12.invoices, num(t.last12.gross), num(t.last12.collected), num(t.last12.adjustments), t.last12.collectionPct + '%']] },
        { heading: 'Monthly', head: ['Month', 'Invoices', 'Gross', 'Collected', 'CN', 'Deductions'], body: t.monthly.map(r => [mLabel(r.period), r.invoiceCount, num(r.gross), num(r.collected), num(r.creditNotes), num(r.deductions)]) }])}>PDF</button>
    </div>
    <div class="stats" data-testid="two-year">
      <div class="stat"><span class="stat-label">Year 1 · {y1}</span><span class="stat-value"><Money v={t.first12.gross} cur={cur} /></span><span class="stat-sub">collected {num(t.first12.collected)} · {t.first12.collectionPct}%</span></div>
      <div class="stat"><span class="stat-label">Year 2 · {y2}</span><span class="stat-value"><Money v={t.last12.gross} cur={cur} /></span><span class="stat-sub">collected {num(t.last12.collected)} · {t.last12.collectionPct}%</span></div>
      <div class={'stat ' + (t.growthPct >= 0 ? 'ok' : 'bad')}><span class="stat-label">Sales growth</span><span class="stat-value">{t.growthPct >= 0 ? '+' : ''}{t.growthPct}%</span></div>
      <div class="stat"><span class="stat-label">2-year total</span><span class="stat-value"><Money v={r2(t.first12.gross + t.last12.gross)} cur={cur} /></span><span class="stat-sub">{t.first12.invoices + t.last12.invoices} invoices</span></div>
    </div>
    <Card title="24-month sales vs collections">
      <BarChart data={t.monthly.map(r => ({ label: mLabel(r.period).split(' ')[0].slice(0, 1), a: r.gross, b: r.collected }))} aLabel="Gross sales" bLabel="Collected" />
    </Card>
  </>;
}

function MonthlyTab() {
  const s = useStore();
  const [m, setM] = useState(monthKey(s.today));
  const inM = (d: string) => monthKey(d) === m;
  const invs = s.data.invoices.filter(i => !i.deleted && inM(i.invoiceDate)).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  const cols = s.data.collections.filter(c => !c.deleted && inM(c.date)).sort((a, b) => a.date.localeCompare(b.date));
  const cns = s.data.creditNotes.filter(c => !c.deleted && inM(c.date));
  const deds = s.data.deductions.filter(c => !c.deleted && inM(c.date));
  const grvs = s.data.grvs.filter(c => !c.deleted && inM(c.date));
  const cur = s.settings.currency;
  const pdf = () => savePDF(`monthly-report-${m}.pdf`, `Monthly report – ${mLabel(m)}`, 'All customers · AED', [
    { heading: 'Summary', head: ['Invoices', 'Gross sales', 'VAT', 'Collected', 'CN applied', 'Deductions accepted', 'GRVs'], body: [[invs.length, num(sum(invs.map(i => i.grossAmount))), num(sum(invs.map(i => i.vatAmount))), num(sum(cols.map(c => c.amount))), num(sum(cns.map(cnEffective))), num(sum(deds.map(deductionEffective))), num(sum(grvs.map(g => g.amount)))]] },
    { heading: 'Invoices', head: ['Date', 'Invoice', 'Customer', 'Net', 'VAT', 'Gross', 'Remaining'], body: invs.map(i => [i.invoiceDate, i.invoiceNo, custName(s, i.customerId), num(i.netAmount), num(i.vatAmount), num(i.grossAmount), num(s.invoices.get(i.id)?.remaining || 0)]) },
    { heading: 'Collections', head: ['Date', 'Receipt', 'Customer', 'Method', 'Amount'], body: cols.map(c => [c.date, c.receiptRef, custName(s, c.customerId), c.method, num(c.amount)]) },
    { heading: 'GRVs, credit notes & deductions', head: ['Type', 'Ref', 'Customer', 'Amount', 'Status'], body: [
      ...grvs.map(g => ['GRV', g.grvRef, custName(s, g.customerId), num(g.amount), g.status]),
      ...cns.map(c => ['Credit note', c.cnRef, custName(s, c.customerId), num(c.amount), c.status + (c.applied ? ' / applied' : '')]),
      ...deds.map(d => ['Deduction', d.ref, custName(s, d.customerId), num(d.claimedAmount), d.status])] }
  ]);
  const csv = () => saveCSV(`monthly-report-${m}.csv`, [
    ...invs.map(i => ({ type: 'Invoice', date: i.invoiceDate, ref: i.invoiceNo, customer: custName(s, i.customerId), amount: i.grossAmount, status: s.invoices.get(i.id)?.status })),
    ...cols.map(c => ({ type: 'Collection', date: c.date, ref: c.receiptRef, customer: custName(s, c.customerId), amount: c.amount, status: c.method })),
    ...grvs.map(g => ({ type: 'GRV', date: g.date, ref: g.grvRef, customer: custName(s, g.customerId), amount: g.amount, status: g.status })),
    ...cns.map(c => ({ type: 'Credit note', date: c.date, ref: c.cnRef, customer: custName(s, c.customerId), amount: c.amount, status: c.status + (c.applied ? ' (applied)' : '') })),
    ...deds.map(d => ({ type: 'Deduction', date: d.date, ref: d.ref, customer: custName(s, d.customerId), amount: d.claimedAmount, status: d.status }))
  ]);
  return <>
    <div class="row gap"><input type="month" value={m} onInput={e => setM((e.target as HTMLInputElement).value)} aria-label="Month" data-testid="month-pick" />
      <button class="btn sm" onClick={csv} data-testid="monthly-csv">CSV</button><button class="btn sm" onClick={pdf} data-testid="monthly-pdf">PDF</button></div>
    <div class="stats">
      <div class="stat"><span class="stat-label">Sales ({invs.length})</span><span class="stat-value"><Money v={sum(invs.map(i => i.grossAmount))} cur={cur} /></span></div>
      <div class="stat ok"><span class="stat-label">Collected ({cols.length})</span><span class="stat-value"><Money v={sum(cols.map(c => c.amount))} cur={cur} /></span></div>
      <div class="stat"><span class="stat-label">CN applied</span><span class="stat-value"><Money v={sum(cns.map(cnEffective))} cur={cur} /></span></div>
      <div class="stat warn"><span class="stat-label">Deductions claimed</span><span class="stat-value"><Money v={sum(deds.map(d => d.claimedAmount))} cur={cur} /></span></div>
    </div>
    <Card title="Invoices">{invs.length ? invs.map(i => <a class="list-row" href={'#/invoices/' + i.id}><div class="grow">{i.invoiceNo} <span class="muted small">{custName(s, i.customerId)} · {fmtDate(i.invoiceDate)}</span></div><Money v={i.grossAmount} cur={cur} /></a>) : <Empty>None</Empty>}</Card>
    <Card title="Collections">{cols.length ? cols.map(c => <a class="list-row" href={'#/collections/' + c.id}><div class="grow">{c.receiptRef} <span class="muted small">{custName(s, c.customerId)} · {fmtDate(c.date)}</span></div><Money v={c.amount} cur={cur} /></a>) : <Empty>None</Empty>}</Card>
  </>;
}
