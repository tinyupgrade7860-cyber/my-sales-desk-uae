import { useState } from 'preact/hooks';
import { useStore, refresh, custName, invNo } from '../store';
import { Page, Card, Stat, Money, Badge, Field, Input, Select, Errors, Warn, Empty, SearchBox, Chips, toast, ask } from '../ui';
import { money, fmtDate, norm, num, r2, todayISO } from '../util';
import { go } from '../router';
import { saveRecord, voidRecord } from '../db';
import { findDuplicate, collectionUnallocated, cnEffective, deductionEffective } from '../calc';
import { customerLedger } from '../ledger';
import { saveCSV, savePDF } from '../exporter';
import type { Customer } from '../types';
import { AuditTrail } from './misc';

const STATUS = ['All', 'Overdue', 'Outstanding', 'Clear', 'Credit'] as const;

export function CustomersList() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [st, setSt] = useState<typeof STATUS[number]>('All');
  const [sort, setSort] = useState('balance');
  const cur = s.settings.currency;
  let rows = [...s.customers.values()].filter(c => {
    const t = norm(q);
    return (!t || [c.customer.name, c.customer.code, c.customer.contactPerson, c.customer.phone, c.customer.emirate].some(x => norm(x).includes(t)))
      && (st === 'All' || c.paymentStatus === st);
  });
  rows.sort((a, b) => sort === 'name' ? a.customer.name.localeCompare(b.customer.name) : sort === 'overdue' ? b.overdue - a.overdue : sort === 'sales' ? b.invoiced - a.invoiced : b.balance - a.balance);
  return (
    <Page title="Customers" sub={`${rows.length} of ${s.customers.size}`} actions={<button class="btn primary sm" data-testid="new-customer" onClick={() => go('/customer-form')}>+ New</button>}>
      <SearchBox value={q} onValue={setQ} placeholder="Search name, code, contact, phone…" />
      <Chips value={st} options={[...STATUS]} onValue={setSt} testid="cust-status" />
      <div class="row gap sort-row"><span class="muted small">Sort</span>
        <Select value={sort} onValue={setSort} aria-label="Sort" options={[['balance', 'Balance'], ['overdue', 'Overdue'], ['sales', 'Sales'], ['name', 'Name']]} />
      </div>
      {rows.length === 0 && <Empty>No customers match.</Empty>}
      <div class="list">
        {rows.map(c => (
          <a class="list-row" href={'#/customers/' + c.customer.id} data-testid="customer-row">
            <div class="grow">
              <b>{c.customer.name}</b>
              <div class="muted small">{c.customer.code} · {c.customer.emirate || '—'} · {c.openInvoices} open · terms {c.customer.paymentTermsDays}d</div>
            </div>
            <div class="right">
              <Money v={c.balance} cur={cur} />
              <div><Badge s={c.paymentStatus} /></div>
              {c.overdue > 0 && <div class="bad-text small">{money(c.overdue, cur)} overdue</div>}
            </div>
          </a>
        ))}
      </div>
    </Page>
  );
}

const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'];

export function CustomerForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.customers.find(c => c.id === id) : undefined;
  const nextCode = 'C-' + String(s.data.customers.length + 1).padStart(3, '0');
  const [f, setF] = useState<Partial<Customer>>(ex ? { ...ex } : { code: nextCode, paymentTermsDays: s.settings.defaultTermsDays, emirate: 'Dubai' });
  const [errors, setErrors] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const set = (k: keyof Customer) => (v: any) => setF({ ...f, [k]: v });
  const dupName = findDuplicate(s.data.customers, 'name', f.name || '', id);
  const dupCode = findDuplicate(s.data.customers, 'code', f.code || '', id);
  const save = async () => {
    const e: string[] = [];
    if (!f.name?.trim()) e.push('Customer name is required.');
    if (!f.code?.trim()) e.push('Customer code is required.');
    if (dupCode) e.push(`Customer code ${f.code} is already used by ${dupCode.name}.`);
    if (dupName && !ack) e.push('A customer with this name already exists – tick “Save anyway” if this is intended.');
    if (!(Number(f.paymentTermsDays) >= 0)) e.push('Payment terms must be 0 or more days.');
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.push('Email address looks invalid.');
    if (f.trn && !/^\d{15}$/.test(f.trn)) e.push('UAE TRN must be 15 digits.');
    setErrors(e);
    if (e.length) return;
    const rec = { ...f, name: f.name!.trim(), code: f.code!.trim(), paymentTermsDays: Number(f.paymentTermsDays), creditLimit: f.creditLimit ? Number(f.creditLimit) : undefined };
    const nid = await saveRecord('customers', rec as any, 'customer ' + rec.name);
    await refresh(); toast('Customer saved'); go('/customers/' + nid);
  };
  return (
    <Page title={ex ? 'Edit customer' : 'New customer'} back>
      <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
        <Errors errors={errors} />
        <Field label="Customer name *" full><Input name="name" value={f.name} onValue={set('name')} autoFocus /></Field>
        {dupName && <Warn testid="dup-warning">⚠ Duplicate: “{dupName.name}” already exists ({dupName.code}). <label class="inline"><input type="checkbox" checked={ack} onChange={e => setAck((e.target as HTMLInputElement).checked)} /> Save anyway</label></Warn>}
        <Field label="Code *"><Input name="code" value={f.code} onValue={set('code')} /></Field>
        <Field label="Payment terms (days) *"><Input name="terms" type="number" inputMode="numeric" value={f.paymentTermsDays} onValue={set('paymentTermsDays')} /></Field>
        <Field label="TRN (15 digits)"><Input name="trn" inputMode="numeric" value={f.trn} onValue={set('trn')} /></Field>
        <Field label="Emirate"><Select value={f.emirate} onValue={set('emirate')} options={EMIRATES} placeholder="—" /></Field>
        <Field label="Salesman"><Input name="salesman" value={f.salesman} onValue={set('salesman')} /></Field>
        <Field label="Contact person"><Input name="contact" value={f.contactPerson} onValue={set('contactPerson')} /></Field>
        <Field label="Phone"><Input name="phone" type="tel" value={f.phone} onValue={set('phone')} /></Field>
        <Field label="Email"><Input name="email" type="email" value={f.email} onValue={set('email')} /></Field>
        <Field label={`Credit limit (${s.settings.currency})`}><Input name="creditLimit" type="number" inputMode="decimal" value={f.creditLimit} onValue={set('creditLimit')} /></Field>
        <Field label="Notes" full><textarea value={f.notes || ''} onInput={e => set('notes')((e.target as HTMLTextAreaElement).value)} /></Field>
        <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save customer</button></div>
      </form>
    </Page>
  );
}

const TABS = ['Invoices', 'Payments', 'GRVs', 'Credit notes', 'Deductions', 'Statements', 'Follow ups', 'Ledger', 'History'] as const;

export function CustomerProfile({ id }: { id: string }) {
  const s = useStore();
  const [tab, setTab] = useState<typeof TABS[number]>('Invoices');
  const cc = s.customers.get(id);
  const c = s.data.customers.find(x => x.id === id);
  if (!c) return <Page title="Customer" back="/customers"><Empty>Customer not found.</Empty></Page>;
  const cur = s.settings.currency;
  const m = (v: number) => money(v, cur);
  const invs = [...s.invoices.values()].filter(x => x.invoice.customerId === id).sort((a, b) => b.invoice.invoiceDate.localeCompare(a.invoice.invoiceDate));
  const cols = s.data.collections.filter(x => x.customerId === id && !x.deleted).sort((a, b) => b.date.localeCompare(a.date));
  const grvs = s.data.grvs.filter(x => x.customerId === id && !x.deleted);
  const cns = s.data.creditNotes.filter(x => x.customerId === id && !x.deleted);
  const deds = s.data.deductions.filter(x => x.customerId === id && !x.deleted);
  const sts = s.data.statements.filter(x => x.customerId === id && !x.deleted).sort((a, b) => b.statementDate.localeCompare(a.statementDate));
  const fus = s.data.followUps.filter(x => x.customerId === id && !x.deleted).sort((a, b) => b.contactDate.localeCompare(a.contactDate));
  const led = customerLedger(s.data, id);
  const q = '?customer=' + id;

  const exportCSV = () => saveCSV(`customer-history-${c.code}-${todayISO()}.csv`, led.rows, [
    { key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'ref', label: 'Reference' }, { key: 'note', label: 'Note' },
    { key: 'debit', label: 'Debit (AED)' }, { key: 'credit', label: 'Credit (AED)' }, { key: 'balance', label: 'Balance (AED)' }
  ]);
  const exportPDF = () => savePDF(`customer-statement-${c.code}-${todayISO()}.pdf`, `Statement of account – ${c.name}`, `Code ${c.code} · TRN ${c.trn || '—'} · Terms ${c.paymentTermsDays} days · As at ${fmtDate(s.today)}`, [
    { heading: 'Summary', head: ['Invoiced', 'Collected', 'Adjustments', 'Balance', 'Overdue', 'Unallocated'], body: [[num(cc!.invoiced), num(cc!.collected), num(cc!.adjustments), num(cc!.balance), num(cc!.overdue), num(cc!.unallocated)]] },
    { heading: 'Open invoices', head: ['Invoice', 'Date', 'Due', 'Gross', 'Paid', 'Adj.', 'Remaining', 'Days overdue'],
      body: invs.filter(x => x.remaining > 0.005).map(x => [x.invoice.invoiceNo, x.invoice.invoiceDate, x.invoice.dueDate, num(x.invoice.grossAmount), num(x.allocated), num(x.adjustments), num(x.remaining), x.daysOverdue || '']) },
    { heading: 'Ledger', head: ['Date', 'Type', 'Ref', 'Debit', 'Credit', 'Balance'], body: led.rows.map(r => [r.date, r.type, r.ref, r.debit ? num(r.debit) : '', r.credit ? num(r.credit) : '', num(r.balance)]) },
    { heading: 'Pending items (not affecting balance)', head: ['Type', 'Ref', 'Date', 'Amount', 'Status'], body: [
      ...cns.filter(x => !cnEffective(x) && x.status !== 'Rejected').map(x => ['Credit note', x.cnRef, x.date, num(x.amount), x.status + (x.applied ? '' : ', not applied')]),
      ...deds.filter(x => x.status === 'Disputed' || x.status === 'Claimed').map(x => ['Deduction', x.ref, x.date, num(x.claimedAmount), x.status]),
      ...grvs.filter(x => x.status === 'Pending').map(x => ['GRV', x.grvRef, x.date, num(x.amount), x.status])
    ] }
  ]);

  return (
    <Page title={c.name} sub={`${c.code} · ${c.emirate || ''} · ${c.paymentTermsDays}d terms`} back="/customers"
      actions={<button class="btn sm" onClick={() => go('/customer-form/' + id)} data-testid="edit-customer">Edit</button>}>
      <div class="stats" data-testid="customer-summary">
        <Stat label="Balance" value={m(cc!.balance)} tone="info" testid="cust-balance" />
        <Stat label="Overdue" value={m(cc!.overdue)} tone="bad" sub={`${cc!.overdueCount} invoice(s)`} testid="cust-overdue" />
        <Stat label="Invoiced" value={m(cc!.invoiced)} />
        <Stat label="Collected" value={m(cc!.collected)} tone="ok" />
        <Stat label="Adjustments" value={m(cc!.adjustments)} sub="applied CN + accepted deductions" />
        <Stat label="Unallocated" value={m(cc!.unallocated)} sub="received, not allocated" />
        {cc!.pendingCN + cc!.disputedDeductions + cc!.claimedDeductions + cc!.grvAwaitingCN > 0 &&
          <Stat label="Pending (no effect)" value={m(cc!.pendingCN + cc!.disputedDeductions + cc!.claimedDeductions)} tone="warn"
            sub={`CN ${num(cc!.pendingCN)} · Disputed ${num(cc!.disputedDeductions)} · Claimed ${num(cc!.claimedDeductions)}`} testid="cust-pending" />}
      </div>
      {c.creditLimit && cc!.balance > c.creditLimit ? <Warn>⚠ Balance exceeds credit limit of {m(c.creditLimit)}.</Warn> : null}
      <div class="quick">
        <a class="qbtn" href={'#/invoice-form' + q}>+ Invoice</a>
        <a class="qbtn" href={'#/collection-form' + q}>+ Payment</a>
        <a class="qbtn" href={'#/grv-form' + q}>+ GRV</a>
        <a class="qbtn" href={'#/cn-form' + q}>+ Credit note</a>
        <a class="qbtn" href={'#/deduction-form' + q}>+ Deduction</a>
        <a class="qbtn" href={'#/followup-form' + q}>+ Follow up</a>
        <a class="qbtn" href={'#/recon-form' + q}>Reconcile</a>
        <button class="qbtn" onClick={exportCSV} data-testid="cust-csv">Export CSV</button>
        <button class="qbtn" onClick={exportPDF} data-testid="cust-pdf">Statement PDF</button>
        <a class="qbtn" href={'#/statements?customer=' + id} data-testid="cust-statement">Statement Excel/PDF</a>
        <a class="qbtn" href={'#/task-form' + q}>+ Task</a>
        <a class="qbtn" href={'#/performance?customer=' + id}>Targets</a>
      </div>
      {(c.phone || c.email) && <div class="row gap contact">
        {c.phone && <a class="btn sm ghost" href={'tel:' + c.phone.replace(/\s/g, '')}>📞 {c.phone}</a>}
        {c.email && <a class="btn sm ghost" href={'mailto:' + c.email}>✉ Email</a>}
      </div>}
      <div class="tabs scroll-x">{TABS.map(t => <button class={'tabbtn' + (t === tab ? ' on' : '')} onClick={() => setTab(t)}>{t}</button>)}</div>
      <Card>
        {tab === 'Invoices' && (invs.length ? invs.map(x => (
          <a class={'list-row' + (x.overdue ? ' overdue' : '')} href={'#/invoices/' + x.invoice.id} data-testid="cust-invoice">
            <div class="grow"><b>{x.invoice.invoiceNo}</b><div class="muted small">{fmtDate(x.invoice.invoiceDate)} · due {fmtDate(x.invoice.dueDate)}{x.overdue ? ` · ${x.daysOverdue}d overdue` : ''}</div></div>
            <div class="right"><Money v={x.remaining} cur={cur} /><div><Badge s={x.status} />{x.overdue && <Badge s="Overdue" />}</div><div class="muted small">of {num(x.invoice.grossAmount)}</div></div>
          </a>)) : <Empty>No invoices.</Empty>)}
        {tab === 'Payments' && (cols.length ? cols.map(x => (
          <a class="list-row" href={'#/collections/' + x.id}>
            <div class="grow"><b>{x.receiptRef}</b><div class="muted small">{fmtDate(x.date)} · {x.method}</div></div>
            <div class="right"><Money v={x.amount} cur={cur} />{s.ix && collectionUnallocated(x, s.ix) > 0.005 && <div class="warn-text small">{num(collectionUnallocated(x, s.ix))} unallocated</div>}</div>
          </a>)) : <Empty>No payments.</Empty>)}
        {tab === 'GRVs' && (grvs.length ? grvs.map(x => (
          <a class="list-row" href={'#/grv-form/' + x.id}><div class="grow"><b>{x.grvRef}</b><div class="muted small">{fmtDate(x.date)} · {x.reason} · {invNo(s, x.invoiceId)}</div></div><div class="right"><Money v={x.amount} cur={cur} /><Badge s={x.status} /></div></a>)) : <Empty>No GRVs.</Empty>)}
        {tab === 'Credit notes' && (cns.length ? cns.map(x => (
          <a class="list-row" href={'#/cn-form/' + x.id}><div class="grow"><b>{x.cnRef}</b><div class="muted small">{fmtDate(x.date)} · {x.reason} · {invNo(s, x.invoiceId)}</div></div><div class="right"><Money v={x.amount} cur={cur} /><Badge s={x.status} /> {x.status === 'Approved' && <Badge s={x.applied ? 'Applied' : 'Not applied'} />}</div></a>)) : <Empty>No credit notes.</Empty>)}
        {tab === 'Deductions' && (deds.length ? deds.map(x => (
          <a class="list-row" href={'#/deduction-form/' + x.id}><div class="grow"><b>{x.ref}</b><div class="muted small">{fmtDate(x.date)} · {x.reason}</div></div><div class="right"><Money v={x.claimedAmount} cur={cur} /><Badge s={x.status} />{deductionEffective(x) > 0 && <div class="ok-text small">accepted {num(deductionEffective(x))}</div>}</div></a>)) : <Empty>No deductions.</Empty>)}
        {tab === 'Statements' && (sts.length ? sts.map(x => (
          <a class="list-row" href={'#/recon-form/' + x.id}><div class="grow"><b>{fmtDate(x.statementDate)}</b><div class="muted small">{x.statementRef} · statement {num(x.statementBalance)} vs mine {num(x.recordedBalance)}</div></div><div class="right"><Money v={x.difference} cur={cur} /><Badge s={x.status} /></div></a>)) : <Empty>No reconciliations.</Empty>)}
        {tab === 'Follow ups' && (fus.length ? fus.map(x => (
          <a class="list-row" href={'#/followup-form/' + x.id}><div class="grow"><b>{fmtDate(x.contactDate)}</b> {invNo(s, x.invoiceId)}<div class="muted small">{x.notes}</div></div><div class="right"><Badge s={x.status} />{x.promisedAmount ? <div class="small">{num(x.promisedAmount)} on {fmtDate(x.promisedDate)}</div> : null}</div></a>)) : <Empty>No follow ups.</Empty>)}
        {tab === 'Ledger' && <div class="table-wrap"><table class="tbl" data-testid="ledger"><thead><tr><th>Date</th><th>Type / Ref</th><th class="num">Dr</th><th class="num">Cr</th><th class="num">Balance</th></tr></thead>
          <tbody>{led.rows.slice().reverse().map(r => <tr onClick={() => (location.hash = r.link)}><td>{r.date}</td><td>{r.type}<div class="muted small">{r.ref}</div></td><td class="num">{r.debit ? num(r.debit) : ''}</td><td class="num">{r.credit ? num(r.credit) : ''}</td><td class="num">{num(r.balance)}</td></tr>)}</tbody></table></div>}
        {tab === 'History' && <AuditTrail filter={e => e.entityId === id || [...s.data.invoices, ...s.data.collections, ...s.data.grvs, ...s.data.creditNotes, ...s.data.deductions, ...s.data.followUps, ...s.data.statements].some((x: any) => x.id === e.entityId && x.customerId === id)} />}
      </Card>
      <button class="btn danger ghost block" onClick={async () => {
        if (cc!.openInvoices > 0) { toast('Customer has open invoices – settle or void them first.', 'bad'); return; }
        const r = await ask('Void this customer?', { body: 'The record is kept in history and can be restored.', input: 'Reason', danger: true, okText: 'Void' });
        if (r) { await voidRecord('customers', id, r === 'ok' ? '' : r, 'customer ' + c.name); await refresh(); go('/customers'); }
      }}>Void customer</button>
    </Page>
  );
}
