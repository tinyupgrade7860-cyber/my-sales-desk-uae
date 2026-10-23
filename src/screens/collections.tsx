import { useEffect, useMemo, useState } from 'preact/hooks';
import { useStore, refresh, custName } from '../store';
import { Page, Card, Money, Badge, Field, Input, MoneyInput, Select, Errors, Warn, Empty, SearchBox, Chips, toast, ask } from '../ui';
import { money, fmtDate, norm, num, r2, todayISO, monthKey, sum } from '../util';
import { go, qp } from '../router';
import { saveCollection, voidRecord, restoreRecord } from '../db';
import { findDuplicate, validateCollection, buildIndex, calcInvoice, collectionUnallocated } from '../calc';
import { saveCSV } from '../exporter';
import type { PaymentMethod } from '../types';
import { AuditTrail } from './misc';

const METHODS: PaymentMethod[] = ['Bank Transfer', 'Cheque', 'PDC', 'Cash', 'Card', 'Other'];

export function CollectionsList() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [f, setF] = useState(qp('filter') === 'unallocated' ? 'Unallocated' : 'All');
  const [month, setMonth] = useState('');
  const [limit, setLimit] = useState(60);
  const cur = s.settings.currency;
  const rows = s.data.collections.filter(c => !c.deleted).filter(c => {
    const t = norm(q);
    if (t && ![c.receiptRef, c.chequeNo, c.bank, custName(s, c.customerId)].some(v => norm(v).includes(t))) return false;
    if (month && monthKey(c.date) !== month) return false;
    if (f === 'Unallocated') return s.ix ? collectionUnallocated(c, s.ix) > 0.005 : false;
    if (f !== 'All') return c.method === f;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Page title="Collections" sub={`${rows.length} · ${money(sum(rows.map(r => r.amount)), cur)}`} actions={<button class="btn primary sm" data-testid="new-collection" onClick={() => go('/collection-form')}>+ New</button>}>
      <div class="row gap"><SearchBox value={q} onValue={setQ} placeholder="Receipt, cheque, bank, customer…" /><input type="month" class="month" value={month} onInput={e => setMonth((e.target as HTMLInputElement).value)} aria-label="Month" /></div>
      <Chips value={f} options={['All', 'Unallocated', ...METHODS]} onValue={setF} />
      <div class="row gap"><button class="btn sm ghost" onClick={() => saveCSV(`collections-${todayISO()}.csv`, rows, [
        { key: 'receiptRef', label: 'Receipt' }, { key: 'c', label: 'Customer', get: r => custName(s, r.customerId) }, { key: 'date', label: 'Date' }, { key: 'amount', label: 'Amount' },
        { key: 'method', label: 'Method' }, { key: 'chequeNo', label: 'Cheque No' }, { key: 'u', label: 'Unallocated', get: r => s.ix ? collectionUnallocated(r, s.ix) : '' }])}>Export CSV</button></div>
      {rows.length === 0 && <Empty>No collections.</Empty>}
      <div class="list">
        {rows.slice(0, limit).map(c => {
          const un = s.ix ? collectionUnallocated(c, s.ix) : 0;
          return <a class="list-row" href={'#/collections/' + c.id} data-testid="collection-row">
            <div class="grow"><b>{c.receiptRef}</b> <span class="muted small">{custName(s, c.customerId)}</span><div class="muted small">{fmtDate(c.date)} · {c.method}{c.chequeNo ? ' #' + c.chequeNo : ''}</div></div>
            <div class="right"><Money v={c.amount} cur={cur} />{un > 0.005 && <div class="warn-text small">{num(un)} unallocated</div>}</div>
          </a>;
        })}
      </div>
      {rows.length > limit && <button class="btn block" onClick={() => setLimit(limit + 100)}>Show more</button>}
    </Page>
  );
}

export function CollectionDetail({ id }: { id: string }) {
  const s = useStore();
  const c = s.data.collections.find(x => x.id === id);
  if (!c) return <Page title="Collection" back="/collections"><Empty>Not found.</Empty></Page>;
  const cur = s.settings.currency;
  const allocs = s.data.allocations.filter(a => a.collectionId === id && !a.deleted);
  const un = r2(c.amount - sum(allocs.map(a => a.amount)));
  return (
    <Page title={c.receiptRef} sub={custName(s, c.customerId)} back="/collections" actions={!c.deleted && <button class="btn sm" onClick={() => go('/collection-form/' + id)}>Edit</button>}>
      {c.deleted && <Warn>VOIDED ({c.deleteReason}). Excluded from totals. <button class="btn sm" onClick={async () => { await restoreRecord('collections', id, 'collection ' + c.receiptRef); await refresh(); toast('Restored – re-allocate it via Edit'); }}>Restore</button></Warn>}
      <Card>
        <dl class="kv">
          <dt>Date</dt><dd>{fmtDate(c.date)}</dd><dt>Method</dt><dd>{c.method}{c.chequeNo ? ' #' + c.chequeNo : ''}{c.bank ? ' · ' + c.bank : ''}</dd>
          <dt>Amount</dt><dd><b><Money v={c.amount} cur={cur} /></b></dd>
          <dt>Allocated</dt><dd><Money v={c.amount - un} cur={cur} /></dd>
          <dt>Unallocated (on account)</dt><dd class={un > 0.005 ? 'warn-text' : ''} data-testid="col-unallocated"><Money v={un} cur={cur} /></dd>
          {c.notes && <><dt>Notes</dt><dd>{c.notes}</dd></>}
        </dl>
      </Card>
      <Card title={`Allocations (${allocs.length})`}>
        {allocs.length ? allocs.map(a => { const inv = s.data.invoices.find(i => i.id === a.invoiceId); const x = s.invoices.get(a.invoiceId); return (
          <a class="list-row" href={'#/invoices/' + a.invoiceId} data-testid="alloc-row"><div class="grow"><b>{inv?.invoiceNo}</b><div class="muted small">gross {num(inv?.grossAmount || 0)} · now {x ? <Badge s={x.status} /> : ''}</div></div><Money v={a.amount} cur={cur} /></a>); })
          : <Empty>Not allocated – edit to allocate to invoices.</Empty>}
      </Card>
      <Card title="Correction history"><AuditTrail filter={e => e.entityId === id} /></Card>
      {!c.deleted && <button class="btn danger ghost block" onClick={async () => {
        const r = await ask('Void receipt ' + c.receiptRef + '?', { body: 'Its allocations will be released and the invoices reopened. Kept in history.', input: 'Reason (e.g. cheque bounced)', danger: true, okText: 'Void' });
        if (r) { await voidRecord('collections', id, r === 'ok' ? '' : r, 'collection ' + c.receiptRef); await refresh(); toast('Receipt voided'); }
      }}>Void receipt (e.g. bounced cheque)</button>}
    </Page>
  );
}

export function CollectionForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.collections.find(c => c.id === id) : undefined;
  const preInv = qp('invoice');
  const [f, setF] = useState<any>(ex ? { ...ex } : { customerId: qp('customer'), date: todayISO(), method: 'Bank Transfer', amount: '' });
  const exAllocs = id ? s.data.allocations.filter(a => a.collectionId === id && !a.deleted) : [];
  const [alloc, setAlloc] = useState<Record<string, string>>(() => Object.fromEntries(exAllocs.map(a => [a.invoiceId, String(a.amount)])));
  const [errors, setErrors] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const cur = s.settings.currency;

  // open invoices of this customer with remaining computed EXCLUDING this collection's own allocations
  const open = useMemo(() => {
    if (!f.customerId) return [];
    const ds = id ? { ...s.data, allocations: s.data.allocations.filter(a => a.collectionId !== id) } : s.data;
    const ix = buildIndex(ds);
    return s.data.invoices.filter(i => !i.deleted && i.customerId === f.customerId).map(i => calcInvoice(i, ix, s.today))
      .filter(x => x.remaining > 0.005 || alloc[x.invoice.id]).sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate));
  }, [f.customerId, s.version]);

  // pre-fill from invoice link
  useEffect(() => {
    if (preInv && !id && !Object.keys(alloc).length) {
      const x = open.find(o => o.invoice.id === preInv);
      if (x) { setAlloc({ [preInv]: String(x.remaining) }); setF((p: any) => ({ ...p, amount: p.amount || String(x.remaining) })); }
    }
  }, [open]);

  const amount = Number(f.amount) || 0;
  const list = Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([invoiceId, v]) => ({ invoiceId, amount: r2(Number(v)) }));
  const allocated = sum(list.map(a => a.amount));
  const unalloc = r2(amount - allocated);
  const dup = findDuplicate(s.data.collections, 'receiptRef', f.receiptRef || '', id);
  const dupCheque = f.chequeNo ? s.data.collections.find(c => !c.deleted && c.id !== id && c.chequeNo && c.chequeNo === f.chequeNo && c.customerId === f.customerId) : undefined;

  const auto = () => {
    let left = amount; const n: Record<string, string> = {};
    for (const x of open) { if (left <= 0.005) break; const a = r2(Math.min(left, x.remaining)); if (a > 0) { n[x.invoice.id] = String(a); left = r2(left - a); } }
    setAlloc(n);
  };
  const save = async () => {
    const rec = { ...f, receiptRef: (f.receiptRef || '').trim(), amount: r2(amount) };
    const e = validateCollection(s.data, rec, list, id);
    if (dup && !ack) e.push(`Receipt reference ${rec.receiptRef} already exists – tick “Save anyway” if correct.`);
    setErrors(e);
    if (e.length) { window.scrollTo(0, 0); return; }
    const nid = await saveCollection(rec, list, 'collection ' + rec.receiptRef);
    await refresh(); toast(unalloc > 0.005 ? `Saved – ${num(unalloc)} left unallocated (on account)` : 'Payment saved'); go('/collections/' + nid);
  };
  return (
    <Page title={ex ? 'Edit payment' : 'Record payment'} back>
      <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
        <Errors errors={errors} />
        <Field label="Customer *"><Select name="customerId" testid="col-customer" value={f.customerId} onValue={v => { setF({ ...f, customerId: v }); setAlloc({}); }} placeholder="Select customer" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
        <Field label="Receipt reference *"><Input name="receiptRef" value={f.receiptRef} onValue={v => setF({ ...f, receiptRef: v })} autoCapitalize="characters" /></Field>
        {dup && <Warn testid="dup-warning">⚠ Receipt {dup.receiptRef} already recorded on {fmtDate(dup.date)} for {money(dup.amount, cur)}. <label class="inline"><input type="checkbox" checked={ack} onChange={e => setAck((e.target as HTMLInputElement).checked)} /> Save anyway</label></Warn>}
        <Field label="Date *"><Input name="date" type="date" value={f.date} onValue={v => setF({ ...f, date: v })} /></Field>
        <Field label={`Amount (${cur}) *`}><MoneyInput name="amount" value={f.amount} onValue={v => setF({ ...f, amount: v })} /></Field>
        <Field label="Method"><Select name="method" value={f.method} onValue={v => setF({ ...f, method: v })} options={METHODS} /></Field>
        {(f.method === 'Cheque' || f.method === 'PDC') && <Field label="Cheque no."><Input name="chequeNo" inputMode="numeric" value={f.chequeNo} onValue={v => setF({ ...f, chequeNo: v })} /></Field>}
        {dupCheque && <Warn>⚠ Cheque #{f.chequeNo} was already used in receipt {dupCheque.receiptRef}.</Warn>}
        <Field label="Bank"><Input name="bank" value={f.bank} onValue={v => setF({ ...f, bank: v })} /></Field>

        <div class="full alloc-box" data-testid="alloc-box">
          <div class="row between"><h3>Allocate to invoices</h3><div class="row gap"><button type="button" class="btn sm" onClick={auto} data-testid="auto-alloc">Auto (oldest first)</button><button type="button" class="btn sm ghost" onClick={() => setAlloc({})}>Clear</button></div></div>
          {!f.customerId ? <p class="muted">Select a customer to see open invoices.</p> : open.length === 0 ? <p class="muted">No open invoices – payment will be kept on account.</p> :
            open.map(x => {
              const v = alloc[x.invoice.id] || '';
              const over = Number(v) - x.remaining > 0.005;
              return <div class={'alloc-row' + (x.overdue ? ' overdue' : '')} data-testid={'alloc-' + x.invoice.invoiceNo}>
                <label class="grow">
                  <input type="checkbox" checked={Number(v) > 0} onChange={e => {
                    const on = (e.target as HTMLInputElement).checked;
                    const left = r2(amount - allocated);
                    setAlloc({ ...alloc, [x.invoice.id]: on ? String(r2(Math.max(0, Math.min(x.remaining, left > 0 ? left : x.remaining)))) : '' });
                  }} />
                  <span><b>{x.invoice.invoiceNo}</b><span class="muted small"> · {fmtDate(x.invoice.invoiceDate)}{x.overdue ? ` · ${x.daysOverdue}d overdue` : ''}</span><br /><span class="small">Remaining {num(x.remaining)}</span></span>
                </label>
                <input class={'alloc-amt' + (over ? ' invalid' : '')} type="number" inputMode="decimal" step="0.01" min="0" value={v} aria-label={'Allocate to ' + x.invoice.invoiceNo}
                  onInput={e => setAlloc({ ...alloc, [x.invoice.id]: (e.target as HTMLInputElement).value })} />
              </div>;
            })}
          <div class="calc-box" data-testid="alloc-summary">
            <div><span>Payment</span><b>{num(amount)}</b></div>
            <div><span>Allocated</span><b data-testid="alloc-total">{num(allocated)}</b></div>
            <div class={unalloc < -0.005 ? 'bad-text' : unalloc > 0.005 ? 'warn-text' : 'ok-text'}><span>{unalloc < -0.005 ? 'Over-allocated' : 'Unallocated'}</span><b data-testid="alloc-left">{num(unalloc)}</b></div>
          </div>
        </div>
        <Field label="Notes" full><textarea value={f.notes || ''} onInput={e => setF({ ...f, notes: (e.target as HTMLTextAreaElement).value })} /></Field>
        <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save payment</button></div>
      </form>
    </Page>
  );
}
