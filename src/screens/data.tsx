import { useEffect, useState } from 'preact/hooks';
import { useStore, refresh, custName } from '../store';
import { Page, Card, Errors, Warn, toast, ask } from '../ui';
import { exportBackup, restoreBackup, clearAll, bulkInsert, requestPersistence } from '../db';
import { validateBackup, type ValidationResult } from '../backup';
import { saveJSON, saveCSV } from '../exporter';
import { generateDemo } from '../seed';
import { TABLES } from '../types';
import { todayISO, fmtDate } from '../util';
import { customerLedger } from '../ledger';

const LAST = 'msd-last-backup';

export function DataScreen() {
  const s = useStore();
  const [pending, setPending] = useState<{ obj: any; v: ValidationResult; name: string } | null>(null);
  const [err, setErr] = useState<string[]>([]);
  const [st, setSt] = useState<any>(null);
  const last = localStorage.getItem(LAST);
  useEffect(() => { requestPersistence().then(setSt); }, []);

  const doExport = async () => {
    const b = await exportBackup();
    await saveJSON(`my-sales-desk-backup-${todayISO()}.json`, b);
    localStorage.setItem(LAST, new Date().toISOString());
    toast('Backup exported'); setSt({ ...st });
  };
  const exportCSVs = async () => {
    for (const t of TABLES) {
      const rows = (s.data as any)[t].map((r: any) => ({ ...r, customer: r.customerId ? custName(s, r.customerId) : undefined }));
      if (rows.length) await saveCSV(`${t}-${todayISO()}.csv`, rows);
    }
    toast('CSV files exported');
  };
  const exportLedger = () => {
    const rows = s.data.customers.filter(c => !c.deleted).flatMap(c => customerLedger(s.data, c.id).rows.map(r => ({ customer: c.name, code: c.code, ...r, link: undefined })));
    return saveCSV(`all-transactions-${todayISO()}.csv`, rows);
  };
  const onFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    setErr([]); setPending(null);
    try {
      const obj = JSON.parse(await file.text());
      const v = validateBackup(obj);
      if (!v.ok) { setErr(v.errors); return; }
      setPending({ obj, v, name: file.name });
    } catch (x: any) { setErr(['Could not read file as JSON: ' + (x?.message || x)]); }
  };
  const doRestore = async () => {
    if (!pending) return;
    try { await restoreBackup(pending.obj); await refresh(); toast('Backup restored'); setPending(null); }
    catch (x: any) { setErr([String(x?.message || x)]); }
  };
  const fmtB = (n?: number) => n == null ? '?' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB';
  const daysSince = last ? Math.floor((Date.now() - Date.parse(last)) / 86400000) : null;
  return (
    <Page title="Backup & data" back="/more">
      {(daysSince == null || daysSince > 7) && s.data.invoices.length > 0 && <Warn testid="backup-reminder">⚠ {daysSince == null ? 'You have never exported a backup.' : `Last backup was ${daysSince} days ago.`} Export one and save it to iCloud Drive / Files.</Warn>}
      <Card title="Storage on this device">
        <p class="small">Data is stored in this browser’s <b>IndexedDB</b> database <code>my-sales-desk-uae</code> on this device only. Nothing is uploaded.</p>
        <p class="small" data-testid="persist-status">Persistent storage: <b>{st?.persisted === true ? 'granted' : st?.persisted === false ? 'not granted (browser may evict data if storage is low – keep backups)' : 'unknown'}</b>
          {st?.usage != null && <> · used {fmtB(st.usage)} of {fmtB(st.quota)}</>}</p>
        <p class="small">Records: {TABLES.map(t => `${t} ${(s.data as any)[t].length}`).join(' · ')}</p>
        {last && <p class="small muted">Last backup exported {fmtDate(last.slice(0, 10))}</p>}
      </Card>
      <Card title="Export">
        <button class="btn primary block" onClick={doExport} data-testid="export-json">Export full backup (JSON)</button>
        <p class="muted small">Complete restorable backup incl. correction history, with an integrity checksum.</p>
        <button class="btn block" onClick={exportLedger} data-testid="export-ledger">Export all transactions (one CSV)</button>
        <button class="btn block" onClick={exportCSVs} data-testid="export-csv">Export each table as CSV</button>
        <p class="muted small">Customer histories: open a customer › Export CSV / Statement PDF. Monthly reports: Reports › Monthly.</p>
      </Card>
      <Card title="Restore from backup">
        <label class="btn block file-btn">Choose backup file (.json)<input type="file" accept="application/json,.json" onChange={onFile} data-testid="import-file" /></label>
        <Errors errors={err} />
        {pending && <div class="alert info" data-testid="restore-preview">
          <b>{pending.name}</b> is a valid backup exported {new Date(pending.obj.exportedAt).toLocaleString('en-GB')}.
          <ul>{Object.entries(pending.v.counts).map(([k, v]) => <li>{k}: {v}</li>)}</ul>
          {pending.v.warnings.map(w => <div class="warn-text small">{w}</div>)}
          <p><b>Restoring REPLACES all current data on this device.</b> Export a backup first if unsure.</p>
          <div class="row gap"><button class="btn ghost" onClick={() => setPending(null)}>Cancel</button><button class="btn danger" onClick={doRestore} data-testid="confirm-restore">Replace my data with this backup</button></div>
        </div>}
      </Card>
      <Card title="Demo & reset">
        <button class="btn block" data-testid="load-demo2" onClick={async () => { const ok = await ask('Add fictional demo data?', { body: '8 made-up customers with 2 years of transactions will be added.', okText: 'Add demo data' }); if (ok) { await bulkInsert(generateDemo(todayISO())); await refresh(); toast('Demo data loaded'); } }}>Load fictional demo data</button>
        <button class="btn danger block" data-testid="wipe" onClick={async () => {
          const r = await ask('Erase ALL data on this device?', { body: 'Type DELETE to confirm. This cannot be undone – export a backup first.', input: 'DELETE', danger: true, okText: 'Erase everything' });
          if (r === 'DELETE') { await clearAll(); await refresh(); toast('All data erased'); } else if (r) toast('Not erased – you must type DELETE', 'bad');
        }}>Erase all data</button>
      </Card>
    </Page>
  );
}
