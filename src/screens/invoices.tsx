import { useState } from 'preact/hooks';
import { useStore, refresh, custName } from '../store';
import { Page, Card, Money, Badge, Field, Input, MoneyInput, Select, Errors, Warn, Empty, SearchBox, Chips, toast, ask } from '../ui';
import { money, fmtDate, norm, num, r2, addDays, todayISO, monthKey } from '../util';
import { go, qp } from '../router';
import { saveRecord, voidRecord, restoreRecord } from '../db';
import { findDuplicate, validateInvoice, cnEffective, deductionEffective } from '../calc';
import { saveCSV } from '../exporter';
import type { Invoice } from '../types';
import { AuditTrail } from './misc';

const ST = ['All', 'Open', 'Overdue', 'Partially Paid', 'Unpaid', 'Paid'] as const;

export function InvoicesList() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [st, setSt] = useState<string>(qp('status') === 'open' ? 'Open' : qp('status') || 'All');
  const [cust, setCust] = useState(qp('customer'));
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('date');
  const [showF, setShowF] = useState(false);
  const [limit, setLimit] = useState(60);
  const cur = s.settings.currency;
  const years = [...new Set(s.data.invoices.map(i => i.invoiceDate.slice(0, 4)))].sort().reverse();
  let rows = [...s.invoices.values()].filter(x => {
    const i = x.invoice, t = norm(q);
    if (t && ![i.invoiceNo, i.lpo, custName(s, i.customerId)].some(v => norm(v).includes(t))) return false;
    if (cust && i.customerId !== cust) return false;
    if (month && monthKey(i.invoiceDate) !== month) return false;
    if (year && !i.invoiceDate.startsWith(year)) return false;
    if (from && i.invoiceDate < from) return false;
    if (to && i.invoiceDate > to) return false;
    if (st === 'Open') return x.remaining > 0.005;
    if (st === 'Overdue') return x.overdue;
    if (st !== 'All') return x.status === st;
    return true;
  });
  rows.sort((a, b) => sort === 'due' ? a.invoice.dueDate.localeCompare(b.invoice.dueDate) : sort === 'amount' ? b.invoice.grossAmount - a.invoice.grossAmount
    : sort === 'remaining' ? b.remaining - a.remaining : sort === 'overdue' ? b.daysOverdue - a.daysOverdue : b.invoice.invoiceDate.localeCompare(a.invoice.invoiceDate) || b.invoice.invoiceNo.localeCompare(a.invoice.invoiceNo));
  const tot = rows.reduce((a, x) => ({ g: a.g + x.invoice.grossAmount, r: a.r + x.remaining }), { g: 0, r: 0 });
  const exp = () => saveCSV(`invoices-${todayISO()}.csv`, rows, [
    { key: 'no', label: 'Invoice No', get: x => x.invoice.invoiceNo }, { key: 'c', label: 'Customer', get: x => custName(s, x.invoice.customerId) },
    { key: 'd', label: 'Invoice Date', get: x => x.invoice.invoiceDate }, { key: 'due', label: 'Due Date', get: x => x.invoice.dueDate },
    { key: 'net', label: 'Net', get: x => x.invoice.netAmount }, { key: 'vat', label: 'VAT', get: x => x.invoice.vatAmount }, { key: 'g', label: 'Gross', get: x => x.invoice.grossAmount },
    { key: 'al', label: 'Allocated', get: x => x.allocated }, { key: 'adj', label: 'Adjustments', get: x => x.adjustments }, { key: 'rem', label: 'Remaining', get: x => x.remaining },
    { key: 'st', label: 'Status', get: x => x.overdue ? 'Overdue' : x.status }, { key: 'od', label: 'Days overdue', get: x => x.daysOverdue }
  ]);
  return (
    <Page title="Invoices" sub={`${rows.length} · ${money(tot.g, cur)} · open ${money(tot.r, cur)}`} actions={<button class="btn primary sm" data-testid="new-invoice" onClick={() => go('/invoice-form')}>+ New</button>}>
      <div class="row gap"><SearchBox value={q} onValue={setQ} placeholder="Invoice no, LPO or customer…" /><button class={'btn sm' + (showF ? ' on' : '')} onClick={() => setShowF(!showF)}>Filters</button></div>
      <Chips value={st} options={[...ST]} onValue={setSt} testid="inv-status" />
      {showF && <div class="filters grid2">
        <Field label="Customer"><Select value={cust} onValue={setCust} placeholder="All customers" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
        <Field label="Month"><input type="month" value={month} onInput={e => setMonth((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Year"><Select value={year} onValue={setYear} placeholder="All years" options={years} /></Field>
        <Field label="Sort"><Select value={sort} onValue={setSort} options={[['date', 'Newest'], ['due', 'Due date'], ['amount', 'Amount'], ['remaining', 'Remaining'], ['overdue', 'Days overdue']]} /></Field>
        <Field label="From"><input type="date" value={from} onInput={e => setFrom((e.target as HTMLInputElement).value)} /></Field>
        <Field label="To"><input type="date" value={to} onInput={e => setTo((e.target as HTMLInputElement).value)} /></Field>
        <button class="btn sm ghost" onClick={() => { setCust(''); setMonth(''); setYear(''); setFrom(''); setTo(''); setQ(''); setSt('All'); }}>Clear filters</button>
        <button class="btn sm" onClick={exp}>Export CSV</button>
      </div>}
      {rows.length === 0 && <Empty>No invoices match.</Empty>}
      <div class="list">
        {rows.slice(0, limit).map(x => (
          <a class={'list-row' + (x.overdue ? ' overdue' : '')} href={'#/invoices/' + x.invoice.id} data-testid="invoice-row">
            <div class="grow"><b>{x.invoice.invoiceNo}</b> <span class="muted small">{custName(s, x.invoice.customerId)}</span>
              <div class="muted small">{fmtDate(x.invoice.invoiceDate)} · due {fmtDate(x.invoice.dueDate)}{x.overdue ? <span class="bad-text"> · {x.daysOverdue}d overdue</span> : x.remaining > 0.005 && x.daysToDue <= s.settings.upcomingDays ? <span class="warn-text"> · due in {x.daysToDue}d</span> : ''}</div></div>
            <div class="right"><Money v={x.remaining} cur={cur} /><div><Badge s={x.status} />{x.overdue && <Badge s="Overdue" />}</div><div class="muted small">of {num(x.invoice.grossAmount)}</div></div>
          </a>
        ))}
      </div>
      {rows.length > limit && <button class="btn block" onClick={() => setLimit(limit + 100)}>Show more ({rows.length - limit})</button>}
    </Page>
  );
}

export function InvoiceDetail({ id }: { id: string }) {
  const s = useStore();
  const inv = s.data.invoices.find(i => i.id === id);
  if (!inv) return <Page title="Invoice" back="/invoices"><Empty>Invoice not found.</Empty></Page>;
  const x = s.invoices.get(id);
  const cur = s.settings.currency;
  const allocs = s.data.allocations.filter(a => a.invoiceId === id && !a.deleted).map(a => ({ a, col: s.data.collections.find(c => c.id === a.collectionId) })).filter(r => r.col && !r.col.deleted);
  const grvs = s.data.grvs.filter(g => g.invoiceId === id && !g.deleted);
  const cns = s.data.creditNotes.filter(g => g.invoiceId === id && !g.deleted);
  const deds = s.data.deductions.filter(g => g.invoiceId === id && !g.deleted);
  const fus = s.data.followUps.filter(g => g.invoiceId === id && !g.deleted);
  const q = `?customer=${inv.customerId}&invoice=${id}`;
  return (
    <Page title={inv.invoiceNo} sub={custName(s, inv.customerId)} back="/invoices" actions={!inv.deleted && <button class="btn sm" onClick={() => go('/invoice-form/' + id)} data-testid="edit-invoice">Edit</button>}>
      {inv.deleted && <Warn>This invoice is VOIDED ({inv.deleteReason || 'no reason'}) and excluded from all totals. <button class="btn sm" onClick={async () => { await restoreRecord('invoices', id, 'invoice ' + inv.invoiceNo); await refresh(); }}>Restore</button></Warn>}
      {x && <Card title={<span>Balance <Badge s={x.status} />{x.overdue && <Badge s="Overdue" />}</span>} testid="invoice-balance">
        <dl class="kv">
          <dt>Invoice date</dt><dd>{fmtDate(inv.invoiceDate)}</dd>
          <dt>Due date</dt><dd class={x.overdue ? 'bad-text' : ''}>{fmtDate(inv.dueDate)} {x.overdue ? `(${x.daysOverdue} days overdue)` : x.remaining > 0.005 ? `(in ${x.daysToDue} days)` : ''}</dd>
          <dt>Terms</dt><dd>{inv.paymentTermsDays} days</dd>
          {inv.lpo && <><dt>LPO</dt><dd>{inv.lpo}</dd></>}
          <dt>Net</dt><dd><Money v={inv.netAmount} cur={cur} /></dd>
          <dt>VAT {inv.vatRate}%</dt><dd><Money v={inv.vatAmount} cur={cur} /></dd>
          <dt>Gross</dt><dd><b><Money v={inv.grossAmount} cur={cur} /></b></dd>
          <dt>Allocated payments</dt><dd data-testid="inv-allocated">− <Money v={x.allocated} cur={cur} /></dd>
          <dt>Approved credit notes</dt><dd data-testid="inv-cn">− <Money v={x.creditNotes} cur={cur} /></dd>
          <dt>Accepted deductions</dt><dd data-testid="inv-ded">− <Money v={x.deductions} cur={cur} /></dd>
          <dt><b>Remaining</b></dt><dd data-testid="inv-remaining"><b><Money v={x.remaining} cur={cur} /></b></dd>
        </dl>
      </Card>}
      {!inv.deleted && <div class="quick">
        {x && x.remaining > 0.005 && <a class="qbtn" href={'#/collection-form' + q}>+ Payment</a>}
        <a class="qbtn" href={'#/grv-form' + q}>+ GRV</a><a class="qbtn" href={'#/cn-form' + q}>+ Credit note</a>
        <a class="qbtn" href={'#/deduction-form' + q}>+ Deduction</a><a class="qbtn" href={'#/followup-form' + q}>+ Follow up</a>
      </div>}
      <Card title="Payments allocated">
        {allocs.length ? allocs.map(r => <a class="list-row" href={'#/collections/' + r.col!.id}><div class="grow"><b>{r.col!.receiptRef}</b><div class="muted small">{fmtDate(r.col!.date)} · {r.col!.method} · receipt total {num(r.col!.amount)}</div></div><Money v={r.a.amount} cur={cur} /></a>) : <Empty>No payments allocated.</Empty>}
      </Card>
      {(grvs.length + cns.length + deds.length > 0) && <Card title="Returns & adjustments">
        {grvs.map(g => <a class="list-row" href={'#/grv-form/' + g.id}><div class="grow">GRV <b>{g.grvRef}</b><div class="muted small">{g.reason} · no direct balance effect</div></div><div class="right"><Money v={g.amount} cur={cur} /><Badge s={g.status} /></div></a>)}
        {cns.map(c => <a class="list-row" href={'#/cn-form/' + c.id}><div class="grow">Credit note <b>{c.cnRef}</b><div class="muted small">{c.reason} · {cnEffective(c) ? 'reduces balance' : 'no effect yet'}</div></div><div class="right"><Money v={c.amount} cur={cur} /><Badge s={c.status} /></div></a>)}
        {deds.map(d => <a class="list-row" href={'#/deduction-form/' + d.id}><div class="grow">Deduction <b>{d.ref}</b><div class="muted small">{d.reason} · {deductionEffective(d) ? `accepted ${num(deductionEffective(d))}` : 'no effect'}</div></div><div class="right"><Money v={d.claimedAmount} cur={cur} /><Badge s={d.status} /></div></a>)}
      </Card>}
      {fus.length > 0 && <Card title="Follow ups">{fus.map(f => <a class="list-row" href={'#/followup-form/' + f.id}><div class="grow">{fmtDate(f.contactDate)}<div class="muted small">{f.notes}</div></div><Badge s={f.status} /></a>)}</Card>}
      <Card title="Correction history"><AuditTrail filter={e => e.entityId === id} /></Card>
      {!inv.deleted && <button class="btn danger ghost block" onClick={async () => {
        if (x && x.allocated > 0) { toast('Invoice has allocated payments – remove the allocations first.', 'bad'); return; }
        const r = await ask('Void invoice ' + inv.invoiceNo + '?', { body: 'It will be excluded from all totals but kept in history.', input: 'Reason (e.g. entered twice)', danger: true, okText: 'Void' });
        if (r) { await voidRecord('invoices', id, r === 'ok' ? '' : r, 'invoice ' + inv.invoiceNo); await refresh(); toast('Invoice voided'); }
      }}>Void invoice</button>}
    </Page>
  );
}

export function InvoiceForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.invoices.find(i => i.id === id) : undefined;
  const pre = qp('customer');
  const cust0 = s.data.customers.find(c => c.id === pre);
  const today = todayISO();
  const [f, setF] = useState<any>(ex ? { ...ex } : {
    customerId: pre, invoiceDate: today, paymentTermsDays: cust0?.paymentTermsDays ?? s.settings.defaultTermsDays,
    dueDate: addDays(today, cust0?.paymentTermsDays ?? s.settings.defaultTermsDays), vatRate: s.settings.defaultVatRate, netAmount: ''
  });
  const [mode, setMode] = useState<'Net' | 'Gross'>('Net');
  const [amt, setAmt] = useState<string>(ex ? String(ex.netAmount) : '');
  const [dueManual, setDueManual] = useState(!!ex);
  const [errors, setErrors] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const vatRate = Number(f.vatRate) || 0;
  const a = Number(amt) || 0;
  const net = mode === 'Net' ? r2(a) : r2(a / (1 + vatRate / 100));
  const vat = mode === 'Net' ? r2(a * vatRate / 100) : r2(a - net);
  const gross = r2(net + vat);
  const upd = (patch: any) => {
    const n = { ...f, ...patch };
    if (!dueManual && n.invoiceDate) n.dueDate = addDays(n.invoiceDate, Number(n.paymentTermsDays) || 0);
    setF(n);
  };
  const onCust = (cid: string) => { const c = s.data.customers.find(x => x.id === cid); upd({ customerId: cid, paymentTermsDays: c?.paymentTermsDays ?? f.paymentTermsDays }); };
  const dup = findDuplicate(s.data.invoices, 'invoiceNo', f.invoiceNo || '', id);
  const calc = id ? s.invoices.get(id) : undefined;
  const save = async () => {
    const rec: Partial<Invoice> = { ...f, invoiceNo: (f.invoiceNo || '').trim(), paymentTermsDays: Number(f.paymentTermsDays) || 0, vatRate, netAmount: net, vatAmount: vat, grossAmount: gross };
    const e = validateInvoice(rec);
    if (dup && !ack) e.push(`Invoice number ${rec.invoiceNo} already exists (${custName(s, dup.customerId)}). Tick “Save anyway” only if it is genuinely a different document.`);
    if (calc && gross + 0.005 < calc.allocated + calc.adjustments) e.push(`Gross (${num(gross)}) cannot be less than payments + adjustments already applied (${num(calc.allocated + calc.adjustments)}).`);
    setErrors(e);
    if (e.length) { window.scrollTo(0, 0); return; }
    const nid = await saveRecord('invoices', rec as any, 'invoice ' + rec.invoiceNo);
    await refresh(); toast('Invoice saved'); go('/invoices/' + nid);
  };
  return (
    <Page title={ex ? 'Edit invoice' : 'New invoice'} back>
      <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
        <Errors errors={errors} />
        <Field label="Invoice number *"><Input name="invoiceNo" value={f.invoiceNo} onValue={v => upd({ invoiceNo: v })} autoCapitalize="characters" /></Field>
        <Field label="Customer *"><Select name="customerId" testid="inv-customer" value={f.customerId} onValue={onCust} placeholder="Select customer" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
        {dup && <Warn testid="dup-warning">⚠ Duplicate invoice number – {dup.invoiceNo} already exists for {custName(s, dup.customerId)} dated {fmtDate(dup.invoiceDate)}. <label class="inline"><input type="checkbox" checked={ack} onChange={e => setAck((e.target as HTMLInputElement).checked)} /> Save anyway</label></Warn>}
        <Field label="Invoice date *"><Input name="invoiceDate" type="date" value={f.invoiceDate} onValue={v => upd({ invoiceDate: v })} /></Field>
        <Field label="Payment terms (days)"><Input name="terms" type="number" inputMode="numeric" value={f.paymentTermsDays} onValue={v => upd({ paymentTermsDays: v })} /></Field>
        <Field label="Due date *" hint={dueManual ? <button type="button" class="link" onClick={() => { setDueManual(false); upd({}); }}>Auto from terms</button> : 'Auto = date + terms'}>
          <Input name="dueDate" type="date" value={f.dueDate} onValue={v => { setDueManual(true); setF({ ...f, dueDate: v }); }} /></Field>
        <Field label="VAT rate %"><Input name="vatRate" type="number" inputMode="decimal" step="0.01" value={f.vatRate} onValue={v => setF({ ...f, vatRate: v })} /></Field>
        <Field label={`Amount entered is`}><Chips value={mode} options={['Net', 'Gross']} onValue={setMode} /></Field>
        <Field label={`${mode} amount (${s.settings.currency}) *`}><MoneyInput name="amount" value={amt} onValue={setAmt} /></Field>
        <div class="calc-box full" data-testid="inv-calc">
          <div><span>Net</span><b>{num(net)}</b></div><div><span>VAT {vatRate}%</span><b>{num(vat)}</b></div><div><span>Gross</span><b data-testid="inv-gross">{num(gross)}</b></div>
          {calc && <><div><span>Allocated</span><b>{num(calc.allocated)}</b></div><div><span>Adjustments</span><b>{num(calc.adjustments)}</b></div><div><span>Remaining</span><b>{num(r2(gross - calc.allocated - calc.adjustments))}</b></div></>}
        </div>
        <Field label="Salesman"><Input name="salesman" value={f.salesman} onValue={v => setF({ ...f, salesman: v })} placeholder={s.data.customers.find(c => c.id === f.customerId)?.salesman || ''} /></Field>
        <Field label="LPO / PO ref"><Input name="lpo" value={f.lpo} onValue={v => setF({ ...f, lpo: v })} /></Field>
        <Field label="Notes" full><textarea value={f.notes || ''} onInput={e => setF({ ...f, notes: (e.target as HTMLTextAreaElement).value })} /></Field>
        <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save invoice</button></div>
      </form>
    </Page>
  );
}
