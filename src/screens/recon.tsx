import { useState } from 'preact/hooks';
import { useStore, refresh, custName } from '../store';
import { Page, Card, Money, Badge, Field, Input, MoneyInput, Select, Errors, Empty, Chips, toast, ask, Warn } from '../ui';
import { fmtDate, num, r2, todayISO } from '../util';
import { go, qp } from '../router';
import { saveRecord, voidRecord } from '../db';
import { reconcile, buildIndex, calcInvoice } from '../calc';
import { saveCSV } from '../exporter';
import { AuditTrail } from './misc';

export function ReconList() {
  const s = useStore();
  const [st, setSt] = useState('All');
  const rows = s.data.statements.filter(x => !x.deleted && (st === 'All' || x.status === st)).sort((a, b) => b.statementDate.localeCompare(a.statementDate));
  const cur = s.settings.currency;
  return (
    <Page title="Statement reconciliation" back="/more" actions={<button class="btn primary sm" data-testid="new-recon" onClick={() => go('/recon-form')}>+ New</button>}>
      <p class="muted small">Compare your recorded balance with the customer’s authorised statement of account. Differences are listed for investigation.</p>
      <Chips value={st} options={['All', 'Discrepancy', 'Investigating', 'Matched', 'Resolved']} onValue={setSt} />
      {rows.length === 0 && <Empty>No reconciliations yet.</Empty>}
      <div class="list">{rows.map(x => (
        <a class="list-row" href={'#/recon-form/' + x.id} data-testid="recon-row">
          <div class="grow"><b>{custName(s, x.customerId)}</b><div class="muted small">{fmtDate(x.statementDate)} · {x.statementRef || 'no ref'} · theirs {num(x.statementBalance)} / mine {num(x.recordedBalance)}</div></div>
          <div class="right"><Money v={x.difference} cur={cur} /><Badge s={x.status} /></div>
        </a>))}
      </div>
    </Page>
  );
}

export function ReconForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.statements.find(x => x.id === id) : undefined;
  const [f, setF] = useState<any>(ex ? { ...ex } : { customerId: qp('customer'), statementDate: todayISO(), statementBalance: '', status: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const cur = s.settings.currency;
  const hasBal = f.statementBalance !== '' && f.statementBalance != null && !isNaN(Number(f.statementBalance));
  const r = f.customerId && f.statementDate && hasBal ? reconcile(s.data, f.customerId, f.statementDate, Number(f.statementBalance)) : null;
  const autoStatus = r ? r.status : '';
  const status = f.status || autoStatus;
  const ix = buildIndex({ ...s.data, allocations: s.data.allocations.filter(a => { const c = s.data.collections.find(x => x.id === a.collectionId); return c && c.date <= f.statementDate; }) });
  const openAsAt = f.customerId ? s.data.invoices.filter(i => !i.deleted && i.customerId === f.customerId && i.invoiceDate <= f.statementDate)
    .map(i => calcInvoice(i, ix, f.statementDate)).filter(x => x.remaining > 0.005).sort((a, b) => a.invoice.invoiceDate.localeCompare(b.invoice.invoiceDate)) : [];
  const save = async () => {
    const e: string[] = [];
    if (!f.customerId) e.push('Select a customer.');
    if (!f.statementDate) e.push('Statement date is required.');
    if (!hasBal) e.push('Enter the balance shown on the customer statement.');
    if (status === 'Matched' && r && Math.abs(r.difference) > 0.005) e.push('Status cannot be Matched while there is a difference. Use Investigating or Resolved (with notes).');
    if (status === 'Resolved' && r && Math.abs(r.difference) > 0.005 && !f.notes?.trim()) e.push('Add a note explaining how the difference was resolved.');
    setErrors(e);
    if (e.length || !r) return;
    const rec = { ...f, statementBalance: r2(Number(f.statementBalance)), recordedBalance: r.recordedBalance, difference: r.difference, status };
    const nid = await saveRecord('statements', rec, `reconciliation ${custName(s, f.customerId)} ${f.statementDate}`);
    await refresh(); toast(r.status === 'Matched' ? 'Reconciled – balances match' : `Saved – difference ${num(r.difference)} to investigate`); go('/recon-form/' + nid);
  };
  return (
    <Page title={ex ? 'Reconciliation' : 'New reconciliation'} back="/recon">
      <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
        <Errors errors={errors} />
        <Field label="Customer *"><Select name="customerId" testid="recon-customer" value={f.customerId} onValue={v => setF({ ...f, customerId: v })} placeholder="Select customer" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
        <Field label="Statement date *"><Input name="statementDate" type="date" value={f.statementDate} onValue={v => setF({ ...f, statementDate: v })} /></Field>
        <Field label={`Balance per customer statement (${cur}) *`}><Input name="statementBalance" type="number" inputMode="decimal" step="0.01" value={f.statementBalance} onValue={v => setF({ ...f, statementBalance: v })} /></Field>
        <Field label="Statement reference"><Input name="statementRef" value={f.statementRef} onValue={v => setF({ ...f, statementRef: v })} /></Field>
        {r && <div class="full recon-box" data-testid="recon-result">
          <dl class="kv">
            <dt>Invoiced to date</dt><dd>{num(r.invoiced)}</dd>
            <dt>Collections to date</dt><dd>− {num(r.collected)}</dd>
            <dt>Applied credit notes</dt><dd>− {num(r.creditNotes)}</dd>
            <dt>Accepted deductions</dt><dd>− {num(r.deductions)}</dd>
            <dt><b>My recorded balance</b></dt><dd data-testid="recon-mine"><b>{num(r.recordedBalance)}</b></dd>
            <dt><b>Customer statement</b></dt><dd><b>{num(r.statementBalance)}</b></dd>
            <dt><b>Difference</b></dt><dd data-testid="recon-diff" class={Math.abs(r.difference) > 0.005 ? 'bad-text' : 'ok-text'}><b>{num(r.difference)}</b></dd>
          </dl>
          <div class="center"><Badge s={autoStatus} /></div>
          {Math.abs(r.difference) > 0.005 && <>
            <p class="small">{r.difference > 0 ? 'Your records show MORE owed than the customer statement.' : 'The customer statement shows MORE owed than your records.'} Possible causes:</p>
            {r.hints.length ? <ul class="hints" data-testid="recon-hints">{r.hints.map(h => <li class={h.matches ? 'match' : ''}>{h.matches ? '✅ ' : '• '}{h.label}: {num(h.amount)}{h.matches ? ' — matches the difference' : ''}</li>)}</ul>
              : <p class="muted small">No pending items found – compare invoice and payment lines one by one below.</p>}
          </>}
        </div>}
        <Field label="Status"><Select name="status" value={f.status} onValue={v => setF({ ...f, status: v })} placeholder={`Auto (${autoStatus || '—'})`} options={['Matched', 'Discrepancy', 'Investigating', 'Resolved']} /></Field>
        <Field label="Investigation notes" full><textarea name="notes" value={f.notes || ''} onInput={e => setF({ ...f, notes: (e.target as HTMLTextAreaElement).value })} /></Field>
        <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save reconciliation</button></div>
      </form>
      {ex && Math.abs(ex.recordedBalance - (r?.recordedBalance ?? ex.recordedBalance)) > 0.005 && <Warn>Your recorded balance at this date changed since saving ({num(ex.recordedBalance)} → {num(r!.recordedBalance)}). Save again to update.</Warn>}
      {f.customerId && <Card title={`My open invoices as at ${fmtDate(f.statementDate)}`} right={<button class="btn sm ghost" onClick={() => saveCSV(`open-items-${f.statementDate}.csv`, openAsAt.map(x => ({ invoice: x.invoice.invoiceNo, date: x.invoice.invoiceDate, gross: x.invoice.grossAmount, remaining: x.remaining })))}>CSV</button>}>
        {openAsAt.length ? <div class="table-wrap"><table class="tbl"><thead><tr><th>Invoice</th><th>Date</th><th class="num">Gross</th><th class="num">Open</th></tr></thead>
          <tbody>{openAsAt.map(x => <tr><td>{x.invoice.invoiceNo}</td><td>{x.invoice.invoiceDate}</td><td class="num">{num(x.invoice.grossAmount)}</td><td class="num">{num(x.remaining)}</td></tr>)}</tbody></table></div> : <Empty>No open invoices at that date.</Empty>}
      </Card>}
      {ex && <Card title="Correction history"><AuditTrail filter={e => e.entityId === ex.id} /></Card>}
      {ex && <button class="btn danger ghost block" onClick={async () => { const x = await ask('Void this reconciliation?', { danger: true, okText: 'Void' }); if (x) { await voidRecord('statements', ex.id, '', 'reconciliation'); await refresh(); go('/recon'); } }}>Void</button>}
    </Page>
  );
}
