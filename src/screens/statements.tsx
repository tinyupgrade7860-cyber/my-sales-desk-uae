import { useState } from 'preact/hooks';
import { useStore } from '../store';
import { Page, Card, Money, Field, Input, Select, Chips, Empty, Errors, toast } from '../ui';
import { fmtDate, num, todayISO, EPS } from '../util';
import { qp } from '../router';
import { buildStatement, statementsXlsx, statementsPdf, zipFiles, statementFileName, type Statement } from '../lib/statementExport';
import { saveFile } from '../exporter';
import { salesmen } from '../lib/perf';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export function StatementView({ st }: { st: Statement }) {
  const cur = st.currency;
  return <div data-testid="statement-view">
    <dl class="kv"><dt>Opening balance {st.from ? fmtDate(st.from) : ''}</dt><dd data-testid="st-opening"><Money v={st.opening} cur={cur} /></dd></dl>
    <div class="table-wrap"><table class="tbl" data-testid="st-lines"><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Details / allocation</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
      <tbody>{st.lines.map(l => <tr data-testid={'st-line-' + l.ref}><td>{fmtDate(l.date)}</td><td>{l.type}</td><td>{l.ref}</td><td class="wrap small">{l.description}</td><td class="num">{l.debit ? num(l.debit) : ''}</td><td class="num">{l.credit ? num(l.credit) : ''}</td><td class="num">{num(l.balance)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={4}>Totals</td><td class="num">{num(st.totalDebit)}</td><td class="num">{num(st.totalCredit)}</td><td class="num" data-testid="st-closing">{num(st.closing)}</td></tr></tfoot></table></div>
    <h3 class="small">Open invoices at {fmtDate(st.to)}</h3>
    <div class="table-wrap"><table class="tbl" data-testid="st-open"><thead><tr><th>Invoice</th><th class="num">Gross</th><th class="num">Paid</th><th class="num">CN/Ded</th><th class="num">Balance</th><th class="num">Days o/d</th><th>Receipts</th></tr></thead>
      <tbody>{st.openInvoices.map(o => <tr data-testid={'st-open-' + o.invoiceNo}><td>{o.invoiceNo}</td><td class="num">{num(o.gross)}</td><td class="num">{num(o.paid)}</td><td class="num">{num(o.adjustments)}</td><td class="num">{num(o.balance)}</td><td class="num">{o.daysOverdue || ''}</td><td class="wrap small">{o.receipts}</td></tr>)}</tbody></table></div>
    {st.unallocated > EPS && <p class="small">Unallocated receipts on account: <b>{num(st.unallocated)}</b></p>}
    <div class="table-wrap"><table class="tbl"><thead><tr>{Object.keys(st.ageing).map(k => <th class="num">{k}</th>)}</tr></thead><tbody><tr>{Object.values(st.ageing).map(v => <td class="num">{num(v)}</td>)}</tr></tbody></table></div>
  </div>;
}

export function StatementsScreen() {
  const s = useStore();
  const pre = qp('customer');
  const [mode, setMode] = useState<'One customer' | 'Bulk'>(pre ? 'One customer' : (qp('mode') === 'bulk' ? 'Bulk' : 'One customer'));
  const [cid, setCid] = useState(pre || s.data.customers.find(c => !c.deleted)?.id || '');
  const y = s.today.slice(0, 4);
  const [from, setFrom] = useState(qp('from') || `${y}-01-01`);
  const [to, setTo] = useState(qp('to') || todayISO());
  const [emirate, setEmirate] = useState('');
  const [sm, setSm] = useState('');
  const [onlyBal, setOnlyBal] = useState(true);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [bulkAs, setBulkAs] = useState<'Single file' | 'ZIP of files'>('Single file');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<string[]>([]);
  const opts = { from, to, company: s.settings.companyName || 'Bisbelluk Trading LLC', currency: s.settings.currency, today: s.today };
  const custs = s.data.customers.filter(c => !c.deleted);
  const filtered = custs.filter(c => (!emirate || c.emirate === emirate) && (!sm || c.salesman === sm) && (!onlyBal || Math.abs(s.customers.get(c.id)?.balance || 0) > EPS));
  const chosen = filtered.filter(c => !picked || picked.has(c.id));
  const valid = () => { const e: string[] = []; if (!to) e.push('Statement date is required.'); if (from && to && from > to) e.push('From date is after the statement date.'); setErr(e); return !e.length; };
  const run = async (fmt: 'xlsx' | 'pdf', ids: string[]) => {
    if (!valid()) return;
    if (!ids.length) { toast('No customers selected', 'bad'); return; }
    setBusy(fmt);
    try {
      const sts = ids.map(id => buildStatement(s.data, id, opts));
      if (sts.length === 1) {
        const st = sts[0];
        if (fmt === 'xlsx') await saveFile(statementFileName(st, 'xlsx'), await statementsXlsx([st]), XLSX_MIME);
        else await saveFile(statementFileName(st, 'pdf'), await statementsPdf([st]), 'application/pdf');
      } else if (bulkAs === 'Single file') {
        if (fmt === 'xlsx') await saveFile(`Statements_${sts.length}_customers_${to}.xlsx`, await statementsXlsx(sts), XLSX_MIME);
        else await saveFile(`Statements_${sts.length}_customers_${to}.pdf`, await statementsPdf(sts), 'application/pdf');
      } else {
        const files: Record<string, Uint8Array> = {};
        for (const st of sts) files[statementFileName(st, fmt)] = fmt === 'xlsx' ? await statementsXlsx([st]) : new Uint8Array(await statementsPdf([st]));
        await saveFile(`Statements_${fmt}_${to}.zip`, await zipFiles(files), 'application/zip');
      }
      toast(`Exported ${sts.length} statement(s)`);
    } catch (x: any) { setErr([String(x?.message || x)]); }
    setBusy('');
  };
  const st = mode === 'One customer' && cid ? buildStatement(s.data, cid, opts) : null;
  return <Page title="Customer statements" sub={opts.company} back="/more">
    <Chips value={mode} options={['One customer', 'Bulk']} onValue={setMode} testid="st-mode" />
    <div class="filters grid2">
      <Field label="From (opening balance date)"><Input type="date" name="from" value={from} onValue={setFrom} /></Field>
      <Field label="Statement date (to)"><Input type="date" name="to" value={to} onValue={setTo} /></Field>
    </div>
    <Errors errors={err} />
    {mode === 'One customer' ? <>
      <Field label="Customer"><Select name="customer" aria-label="Statement customer" value={cid} onValue={setCid} options={custs.map(c => [c.id, c.name])} /></Field>
      <div class="row gap"><button class="btn primary" disabled={!!busy} data-testid="st-xlsx" onClick={() => run('xlsx', [cid])}>{busy === 'xlsx' ? 'Building…' : 'Excel (.xlsx)'}</button><button class="btn primary" disabled={!!busy} data-testid="st-pdf" onClick={() => run('pdf', [cid])}>{busy === 'pdf' ? 'Building…' : 'PDF'}</button></div>
      {st && <Card title={st.customer.name} right={<b data-testid="st-closing-head"><Money v={st.closing} cur={st.currency} /></b>}><StatementView st={st} /></Card>}
    </> : <>
      <div class="filters grid2">
        <Field label="Emirate"><Select aria-label="Emirate filter" value={emirate} onValue={v => { setEmirate(v); setPicked(null); }} placeholder="All" options={[...new Set(custs.map(c => c.emirate || '').filter(Boolean))].sort()} /></Field>
        <Field label="Salesman"><Select aria-label="Salesman filter" value={sm} onValue={v => { setSm(v); setPicked(null); }} placeholder="All" options={salesmen(s.data)} /></Field>
      </div>
      <label class="inline small"><input type="checkbox" checked={onlyBal} data-testid="only-balance" onChange={e => { setOnlyBal((e.target as HTMLInputElement).checked); setPicked(null); }} /> Only customers with a balance</label>
      <Field label="Bulk output"><Chips value={bulkAs} options={['Single file', 'ZIP of files']} onValue={setBulkAs} testid="bulk-as" /></Field>
      <Card title={`${chosen.length} of ${filtered.length} customers selected`} right={<button class="link" onClick={() => setPicked(picked ? null : new Set())}>{picked ? 'Select all' : 'Select none'}</button>} testid="bulk-list">
        {filtered.length ? filtered.map(c => <label class="list-row"><input type="checkbox" data-testid={'pick-' + c.code} checked={!picked || picked.has(c.id)} onChange={e => { const n = new Set(picked || filtered.map(x => x.id)); (e.target as HTMLInputElement).checked ? n.add(c.id) : n.delete(c.id); setPicked(n); }} /><span class="grow">{c.name}</span><Money v={s.customers.get(c.id)?.balance || 0} cur={s.settings.currency} /></label>) : <Empty>No customers match.</Empty>}
      </Card>
      <div class="row gap"><button class="btn primary" disabled={!!busy} data-testid="bulk-xlsx" onClick={() => run('xlsx', chosen.map(c => c.id))}>{busy === 'xlsx' ? 'Building…' : `Excel (${chosen.length})`}</button><button class="btn primary" disabled={!!busy} data-testid="bulk-pdf" onClick={() => run('pdf', chosen.map(c => c.id))}>{busy === 'pdf' ? 'Building…' : `PDF (${chosen.length})`}</button></div>
      <p class="small muted">Single file = one workbook with a Summary sheet + one sheet per customer, or one multi-page PDF. ZIP = one file per customer.</p>
    </>}
  </Page>;
}
