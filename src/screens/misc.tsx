import { useEffect, useState } from 'preact/hooks';
import { useStore, refresh } from '../store';
import { Page, Card, Field, Input, Empty, Errors, toast, SearchBox } from '../ui';
import { db, saveSettings } from '../db';
import type { AuditEntry } from '../types';
import { norm, isValidISODate } from '../util';
import { computeAlerts, badgeCount, enableNotifications } from '../lib/alerts';

export function AuditTrail({ filter, limit = 50 }: { filter?: (e: AuditEntry) => boolean; limit?: number }) {
  const s = useStore();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  useEffect(() => { db.auditLog.orderBy('ts').reverse().toArray().then(all => setRows((filter ? all.filter(filter) : all).slice(0, limit))); }, [s.version]);
  if (!rows) return <p class="muted small">Loading…</p>;
  if (!rows.length) return <Empty>No history.</Empty>;
  return <ul class="audit" data-testid="audit">{rows.map(r => (
    <li><span class={'dot ' + r.action} /><div><div class="small"><b>{r.summary}</b></div>
      <div class="muted small">{new Date(r.ts).toLocaleString('en-GB')} · {r.action}</div>
      {r.action === 'update' && r.before && <div class="small diff">{Object.keys(r.after || {}).map(k => <div><code>{k}</code>: {fmt(r.before[k])} → <b>{fmt(r.after[k])}</b></div>)}</div>}
    </div></li>))}</ul>;
}
const fmt = (v: any) => v === undefined || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v);

export function HistoryScreen() {
  const [q, setQ] = useState('');
  return <Page title="Correction history" back="/more">
    <p class="muted small">Every create, edit, void and restore is logged with the before/after values. Records are never hard-deleted.</p>
    <SearchBox value={q} onValue={setQ} placeholder="Filter history…" />
    <Card><AuditTrail filter={q ? e => norm(e.summary + ' ' + e.entity).includes(norm(q)) : undefined} limit={300} /></Card>
  </Page>;
}

export function SettingsScreen() {
  const s = useStore();
  const [f, setF] = useState<any>({ ...s.settings });
  const [errors, setErrors] = useState<string[]>([]);
  const save = async () => {
    const e: string[] = [];
    const vat = Number(f.defaultVatRate);
    if (!(vat >= 0 && vat <= 100)) e.push('VAT rate must be between 0 and 100.');
    if (!(Number(f.defaultTermsDays) >= 0)) e.push('Default terms must be 0 or more.');
    if (!(Number(f.upcomingDays) >= 1)) e.push('Alert window must be at least 1 day.');
    if (!/^[A-Z]{3}$/.test(f.currency)) e.push('Currency must be a 3-letter code, e.g. AED.');
    if (!(f.companyName || '').trim()) e.push('Company name is required (used on statements).');
    if (!isValidISODate(f.jobStartDate)) e.push('Job start date must be a valid date.');
    setErrors(e); if (e.length) return;
    await saveSettings({ ...f, defaultVatRate: vat, defaultTermsDays: Number(f.defaultTermsDays), upcomingDays: Number(f.upcomingDays), companyName: f.companyName.trim() });
    await refresh(); toast('Settings saved');
  };
  return <Page title="Settings" back="/more">
    <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
      <Errors errors={errors} />
      <Field label="Default VAT rate %" hint="UAE standard rate is 5%. Applies to new invoices; each invoice keeps its own rate."><Input name="vat" type="number" step="0.01" value={f.defaultVatRate} onValue={v => setF({ ...f, defaultVatRate: v })} /></Field>
      <Field label="Currency code"><Input name="currency" value={f.currency} onValue={v => setF({ ...f, currency: v.toUpperCase() })} maxLength={3} /></Field>
      <Field label="Default payment terms (days)"><Input name="terms" type="number" value={f.defaultTermsDays} onValue={v => setF({ ...f, defaultTermsDays: v })} /></Field>
      <Field label="Upcoming alert window (days)"><Input name="upcoming" type="number" value={f.upcomingDays} onValue={v => setF({ ...f, upcomingDays: v })} /></Field>
      <Field label="Your name (for PDF headers)" full><Input name="owner" value={f.ownerName} onValue={v => setF({ ...f, ownerName: v })} /></Field>
      <Field label="Company name (statements, My Job)" full><Input name="companyName" value={f.companyName} onValue={v => setF({ ...f, companyName: v })} /></Field>
      <Field label="My job start date"><Input name="jobStartDate" type="date" value={f.jobStartDate} onValue={v => setF({ ...f, jobStartDate: v })} /></Field>
      <Field label="Sales value basis for targets"><select name="salesBasis" value={f.salesBasis} onChange={e => setF({ ...f, salesBasis: (e.target as HTMLSelectElement).value })}><option value="net">Net (excl. VAT)</option><option value="gross">Gross (incl. VAT)</option></select></Field>
      <Field label="Phone notifications" hint="Best effort, only while the app is open (iPhone: Home Screen app, iOS 16.4+). Use Alerts › Export calendar for reliable reminders."><label class="inline"><input type="checkbox" name="notifications" checked={!!f.notifications} onChange={async e => { const on = (e.target as HTMLInputElement).checked; if (on) { const p = await enableNotifications(); if (p !== 'granted') toast(p === 'unsupported' ? 'Notifications are not supported in this browser' : 'Permission not granted', 'bad'); } setF({ ...f, notifications: on }); }} /> Notify me about due items when I open the app</label></Field>
      <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save settings</button></div>
    </form>
  </Page>;
}

const SECTIONS: [string, string[][]][] = [
  ['Today', [['/alerts', 'Alerts', 'Due today, overdue, promises, visits', '🔔'], ['/followups', 'Follow ups', 'Overdue, promises, contacts', '☎︎'], ['/tasks', 'Tasks', 'Follow-up tasks with update history', '✔︎']]],
  ['Sales & planning', [['/performance', 'Targets & performance', 'Achievement, run-rate, MoM / YoY', '◎'], ['/plans', 'Monthly plan', 'Planned sales, collection, visits', '▦'], ['/targets', 'Monthly targets', 'Overall and per customer', '⊕'], ['/sales-entries', 'Manual sales entries', 'Sales value not invoiced here', '+']]],
  ['Statements', [['/import', 'Import statement file', 'Excel / CSV / PDF upload', '⇧'], ['/imports', 'Import history', 'Batches, reconciliation, undo', '☷'], ['/statements', 'Customer statements', 'Excel / PDF, single or bulk', '▤'], ['/recon', 'Statement reconciliation', 'Compare with customer SOA', '⚖︎']]],
  ['Returns & adjustments', [['/grvs', 'GRVs', 'Goods return vouchers', '↩︎'], ['/credit-notes', 'Credit notes', 'Approval & applied status', '✎'], ['/deductions', 'Deductions', 'Claims, disputes, accepted', '−']]],
  ['Me', [['/job', 'My Job', 'Salary, claims, kitha, leave, documents', '☻']]],
  ['Data', [['/reports', 'Reports', 'Periods, ageing, 2-year', '▥'], ['/search', 'Search & filters', 'Across all records', '⌕'], ['/data', 'Backup & data', 'Export / restore / CSV', '⇪'], ['/history', 'Correction history', 'Audit trail of changes', '⟲'], ['/settings', 'Settings', 'Company, VAT, alerts', '⚙︎']]]
];
export function MoreScreen() {
  const s = useStore();
  const badge = badgeCount(computeAlerts(s.data, s.settings, s.today));
  return <Page title="More">
    {SECTIONS.map(([h, items]) => <><div class="menu-head">{h}</div><div class="menu">{items.map(([p, t, sub, ic]) => <a class="menu-item" href={'#' + p} data-testid={'menu-' + p.slice(1)}><span class="menu-ic">{ic}</span><span class="grow"><b>{t}</b><span class="muted small">{sub}</span></span>{p === '/alerts' && badge > 0 && <span class="badge bad" data-testid="menu-alert-count">{badge}</span>}<span class="chev">›</span></a>)}</div></>)}
    <p class="muted small center">My Sales Desk UAE v2.0 · data stored locally on this device · {s.data.customers.length} customers</p>
  </Page>;
}
