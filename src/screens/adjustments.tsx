import { useState } from 'preact/hooks';
import { useStore, refresh, custName, invNo } from '../store';
import { Page, Card, Money, Badge, Field, Input, MoneyInput, Select, Errors, Warn, Empty, SearchBox, Chips, toast, ask } from '../ui';
import { money, fmtDate, norm, num, r2, todayISO, sum } from '../util';
import { go, qp } from '../router';
import { saveRecord, voidRecord, restoreRecord } from '../db';
import { findDuplicate, validateCreditNote, validateDeduction, cnEffective, deductionEffective, remainingExcluding } from '../calc';
import { saveCSV } from '../exporter';
import type { CreditNote, Deduction, GRV } from '../types';
import { AuditTrail } from './misc';

type Kind = 'grvs' | 'creditNotes' | 'deductions';
const CFG = {
  grvs: { title: 'GRVs', one: 'GRV', ref: 'grvRef', form: 'grv-form', statuses: ['Pending', 'Approved', 'Rejected'], amount: 'amount' },
  creditNotes: { title: 'Credit notes', one: 'credit note', ref: 'cnRef', form: 'cn-form', statuses: ['Pending', 'Approved', 'Rejected'], amount: 'amount' },
  deductions: { title: 'Deductions', one: 'deduction', ref: 'ref', form: 'deduction-form', statuses: ['Claimed', 'Disputed', 'Accepted', 'Partially Accepted', 'Rejected'], amount: 'claimedAmount' }
} as const;

export function AdjList({ kind }: { kind: Kind }) {
  const s = useStore();
  const cfg = CFG[kind];
  const [q, setQ] = useState('');
  const [st, setSt] = useState('All');
  const [showVoid, setShowVoid] = useState(false);
  const cur = s.settings.currency;
  const all = (s.data[kind] as any[]);
  const extra = kind === 'creditNotes' ? ['Not applied', 'Applied'] : kind === 'grvs' ? ['Awaiting CN'] : [];
  const coveredGrv = new Set(s.data.creditNotes.filter(c => !c.deleted && c.grvId && c.status === 'Approved').map(c => c.grvId));
  const rows = all.filter(x => showVoid ? x.deleted : !x.deleted).filter(x => {
    const t = norm(q);
    if (t && ![x[cfg.ref], x.reason, x.supportingRef, custName(s, x.customerId), invNo(s, x.invoiceId)].some(v => norm(v).includes(t))) return false;
    if (st === 'All') return true;
    if (st === 'Applied') return x.status === 'Approved' && x.applied;
    if (st === 'Not applied') return x.status === 'Approved' && !x.applied;
    if (st === 'Awaiting CN') return x.status === 'Approved' && !coveredGrv.has(x.id);
    return x.status === st;
  }).sort((a, b) => b.date.localeCompare(a.date));
  const total = sum(rows.map(r => r[cfg.amount]));
  return (
    <Page title={cfg.title} sub={`${rows.length} · ${money(total, cur)}`} back="/more" actions={<button class="btn primary sm" data-testid={'new-' + kind} onClick={() => go('/' + cfg.form)}>+ New</button>}>
      <SearchBox value={q} onValue={setQ} placeholder="Reference, reason, customer, invoice…" />
      <Chips value={st} options={['All', ...cfg.statuses, ...extra]} onValue={setSt} />
      <div class="row gap">
        <label class="inline small"><input type="checkbox" checked={showVoid} onChange={e => setShowVoid((e.target as HTMLInputElement).checked)} /> Show voided</label>
        <button class="btn sm ghost" onClick={() => saveCSV(`${kind}-${todayISO()}.csv`, rows.map(r => ({ ...r, customer: custName(s, r.customerId), invoice: invNo(s, r.invoiceId) })))}>Export CSV</button>
      </div>
      {kind === 'deductions' && <p class="muted small">Claimed and Disputed deductions never reduce balances. Only Accepted / Partially Accepted (accepted amount) do.</p>}
      {kind === 'grvs' && <p class="muted small">GRVs don’t change balances directly – the approved &amp; applied credit note issued against the GRV does (prevents double counting).</p>}
      {rows.length === 0 && <Empty>Nothing here.</Empty>}
      <div class="list">
        {rows.map(x => (
          <a class="list-row" href={`#/${cfg.form}/${x.id}`} data-testid="adj-row">
            <div class="grow"><b>{x[cfg.ref]}</b> <span class="muted small">{custName(s, x.customerId)}</span>
              <div class="muted small">{fmtDate(x.date)} · {x.reason}{x.invoiceId ? ' · ' + invNo(s, x.invoiceId) : ''}</div></div>
            <div class="right"><Money v={x[cfg.amount]} cur={cur} /><div><Badge s={x.status} />{kind === 'creditNotes' && x.status === 'Approved' && <Badge s={x.applied ? 'Applied' : 'Not applied'} />}</div>
              {kind === 'deductions' && deductionEffective(x) > 0 && <div class="ok-text small">accepted {num(deductionEffective(x))}</div>}
              {kind === 'grvs' && x.status === 'Approved' && !coveredGrv.has(x.id) && <div class="warn-text small">awaiting CN</div>}
            </div>
          </a>
        ))}
      </div>
    </Page>
  );
}

const REASONS = {
  grvs: ['Damaged in transit', 'Near expiry', 'Expired', 'Wrong item delivered', 'Short shelf life', 'Quality issue', 'Excess delivery'],
  creditNotes: ['Against GRV', 'Price difference', 'Promotional discount', 'Rebate', 'Billing error', 'Shortage'],
  deductions: ['Listing fee', 'Promotional support', 'Price difference', 'Display rental', 'Late delivery penalty', 'Shortage', 'Damages', 'Rebate']
};

export function AdjForm({ kind, id }: { kind: Kind; id?: string }) {
  const s = useStore();
  const cfg = CFG[kind];
  const all = s.data[kind] as any[];
  const ex = id ? all.find(x => x.id === id) : undefined;
  const preGrv = qp('grv') ? s.data.grvs.find(g => g.id === qp('grv')) : undefined;
  const [f, setF] = useState<any>(ex ? { ...ex } : {
    customerId: qp('customer'), invoiceId: qp('invoice'), grvId: preGrv?.id, date: todayISO(),
    status: kind === 'deductions' ? 'Claimed' : 'Pending', applied: false, acceptedAmount: 0,
    amount: preGrv ? preGrv.amount : '', reason: preGrv ? 'Against GRV' : ''
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const cur = s.settings.currency;
  const set = (k: string) => (v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const invOptions = s.data.invoices.filter(i => !i.deleted && i.customerId === f.customerId).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))
    .map(i => [i.id, `${i.invoiceNo} · ${fmtDate(i.invoiceDate)} · ${num(s.invoices.get(i.id)?.remaining ?? 0)} open`] as [string, string]);
  const dup = findDuplicate(all, cfg.ref as any, f[cfg.ref] || '', id);
  const label = `${cfg.one} ${f[cfg.ref] || ''}`;

  const amountField = kind === 'deductions' ? 'claimedAmount' : 'amount';
  const numRec = () => {
    const r: any = { ...f, [cfg.ref]: (f[cfg.ref] || '').trim(), [amountField]: r2(Number(f[amountField]) || 0) };
    if (!r.invoiceId) delete r.invoiceId;
    if (kind === 'deductions') {
      r.acceptedAmount = r.status === 'Accepted' ? r2(Number(f.acceptedAmount) || r.claimedAmount) : r.status === 'Partially Accepted' ? r2(Number(f.acceptedAmount) || 0) : 0;
    }
    if (kind === 'creditNotes') { if (!r.grvId) delete r.grvId; if (r.status !== 'Approved') r.applied = false; }
    return r;
  };
  // effect preview
  let effect = '';
  const rec = numRec();
  if (kind !== 'grvs' && rec.invoiceId) {
    const before = remainingExcluding(s.data, rec.invoiceId, kind === 'creditNotes' ? { cnId: id || '__new' } : { dedId: id || '__new' });
    const eff = kind === 'creditNotes' ? cnEffective({ ...rec, deleted: false }) : deductionEffective({ ...rec, deleted: false });
    effect = eff > 0 ? `Reduces ${invNo(s, rec.invoiceId)} balance from ${num(before)} to ${num(r2(before - eff))}.` : `No effect on ${invNo(s, rec.invoiceId)} balance (${num(before)}) – ${kind === 'creditNotes' ? 'credit note must be Approved AND Applied' : 'only accepted deductions reduce balances'}.`;
  } else if (kind === 'grvs') effect = 'A GRV does not change the balance by itself. Issue an approved credit note against it to adjust the account.';

  const save = async () => {
    const r = numRec();
    let e: string[] = [];
    if (kind === 'grvs') {
      if (!r.grvRef) e.push('GRV reference is required.');
      if (!r.customerId) e.push('Select a customer.');
      if (!r.date) e.push('Date is required.');
      if (!(r.amount > 0)) e.push('Amount must be greater than 0.');
      if (!r.reason) e.push('Reason is required.');
    } else if (kind === 'creditNotes') e = validateCreditNote(s.data, r);
    else { e = validateDeduction(s.data, r); if (!r.reason) e.push('Reason is required.'); }
    if (dup && !ack) e.push(`Reference ${r[cfg.ref]} already exists – tick “Save anyway” if correct.`);
    setErrors(e);
    if (e.length) { window.scrollTo(0, 0); return; }
    const nid = await saveRecord(kind, r, label);
    await refresh(); toast(`${cfg.one[0].toUpperCase() + cfg.one.slice(1)} saved`); go(`/${cfg.form}/${nid}`);
  };
  const linkedCNs = kind === 'grvs' && id ? s.data.creditNotes.filter(c => c.grvId === id && !c.deleted) : [];
  const grvOptions = s.data.grvs.filter(g => !g.deleted && g.customerId === f.customerId).map(g => [g.id, `${g.grvRef} · ${num(g.amount)} · ${g.status}`] as [string, string]);

  return (
    <Page title={(ex ? 'Edit ' : 'New ') + cfg.one} back>
      {ex?.deleted && <Warn>VOIDED ({ex.deleteReason}). <button class="btn sm" onClick={async () => { await restoreRecord(kind, ex.id, label); await refresh(); }}>Restore</button></Warn>}
      <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
        <Errors errors={errors} />
        <Field label={`${kind === 'grvs' ? 'GRV' : kind === 'creditNotes' ? 'Credit note' : 'Deduction'} reference *`}><Input name="ref" value={f[cfg.ref]} onValue={set(cfg.ref)} autoCapitalize="characters" /></Field>
        <Field label="Customer *"><Select name="customerId" testid="adj-customer" value={f.customerId} onValue={v => setF({ ...f, customerId: v, invoiceId: '', grvId: '' })} placeholder="Select customer" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
        {dup && <Warn testid="dup-warning">⚠ Duplicate reference – {dup[cfg.ref]} already exists ({custName(s, dup.customerId)}, {fmtDate(dup.date)}). <label class="inline"><input type="checkbox" checked={ack} onChange={e => setAck((e.target as HTMLInputElement).checked)} /> Save anyway</label></Warn>}
        <Field label="Invoice"><Select name="invoiceId" testid="adj-invoice" value={f.invoiceId} onValue={set('invoiceId')} placeholder={kind === 'grvs' ? '— none —' : '— customer level (no invoice) —'} options={invOptions} /></Field>
        {kind === 'creditNotes' && <Field label="Against GRV"><Select name="grvId" testid="adj-grv" value={f.grvId} onValue={v => { const g = s.data.grvs.find(x => x.id === v); setF({ ...f, grvId: v, invoiceId: g?.invoiceId || f.invoiceId, amount: f.amount || g?.amount || '' }); }} placeholder="— none —" options={grvOptions} /></Field>}
        <Field label="Date *"><Input name="date" type="date" value={f.date} onValue={set('date')} /></Field>
        <Field label={`${kind === 'deductions' ? 'Claimed amount' : 'Amount'} (${cur}) *`}><MoneyInput name="amount" value={f[amountField]} onValue={set(amountField)} /></Field>
        <Field label="Reason *"><Input name="reason" list={'reasons-' + kind} value={f.reason} onValue={set('reason')} /><datalist id={'reasons-' + kind}>{REASONS[kind].map(r => <option value={r} />)}</datalist></Field>
        <Field label={kind === 'deductions' ? 'Status' : 'Approval status'}><Select name="status" testid="adj-status" value={f.status} onValue={set('status')} options={[...cfg.statuses]} /></Field>
        {kind === 'creditNotes' && <Field label="Adjustment applied to account?" hint={f.status !== 'Approved' ? 'Available once Approved' : ''}>
          <label class="inline"><input type="checkbox" name="applied" data-testid="cn-applied" disabled={f.status !== 'Approved'} checked={!!f.applied && f.status === 'Approved'} onChange={e => set('applied')((e.target as HTMLInputElement).checked)} /> Applied</label></Field>}
        {kind === 'deductions' && (f.status === 'Accepted' || f.status === 'Partially Accepted') && <Field label={`Accepted amount (${cur})`} hint={f.status === 'Accepted' ? 'Leave blank to accept the full claim' : ''}><MoneyInput name="acceptedAmount" value={f.acceptedAmount || ''} onValue={set('acceptedAmount')} /></Field>}
        {kind === 'deductions' && <Field label="Supporting reference"><Input name="supportingRef" value={f.supportingRef} onValue={set('supportingRef')} placeholder="Promo agreement, debit note…" /></Field>}
        {kind === 'deductions' && <Field label="Dispute notes" full><textarea name="disputeNotes" value={f.disputeNotes || ''} onInput={e => set('disputeNotes')((e.target as HTMLTextAreaElement).value)} /></Field>}
        <Field label="Notes" full><textarea value={f.notes || ''} onInput={e => set('notes')((e.target as HTMLTextAreaElement).value)} /></Field>
        {effect && <div class="alert info full" data-testid="effect">{effect}</div>}
        <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save {cfg.one}</button></div>
      </form>
      {kind === 'grvs' && id && <Card title="Credit notes for this GRV">
        {linkedCNs.map(c => <a class="list-row" href={'#/cn-form/' + c.id}><div class="grow"><b>{c.cnRef}</b> {fmtDate(c.date)}</div><div class="right"><Money v={c.amount} cur={cur} /><Badge s={c.status} /></div></a>)}
        {!linkedCNs.some(c => c.status !== 'Rejected') && ex?.status === 'Approved' && <a class="btn primary block" href={`#/cn-form?customer=${ex.customerId}&invoice=${ex.invoiceId || ''}&grv=${ex.id}`} data-testid="cn-from-grv">Create credit note from this GRV</a>}
        {!linkedCNs.length && ex?.status !== 'Approved' && <p class="muted small">Approve the GRV first, then create its credit note.</p>}
      </Card>}
      {ex && <Card title="Correction history"><AuditTrail filter={e => e.entityId === ex.id} /></Card>}
      {ex && !ex.deleted && <button class="btn danger ghost block" onClick={async () => {
        const r = await ask(`Void ${label}?`, { input: 'Reason', danger: true, okText: 'Void' });
        if (r) { await voidRecord(kind, ex.id, r === 'ok' ? '' : r, label); await refresh(); toast('Voided'); }
      }}>Void {cfg.one}</button>}
    </Page>
  );
}
export type { GRV, CreditNote, Deduction };
