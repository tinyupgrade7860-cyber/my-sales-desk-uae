import { useState } from 'preact/hooks';
import { useStore, custName, invNo } from '../store';
import { Page, Field, Select, Money, Badge, Empty, SearchBox } from '../ui';
import { norm, fmtDate, monthKey } from '../util';
import { cnEffective } from '../calc';
import { saveCSV } from '../exporter';

interface Hit { type: string; ref: string; date: string; customerId: string; amount: number; status: string; link: string; overdue?: boolean; text: string }

export function SearchScreen() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [cust, setCust] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [month, setMonth] = useState(''); const [year, setYear] = useState('');
  const [pay, setPay] = useState(''); const [od, setOd] = useState('');
  const [grvSt, setGrvSt] = useState(''); const [recSt, setRecSt] = useState('');
  const hits: Hit[] = [];
  for (const x of s.invoices.values()) hits.push({ type: 'Invoice', ref: x.invoice.invoiceNo, date: x.invoice.invoiceDate, customerId: x.invoice.customerId, amount: x.remaining, status: x.status, overdue: x.overdue, link: '#/invoices/' + x.invoice.id, text: [x.invoice.invoiceNo, x.invoice.lpo, x.invoice.notes].join(' ') });
  for (const c of s.data.collections) if (!c.deleted) hits.push({ type: 'Collection', ref: c.receiptRef, date: c.date, customerId: c.customerId, amount: c.amount, status: c.method, link: '#/collections/' + c.id, text: [c.receiptRef, c.chequeNo, c.bank, c.notes].join(' ') });
  for (const g of s.data.grvs) if (!g.deleted) hits.push({ type: 'GRV', ref: g.grvRef, date: g.date, customerId: g.customerId, amount: g.amount, status: g.status, link: '#/grv-form/' + g.id, text: [g.grvRef, g.reason, invNo(s, g.invoiceId)].join(' ') });
  for (const c of s.data.creditNotes) if (!c.deleted) hits.push({ type: 'Credit note', ref: c.cnRef, date: c.date, customerId: c.customerId, amount: c.amount, status: c.status + (cnEffective(c) ? ' · applied' : ''), link: '#/cn-form/' + c.id, text: [c.cnRef, c.reason, invNo(s, c.invoiceId)].join(' ') });
  for (const d of s.data.deductions) if (!d.deleted) hits.push({ type: 'Deduction', ref: d.ref, date: d.date, customerId: d.customerId, amount: d.claimedAmount, status: d.status, link: '#/deduction-form/' + d.id, text: [d.ref, d.reason, d.supportingRef, invNo(s, d.invoiceId)].join(' ') });
  for (const r of s.data.statements) if (!r.deleted) hits.push({ type: 'Reconciliation', ref: r.statementRef || 'Statement', date: r.statementDate, customerId: r.customerId, amount: r.difference, status: r.status, link: '#/recon-form/' + r.id, text: [r.statementRef, r.notes].join(' ') });
  const years = [...new Set(hits.map(h => h.date.slice(0, 4)))].sort().reverse();
  const anyFilter = q || type || cust || from || to || month || year || pay || od || grvSt || recSt;
  const t = norm(q);
  const res = !anyFilter ? [] : hits.filter(h =>
    (!t || norm(h.text + ' ' + custName(s, h.customerId)).includes(t)) && (!type || h.type === type) && (!cust || h.customerId === cust) &&
    (!from || h.date >= from) && (!to || h.date <= to) && (!month || monthKey(h.date) === month) && (!year || h.date.startsWith(year)) &&
    (!pay || (h.type === 'Invoice' && h.status === pay)) && (!od || (h.type === 'Invoice' && (od === 'Overdue' ? h.overdue : !h.overdue))) &&
    (!grvSt || (h.type === 'GRV' && h.status === grvSt)) && (!recSt || (h.type === 'Reconciliation' && h.status === recSt))
  ).sort((a, b) => b.date.localeCompare(a.date));
  const cur = s.settings.currency;
  return (
    <Page title="Search & filters" back>
      <SearchBox value={q} onValue={setQ} placeholder="Invoice no, receipt, GRV, CN, cheque, reason…" />
      <div class="filters grid2">
        <Field label="Record type"><Select value={type} onValue={setType} placeholder="All types" options={['Invoice', 'Collection', 'GRV', 'Credit note', 'Deduction', 'Reconciliation']} /></Field>
        <Field label="Customer"><Select value={cust} onValue={setCust} placeholder="All customers" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
        <Field label="From"><input type="date" value={from} onInput={e => setFrom((e.target as HTMLInputElement).value)} /></Field>
        <Field label="To"><input type="date" value={to} onInput={e => setTo((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Month"><input type="month" value={month} onInput={e => setMonth((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Year"><Select value={year} onValue={setYear} placeholder="Any" options={years} /></Field>
        <Field label="Payment status"><Select value={pay} onValue={setPay} placeholder="Any" options={['Unpaid', 'Partially Paid', 'Paid', 'Over-credited']} /></Field>
        <Field label="Overdue"><Select value={od} onValue={setOd} placeholder="Any" options={['Overdue', 'Not overdue']} /></Field>
        <Field label="GRV status"><Select value={grvSt} onValue={setGrvSt} placeholder="Any" options={['Pending', 'Approved', 'Rejected']} /></Field>
        <Field label="Reconciliation"><Select value={recSt} onValue={setRecSt} placeholder="Any" options={['Matched', 'Discrepancy', 'Investigating', 'Resolved']} /></Field>
      </div>
      {anyFilter ? <div class="row between"><span class="muted small" data-testid="search-count">{res.length} result(s)</span>
        {res.length > 0 && <button class="btn sm ghost" onClick={() => saveCSV('search-results.csv', res.map(h => ({ type: h.type, ref: h.ref, date: h.date, customer: custName(s, h.customerId), amount: h.amount, status: h.status })))}>Export CSV</button>}</div>
        : <Empty>Type or pick a filter to search across all records.</Empty>}
      <div class="list">{res.slice(0, 200).map(h => (
        <a class={'list-row' + (h.overdue ? ' overdue' : '')} href={h.link} data-testid="search-hit">
          <div class="grow"><span class="muted small">{h.type}</span> <b>{h.ref}</b><div class="muted small">{custName(s, h.customerId)} · {fmtDate(h.date)}</div></div>
          <div class="right"><Money v={h.amount} cur={cur} /><Badge s={h.overdue ? 'Overdue' : h.status} /></div>
        </a>))}</div>
    </Page>
  );
}
