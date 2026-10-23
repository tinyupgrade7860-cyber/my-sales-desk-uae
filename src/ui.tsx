import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { money, num, monthLabel } from './util';
import { back } from './router';

export function Page(props: { title: string; back?: boolean | string; actions?: ComponentChildren; children: ComponentChildren; sub?: string }) {
  return (
    <div class="page">
      <header class="topbar">
        {props.back ? <button class="icon-btn" aria-label="Back" onClick={() => back(typeof props.back === 'string' ? props.back : '/')}>‹</button> : <span class="brand-dot" />}
        <div class="topbar-title"><h1>{props.title}</h1>{props.sub && <div class="muted small">{props.sub}</div>}</div>
        <div class="topbar-actions">{props.actions}</div>
      </header>
      <main class="content">{props.children}</main>
    </div>
  );
}

export const Card = (p: { title?: ComponentChildren; children: ComponentChildren; class?: string; right?: ComponentChildren; testid?: string }) => (
  <section class={'card ' + (p.class || '')} data-testid={p.testid}>
    {(p.title || p.right) && <div class="card-head"><h2>{p.title}</h2>{p.right}</div>}
    {p.children}
  </section>
);

export const Stat = (p: { label: string; value: string; tone?: string; sub?: string; onClick?: () => void; testid?: string }) => (
  <button type="button" class={'stat ' + (p.tone || '')} onClick={p.onClick} data-testid={p.testid}>
    <span class="stat-label">{p.label}</span>
    <span class="stat-value">{p.value}</span>
    {p.sub && <span class="stat-sub">{p.sub}</span>}
  </button>
);

export const Money = (p: { v: number; cur?: string; class?: string }) => <span class={'money ' + (p.class || '') + (p.v < 0 ? ' neg' : '')}>{money(p.v, p.cur)}</span>;

const TONES: Record<string, string> = {
  Paid: 'ok', Clear: 'ok', Approved: 'ok', Accepted: 'ok', Matched: 'ok', Resolved: 'ok', Closed: 'muted', Applied: 'ok',
  'Partially Paid': 'warn', 'Partially Accepted': 'warn', Pending: 'warn', Claimed: 'warn', Promised: 'info', Open: 'info', Investigating: 'warn', Outstanding: 'info',
  Unpaid: 'info', Overdue: 'bad', Disputed: 'bad', Rejected: 'muted', Discrepancy: 'bad', Escalated: 'bad', 'Over-credited': 'bad', Credit: 'info', Voided: 'muted', 'Not applied': 'warn'
};
export const Badge = (p: { s: string; tone?: string }) => <span class={'badge ' + (p.tone || TONES[p.s] || 'muted')}>{p.s}</span>;

export function Field(p: { label: string; children: ComponentChildren; hint?: ComponentChildren; error?: string; full?: boolean }) {
  return (
    <label class={'field' + (p.full ? ' full' : '')}>
      <span class="field-label">{p.label}</span>
      {p.children}
      {p.hint && <span class="field-hint">{p.hint}</span>}
      {p.error && <span class="field-error">{p.error}</span>}
    </label>
  );
}

type InputP = { value: any; onValue: (v: string) => void; [k: string]: any };
export const Input = ({ value, onValue, ...rest }: InputP) => <input {...rest} value={value ?? ''} onInput={e => onValue((e.target as HTMLInputElement).value)} />;
export const MoneyInput = ({ value, onValue, ...rest }: InputP) => (
  <input {...rest} type="number" inputMode="decimal" step="0.01" min="0" value={value ?? ''} onInput={e => onValue((e.target as HTMLInputElement).value)} />
);
export function Select(p: { value: any; onValue: (v: string) => void; options: (string | [string, string])[]; placeholder?: string; name?: string; testid?: string; 'aria-label'?: string }) {
  return (
    <select name={p.name} data-testid={p.testid} aria-label={p['aria-label']} value={p.value ?? ''} onChange={e => p.onValue((e.target as HTMLSelectElement).value)}>
      {p.placeholder != null && <option value="">{p.placeholder}</option>}
      {p.options.map(o => Array.isArray(o) ? <option value={o[0]}>{o[1]}</option> : <option value={o}>{o}</option>)}
    </select>
  );
}

export const Errors = (p: { errors: string[] }) => p.errors.length ? (
  <div class="alert bad" role="alert" data-testid="form-errors"><strong>Please fix:</strong><ul>{p.errors.map(e => <li>{e}</li>)}</ul></div>
) : null;
export const Warn = (p: { children: ComponentChildren; testid?: string }) => <div class="alert warn" data-testid={p.testid}>{p.children}</div>;
export const Empty = (p: { children: ComponentChildren }) => <div class="empty">{p.children}</div>;

export function SearchBox(p: { value: string; onValue: (v: string) => void; placeholder?: string }) {
  return <input class="search" type="search" placeholder={p.placeholder || 'Search…'} value={p.value} onInput={e => p.onValue((e.target as HTMLInputElement).value)} aria-label="Search" />;
}

export function Chips<T extends string>(p: { value: T; options: T[]; onValue: (v: T) => void; testid?: string }) {
  return <div class="chips" data-testid={p.testid}>{p.options.map(o => <button type="button" class={'chip' + (o === p.value ? ' on' : '')} onClick={() => p.onValue(o)}>{o}</button>)}</div>;
}

// ---------- toast ----------
let toastFn: (m: string, tone?: string) => void = () => {};
export const toast = (m: string, tone = 'ok') => toastFn(m, tone);
export function ToastHost() {
  const [t, set] = useState<{ m: string; tone: string; k: number } | null>(null);
  useEffect(() => { toastFn = (m, tone = 'ok') => set({ m, tone, k: Date.now() }); }, []);
  useEffect(() => { if (!t) return; const h = setTimeout(() => set(null), 3200); return () => clearTimeout(h); }, [t]);
  return t ? <div class={'toast ' + t.tone} role="status" data-testid="toast">{t.m}</div> : null;
}

// ---------- confirm / prompt sheet ----------
let sheetFn: (o: SheetOpts) => void = () => {};
interface SheetOpts { title: string; body?: ComponentChildren; input?: string; okText?: string; danger?: boolean; resolve: (v: string | null) => void }
export const ask = (title: string, opts: { body?: ComponentChildren; input?: string; okText?: string; danger?: boolean } = {}) =>
  new Promise<string | null>(resolve => sheetFn({ title, ...opts, resolve }));
export function SheetHost() {
  const [o, set] = useState<SheetOpts | null>(null);
  const [val, setVal] = useState('');
  useEffect(() => { sheetFn = x => { setVal(''); set(x); }; }, []);
  if (!o) return null;
  const done = (v: string | null) => { o.resolve(v); set(null); };
  return (
    <div class="sheet-bg" onClick={() => done(null)}>
      <div class="sheet" role="dialog" aria-label={o.title} onClick={e => e.stopPropagation()}>
        <h3>{o.title}</h3>
        {o.body && <div class="sheet-body">{o.body}</div>}
        {o.input != null && <input data-testid="sheet-input" placeholder={o.input} value={val} onInput={e => setVal((e.target as HTMLInputElement).value)} />}
        <div class="row gap">
          <button class="btn ghost" onClick={() => done(null)}>Cancel</button>
          <button class={'btn ' + (o.danger ? 'danger' : 'primary')} data-testid="sheet-ok" onClick={() => done(val || 'ok')}>{o.okText || 'OK'}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- charts (pure SVG, offline) ----------
export function BarChart(p: { data: { label: string; a: number; b?: number }[]; aLabel: string; bLabel?: string; height?: number }) {
  const h = p.height || 170, w = 340, pad = 26;
  const max = Math.max(1, ...p.data.flatMap(d => [d.a, d.b || 0]));
  const bw = (w - pad) / Math.max(1, p.data.length);
  const y = (v: number) => h - 18 - (v / max) * (h - 30);
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="chart">
        {[0, 0.5, 1].map(f => <g><line x1={pad} x2={w} y1={y(max * f)} y2={y(max * f)} class="grid" /><text x={0} y={y(max * f) + 3} class="axis">{compact(max * f)}</text></g>)}
        {p.data.map((d, i) => {
          const x = pad + i * bw;
          const inner = p.bLabel ? bw * 0.38 : bw * 0.7;
          return <g>
            <rect x={x + bw * 0.1} y={y(d.a)} width={inner} height={h - 18 - y(d.a)} class="bar-a" rx="2"><title>{d.label}: {num(d.a)}</title></rect>
            {p.bLabel && <rect x={x + bw * 0.1 + inner + 1} y={y(d.b || 0)} width={inner} height={h - 18 - y(d.b || 0)} class="bar-b" rx="2"><title>{d.label}: {num(d.b || 0)}</title></rect>}
            {(p.data.length <= 12 || i % 2 === 0) && <text x={x + bw / 2} y={h - 4} class="axis" text-anchor="middle">{d.label}</text>}
          </g>;
        })}
      </svg>
      <div class="legend"><span><i class="bar-a" />{p.aLabel}</span>{p.bLabel && <span><i class="bar-b" />{p.bLabel}</span>}</div>
    </div>
  );
}
export const compact = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v.toFixed(0);
export const mLabel = monthLabel;

export function Donut(p: { parts: { label: string; value: number; cls: string }[] }) {
  const total = p.parts.reduce((a, x) => a + Math.max(0, x.value), 0) || 1;
  let acc = 0;
  const R = 40, C = 2 * Math.PI * R;
  return (
    <div class="donut-wrap">
      <svg viewBox="0 0 100 100" class="donut">
        {p.parts.map(x => { const len = (Math.max(0, x.value) / total) * C; const el = <circle r={R} cx="50" cy="50" class={x.cls} stroke-dasharray={`${len} ${C - len}`} stroke-dashoffset={-acc} />; acc += len; return el; })}
      </svg>
      <div class="legend col">{p.parts.map(x => <span><i class={x.cls} />{x.label}: {num(x.value)}</span>)}</div>
    </div>
  );
}
