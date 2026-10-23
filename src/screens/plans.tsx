import { useState } from 'preact/hooks';
import { useStore, refresh, custName, invNo } from '../store';
import { Page, Card, Stat, Badge, Field, Input, MoneyInput, Select, Errors, Empty, Chips, toast, ask, Warn } from '../ui';
import { money, num, monthLabel, monthKey, fmtDate, todayISO, addDays } from '../util';
import { go, qp } from '../router';
import { saveRecord, voidRecord } from '../db';
import { planVsActual, addMonths } from '../lib/perf';
import { computeAlerts, badgeCount, KIND_LABEL, buildICS, calendarEvents, enableNotifications, notificationsSupported, notifyAlerts, type Alert } from '../lib/alerts';
import { saveFile } from '../exporter';
import { Progress } from './perf';
import { AuditTrail } from './misc';
import type { TaskStatus } from '../types';

const pctTxt = (v: number | null) => (v == null ? '—' : v.toFixed(0) + '%');

export function PlanScreen() {
  const s = useStore();
  const cur = s.settings.currency;
  const [month, setMonth] = useState(qp('month') || monthKey(s.today));
  const r = planVsActual(s.data, month, s.settings.salesBasis || 'net', s.today);
  return <Page title="Monthly plan" sub="Sales & collection plan vs actual" back="/more" actions={<a class="btn sm primary" href={'#/plan-form?month=' + month} data-testid="new-plan">+ Plan</a>}>
    <div class="row gap"><button class="btn sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</button><Input type="month" name="month" value={month} onValue={v => v && setMonth(v)} /><button class="btn sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>›</button></div>
    <Card title={monthLabel(month)} testid="plan-totals">
      <div class="stats">
        <Stat label="Planned sales" value={money(r.totals.plannedSales, cur)} sub={`actual ${money(r.totals.actualSales, cur)}`} testid="plan-sales" />
        <Stat label="Sales vs plan" value={pctTxt(r.totals.salesAch)} testid="plan-sales-ach" tone={(r.totals.salesAch || 0) >= 100 ? 'ok' : 'warn'} />
        <Stat label="Planned collection" value={money(r.totals.plannedCollection, cur)} sub={`actual ${money(r.totals.actualCollection, cur)}`} />
        <Stat label="Collection vs plan" value={pctTxt(r.totals.collAch)} testid="plan-coll-ach" tone={(r.totals.collAch || 0) >= 100 ? 'ok' : 'warn'} />
        <Stat label="Visits done" value={`${r.totals.visitsDone} / ${r.totals.visitsPlanned}`} testid="plan-visits" />
      </div>
    </Card>
    {r.rows.length ? r.rows.map(x => <Card title={custName(s, x.customerId)} right={x.plan ? <a class="link" href={'#/plan-form/' + x.plan.id}>Edit</a> : <a class="link" href={`#/plan-form?month=${month}&customer=${x.customerId}`}>Add plan</a>} testid={'plan-' + x.customerId}>
      <div class="small">Sales {num(x.actualSales)} / {num(x.plannedSales)} ({pctTxt(x.salesAch)})</div><Progress v={x.salesAch} />
      <div class="small">Collection {num(x.actualCollection)} / {num(x.plannedCollection)} ({pctTxt(x.collAch)})</div><Progress v={x.collAch} />
      {x.plan && x.plan.visitDates.length > 0 && <div class="chips">{x.plan.visitDates.map(d => {
        const done = x.plan!.visitsDone.includes(d);
        return <button type="button" class={'chip' + (done ? ' on' : '')} data-testid={'visit-' + d} title="Tap to mark visit done / not done" onClick={async () => {
          const vd = done ? x.plan!.visitsDone.filter(v => v !== d) : [...x.plan!.visitsDone, d];
          await saveRecord('plans', { id: x.plan!.id, visitsDone: vd } as any, `plan ${month} visit ${d} ${done ? 'not done' : 'done'}`); await refresh();
        }}>{done ? '✓ ' : ''}{fmtDate(d).slice(0, 6)}</button>;
      })}</div>}
      {!x.plan && <p class="muted small">Not in plan (unplanned business).</p>}
    </Card>) : <Empty>No plan for {monthLabel(month)}. Tap + Plan.</Empty>}
  </Page>;
}

export function PlanForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.plans.find(p => p.id === id) : undefined;
  const [f, setF] = useState<any>(ex ? { ...ex, visitText: ex.visitDates.join(', ') } : { month: qp('month') || monthKey(s.today), customerId: qp('customer'), plannedSales: '', plannedCollection: '', visitText: '' });
  const [newVisit, setNewVisit] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const visits = (f.visitText || '').split(/[\s,]+/).filter(Boolean);
  const save = async () => {
    const e: string[] = [];
    if (!/^\d{4}-\d{2}$/.test(f.month || '')) e.push('Month is required.');
    if (!f.customerId) e.push('Customer is required.');
    if (!(Number(f.plannedSales) >= 0) || f.plannedSales === '') e.push('Planned sales must be 0 or more.');
    if (!(Number(f.plannedCollection) >= 0) || f.plannedCollection === '') e.push('Planned collection must be 0 or more.');
    const bad = visits.filter((v: string) => !/^\d{4}-\d{2}-\d{2}$/.test(v));
    if (bad.length) e.push('Visit dates must be YYYY-MM-DD: ' + bad.join(', '));
    if (s.data.plans.some(p => !p.deleted && p.id !== id && p.month === f.month && p.customerId === f.customerId)) e.push('This customer already has a plan for that month – edit it instead.');
    setErrors(e); if (e.length) return;
    const vd = [...new Set<string>(visits)].sort();
    const { visitText, ...rec } = f;
    const nid = await saveRecord('plans', { ...rec, plannedSales: Number(f.plannedSales), plannedCollection: Number(f.plannedCollection), visitDates: vd, visitsDone: (ex?.visitsDone || []).filter(d => vd.includes(d)) } as any, `plan ${f.month} ${custName(s, f.customerId)}`);
    await refresh(); toast('Plan saved'); go('/plans?month=' + f.month); void nid;
  };
  return <Page title={ex ? 'Edit plan' : 'New plan'} back="/plans">
    <form class="form" noValidate onSubmit={e => { e.preventDefault(); save(); }}>
      <Errors errors={errors} />
      <Field label="Month *"><Input type="month" name="month" value={f.month} onValue={v => setF({ ...f, month: v })} /></Field>
      <Field label="Customer *"><Select name="customerId" aria-label="Plan customer" value={f.customerId} onValue={v => setF({ ...f, customerId: v })} placeholder="Select customer" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
      <Field label={`Planned sales (${s.settings.currency}) *`}><MoneyInput name="plannedSales" value={f.plannedSales} onValue={v => setF({ ...f, plannedSales: v })} /></Field>
      <Field label={`Planned collection (${s.settings.currency}) *`}><MoneyInput name="plannedCollection" value={f.plannedCollection} onValue={v => setF({ ...f, plannedCollection: v })} /></Field>
      <Field label="Add visit date"><div class="row gap"><Input type="date" name="newVisit" value={newVisit} onValue={setNewVisit} /><button type="button" class="btn sm" data-testid="add-visit" onClick={() => { if (newVisit) { setF({ ...f, visitText: [...visits, newVisit].join(', ') }); setNewVisit(''); } }}>Add</button></div></Field>
      <Field label="Visit dates (YYYY-MM-DD, comma separated)" full><Input name="visits" value={f.visitText} onValue={v => setF({ ...f, visitText: v })} /></Field>
      <Field label="Notes" full><textarea value={f.notes || ''} onInput={e => setF({ ...f, notes: (e.target as HTMLTextAreaElement).value })} /></Field>
      <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save plan</button></div>
      {ex && <button type="button" class="btn danger ghost block" onClick={async () => { if (await ask('Delete this plan?', { danger: true, okText: 'Delete' })) { await voidRecord('plans', ex.id, '', 'plan'); await refresh(); go('/plans'); } }}>Delete plan</button>}
    </form>
    {ex && <Card title="Correction history"><AuditTrail filter={a => a.entityId === ex.id} /></Card>}
  </Page>;
}

const TS: TaskStatus[] = ['Open', 'In progress', 'Waiting', 'Done', 'Cancelled'];
export function TasksScreen() {
  const s = useStore();
  const [st, setSt] = useState<'Active' | 'Due' | 'Done' | 'All'>('Active');
  const ts = s.data.tasks.filter(t => !t.deleted && (st === 'All' || (st === 'Done' ? ['Done', 'Cancelled'].includes(t.status) : !['Done', 'Cancelled'].includes(t.status) && (st === 'Active' || t.dueDate <= s.today)))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return <Page title="Follow-up tasks" back="/more" actions={<a class="btn sm primary" href="#/task-form" data-testid="new-task">+ Task</a>}>
    <Chips value={st} options={['Active', 'Due', 'Done', 'All']} onValue={setSt} testid="task-filter" />
    {ts.length ? <div class="list">{ts.map(t => <a class="list-row" href={'#/task-form/' + t.id} data-testid="task-row"><div class="grow"><b>{t.title}</b><div class="muted small">{fmtDate(t.dueDate)} · {t.customerId ? custName(s, t.customerId) : 'General'} · {t.priority}{t.updates.length ? ` · ${t.updates.length} update(s)` : ''}</div></div><Badge s={t.dueDate < s.today && !['Done', 'Cancelled'].includes(t.status) ? 'Overdue' : t.status} tone={t.status === 'Done' ? 'ok' : undefined} /></a>)}</div> : <Empty>No tasks.</Empty>}
  </Page>;
}
export function TaskForm({ id }: { id?: string }) {
  const s = useStore();
  const ex = id ? s.data.tasks.find(t => t.id === id) : undefined;
  const [f, setF] = useState<any>(ex ? { ...ex } : { title: '', customerId: qp('customer'), invoiceId: qp('invoice'), dueDate: addDays(todayISO(), 1), priority: 'Normal', status: 'Open', updates: [] });
  const [upd, setUpd] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const save = async () => {
    const e: string[] = [];
    if (!f.title?.trim()) e.push('Title is required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.dueDate || '')) e.push('Due date is required.');
    setErrors(e); if (e.length) return;
    const ts = new Date().toISOString();
    const updates = [...(f.updates || [])];
    if (!ex) updates.push({ ts, text: 'Task created', status: f.status });
    else if (ex.status !== f.status) updates.push({ ts, text: `Status ${ex.status} → ${f.status}${upd ? ': ' + upd : ''}`, status: f.status });
    if (upd && (!ex || ex.status === f.status)) updates.push({ ts, text: upd });
    const nid = await saveRecord('tasks', { ...f, title: f.title.trim(), customerId: f.customerId || undefined, invoiceId: f.invoiceId || undefined, updates } as any, 'task ' + f.title.trim());
    await refresh(); toast('Task saved'); go(ex ? '/task-form/' + nid : '/tasks');
  };
  return <Page title={ex ? 'Task' : 'New task'} back="/tasks">
    <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
      <Errors errors={errors} />
      <Field label="Title *" full><Input name="title" value={f.title} onValue={v => setF({ ...f, title: v })} /></Field>
      <Field label="Customer"><Select name="customerId" aria-label="Task customer" value={f.customerId} onValue={v => setF({ ...f, customerId: v, invoiceId: '' })} placeholder="General" options={s.data.customers.filter(c => !c.deleted).map(c => [c.id, c.name])} /></Field>
      <Field label="Invoice"><Select name="invoiceId" aria-label="Task invoice" value={f.invoiceId} onValue={v => setF({ ...f, invoiceId: v })} placeholder="None" options={s.data.invoices.filter(i => !i.deleted && i.customerId === f.customerId).map(i => [i.id, i.invoiceNo])} /></Field>
      <Field label="Due date *"><Input type="date" name="dueDate" value={f.dueDate} onValue={v => setF({ ...f, dueDate: v })} /></Field>
      <Field label="Priority"><Select name="priority" aria-label="Priority" value={f.priority} onValue={v => setF({ ...f, priority: v })} options={['Low', 'Normal', 'High']} /></Field>
      <Field label="Status"><Select name="status" aria-label="Task status" value={f.status} onValue={v => setF({ ...f, status: v })} options={TS} /></Field>
      <Field label={ex ? 'Add an update' : 'First note'} full><textarea data-testid="task-update" value={upd} onInput={e => setUpd((e.target as HTMLTextAreaElement).value)} /></Field>
      <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save task</button></div>
    </form>
    {ex && <Card title="Update history" testid="task-history">{[...ex.updates].reverse().map(u => <div class="list-row"><div class="grow small">{u.text}<div class="muted">{new Date(u.ts).toLocaleString('en-GB')}</div></div>{u.status && <Badge s={u.status} />}</div>)}</Card>}
    {ex && <button type="button" class="btn danger ghost block" onClick={async () => { if (await ask('Delete this task?', { danger: true, okText: 'Delete' })) { await voidRecord('tasks', ex.id, '', 'task'); await refresh(); go('/tasks'); } }}>Delete task</button>}
    {ex && <Card title="Correction history"><AuditTrail filter={a => a.entityId === ex.id} /></Card>}
  </Page>;
}

export function useAlerts() {
  const s = useStore();
  const al = computeAlerts(s.data, s.settings, s.today);
  return { alerts: al, badge: badgeCount(al) };
}
export function AlertCenter() {
  const s = useStore();
  const { alerts, badge } = useAlerts();
  const [perm, setPerm] = useState(notificationsSupported() ? Notification.permission : 'unsupported');
  const groups: Record<string, Alert[]> = { overdue: [], today: [], upcoming: [] };
  alerts.forEach(a => groups[a.when].push(a));
  const exportIcs = async () => {
    const ev = calendarEvents(s.data, s.today);
    await saveFile(`my-sales-desk-reminders-${s.today}.ics`, buildICS(ev), 'text/calendar;charset=utf-8');
    toast(`${ev.length} reminders exported – open the file to add them to your calendar`);
  };
  return <Page title="Alerts" sub={`${badge} need action today`} back="/">
    <Card title="Reminders on your phone">
      <p class="small">In-app alerts below always work offline. <b>Phone notifications</b> are best-effort: shown when you open the app (iPhone: only after “Add to Home Screen”, iOS 16.4+). There is no server, so nothing can be pushed while the app is closed – export the calendar file to get reliable reminders from your Calendar app.</p>
      <div class="row gap">
        <button class="btn" data-testid="enable-notif" disabled={perm === 'unsupported' || perm === 'granted'} onClick={async () => { const p = await enableNotifications(); setPerm(p as any); if (p === 'granted') await notifyAlerts(alerts); }}>{perm === 'granted' ? 'Notifications on' : perm === 'unsupported' ? 'Not supported here' : perm === 'denied' ? 'Blocked in settings' : 'Enable notifications'}</button>
        <button class="btn primary" data-testid="export-ics" onClick={exportIcs}>Export calendar (.ics)</button>
      </div>
    </Card>
    {alerts.length === 0 && <Empty>Nothing due. 🎉</Empty>}
    {(['overdue', 'today', 'upcoming'] as const).map(w => groups[w].length > 0 && <Card title={w === 'overdue' ? 'Overdue' : w === 'today' ? 'Today' : `Next ${s.settings.upcomingDays} days`} testid={'alerts-' + w}>
      {w === 'overdue' && groups.overdue.filter(a => a.kind === 'overdue').length > 0 && <Warn>{groups.overdue.filter(a => a.kind === 'overdue').length} overdue invoice(s) – see Follow ups for the full queue.</Warn>}
      {groups[w].filter(a => w !== 'overdue' || a.kind !== 'overdue').concat(w === 'overdue' ? groups.overdue.filter(a => a.kind === 'overdue').slice(0, 5) : []).map(a => <a class="list-row" href={a.link} data-testid={'alert-' + a.kind}><div class="grow"><b>{a.title}</b><div class="muted small">{KIND_LABEL[a.kind]} · {fmtDate(a.date)}{a.sub ? ' · ' + a.sub : ''}</div></div><span class="chev">›</span></a>)}
    </Card>)}
  </Page>;
}
export { invNo, num };
