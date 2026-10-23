import { useState } from 'preact/hooks';
import { useStore, refresh, custName, invNo } from '../store';
import { Page, Card, Money, Badge, Field, Input, MoneyInput, Select, Errors, Empty, Chips, toast, ask } from '../ui';
import { fmtDate, num, r2, todayISO, addDays } from '../util';
import { go, qp } from '../router';
import { saveRecord, voidRecord } from '../db';
import { followUpQueue } from '../calc';
import { saveCSV } from '../exporter';
import { AuditTrail } from './misc';

export function FollowUps() {
  const s = useStore();
  const [tab, setTab] = useState('Overdue');
  const [cust, setCust] = useState('');
  const q = followUpQueue(s.data, s.today, s.settings.upcomingDays);
  const cur = s.settings.currency;
  const fc = (cid: string) => !cust || cid === cust;
  const all = s.data.followUps.filter(f => !f.deleted && fc(f.customerId)).sort((a, b) => (b.nextContactDate || b.contactDate).localeCompare(a.nextContactDate || a.contactDate));
  const overdue = q.overdue.filter(x => fc(x.calc.invoice.customerId));
  return (
    <Page title="Follow ups" back="/more" actions={<button class="btn primary sm" onClick={() => go('/followup-form')}>+ New</button>}>
      <Chips value={tab} options={['Overdue', 'Due soon', 'Promises', 'Contact today', 'All']} onValue={setTab} />
      <Select value={cust} onValue={setCust} placeholder="All customers" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} aria-label="Customer" />
      {tab === 'Overdue' && <>
        <div class="row between"><span class="muted small">{overdue.length} overdue invoices</span>
          <button class="btn sm ghost" onClick={() => saveCSV(`overdue-${todayISO()}.csv`, overdue.map(x => ({ invoice: x.calc.invoice.invoiceNo, customer: custName(s, x.calc.invoice.customerId), dueDate: x.calc.invoice.dueDate, daysOverdue: x.calc.daysOverdue, remaining: x.calc.remaining, nextContact: x.followUp?.nextContactDate, promisedDate: x.followUp?.promisedDate, promisedAmount: x.followUp?.promisedAmount, status: x.followUp?.status || 'No follow up' })))}>Export CSV</button></div>
        {overdue.length === 0 && <Empty>No overdue invoices 🎉</Empty>}
        <div class="list">{overdue.map(({ calc: x, followUp: f }) => (
          <div class={'list-row overdue'} data-testid="overdue-row">
            <a class="grow" href={'#/invoices/' + x.invoice.id}><b>{x.invoice.invoiceNo}</b> <span class="small">{custName(s, x.invoice.customerId)}</span>
              <div class="small"><span class="bad-text">{x.daysOverdue} days overdue</span> · due {fmtDate(x.invoice.dueDate)}</div>
              <div class="muted small">{f ? <>Next contact {fmtDate(f.nextContactDate) || '—'}{f.promisedDate ? ` · promised ${num(f.promisedAmount || 0)} on ${fmtDate(f.promisedDate)}` : ''} · <Badge s={f.status} /></> : 'No follow up yet'}</div></a>
            <div class="right"><Money v={x.remaining} cur={cur} /><a class="btn sm" href={`#/followup-form?customer=${x.invoice.customerId}&invoice=${x.invoice.id}`}>Log</a></div>
          </div>))}</div>
      </>}
      {tab === 'Due soon' && <div class="list">{q.dueSoon.filter(x => fc(x.invoice.customerId)).map(x => (
        <a class="list-row" href={'#/invoices/' + x.invoice.id}><div class="grow"><b>{x.invoice.invoiceNo}</b> {custName(s, x.invoice.customerId)}<div class="warn-text small">due {x.daysToDue === 0 ? 'today' : `in ${x.daysToDue} days`} ({fmtDate(x.invoice.dueDate)})</div></div><Money v={x.remaining} cur={cur} /></a>))}
        {!q.dueSoon.length && <Empty>Nothing due in the next {s.settings.upcomingDays} days.</Empty>}</div>}
      {tab === 'Promises' && <FuList s={s} rows={q.promises.filter(f => fc(f.customerId))} />}
      {tab === 'Contact today' && <FuList s={s} rows={q.contactsDue.filter(f => fc(f.customerId))} />}
      {tab === 'All' && <FuList s={s} rows={all} />}
    </Page>
  );
}

function FuList({ s, rows }: { s: any; rows: any[] }) {
  if (!rows.length) return <Empty>Nothing here.</Empty>;
  return <div class="list">{rows.map(f => (
    <a class="list-row" href={'#/followup-form/' + f.id} data-testid="fu-row">
      <div class="grow"><b>{custName(s, f.customerId)}</b> <span class="small">{invNo(s, f.invoiceId)}</span>
        <div class="muted small">Contacted {fmtDate(f.contactDate)} · next {fmtDate(f.nextContactDate) || '—'}</div>
        {f.promisedDate && <div class={'small ' + (f.promisedDate < s.today ? 'bad-text' : '')}>Promised {num(f.promisedAmount || 0)} on {fmtDate(f.promisedDate)}</div>}
        {f.notes && <div class="muted small">{f.notes}</div>}</div>
      <Badge s={f.status} />
    </a>))}</div>;
}

export function FollowUpForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.followUps.find(x => x.id === id) : undefined;
  const preInv = s.invoices.get(qp('invoice'));
  const [f, setF] = useState<any>(ex ? { ...ex } : { customerId: qp('customer'), invoiceId: qp('invoice'), contactDate: todayISO(), nextContactDate: addDays(todayISO(), 3), status: 'Open', promisedAmount: preInv ? '' : '' });
  const [errors, setErrors] = useState<string[]>([]);
  const cur = s.settings.currency;
  const invOptions = [...s.invoices.values()].filter(x => x.invoice.customerId === f.customerId && (x.remaining > 0.005 || x.invoice.id === f.invoiceId))
    .map(x => [x.invoice.id, `${x.invoice.invoiceNo} · ${num(x.remaining)} open${x.overdue ? ` · ${x.daysOverdue}d overdue` : ''}`] as [string, string]);
  const save = async () => {
    const e: string[] = [];
    if (!f.customerId) e.push('Select a customer.');
    if (!f.contactDate) e.push('Contact date is required.');
    if (f.status === 'Promised' && (!f.promisedDate || !(Number(f.promisedAmount) > 0))) e.push('Enter the promised date and amount for a payment promise.');
    if (f.nextContactDate && f.nextContactDate < f.contactDate) e.push('Next contact date cannot be before the contact date.');
    setErrors(e); if (e.length) return;
    const rec = { ...f, promisedAmount: f.promisedAmount ? r2(Number(f.promisedAmount)) : undefined };
    if (!rec.invoiceId) delete rec.invoiceId;
    await saveRecord('followUps', rec, 'follow up ' + custName(s, f.customerId));
    await refresh(); toast('Follow up saved'); go('/followups');
  };
  return (
    <Page title={ex ? 'Follow up' : 'Log follow up'} back>
      <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
        <Errors errors={errors} />
        <Field label="Customer *"><Select name="customerId" value={f.customerId} onValue={v => setF({ ...f, customerId: v, invoiceId: '' })} placeholder="Select customer" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
        <Field label="Invoice"><Select name="invoiceId" value={f.invoiceId} onValue={v => setF({ ...f, invoiceId: v })} placeholder="— all / account level —" options={invOptions} /></Field>
        <Field label="Contact date *"><Input name="contactDate" type="date" value={f.contactDate} onValue={v => setF({ ...f, contactDate: v })} /></Field>
        <Field label="Next contact date"><Input name="nextContactDate" type="date" value={f.nextContactDate} onValue={v => setF({ ...f, nextContactDate: v })} /></Field>
        <Field label="Status"><Select name="status" value={f.status} onValue={v => setF({ ...f, status: v })} options={['Open', 'Promised', 'Escalated', 'Paid', 'Closed']} /></Field>
        <Field label="Promised payment date"><Input name="promisedDate" type="date" value={f.promisedDate} onValue={v => setF({ ...f, promisedDate: v })} /></Field>
        <Field label={`Promised amount (${cur})`}><MoneyInput name="promisedAmount" value={f.promisedAmount} onValue={v => setF({ ...f, promisedAmount: v })} /></Field>
        <Field label="Notes" full><textarea name="notes" value={f.notes || ''} onInput={e => setF({ ...f, notes: (e.target as HTMLTextAreaElement).value })} /></Field>
        <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save follow up</button></div>
      </form>
      {ex && <Card title="Correction history"><AuditTrail filter={e => e.entityId === ex.id} /></Card>}
      {ex && <button class="btn danger ghost block" onClick={async () => { const x = await ask('Void this follow up?', { danger: true, okText: 'Void' }); if (x) { await voidRecord('followUps', ex.id, '', 'follow up'); await refresh(); go('/followups'); } }}>Void</button>}
    </Page>
  );
}
