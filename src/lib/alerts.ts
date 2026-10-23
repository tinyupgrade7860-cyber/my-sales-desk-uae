/** In-app alert centre (pure) + optional Web Notifications + .ics calendar export. */
import type { DataSet, Settings } from '../types';
import { calcAllInvoices } from '../calc';
import { addDays, todayISO, EPS, money } from '../util';

export type AlertKind = 'due-today' | 'overdue' | 'promise' | 'visit' | 'task' | 'followup' | 'claim' | 'document';
export interface Alert { key: string; kind: AlertKind; when: 'overdue' | 'today' | 'upcoming'; date: string; title: string; sub?: string; link: string }
export const KIND_LABEL: Record<AlertKind, string> = {
  'due-today': 'Invoices due today', overdue: 'Overdue invoices', promise: 'Promised payments', visit: 'Customer visits', task: 'Tasks',
  followup: 'Follow-up calls due', claim: 'Expense claims awaiting payment', document: 'Documents expiring'
};
const live = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter(x => !x.deleted);

export function computeAlerts(ds: DataSet, settings: Pick<Settings, 'upcomingDays' | 'currency'>, today = todayISO()): Alert[] {
  const up = addDays(today, settings.upcomingDays);
  const cur = settings.currency;
  const cn = (id?: string) => ds.customers.find(c => c.id === id)?.name || '';
  const when = (d: string) => (d < today ? 'overdue' : d === today ? 'today' : 'upcoming') as Alert['when'];
  const out: Alert[] = [];
  const { map } = calcAllInvoices(ds, today);
  for (const c of map.values()) {
    if (c.remaining <= EPS) continue;
    if (c.invoice.dueDate === today) out.push({ key: 'due:' + c.invoice.id, kind: 'due-today', when: 'today', date: today, title: `${c.invoice.invoiceNo} due today`, sub: `${cn(c.invoice.customerId)} · ${money(c.remaining, cur)}`, link: '#/invoices/' + c.invoice.id });
    else if (c.overdue) out.push({ key: 'od:' + c.invoice.id, kind: 'overdue', when: 'overdue', date: c.invoice.dueDate, title: `${c.invoice.invoiceNo} · ${c.daysOverdue} days overdue`, sub: `${cn(c.invoice.customerId)} · ${money(c.remaining, cur)}`, link: '#/invoices/' + c.invoice.id });
  }
  for (const f of live(ds.followUps)) {
    if (f.status === 'Promised' && f.promisedDate && f.promisedDate <= up) out.push({ key: 'pr:' + f.id + f.promisedDate, kind: 'promise', when: when(f.promisedDate), date: f.promisedDate, title: `Payment promised${f.promisedAmount ? ' ' + money(f.promisedAmount, cur) : ''}`, sub: cn(f.customerId), link: '#/followup-form/' + f.id });
    if (['Open', 'Promised', 'Escalated'].includes(f.status) && f.nextContactDate && f.nextContactDate <= today) out.push({ key: 'fu:' + f.id + f.nextContactDate, kind: 'followup', when: when(f.nextContactDate), date: f.nextContactDate, title: `Call ${cn(f.customerId)}`, sub: f.notes, link: '#/followup-form/' + f.id });
  }
  for (const p of live(ds.plans)) for (const d of p.visitDates) {
    if (p.visitsDone.includes(d) || d > up || d < addDays(today, -14)) continue;
    out.push({ key: 'vi:' + p.id + d, kind: 'visit', when: when(d), date: d, title: `Visit ${cn(p.customerId)}`, sub: d < today ? 'Planned visit not marked done' : 'Planned visit', link: '#/plan-form/' + p.id });
  }
  for (const t of live(ds.tasks)) {
    if (t.status === 'Done' || t.status === 'Cancelled' || t.dueDate > up) continue;
    out.push({ key: 'ta:' + t.id + t.dueDate, kind: 'task', when: when(t.dueDate), date: t.dueDate, title: t.title, sub: [cn(t.customerId), t.status, t.priority === 'High' ? 'High priority' : ''].filter(Boolean).join(' · '), link: '#/task-form/' + t.id });
  }
  for (const j of live(ds.jobRecords)) {
    if (j.category === 'Expense claim' && (j.claimStatus === 'Submitted' || j.claimStatus === 'Approved') && j.date <= addDays(today, -30))
      out.push({ key: 'cl:' + j.id, kind: 'claim', when: 'overdue', date: j.date, title: `Claim not reimbursed: ${j.description}`, sub: `${money(j.amount - (j.reimbursedAmount || 0), cur)} · ${j.claimStatus} since ${j.date}`, link: '#/job-form/' + j.id });
    if (j.category === 'Document expiry' && j.expiryDate && j.expiryDate <= addDays(today, 60))
      out.push({ key: 'doc:' + j.id + j.expiryDate, kind: 'document', when: j.expiryDate < today ? 'overdue' : j.expiryDate <= addDays(today, 30) ? 'today' : 'upcoming', date: j.expiryDate, title: `${j.description} ${j.expiryDate < today ? 'expired' : 'expires'} ${j.expiryDate}`, sub: j.docNumber, link: '#/job-form/' + j.id });
  }
  const order = { overdue: 0, today: 1, upcoming: 2 };
  return out.sort((a, b) => order[a.when] - order[b.when] || a.date.localeCompare(b.date));
}
/** Badge = things needing action now (today/overdue), except plain overdue invoices which are summarised separately. */
export const badgeCount = (alerts: Alert[]) => alerts.filter(a => a.kind !== 'overdue' && a.when !== 'upcoming').length;

// ---------- Web Notifications (best effort, foreground only) ----------
export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export async function enableNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.requestPermission();
}
/** Show at most one summary notification per day per new alert set, while the app is open/foregrounded. */
export async function notifyAlerts(alerts: Alert[], today = todayISO()) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  const due = alerts.filter(a => a.when !== 'upcoming' && a.kind !== 'overdue');
  if (!due.length) return false;
  const k = 'msd-notified-' + today;
  const seen = new Set<string>(JSON.parse(localStorage.getItem(k) || '[]'));
  const fresh = due.filter(a => !seen.has(a.key));
  if (!fresh.length) return false;
  const body = fresh.slice(0, 4).map(a => '• ' + a.title).join('\n') + (fresh.length > 4 ? `\n+${fresh.length - 4} more` : '');
  const title = `My Sales Desk: ${fresh.length} item(s) need attention`;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag: 'msd-daily', icon: './icons/icon-192.png' });
    else new Notification(title, { body, tag: 'msd-daily' });
  } catch { return false; }
  localStorage.setItem(k, JSON.stringify([...seen, ...fresh.map(a => a.key)]));
  return true;
}

// ---------- iCalendar (.ics) export: lets the iPhone Calendar do the reminding ----------
export interface CalEvent { uid: string; date: string; title: string; description?: string; alarmHour?: number }
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => { const out: string[] = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
export function buildICS(events: CalEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//My Sales Desk UAE//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:My Sales Desk'];
  for (const e of events) {
    const d = e.date.replace(/-/g, '');
    const next = new Date(Date.UTC(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@my-sales-desk-uae`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, fold(`SUMMARY:${esc(e.title)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`));
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${esc(e.title)}`), `TRIGGER;RELATED=START:PT${e.alarmHour ?? 9}H`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
export function calendarEvents(ds: DataSet, today = todayISO(), kinds: ('followups' | 'visits' | 'tasks' | 'documents')[] = ['followups', 'visits', 'tasks', 'documents']): CalEvent[] {
  const cn = (id?: string) => ds.customers.find(c => c.id === id)?.name || '';
  const ev: CalEvent[] = [];
  const from = addDays(today, -1);
  if (kinds.includes('followups')) for (const f of live(ds.followUps)) {
    if (!['Open', 'Promised', 'Escalated'].includes(f.status)) continue;
    if (f.nextContactDate && f.nextContactDate >= from) ev.push({ uid: 'fu-' + f.id, date: f.nextContactDate, title: `Follow up: ${cn(f.customerId)}`, description: f.notes });
    if (f.promisedDate && f.promisedDate >= from) ev.push({ uid: 'pr-' + f.id, date: f.promisedDate, title: `Payment promised: ${cn(f.customerId)}${f.promisedAmount ? ' (' + f.promisedAmount.toFixed(2) + ')' : ''}` });
  }
  if (kinds.includes('visits')) for (const p of live(ds.plans)) for (const d of p.visitDates) if (d >= from && !p.visitsDone.includes(d)) ev.push({ uid: `vi-${p.id}-${d}`, date: d, title: `Visit: ${cn(p.customerId)}`, description: `Plan ${p.month}: sales ${p.plannedSales.toFixed(2)}, collection ${p.plannedCollection.toFixed(2)}`, alarmHour: 8 });
  if (kinds.includes('tasks')) for (const t of live(ds.tasks)) if (t.status !== 'Done' && t.status !== 'Cancelled' && t.dueDate >= from) ev.push({ uid: 'ta-' + t.id, date: t.dueDate, title: `Task: ${t.title}`, description: [cn(t.customerId), t.notes].filter(Boolean).join(' - ') });
  if (kinds.includes('documents')) for (const j of live(ds.jobRecords)) if (j.category === 'Document expiry' && j.expiryDate && j.expiryDate >= from) {
    ev.push({ uid: 'doc-' + j.id, date: j.expiryDate, title: `${j.description} expires` });
    const warn = addDays(j.expiryDate, -30);
    if (warn >= from) ev.push({ uid: 'docw-' + j.id, date: warn, title: `Renew soon: ${j.description} (expires ${j.expiryDate})` });
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}
