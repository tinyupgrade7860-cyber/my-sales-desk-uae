import Dexie, { type Table } from 'dexie';
import type { AuditEntry, DataSet, Settings, TableName, Allocation, Collection } from './types';
import { TABLES } from './types';
import { uid } from './util';
import { makeBackup, validateBackup, type BackupFile } from './backup';

export class SalesDB extends Dexie {
  customers!: Table<any, string>;
  invoices!: Table<any, string>;
  collections!: Table<any, string>;
  allocations!: Table<any, string>;
  grvs!: Table<any, string>;
  creditNotes!: Table<any, string>;
  deductions!: Table<any, string>;
  statements!: Table<any, string>;
  followUps!: Table<any, string>;
  importBatches!: Table<any, string>;
  statementLines!: Table<any, string>;
  targets!: Table<any, string>;
  salesEntries!: Table<any, string>;
  plans!: Table<any, string>;
  tasks!: Table<any, string>;
  jobRecords!: Table<any, string>;
  auditLog!: Table<AuditEntry, string>;
  settings!: Table<Settings, string>;
  constructor(name = 'my-sales-desk-uae') {
    super(name);
    this.version(1).stores({
      customers: 'id, code, name, updatedAt',
      invoices: 'id, invoiceNo, customerId, invoiceDate, dueDate',
      collections: 'id, receiptRef, customerId, date',
      allocations: 'id, collectionId, invoiceId',
      grvs: 'id, grvRef, customerId, invoiceId, date, status',
      creditNotes: 'id, cnRef, customerId, invoiceId, grvId, date, status',
      deductions: 'id, ref, customerId, invoiceId, date, status',
      statements: 'id, customerId, statementDate, status',
      followUps: 'id, customerId, invoiceId, nextContactDate, status',
      auditLog: 'id, ts, entity, entityId',
      settings: 'id'
    });
    // v2 (app 2.0): statement import, targets, planning, tasks, My Job. Existing tables are untouched,
    // so all v1 data survives; the upgrade only adds tables/indexes and fills new settings defaults.
    this.version(2).stores({
      invoices: 'id, invoiceNo, customerId, invoiceDate, dueDate, salesman, importBatchId',
      importBatches: 'id, fileHash, importedAt, status',
      statementLines: 'id, batchId, customerId, invoiceNo, statementId',
      targets: 'id, month, customerId',
      salesEntries: 'id, date, customerId',
      plans: 'id, month, customerId',
      tasks: 'id, dueDate, status, customerId',
      jobRecords: 'id, date, category, month'
    }).upgrade(async tx => {
      const st = await tx.table('settings').get('settings');
      if (st) await tx.table('settings').put({ ...V2_SETTING_DEFAULTS, ...st });
      await tx.table('auditLog').add({ id: uid('a_'), ts: new Date().toISOString(), entity: 'customers', entityId: '-', action: 'import', summary: 'Database upgraded to schema v2 (statement import, targets, planning, My Job)' });
    });
  }
}

export const db = new SalesDB();
export const DB_VERSION = 2;

export const V2_SETTING_DEFAULTS = { companyName: 'Bisbelluk Trading LLC', jobStartDate: '2024-12-01', salesBasis: 'net' as const, notifications: false };
export const DEFAULT_SETTINGS: Settings = {
  id: 'settings', currency: 'AED', defaultVatRate: 5, defaultTermsDays: 60, upcomingDays: 7, ownerName: '', ...V2_SETTING_DEFAULTS
};

export async function loadAll(): Promise<{ data: DataSet; settings: Settings }> {
  const data: any = {};
  await db.transaction('r', TABLES.map(t => (db as any)[t]), async () => {
    for (const t of TABLES) data[t] = await (db as any)[t].toArray();
  });
  const s = await db.settings.get('settings');
  return { data, settings: { ...DEFAULT_SETTINGS, ...(s || {}) } };
}

const diff = (a: any, b: any) => {
  const out: Record<string, [any, any]> = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (k === 'updatedAt') continue;
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out[k] = [a?.[k], b?.[k]];
  }
  return out;
};

function audit(entity: TableName, entityId: string, action: AuditEntry['action'], summary: string, before?: any, after?: any) {
  return db.auditLog.add({ id: uid('a_'), ts: new Date().toISOString(), entity, entityId, action, summary, before, after });
}

/** Insert or update a record, writing a correction-history entry with the field changes. */
export async function saveRecord<T extends { id?: string }>(table: TableName, rec: T, label: string): Promise<string> {
  const now = new Date().toISOString();
  return db.transaction('rw', (db as any)[table], db.auditLog, async () => {
    const t = (db as any)[table] as Table<any, string>;
    const existing = rec.id ? await t.get(rec.id) : undefined;
    if (existing) {
      const next = { ...existing, ...rec, updatedAt: now };
      const changes = diff(existing, next);
      if (Object.keys(changes).length === 0) return existing.id;
      await t.put(next);
      await audit(table, existing.id, 'update', `Edited ${label}: ` + Object.keys(changes).join(', '), Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])), Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])));
      return existing.id;
    }
    const id = rec.id || uid();
    const next = { ...rec, id, createdAt: now, updatedAt: now, deleted: false };
    await t.add(next);
    await audit(table, id, 'create', `Created ${label}`, undefined, next);
    return id;
  });
}

/** Soft delete (void). The record is kept for history but excluded from all calculations. */
export async function voidRecord(table: TableName, id: string, reason: string, label: string) {
  await db.transaction('rw', (db as any)[table], db.allocations, db.auditLog, async () => {
    const t = (db as any)[table] as Table<any, string>;
    const r = await t.get(id);
    if (!r) return;
    await t.put({ ...r, deleted: true, deleteReason: reason, updatedAt: new Date().toISOString() });
    await audit(table, id, 'delete', `Voided ${label}${reason ? ' - ' + reason : ''}`, { deleted: false }, { deleted: true, deleteReason: reason });
    if (table === 'collections') {
      // allocations of a voided collection are voided too, so they stop reducing invoices
      const al = await db.allocations.where('collectionId').equals(id).toArray();
      for (const a of al.filter(a => !a.deleted)) await db.allocations.put({ ...a, deleted: true, deleteReason: 'Collection voided', updatedAt: new Date().toISOString() });
    }
  });
}

export async function restoreRecord(table: TableName, id: string, label: string) {
  await db.transaction('rw', (db as any)[table], db.auditLog, async () => {
    const t = (db as any)[table] as Table<any, string>;
    const r = await t.get(id);
    if (!r) return;
    await t.put({ ...r, deleted: false, deleteReason: undefined, updatedAt: new Date().toISOString() });
    await audit(table, id, 'restore', `Restored ${label}`, { deleted: true }, { deleted: false });
  });
}

/** Save a collection together with its allocations atomically. Previous allocations are voided (kept in history). */
export async function saveCollection(col: Partial<Collection>, allocs: { invoiceId: string; amount: number }[], label: string) {
  return db.transaction('rw', db.collections, db.allocations, db.auditLog, async () => {
    const id = await saveRecord('collections', col as any, label);
    const existing: Allocation[] = await db.allocations.where('collectionId').equals(id).toArray();
    const liveEx = existing.filter(a => !a.deleted);
    const same = liveEx.length === allocs.length && allocs.every(a => liveEx.some(e => e.invoiceId === a.invoiceId && Math.abs(e.amount - a.amount) < 0.005));
    if (same) return id;
    const now = new Date().toISOString();
    for (const a of liveEx) await db.allocations.put({ ...a, deleted: true, deleteReason: 'Re-allocated', updatedAt: now });
    for (const a of allocs) {
      const rec: Allocation = { id: uid('al_'), collectionId: id, invoiceId: a.invoiceId, amount: a.amount, createdAt: now, updatedAt: now, deleted: false };
      await db.allocations.add(rec);
    }
    await audit('allocations', id, liveEx.length ? 'update' : 'create', `Allocations for ${label}: ${allocs.length} invoice(s)`, liveEx.map(a => ({ invoiceId: a.invoiceId, amount: a.amount })), allocs);
    return id;
  });
}

export async function saveSettings(s: Settings) { await db.settings.put({ ...s, id: 'settings' }); }

export async function exportBackup(): Promise<BackupFile> {
  const { data } = await loadAll();
  const auditLog = await db.auditLog.orderBy('ts').toArray();
  const settings = await db.settings.toArray();
  return makeBackup({ ...data, auditLog, settings });
}

/** Replace the whole database with a validated backup (single transaction - all or nothing). */
export async function restoreBackup(obj: any) {
  const v = validateBackup(obj);
  if (!v.ok) throw new Error('Backup is invalid: ' + v.errors.slice(0, 5).join(' '));
  const d = obj.data;
  await db.transaction('rw', [...TABLES.map(t => (db as any)[t]), db.auditLog, db.settings], async () => {
    for (const t of TABLES) { await (db as any)[t].clear(); await (db as any)[t].bulkAdd(Array.isArray(d[t]) ? d[t] : []); }
    await db.auditLog.clear();
    if (Array.isArray(d.auditLog)) await db.auditLog.bulkAdd(d.auditLog);
    await db.settings.clear();
    if (Array.isArray(d.settings) && d.settings.length) await db.settings.bulkAdd(d.settings);
    await db.auditLog.add({ id: uid('a_'), ts: new Date().toISOString(), entity: 'customers', entityId: '-', action: 'import', summary: `Restored backup exported ${obj.exportedAt}` });
  });
  return v;
}

export async function clearAll() {
  await db.transaction('rw', [...TABLES.map(t => (db as any)[t]), db.auditLog], async () => {
    for (const t of TABLES) await (db as any)[t].clear();
    await db.auditLog.clear();
  });
}

export async function bulkInsert(ds: DataSet) {
  await db.transaction('rw', [...TABLES.map(t => (db as any)[t]), db.auditLog], async () => {
    for (const t of TABLES) await (db as any)[t].bulkPut(ds[t]);
    await db.auditLog.add({ id: uid('a_'), ts: new Date().toISOString(), entity: 'customers', entityId: '-', action: 'import', summary: 'Loaded fictional demo data' });
  });
}

export async function requestPersistence(): Promise<{ persisted: boolean | null; usage?: number; quota?: number }> {
  try {
    const st: any = navigator.storage;
    if (!st) return { persisted: null };
    let persisted = st.persisted ? await st.persisted() : null;
    if (!persisted && st.persist) persisted = await st.persist();
    const est = st.estimate ? await st.estimate() : {};
    return { persisted, usage: est.usage, quota: est.quota };
  } catch { return { persisted: null }; }
}

export const auditEntry = audit;

/** Run several record writes in one transaction (used by the statement importer). */
export async function inTx<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [...TABLES.map(t => (db as any)[t]), db.auditLog, db.settings], fn);
}
