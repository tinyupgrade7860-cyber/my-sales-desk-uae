/**
 * Statement import: plan (pure) + apply/undo (IndexedDB, single transaction each).
 * Idempotent: rows that already match the app produce no changes, statement snapshot lines are keyed by
 * customer + invoice no + statement date, and "received" sync only records the missing gap.
 */
import type { DataSet, ImportBatch, ImportChange, Invoice, Customer, StatementLine, StatementRecon, TableName } from '../types';
import type { ParsedRow } from './statementParse';
import { calcAllInvoices, customerBalanceAsOf } from '../calc';
import { addDays, norm, r2, uid, EPS } from '../util';
import { db, inTx, loadAll, saveRecord, saveCollection, voidRecord, auditEntry } from '../db';

export type InvoiceAction = 'create' | 'update' | 'none' | 'skip';
export interface PlanRow {
  r: ParsedRow;
  customerId?: string;
  customerMatch: 'existing' | 'new' | 'none';
  invoiceId?: string;
  proposed: InvoiceAction; // what the app suggests
  invoiceAction: InvoiceAction; // user's choice
  snapshot: boolean; // record as statement snapshot line
  snapshotState: 'new' | 'update' | 'same';
  diffs: string[];
  appRemaining: number | null;
  appAllocated: number;
  otherCustomer?: string; // invoice exists but under a different customer
}
export interface ImportPlan { rows: PlanRow[]; previous?: ImportBatch; newCustomers: string[]; statementDate: string }

const live = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter(x => !x.deleted);
const activeBatchIds = (ds: DataSet) => new Set(ds.importBatches.filter(b => !b.deleted && b.status === 'Active').map(b => b.id));

export function findCustomer(ds: DataSet, name: string): Customer | undefined {
  const n = norm(name).replace(/\s+/g, ' ');
  return live(ds.customers).find(c => norm(c.name).replace(/\s+/g, ' ') === n || norm(c.code) === n);
}

function invoiceDiffs(inv: Invoice, r: ParsedRow): string[] {
  const d: string[] = [];
  if (r.billingDate && inv.invoiceDate !== r.billingDate) d.push(`date ${inv.invoiceDate} → ${r.billingDate}`);
  if (Math.abs(inv.grossAmount - r.grand) > EPS) d.push(`gross ${inv.grossAmount.toFixed(2)} → ${r.grand.toFixed(2)}`);
  if (Math.abs(inv.netAmount - r.total) > EPS) d.push(`net ${inv.netAmount.toFixed(2)} → ${r.total.toFixed(2)}`);
  if (Math.abs(inv.vatAmount - r.tax) > EPS) d.push(`VAT ${inv.vatAmount.toFixed(2)} → ${r.tax.toFixed(2)}`);
  if (r.salesman && (inv.salesman || '') !== r.salesman) d.push(`salesman → ${r.salesman}`);
  return d;
}

export function planImport(ds: DataSet, rows: ParsedRow[], statementDate: string, hash: string, today?: string): ImportPlan {
  const { map, ix } = calcAllInvoices(ds, today);
  const active = activeBatchIds(ds);
  const lines = live(ds.statementLines).filter(l => active.has(l.batchId));
  const newCustomers = new Set<string>();
  const out: PlanRow[] = rows.map(r => {
    const cust = r.customer ? findCustomer(ds, r.customer) : undefined;
    const inv = r.invoiceNo ? live(ds.invoices).find(i => norm(i.invoiceNo) === norm(r.invoiceNo)) : undefined;
    const pr: PlanRow = {
      r, customerId: cust?.id, customerMatch: cust ? 'existing' : r.customer ? 'new' : 'none', invoiceId: inv?.id,
      proposed: 'create', invoiceAction: 'create', snapshot: true, snapshotState: 'new', diffs: [],
      appRemaining: inv ? map.get(inv.id)?.remaining ?? null : null, appAllocated: inv ? ix.allocByInvoice.get(inv.id) || 0 : 0
    };
    if (!cust && r.customer) newCustomers.add(r.customer);
    if (inv) {
      if (cust && inv.customerId !== cust.id) pr.otherCustomer = ds.customers.find(c => c.id === inv.customerId)?.name;
      pr.diffs = invoiceDiffs(inv, r);
      pr.proposed = pr.diffs.length ? 'update' : 'none';
    }
    if (cust) {
      const ex = lines.find(l => l.customerId === cust.id && norm(l.invoiceNo) === norm(r.invoiceNo) && l.billingDate && statementLineDate(ds, l) === statementDate);
      if (ex) pr.snapshotState = Math.abs(ex.balance - r.balance) <= EPS && Math.abs(ex.grandTotal - r.grand) <= EPS && Math.abs(ex.receivedAmount - r.received) <= EPS ? 'same' : 'update';
    }
    if (r.errors.length) { pr.proposed = 'skip'; pr.snapshot = false; }
    if (pr.otherCustomer) pr.proposed = 'skip';
    pr.invoiceAction = pr.proposed;
    return pr;
  });
  const previous = ds.importBatches.find(b => !b.deleted && b.status === 'Active' && b.fileHash === hash);
  return { rows: out, previous, newCustomers: [...newCustomers], statementDate };
}
const statementLineDate = (ds: DataSet, l: StatementLine) => ds.importBatches.find(b => b.id === l.batchId)?.statementDate;

export interface ApplyOptions { fileName: string; fileHash: string; fileType: ImportBatch['fileType']; autoCreateCustomers: boolean; syncReceived: boolean; defaultTerms: number }
export interface ApplyResult { batchId: string; counts: Record<string, number>; summary: string }

export async function applyImport(plan: ImportPlan, o: ApplyOptions): Promise<ApplyResult> {
  return inTx(async () => {
    const batchId = uid('imp_');
    const changes: ImportChange[] = [];
    const counts: Record<string, number> = { customersCreated: 0, invoicesCreated: 0, invoicesUpdated: 0, unchanged: 0, collectionsCreated: 0, linesCreated: 0, linesUpdated: 0, statements: 0, skipped: 0 };
    const now = new Date().toISOString();
    let { data: ds } = await loadAll();
    // 1. customers
    const custIds = new Map<string, string>();
    let codeN = live(ds.customers).filter(c => /^IMP-\d+$/.test(c.code)).length + 1;
    const want = plan.rows.filter(p => !p.r.errors.length && (p.invoiceAction === 'create' || p.invoiceAction === 'update' || p.snapshot));
    for (const p of want) {
      if (p.customerId || !p.r.customer) continue;
      const key = norm(p.r.customer);
      if (custIds.has(key)) continue;
      const ex = findCustomer(ds, p.r.customer);
      if (ex) { custIds.set(key, ex.id); continue; }
      if (!o.autoCreateCustomers) continue;
      let code = `IMP-${String(codeN++).padStart(3, '0')}`;
      while (live(ds.customers).some(c => c.code === code)) code = `IMP-${String(codeN++).padStart(3, '0')}`;
      const id = await saveRecord('customers', { code, name: p.r.customer, paymentTermsDays: o.defaultTerms, salesman: p.r.salesman || undefined, importBatchId: batchId, notes: `Created by statement import (${o.fileName})` } as any, `customer ${p.r.customer} (import)`);
      custIds.set(key, id); changes.push({ table: 'customers', id, action: 'create' }); counts.customersCreated++;
    }
    const cidOf = (p: PlanRow) => p.customerId || custIds.get(norm(p.r.customer));
    // 2. invoices
    const invIds = new Map<PlanRow, string>();
    for (const p of plan.rows) {
      const cid = cidOf(p);
      if (p.r.errors.length || !cid) { counts.skipped++; continue; }
      const r = p.r;
      const cust = (await db.customers.get(cid)) as Customer;
      const fresh = live(await db.invoices.where('invoiceNo').equals(r.invoiceNo).toArray()).concat(live(ds.invoices).filter(i => norm(i.invoiceNo) === norm(r.invoiceNo)))[0] as Invoice | undefined;
      if (fresh) invIds.set(p, fresh.id);
      if (p.invoiceAction === 'create' && !fresh) {
        const terms = cust?.paymentTermsDays ?? o.defaultTerms;
        const id = await saveRecord('invoices', {
          invoiceNo: r.invoiceNo, customerId: cid, invoiceDate: r.billingDate!, dueDate: addDays(r.billingDate!, terms), paymentTermsDays: terms,
          netAmount: r.total, vatRate: r.total ? r2((r.tax / r.total) * 100) : 0, vatAmount: r.tax, grossAmount: r.grand, salesman: r.salesman || undefined,
          notes: r.remarks || undefined, importBatchId: batchId
        } as any, `invoice ${r.invoiceNo} (import)`);
        invIds.set(p, id); changes.push({ table: 'invoices', id, action: 'create' }); counts.invoicesCreated++;
      } else if ((p.invoiceAction === 'update' || p.invoiceAction === 'create') && fresh && invoiceDiffs(fresh, r).length) {
        const patch: any = { id: fresh.id, invoiceDate: r.billingDate, netAmount: r.total, vatAmount: r.tax, grossAmount: r.grand, vatRate: r.total ? r2((r.tax / r.total) * 100) : fresh.vatRate };
        if (r.billingDate !== fresh.invoiceDate) patch.dueDate = addDays(r.billingDate!, fresh.paymentTermsDays);
        if (r.salesman) patch.salesman = r.salesman;
        const before: any = {}; for (const k of Object.keys(patch)) before[k] = (fresh as any)[k];
        await saveRecord('invoices', patch, `invoice ${r.invoiceNo} (statement import)`);
        changes.push({ table: 'invoices', id: fresh.id, action: 'update', before }); counts.invoicesUpdated++;
      } else counts.unchanged++;
    }
    // 3. optional: record received amounts not yet in the app (gap only -> idempotent)
    if (o.syncReceived) {
      ({ data: ds } = await loadAll());
      const { map, ix } = calcAllInvoices(ds);
      for (const p of plan.rows) {
        const iid = invIds.get(p); if (!iid || p.r.errors.length) continue;
        const calc = map.get(iid); if (!calc) continue;
        const gap = r2(Math.min(p.r.received - (ix.allocByInvoice.get(iid) || 0), calc.remaining));
        if (gap <= EPS) continue;
        let ref = `IMP-${p.r.invoiceNo}`, k = 2;
        while (live(ds.collections).some(c => c.receiptRef === ref)) ref = `IMP-${p.r.invoiceNo}-${k++}`;
        const cid = await saveCollection({ receiptRef: ref, customerId: calc.invoice.customerId, date: plan.statementDate, amount: gap, method: 'Other', notes: `Received per statement ${o.fileName}`, importBatchId: batchId } as any, [{ invoiceId: iid, amount: gap }], `payment ${ref} (import)`);
        changes.push({ table: 'collections', id: cid, action: 'create' }); counts.collectionsCreated++;
      }
    }
    // 4. statement snapshot lines + one reconciliation per customer
    ({ data: ds } = await loadAll());
    const { map } = calcAllInvoices(ds);
    const active = activeBatchIds(ds);
    const byCust = new Map<string, { rows: PlanRow[] }>();
    for (const p of plan.rows) { const cid = cidOf(p); if (!p.snapshot || p.r.errors.length || !cid) continue; (byCust.get(cid) || byCust.set(cid, { rows: [] }).get(cid)!).rows.push(p); }
    const batchRec: ImportBatch = { id: batchId, createdAt: now, updatedAt: now, deleted: false, fileName: o.fileName, fileHash: o.fileHash, fileType: o.fileType, statementDate: plan.statementDate, importedAt: now, rowCount: plan.rows.length, summary: '', changes: [], status: 'Active' };
    await db.importBatches.add(batchRec); // must exist before lines reference it
    for (const [cid, g] of byCust) {
      const fileBal = r2(g.rows.reduce((a, p) => a + p.r.balance, 0));
      const recorded = customerBalanceAsOf(ds, cid, plan.statementDate).balance;
      const diff = r2(recorded - fileBal);
      const exSt = live(ds.statements).find(s => s.customerId === cid && s.statementDate === plan.statementDate && s.importBatchId && active.has(s.importBatchId));
      const stFields = { statementBalance: fileBal, recordedBalance: recorded, difference: diff, status: Math.abs(diff) <= EPS ? 'Matched' : 'Discrepancy' } as Partial<StatementRecon>;
      let stId: string;
      if (exSt) {
        stId = exSt.id;
        if (Math.abs(exSt.statementBalance - fileBal) > EPS || Math.abs(exSt.recordedBalance - recorded) > EPS) {
          const before: any = { statementBalance: exSt.statementBalance, recordedBalance: exSt.recordedBalance, difference: exSt.difference, status: exSt.status };
          await saveRecord('statements', { id: exSt.id, ...stFields } as any, 'statement reconciliation (import)');
          changes.push({ table: 'statements', id: exSt.id, action: 'update', before }); counts.statements++;
        }
      } else {
        stId = await saveRecord('statements', { customerId: cid, statementDate: plan.statementDate, statementRef: o.fileName, ...stFields, importBatchId: batchId, notes: `From imported statement file ${o.fileName} (${g.rows.length} lines)` } as any, 'statement reconciliation (import)');
        changes.push({ table: 'statements', id: stId, action: 'create' }); counts.statements++;
      }
      for (const p of g.rows) {
        const r = p.r;
        const inv = live(ds.invoices).find(i => norm(i.invoiceNo) === norm(r.invoiceNo));
        const appBal = inv ? map.get(inv.id)?.remaining ?? 0 : 0;
        const fields = { customerId: cid, invoiceId: inv?.id, invoiceNo: r.invoiceNo, billingDate: r.billingDate!, salesman: r.salesman || undefined, customerName: r.customer,
          totalAmount: r.total, taxAmount: r.tax, grandTotal: r.grand, receivedAmount: r.received, balance: r.balance, ageingDays: r.ageing ?? 0, remarks: r.remarks || undefined,
          appBalance: appBal, difference: r2(appBal - r.balance), statementId: stId };
        const ex = live(ds.statementLines).find(l => active.has(l.batchId) && l.customerId === cid && norm(l.invoiceNo) === norm(r.invoiceNo) && ds.importBatches.find(b => b.id === l.batchId)?.statementDate === plan.statementDate);
        if (ex) {
          const same = Math.abs(ex.balance - r.balance) <= EPS && Math.abs(ex.grandTotal - r.grand) <= EPS && Math.abs(ex.receivedAmount - r.received) <= EPS && Math.abs(ex.appBalance - appBal) <= EPS;
          if (same) continue;
          const before: any = {}; for (const k of Object.keys(fields)) before[k] = (ex as any)[k];
          await saveRecord('statementLines', { id: ex.id, ...fields } as any, `statement line ${r.invoiceNo}`);
          changes.push({ table: 'statementLines', id: ex.id, action: 'update', before }); counts.linesUpdated++;
        } else {
          const id = await saveRecord('statementLines', { ...fields, batchId } as any, `statement line ${r.invoiceNo}`);
          changes.push({ table: 'statementLines', id, action: 'create' }); counts.linesCreated++;
        }
      }
    }
    const total = changes.length;
    const summary = total === 0 ? 'No changes - everything in this file is already in the app (idempotent re-import).'
      : `${counts.invoicesCreated} invoices created, ${counts.invoicesUpdated} updated, ${counts.customersCreated} customers created, ${counts.collectionsCreated} receipts recorded, ${counts.linesCreated + counts.linesUpdated} statement lines, ${counts.statements} reconciliations.`;
    await db.importBatches.put({ ...batchRec, summary, changes, updatedAt: new Date().toISOString() });
    await auditEntry('importBatches', batchId, 'import', `Imported statement ${o.fileName}: ${summary}`, undefined, { counts });
    return { batchId, counts, summary };
  });
}

/** Undo a whole import batch: created records are voided (kept in history), updated records get their previous values back. */
export async function undoImport(batchId: string): Promise<{ reverted: number }> {
  return inTx(async () => {
    const b = (await db.importBatches.get(batchId)) as ImportBatch | undefined;
    if (!b) throw new Error('Import batch not found.');
    if (b.status === 'Undone') throw new Error('This import was already undone.');
    const { data: ds } = await loadAll();
    const created = new Set(b.changes.filter(c => c.action === 'create').map(c => c.table + ':' + c.id));
    const conflicts: string[] = [];
    for (const c of b.changes.filter(c => c.action === 'create' && c.table === 'invoices')) {
      const inv = ds.invoices.find(i => i.id === c.id);
      const al = live(ds.allocations).filter(a => a.invoiceId === c.id && !created.has('collections:' + a.collectionId) && !ds.collections.find(x => x.id === a.collectionId)?.deleted);
      const adj = live(ds.creditNotes).filter(x => x.invoiceId === c.id).length + live(ds.deductions).filter(x => x.invoiceId === c.id).length + live(ds.grvs).filter(x => x.invoiceId === c.id).length;
      if (al.length || adj) conflicts.push(`${inv?.invoiceNo}: has ${al.length} payment allocation(s) / ${adj} GRV/CN/deduction(s) added after the import`);
    }
    for (const c of b.changes.filter(c => c.action === 'create' && c.table === 'customers')) {
      const others = live(ds.invoices).filter(i => i.customerId === c.id && !created.has('invoices:' + i.id)).length + live(ds.collections).filter(x => x.customerId === c.id && !created.has('collections:' + x.id)).length;
      if (others) conflicts.push(`${ds.customers.find(x => x.id === c.id)?.name}: has ${others} record(s) added after the import`);
    }
    if (conflicts.length) throw new Error('Cannot undo - records were added later that depend on this import. Void those first: ' + conflicts.join('; '));
    let reverted = 0;
    for (const c of [...b.changes].reverse()) {
      if (c.action === 'create') await voidRecord(c.table as TableName, c.id, `Import undone (${b.fileName})`, `${c.table} from import`);
      else await saveRecord(c.table as TableName, { id: c.id, ...c.before } as any, `${c.table} (import undone - previous values restored)`);
      reverted++;
    }
    await db.importBatches.put({ ...b, status: 'Undone', undoneAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await auditEntry('importBatches', batchId, 'delete', `Undid statement import ${b.fileName} (${reverted} changes reverted)`);
    return { reverted };
  });
}
