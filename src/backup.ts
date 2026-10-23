/** Backup format, validation and CSV helpers (pure, unit tested). */
import type { DataSet, TableName, AuditEntry, Settings } from './types';
import { TABLES, V1_TABLES } from './types';
import { isValidISODate } from './util';

export const APP_ID = 'my-sales-desk-uae';
export const SCHEMA_VERSION = 2;

export interface BackupFile {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  counts: Record<string, number>;
  checksum: string;
  data: DataSet & { auditLog: AuditEntry[]; settings: Settings[] };
}

/** FNV-1a 32-bit hash over a stable JSON string - detects truncated / edited files. */
export function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}

export function makeBackup(data: BackupFile['data'], now = new Date().toISOString()): BackupFile {
  const counts: Record<string, number> = {};
  for (const t of [...TABLES, 'auditLog', 'settings'] as const) counts[t] = (data as any)[t].length;
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: now, counts, checksum: checksum(JSON.stringify(data)), data };
}

const REQUIRED: Record<TableName, { str?: string[]; num?: string[]; date?: string[]; ref?: [string, TableName, boolean][] }> = {
  customers: { str: ['name', 'code'], num: ['paymentTermsDays'] },
  invoices: { str: ['invoiceNo'], num: ['netAmount', 'vatAmount', 'grossAmount'], date: ['invoiceDate', 'dueDate'], ref: [['customerId', 'customers', true]] },
  collections: { str: ['receiptRef'], num: ['amount'], date: ['date'], ref: [['customerId', 'customers', true]] },
  allocations: { num: ['amount'], ref: [['collectionId', 'collections', true], ['invoiceId', 'invoices', true]] },
  grvs: { str: ['grvRef', 'status'], num: ['amount'], date: ['date'], ref: [['customerId', 'customers', true], ['invoiceId', 'invoices', false]] },
  creditNotes: { str: ['cnRef', 'status'], num: ['amount'], date: ['date'], ref: [['customerId', 'customers', true], ['invoiceId', 'invoices', false], ['grvId', 'grvs', false]] },
  deductions: { str: ['ref', 'status'], num: ['claimedAmount', 'acceptedAmount'], date: ['date'], ref: [['customerId', 'customers', true], ['invoiceId', 'invoices', false]] },
  statements: { str: ['status'], num: ['statementBalance', 'recordedBalance', 'difference'], date: ['statementDate'], ref: [['customerId', 'customers', true]] },
  followUps: { str: ['status'], date: ['contactDate'], ref: [['customerId', 'customers', true], ['invoiceId', 'invoices', false]] },
  importBatches: { str: ['fileName', 'status'], num: ['rowCount'], date: ['statementDate'] },
  statementLines: { str: ['invoiceNo'], num: ['grandTotal', 'receivedAmount', 'balance', 'appBalance', 'difference'], date: ['billingDate'], ref: [['batchId', 'importBatches', true], ['customerId', 'customers', true], ['invoiceId', 'invoices', false], ['statementId', 'statements', false]] },
  targets: { num: ['salesTarget', 'collectionTarget'], ref: [['customerId', 'customers', false]] },
  salesEntries: { num: ['amount'], date: ['date'], ref: [['customerId', 'customers', false]] },
  plans: { num: ['plannedSales', 'plannedCollection'], ref: [['customerId', 'customers', true]] },
  tasks: { str: ['title', 'status'], date: ['dueDate'], ref: [['customerId', 'customers', false], ['invoiceId', 'invoices', false]] },
  jobRecords: { str: ['category', 'direction'], num: ['amount'], date: ['date'], ref: [['customerId', 'customers', false]] }
};
const MONTH_FIELDS: Partial<Record<TableName, string>> = { targets: 'month', plans: 'month' };

export interface ValidationResult { ok: boolean; errors: string[]; warnings: string[]; counts: Record<string, number> }

export function validateBackup(obj: any): ValidationResult {
  const errors: string[] = [], warnings: string[] = [], counts: Record<string, number> = {};
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['File is not a JSON object.'], warnings, counts };
  if (obj.app !== APP_ID) errors.push(`Not a My Sales Desk UAE backup (app = ${JSON.stringify(obj.app)}).`);
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion > SCHEMA_VERSION) errors.push(`Unsupported schema version ${obj.schemaVersion}.`);
  const data = obj.data;
  if (!data || typeof data !== 'object') { errors.push('Missing "data" section.'); return { ok: false, errors, warnings, counts }; }
  const computed = checksum(JSON.stringify(data)); // before any normalisation below
  const ids: Record<string, Set<string>> = {};
  for (const t of TABLES) {
    if (data[t] == null && !V1_TABLES.includes(t) && obj.schemaVersion < 2) { data[t] = []; warnings.push(`Version ${obj.schemaVersion} backup has no "${t}" table - it will be empty.`); }
    if (!Array.isArray(data[t])) { errors.push(`Table "${t}" is missing or not a list.`); ids[t] = new Set(); continue; }
    counts[t] = data[t].length;
    ids[t] = new Set();
    for (const r of data[t]) {
      if (!r || typeof r.id !== 'string' || !r.id) { errors.push(`${t}: record without a valid id.`); continue; }
      if (ids[t].has(r.id)) errors.push(`${t}: duplicate id ${r.id}.`);
      ids[t].add(r.id);
    }
  }
  if (errors.length) return { ok: false, errors, warnings, counts };
  for (const t of TABLES) {
    const spec = REQUIRED[t];
    for (const r of data[t]) {
      const where = `${t}[${r.id}]`;
      for (const f of spec.str || []) if (typeof r[f] !== 'string' || !r[f].trim()) errors.push(`${where}: "${f}" is required.`);
      for (const f of spec.num || []) if (typeof r[f] !== 'number' || !isFinite(r[f])) errors.push(`${where}: "${f}" must be a number.`);
      for (const f of spec.date || []) if (!isValidISODate(r[f])) errors.push(`${where}: "${f}" must be a date YYYY-MM-DD.`);
      const mf = MONTH_FIELDS[t];
      if (mf && !/^\d{4}-(0[1-9]|1[0-2])$/.test(r[mf] || '')) errors.push(`${where}: "${mf}" must be a month YYYY-MM.`);
      for (const [f, target, req] of spec.ref || []) {
        if (r[f] == null || r[f] === '') { if (req) errors.push(`${where}: "${f}" is required.`); continue; }
        if (!ids[target].has(r[f])) errors.push(`${where}: "${f}" points to a missing ${target} record (${r[f]}).`);
      }
      if (errors.length > 50) { errors.push('Too many errors - stopped checking.'); return { ok: false, errors, warnings, counts }; }
    }
  }
  if (!Array.isArray(data.auditLog)) warnings.push('No correction history in file (auditLog missing) - history will be empty.');
  if (!Array.isArray(data.settings)) warnings.push('No settings in file - defaults will be used.');
  if (obj.checksum) {
    const c = computed;
    if (c !== obj.checksum) errors.push(`Checksum mismatch (file ${obj.checksum}, computed ${c}) - the file was modified or is incomplete.`);
  } else warnings.push('Backup has no checksum - integrity cannot be confirmed.');
  return { ok: errors.length === 0, errors, warnings, counts };
}

// ---------- CSV ----------
export function csvCell(v: any): string {
  if (v == null) return '';
  let s = typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  if (/^[=+\-@]/.test(s) && typeof v !== 'number') s = "'" + s; // prevent CSV formula injection in Excel
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(rows: any[], columns?: { key: string; label?: string; get?: (r: any) => any }[]): string {
  const cols: { key: string; label?: string; get?: (r: any) => any }[] = columns || [...new Set(rows.flatMap(r => Object.keys(r)))].map(k => ({ key: k }));
  const head = cols.map(c => csvCell(c.label || c.key)).join(',');
  const body = rows.map(r => cols.map(c => csvCell(c.get ? c.get(r) : r[c.key])).join(','));
  return '\uFEFF' + [head, ...body].join('\r\n') + '\r\n';
}
