import { useState } from 'preact/hooks';
import { useStore, refresh, custName } from '../store';
import { Page, Card, Money, Badge, Field, Input, MoneyInput, Select, Errors, Warn, Empty, toast, ask } from '../ui';
import { fmtDate, num, r2, todayISO, EPS } from '../util';
import { go } from '../router';
import { saveRecord } from '../db';
import { parseStatementFile, fileHash, fileKind, type ParseResult } from '../lib/statementParse';
import { planImport, applyImport, undoImport, type ImportPlan, type InvoiceAction } from '../lib/statementImport';
import type { StatementLine } from '../types';

const ACT_LABEL: Record<InvoiceAction, string> = { create: 'Create invoice', update: 'Update invoice', none: 'No change', skip: 'Skip' };

export function ImportScreen() {
  const s = useStore();
  const [file, setFile] = useState<{ name: string; buf: ArrayBuffer; hash: string } | null>(null);
  const [parsed, setParsed] = useState<(ParseResult & { kind: string }) | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [stDate, setStDate] = useState(todayISO());
  const [err, setErr] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState({ autoCreateCustomers: true, syncReceived: false });
  const [filter, setFilter] = useState<'All' | 'Issues' | 'Changes'>('All');
  const analyse = async (f: { name: string; buf: ArrayBuffer; hash: string }, date: string) => {
    setBusy(true); setErr([]);
    try {
      const p = await parseStatementFile(f.buf.slice(0), f.name, date);
      setParsed(p);
      setPlan(planImport(s.data, p.rows, date, f.hash, s.today));
    } catch (x: any) { setErr([String(x?.message || x)]); setParsed(null); setPlan(null); }
    setBusy(false);
  };
  const onFile = async (e: Event) => {
    const fl = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!fl) return;
    if (!fileKind(fl.name)) { setErr(['Unsupported file type. Use .xlsx, .xls, .csv or a text-based .pdf']); return; }
    const buf = await fl.arrayBuffer();
    const f = { name: fl.name, buf, hash: await fileHash(buf) };
    setFile(f); await analyse(f, stDate);
  };
  const setRow = (i: number, patch: any) => setPlan(p => p && { ...p, rows: p.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const apply = async () => {
    if (!plan || !file || !parsed) return;
    const n = plan.rows.filter(r => r.invoiceAction === 'create' || r.invoiceAction === 'update' || r.snapshot).length;
    if (!n) { toast('Nothing selected to import', 'bad'); return; }
    if (plan.previous) {
      const ok = await ask('This exact file was imported before', { body: `Batch from ${new Date(plan.previous.importedAt).toLocaleString('en-GB')}. Re-importing is safe: unchanged rows are skipped and nothing is duplicated.`, okText: 'Import again' });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await applyImport(plan, { fileName: file.name, fileHash: file.hash, fileType: parsed.kind as any, ...opts, defaultTerms: s.settings.defaultTermsDays });
      await refresh(); toast('Import complete'); go('/imports/' + res.batchId);
    } catch (x: any) { setErr([String(x?.message || x)]); }
    setBusy(false);
  };
  const rows = plan?.rows.map((p, i) => ({ p, i })).filter(({ p }) => filter === 'All' || (filter === 'Issues' ? p.r.errors.length || p.r.warnings.length || p.otherCustomer : p.invoiceAction === 'create' || p.invoiceAction === 'update' || p.snapshotState !== 'same')) || [];
  const errs = plan?.rows.filter(r => r.r.errors.length).length || 0, warns = plan?.rows.filter(r => r.r.warnings.length).length || 0;
  return (
    <Page title="Import statement" back="/imports" sub="Excel / CSV / PDF · processed on this device">
      <Card title="1. Choose the monthly statement file">
        <p class="small muted">Expected columns (any order, flexible names): Invoice No, Billing Date, Sales Man, Customer, Total Amount, Tax Amount, Grand Total, Received Amount, Balance, Ageing Days, Remarks. The file never leaves this device.</p>
        <Field label="Statement date (ageing is recalculated to this date)"><Input type="date" name="statementDate" value={stDate} onValue={v => { setStDate(v); if (file && v) analyse(file, v); }} /></Field>
        <label class="btn primary block file-btn">{file ? 'Choose another file' : 'Choose file (.xlsx, .xls, .csv, .pdf)'}<input type="file" accept=".xlsx,.xls,.csv,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" onChange={onFile} data-testid="statement-file" /></label>
        <p class="small muted">Fictional samples: <a href="./samples/sample-statement-2026-10.xlsx" download>xlsx</a> · <a href="./samples/sample-statement-2026-10.pdf" download>pdf</a> · <a href="./samples/sample-statement-with-errors.csv" download>csv with errors</a></p>
        {busy && <p class="small">Reading file…</p>}
        <Errors errors={err} />
      </Card>
      {plan && parsed && <>
        <Card title="2. Preview & validation" testid="import-preview">
          <p class="small" data-testid="import-summary"><b>{file!.name}</b> ({parsed.kind.toUpperCase()}): {plan.rows.length} rows · header on line {parsed.headerLine} · {errs} with errors · {warns} with warnings{parsed.skipped ? ` · ${parsed.skipped} blank/total lines ignored` : ''}</p>
          {parsed.missingColumns.length > 0 && <Warn>Columns not found: {parsed.missingColumns.join(', ')} – values treated as 0/blank.</Warn>}
          {plan.previous && <Warn testid="reimport-warning">This exact file was already imported on {new Date(plan.previous.importedAt).toLocaleString('en-GB')}. Re-import is idempotent: unchanged rows will not be duplicated.</Warn>}
          {plan.newCustomers.length > 0 && <p class="small">New customers in file: <b>{plan.newCustomers.join(', ')}</b></p>}
          <label class="inline small"><input type="checkbox" data-testid="opt-autocreate" checked={opts.autoCreateCustomers} onChange={e => setOpts({ ...opts, autoCreateCustomers: (e.target as HTMLInputElement).checked })} /> Auto-create missing customers</label>
          <label class="inline small"><input type="checkbox" data-testid="opt-sync" checked={opts.syncReceived} onChange={e => setOpts({ ...opts, syncReceived: (e.target as HTMLInputElement).checked })} /> Create “statement receipt” payments where the file shows more received than the app</label>
          <div class="row gap" style="margin-top:8px">
            <button class="btn sm" type="button" onClick={() => setPlan({ ...plan, rows: plan.rows.map(r => ({ ...r, invoiceAction: r.proposed })) })}>Use suggested</button>
            <button class="btn sm" type="button" onClick={() => setPlan({ ...plan, rows: plan.rows.map(r => ({ ...r, invoiceAction: r.r.errors.length ? 'skip' : r.invoiceAction === 'skip' ? 'skip' : 'none' })) })}>Snapshot only</button>
          </div>
          <div class="chips" style="margin-top:8px">{(['All', 'Issues', 'Changes'] as const).map(o => <button type="button" class={'chip' + (o === filter ? ' on' : '')} onClick={() => setFilter(o)}>{o}</button>)}</div>
          <div class="table-wrap"><table class="tbl" data-testid="preview-table">
            <thead><tr><th>#</th><th>Invoice</th><th>Date</th><th>Customer</th><th class="num">Grand</th><th class="num">Received</th><th class="num">Balance</th><th class="num">Ageing</th><th>App</th><th>Invoice action</th><th>Snapshot</th><th>Checks</th></tr></thead>
            <tbody>{rows.map(({ p, i }) => (
              <tr data-testid={'prow-' + p.r.invoiceNo} class={p.r.errors.length ? 'row-bad' : p.r.warnings.length ? 'row-warn' : ''}>
                <td>{p.r.line}</td><td><b>{p.r.invoiceNo || '—'}</b></td><td>{p.r.billingDate ? fmtDate(p.r.billingDate) : <span class="bad-text">{p.r.rawDate || '—'}</span>}</td>
                <td>{p.r.customer || '—'} {p.customerMatch === 'new' && <Badge s="new" tone="info" />}</td>
                <td class="num">{num(p.r.grand)}</td><td class="num">{num(p.r.received)}</td><td class="num">{num(p.r.balance)}</td>
                <td class="num">{p.r.ageing ?? '—'}{p.r.fileAgeing != null && p.r.fileAgeing !== p.r.ageing ? <span class="muted"> (file {p.r.fileAgeing})</span> : ''}</td>
                <td class="small">{p.invoiceId ? <>exists{p.appRemaining != null && <> · bal {num(p.appRemaining)}</>}{p.diffs.length > 0 && <div class="warn-text">{p.diffs.join('; ')}</div>}</> : 'new'}{p.otherCustomer && <div class="bad-text">belongs to {p.otherCustomer}</div>}</td>
                <td><select aria-label={'Action ' + p.r.invoiceNo} data-testid={'act-' + p.r.invoiceNo} value={p.invoiceAction} disabled={!!p.r.errors.length} onChange={e => setRow(i, { invoiceAction: (e.target as HTMLSelectElement).value })}>
                  {(p.invoiceId ? ['update', 'none', 'skip'] : ['create', 'skip']).map(a => <option value={a}>{ACT_LABEL[a as InvoiceAction]}</option>)}</select></td>
                <td><label class="inline small"><input type="checkbox" checked={p.snapshot} disabled={!!p.r.errors.length} onChange={e => setRow(i, { snapshot: (e.target as HTMLInputElement).checked })} /> {p.snapshotState === 'same' ? 'same' : p.snapshotState}</label></td>
                <td class="small wrap">{p.r.errors.map(x => <div class="bad-text">✖ {x}</div>)}{p.r.warnings.map(x => <div class="warn-text">⚠ {x}</div>)}{!p.r.errors.length && !p.r.warnings.length && <span class="ok-text">✓</span>}</td>
              </tr>))}</tbody>
          </table></div>
        </Card>
        <div class="form-actions"><button class="btn primary block" disabled={busy} onClick={apply} data-testid="apply-import">Import selected rows</button></div>
      </>}
    </Page>
  );
}

export function ImportsList() {
  const s = useStore();
  const bs = [...s.data.importBatches].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  return <Page title="Statement imports" back="/more" actions={<a class="btn sm primary" href="#/import" data-testid="new-import">+ Import</a>}>
    <p class="small muted">Each upload is a batch: logged, idempotent on re-import, and undoable as a whole.</p>
    {bs.length ? <div class="list">{bs.map(b => <a class="list-row" href={'#/imports/' + b.id} data-testid="batch-row"><div class="grow"><b>{b.fileName}</b><div class="muted small">{new Date(b.importedAt).toLocaleString('en-GB')} · statement {fmtDate(b.statementDate)} · {b.rowCount} rows</div><div class="small">{b.summary}</div></div><Badge s={b.status} tone={b.status === 'Active' ? 'ok' : 'muted'} /></a>)}</div> : <Empty>No imports yet. Tap + Import to upload a statement file.</Empty>}
  </Page>;
}

export function ImportDetail({ id }: { id: string }) {
  const s = useStore();
  const b = s.data.importBatches.find(x => x.id === id);
  if (!b) return <Page title="Import" back="/imports"><Empty>Not found.</Empty></Page>;
  const lines = s.data.statementLines.filter(l => l.batchId === id && !l.deleted);
  const diff = lines.filter(l => Math.abs(l.difference) > EPS);
  const byCust = new Map<string, StatementLine[]>();
  lines.forEach(l => (byCust.get(l.customerId) || byCust.set(l.customerId, []).get(l.customerId)!).push(l));
  return <Page title="Import batch" sub={b.fileName} back="/imports">
    <Card title={<span>Batch <Badge s={b.status} tone={b.status === 'Active' ? 'ok' : 'muted'} /></span>} testid="batch-card">
      <dl class="kv"><dt>Imported</dt><dd>{new Date(b.importedAt).toLocaleString('en-GB')}</dd><dt>Statement date</dt><dd>{fmtDate(b.statementDate)}</dd><dt>File type</dt><dd>{b.fileType}</dd><dt>Rows</dt><dd>{b.rowCount}</dd><dt>Changes recorded</dt><dd>{b.changes.length}</dd>{b.undoneAt && <><dt>Undone</dt><dd>{new Date(b.undoneAt).toLocaleString('en-GB')}</dd></>}</dl>
      <p class="small" data-testid="batch-summary">{b.summary}</p>
      <Field label="Notes" full><textarea data-testid="batch-notes" value={b.notes || ''} onBlur={async e => { const v = (e.target as HTMLTextAreaElement).value; if (v !== (b.notes || '')) { await saveRecord('importBatches', { id, notes: v } as any, 'import batch notes'); await refresh(); toast('Notes saved'); } }} /></Field>
      {b.status === 'Active' && <button class="btn danger ghost block" data-testid="undo-import" onClick={async () => {
        const ok = await ask('Undo this whole import?', { body: 'Invoices, customers, payments and statement lines created by this batch are voided; updated invoices get their previous values back.', danger: true, okText: 'Undo import' });
        if (!ok) return;
        try { const r = await undoImport(id); await refresh(); toast(`Import undone (${r.reverted} changes reverted)`); } catch (x: any) { toast(String(x?.message || x), 'bad'); }
      }}>Undo whole import</button>}
    </Card>
    <Card title={`Reconciliation · ${diff.length} difference(s)`} testid="batch-recon">
      {[...byCust.entries()].map(([cid, ls]) => {
        const fileBal = r2(ls.reduce((a, l) => a + l.balance, 0)), app = r2(ls.reduce((a, l) => a + l.appBalance, 0));
        return <div class="recon-box" style="margin-bottom:8px"><b>{custName(s, cid)}</b><div class="small">File balance <Money v={fileBal} /> · app <Money v={app} /> · difference <b class={Math.abs(app - fileBal) > EPS ? 'bad-text' : 'ok-text'}>{num(r2(app - fileBal))}</b></div></div>;
      })}
      <div class="table-wrap"><table class="tbl" data-testid="lines-table"><thead><tr><th>Invoice</th><th>Customer</th><th class="num">File bal.</th><th class="num">App bal.</th><th class="num">Diff</th><th>Remarks</th><th></th></tr></thead>
        <tbody>{lines.map(l => <tr data-testid={'line-' + l.invoiceNo}><td>{l.invoiceId ? <a href={'#/invoices/' + l.invoiceId}>{l.invoiceNo}</a> : l.invoiceNo}</td><td>{l.customerName}</td><td class="num">{num(l.balance)}</td><td class="num">{num(l.appBalance)}</td><td class={'num ' + (Math.abs(l.difference) > EPS ? 'bad-text' : '')}>{num(l.difference)}</td><td class="small">{l.remarks}</td><td><a class="link" href={'#/statement-line/' + l.id}>Edit</a></td></tr>)}</tbody></table></div>
    </Card>
  </Page>;
}

/** Correct a statement line (e.g. a typo in the file) – difference and the customer's reconciliation are recalculated. */
export function StatementLineForm({ id }: { id: string }) {
  const s = useStore();
  const l = s.data.statementLines.find(x => x.id === id);
  const [f, setF] = useState<any>(l ? { ...l } : {});
  const [errors, setErrors] = useState<string[]>([]);
  if (!l) return <Page title="Statement line" back><Empty>Not found.</Empty></Page>;
  const save = async () => {
    const e: string[] = [];
    const nums = ['totalAmount', 'taxAmount', 'receivedAmount', 'balance'].map(k => Number(f[k]));
    if (nums.some(n => !isFinite(n))) e.push('Amounts must be numbers.');
    if (!f.invoiceNo?.trim()) e.push('Invoice no is required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.billingDate || '')) e.push('Billing date is required.');
    setErrors(e); if (e.length) return;
    const grand = r2(Number(f.totalAmount) + Number(f.taxAmount));
    const bal = Number(f.balance);
    const rec = { id, invoiceNo: f.invoiceNo.trim(), billingDate: f.billingDate, totalAmount: Number(f.totalAmount), taxAmount: Number(f.taxAmount), grandTotal: grand, receivedAmount: Number(f.receivedAmount), balance: bal, remarks: f.remarks, difference: r2(l.appBalance - bal) };
    await saveRecord('statementLines', rec as any, 'statement line ' + rec.invoiceNo);
    if (l.statementId) {
      const st = s.data.statements.find(x => x.id === l.statementId);
      if (st) {
        const fileBal = r2(s.data.statementLines.filter(x => x.statementId === l.statementId && !x.deleted).reduce((a, x) => a + (x.id === id ? bal : x.balance), 0));
        const diff = r2(fileBal - st.recordedBalance);
        await saveRecord('statements', { id: st.id, statementBalance: fileBal, difference: diff, status: Math.abs(diff) <= EPS ? 'Matched' : st.status === 'Matched' ? 'Discrepancy' : st.status } as any, 'statement reconciliation (line corrected)');
      }
    }
    await refresh(); toast('Statement line saved'); go('/imports/' + l.batchId);
  };
  return <Page title="Edit statement line" sub={l.customerName} back={'/imports/' + l.batchId}>
    <form class="form" onSubmit={e => { e.preventDefault(); save(); }}>
      <Errors errors={errors} />
      <Field label="Invoice no"><Input name="invoiceNo" value={f.invoiceNo} onValue={v => setF({ ...f, invoiceNo: v })} /></Field>
      <Field label="Billing date"><Input name="billingDate" type="date" value={f.billingDate} onValue={v => setF({ ...f, billingDate: v })} /></Field>
      <Field label="Total amount"><MoneyInput name="totalAmount" value={f.totalAmount} onValue={v => setF({ ...f, totalAmount: v })} /></Field>
      <Field label="Tax amount"><MoneyInput name="taxAmount" value={f.taxAmount} onValue={v => setF({ ...f, taxAmount: v })} /></Field>
      <Field label="Received amount"><MoneyInput name="receivedAmount" value={f.receivedAmount} onValue={v => setF({ ...f, receivedAmount: v })} /></Field>
      <Field label="Balance (per file)"><Input name="balance" type="number" step="0.01" value={f.balance} onValue={v => setF({ ...f, balance: v })} /></Field>
      <div class="calc-box full"><div><span>Grand total</span><b>{num(r2(Number(f.totalAmount || 0) + Number(f.taxAmount || 0)))}</b></div><div><span>App balance</span><b>{num(l.appBalance)}</b></div><div><span>Difference</span><b>{num(r2(l.appBalance - Number(f.balance || 0)))}</b></div></div>
      <Field label="Remarks" full><Input name="remarks" value={f.remarks} onValue={v => setF({ ...f, remarks: v })} /></Field>
      <div class="form-actions"><button class="btn primary block" type="submit" data-testid="save">Save line</button></div>
    </form>
  </Page>;
}
export { Select };
