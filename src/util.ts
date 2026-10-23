export const r2 = (n: number) => { const v = Number(n) || 0; return Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * 100) / 100; };
/** Sum in integer fils to avoid floating point drift. */
export const sum = (xs: number[]) => xs.reduce((a, b) => a + Math.round((Number(b) || 0) * 100), 0) / 100;
export const EPS = 0.005;

export function uid(prefix = ''): string {
  const c: any = (globalThis as any).crypto;
  const u = c?.randomUUID ? c.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  return prefix + u;
}

export const todayISO = () => toISODate(new Date());
export function toISODate(d: Date): string {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(s: string, n: number): string {
  const d = parseISO(s); d.setDate(d.getDate() + n); return toISODate(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}
export const isValidISODate = (s: any) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISODate(parseISO(s)) === s;

const fmt = new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number, cur = 'AED') => `${cur} ${fmt.format(r2(n))}`;
export const num = (n: number) => fmt.format(r2(n));
export const fmtDate = (s?: string) => {
  if (!s) return '';
  const d = parseISO(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const monthKey = (s: string) => s.slice(0, 7);
export const monthLabel = (k: string) => {
  const [y, m] = k.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};
export function quarterKey(s: string) { const d = parseISO(s); return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`; }
export function yearKey(s: string) { return s.slice(0, 4); }
/** ISO week key: YYYY-Www */
export function weekKey(s: string) {
  const d = parseISO(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}
export const norm = (s?: string) => (s || '').trim().toLowerCase();
