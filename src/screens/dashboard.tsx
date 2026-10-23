import { computeAlerts, badgeCount } from '../lib/alerts';
import { monthPerformance } from '../lib/perf';
import { Progress } from './perf';
import { useState } from 'preact/hooks';
import { useStore, custName } from '../store';
import { dashboard, followUpQueue, grvsAwaitingCN } from '../calc';
import { Page, Card, Stat, BarChart, Chips, Money, Badge, Donut, mLabel } from '../ui';
import { money, fmtDate, addDays, monthKey, monthLabel } from '../util';
import { go } from '../router';
import { bulkInsert } from '../db';
import { refresh } from '../store';
import { generateDemo } from '../seed';

type Range = 'All time' | 'This month' | 'This year' | 'Last 12m';

export function Dashboard() {
  const s = useStore();
  const [range, setRange] = useState<Range>('All time');
  const t = s.today;
  const from = range === 'This month' ? t.slice(0, 8) + '01' : range === 'This year' ? t.slice(0, 4) + '-01-01' : range === 'Last 12m' ? addDays(t, -365) : undefined;
  const d = dashboard(s.data, t, 12, from, from ? t : undefined);
  const q = followUpQueue(s.data, t, s.settings.upcomingDays);
  const cur = s.settings.currency;
  const m = (v: number) => money(v, cur);
  const awaiting = grvsAwaitingCN(s.data);
  const badge = badgeCount(computeAlerts(s.data, s.settings, t));
  const perf = monthPerformance(s.data, monthKey(t), s.settings.salesBasis || 'net', {}, t);
  const topOverdue = [...s.customers.values()].filter(c => c.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 5);

  if (!s.data.customers.length) return (
    <Page title="My Sales Desk UAE">
      <Card title="Welcome">
        <p>Your private sales &amp; receivables desk. Everything is stored on this device only.</p>
        <div class="row gap wrap">
          <button class="btn primary" onClick={() => go('/customer-form')}>+ Add first customer</button>
          <button class="btn" data-testid="load-demo" onClick={async () => { await bulkInsert(generateDemo(t)); await refresh(); }}>Load fictional demo data</button>
        </div>
        <p class="muted small">Demo data uses made-up customers (marked “Demo”). You can wipe it later in More › Backup &amp; Data.</p>
      </Card>
    </Page>
  );

  return (
    <Page title="Dashboard" sub={fmtDate(t)} actions={<><a class="bell" href="#/alerts" aria-label="Alerts" data-testid="bell">🔔{badge > 0 && <span class="nbadge" data-testid="bell-count">{badge}</span>}</a><button class="icon-btn" aria-label="Search" onClick={() => go('/search')}>⌕</button></>}>
      <a class="card month-card" href="#/performance" data-testid="dash-target"><div class="row"><b class="grow">{monthLabel(perf.month)} target</b><span>{perf.salesAch == null ? 'No target set' : perf.salesAch.toFixed(0) + '%'}</span></div>
        <Progress v={perf.salesAch} /><div class="muted small">Sales {money(perf.sales, cur)} of {money(perf.salesTarget, cur)} · projected {money(perf.projectedSales, cur)} · collected {money(perf.collections, cur)} of {money(perf.collectionTarget, cur)}</div></a>
      <Chips value={range} options={['All time', 'This month', 'This year', 'Last 12m']} onValue={setRange} testid="dash-range" />
      <div class="stats" data-testid="dash-stats">
        <Stat label="Invoiced sales" value={m(d.invoiced)} onClick={() => go('/invoices')} testid="stat-invoiced" />
        <Stat label="Collections" value={m(d.collections)} tone="ok" onClick={() => go('/collections')} testid="stat-collections" />
        <Stat label="Outstanding" value={m(d.outstanding)} tone="info" sub={`${d.openCount} open invoices`} onClick={() => go('/invoices?status=open')} testid="stat-outstanding" />
        <Stat label="Overdue" value={m(d.overdue)} tone="bad" sub={`${d.overdueCount} overdue invoices`} onClick={() => go('/followups')} testid="stat-overdue" />
        <Stat label="Collection %" value={d.collectionPct.toFixed(1) + '%'} sub="collected ÷ (sales − adjustments)" testid="stat-pct" />
        <Stat label="Unallocated receipts" value={m(d.unallocated)} sub="on-account money" onClick={() => go('/collections?filter=unallocated')} />
        <Stat label="GRVs" value={m(d.grvTotal)} sub={`Pending ${m(d.grvPending)}`} onClick={() => go('/grvs')} testid="stat-grv" />
        <Stat label="Credit notes" value={m(d.cnTotal)} sub={`Applied ${m(d.cnApplied)} · Pending ${m(d.cnPending)}`} onClick={() => go('/credit-notes')} testid="stat-cn" />
        <Stat label="Deduction claims" value={m(d.dedClaimed)} tone="warn" sub={`Disputed ${m(d.dedDisputed)} · Accepted ${m(d.dedAccepted)}`} onClick={() => go('/deductions')} testid="stat-ded" />
      </div>

      <Card title="Monthly trend (12 months)">
        <BarChart data={d.trend.map(x => ({ label: mLabel(x.month).split(' ')[0], a: x.invoiced, b: x.collected }))} aLabel="Invoiced" bLabel="Collected" />
      </Card>

      <Card title="Alerts" testid="alerts">
        {q.contactsDue.length + q.promises.length + q.dueSoon.length + awaiting.length === 0 && <p class="muted">No alerts. 👍</p>}
        {q.promises.map(f => (
          <a class="alert-row info" href={'#/followup-form/' + f.id}>
            <span>💬 Promise: <b>{custName(s, f.customerId)}</b> {f.promisedAmount ? m(f.promisedAmount) : ''}</span>
            <span class={f.promisedDate! < t ? 'bad-text' : ''}>{fmtDate(f.promisedDate)}</span>
          </a>
        ))}
        {q.contactsDue.map(f => (
          <a class="alert-row warn" href={'#/followup-form/' + f.id}><span>📞 Follow up due: <b>{custName(s, f.customerId)}</b></span><span>{fmtDate(f.nextContactDate)}</span></a>
        ))}
        {q.dueSoon.slice(0, 8).map(c => (
          <a class="alert-row" href={'#/invoices/' + c.invoice.id}><span>⏰ {c.invoice.invoiceNo} · {custName(s, c.invoice.customerId)} due {c.daysToDue === 0 ? 'today' : `in ${c.daysToDue}d`}</span><Money v={c.remaining} cur={cur} /></a>
        ))}
        {awaiting.slice(0, 5).map(g => (
          <a class="alert-row" href={'#/grv-form/' + g.id}><span>↩︎ GRV {g.grvRef} approved – credit note not yet issued</span><Money v={g.amount} cur={cur} /></a>
        ))}
      </Card>

      <Card title="Top overdue customers">
        {topOverdue.length ? topOverdue.map(c => (
          <a class="list-row" href={'#/customers/' + c.customer.id}>
            <div><b>{c.customer.name}</b><div class="muted small">{c.overdueCount} overdue invoice(s)</div></div>
            <Money v={c.overdue} cur={cur} class="bad-text" />
          </a>
        )) : <p class="muted">Nothing overdue.</p>}
      </Card>

      <Card title="Adjustments overview">
        <Donut parts={[
          { label: 'CN applied', value: d.cnApplied, cls: 'p1' },
          { label: 'CN pending', value: d.cnPending, cls: 'p2' },
          { label: 'Deductions accepted', value: d.dedAccepted, cls: 'p3' },
          { label: 'Deductions disputed', value: d.dedDisputed, cls: 'p4' }
        ]} />
        <p class="muted small">Only <Badge s="Approved" /> + applied credit notes and accepted deductions reduce balances.</p>
      </Card>
    </Page>
  );
}
