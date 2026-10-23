/**
 * Customer-statement file parsing (pure; no DB). Supports .xlsx/.xls/.csv (SheetJS, bundled) and
 * text-based PDFs (pdf.js, bundled). Everything runs in the browser, offline.
 */
import { r2, isValidISODate, toISODate, daysBetween, todayISO } from '../util';

export type StmtField = 'invoiceNo' | 'billingDate' | 'salesman' | 'customer' | 'total' | 'tax' | 'grand' | 'received' | 'balance' | 'ageing' | 'remarks';
export const FIELD_LABELS: Record<StmtField, string> = {
  invoiceNo: 'Invoice No', billingDate: 'Billing Date', salesman: 'Sales Man', customer: 'Customer', total: 'Total Amount', tax: 'Tax Amount',
  grand: 'Grand Total', received: 'Received Amount', balance: 'Balance', ageing: 'Ageing Days', remarks: 'Remarks'
};
/** Header synonyms, compared after lower-casing and removing everything except letters/digits. */
const SYNONYMS: Record<StmtField, string[]> = {
  invoiceNo: ['invoiceno', 'invoicenumber', 'invoice', 'invno', 'invnumber', 'invoiceref', 'billno', 'billnumber', 'docno', 'documentno', 'documentnumber', 'voucherno', 'invoiceid'],
  billingDate: ['billingdate', 'billdate', 'invoicedate', 'invdate', 'date', 'docdate', 'documentdate', 'postingdate'],
  salesman: ['salesman', 'salesmen', 'salesperson', 'salesexecutive', 'salesrep', 'rep', 'salesmanname', 'executive'],
  customer: ['customer', 'customername', 'party', 'partyname', 'client', 'clientname', 'account', 'accountname', 'customeraccount'],
  total: ['totalamount', 'total', 'amount', 'netamount', 'net', 'taxableamount', 'taxablevalue', 'amountexclvat', 'amountexvat', 'value', 'grossbeforetax'],
  tax: ['taxamount', 'tax', 'vat', 'vatamount', 'vat5', 'taxvalue', 'outputvat'],
  grand: ['grandtotal', 'grossamount', 'gross', 'totalinclvat', 'totalincvat', 'invoiceamount', 'invoicevalue', 'amountinclvat', 'nettotal', 'totalwithvat'],
  received: ['receivedamount', 'received', 'receivedamt', 'paid', 'paidamount', 'amountpaid', 'amountreceived', 'collected', 'collection', 'receipts', 'settled'],
  balance: ['balance', 'balanceamount', 'balanceamt', 'outstanding', 'outstandingamount', 'dueamount', 'amountdue', 'pending', 'balancedue', 'netbalance'],
  ageing: ['ageingdays', 'agingdays', 'ageing', 'aging', 'age', 'days', 'overduedays', 'daysoutstanding'],
  remarks: ['remarks', 'remark', 'notes', 'note', 'comments', 'comment', 'narration', 'description']
};
export const normHeader = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchHeader(cell: any): StmtField | null {
  const h = normHeader(cell);
  if (!h) return null;
  for (const f of Object.keys(SYNONYMS) as StmtField[]) if (SYNONYMS[f].includes(h)) return f;
  return null;
}

/** Find the header row (first row with >= 4 recognised columns, incl. invoice no). */
export function findHeader(rows: any[][]): { index: number; cols: Partial<Record<StmtField, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cols: Partial<Record<StmtField, number>> = {};
    (rows[i] || []).forEach((c, j) => { const f = matchHeader(c); if (f && cols[f] == null) cols[f] = j; });
    if (Object.keys(cols).length >= 4 && cols.invoiceNo != null) return { index: i, cols };
  }
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** Excel serial date -> ISO (1900 date system, incl. the 1900 leap-year bug offset). */
export function excelSerialToISO(n: number): string | null {
  if (!isFinite(n) || n < 1 || n > 2958465) return null;
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** Parse statement dates. UAE files use day-first: 05/08/2026 = 5 Aug 2026. */
export function parseDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return toISODate(v);
  if (typeof v === 'number') return excelSerialToISO(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/);
  if (m) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // clearly month-first
    return iso(y4(+m[3]), mo, d);
  }
  m = s.match(/^(\d{1,2})[-/. ]?([A-Za-z]{3,9})[-/. ,]*(\d{2,4})$/);
  if (m) { const mo = MONTHS[m[2].toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return iso(y4(+m[3]), mo, +m[1]); }
  m = s.match(/^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -](\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  if (/^\d+(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) return excelSerialToISO(+s);
  return null;
}
const y4 = (y: number) => (y < 100 ? 2000 + y : y);
function iso(y: number, m: number, d: number) {
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidISODate(s) ? s : null;
}
/** Parse amounts: "1,234.50", "AED 1,234.50", "(200.00)" = -200, "-", "" = null. */
export function parseNum(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? r2(v) : null;
  let s = String(v).trim();
  if (!s || s === '-' || s === '—') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/aed|dhs?|\s/gi, '').replace(/,/g, '');
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? r2(neg ? -n : n) : null;
}

export interface ParsedRow {
  line: number; // 1-based row in the source (sheet row or PDF line)
  invoiceNo: string;
  billingDate: string | null;
  rawDate: string;
  salesman: string;
  customer: string;
  total: number;
  tax: number;
  grand: number;
  received: number;
  balance: number;
  fileAgeing: number | null;
  ageing: number | null; // recomputed: as-of date - billing date
  remarks: string;
  errors: string[]; // row cannot be imported
  warnings: string[]; // importable, but check
}
export interface ParseResult { rows: ParsedRow[]; columns: Partial<Record<StmtField, number>>; headerLine: number; missingColumns: StmtField[]; skipped: number }

/** Turn a 2-D table (header row somewhere at the top) into validated statement rows. */
export function rowsToStatement(table: any[][], asOf = todayISO()): ParseResult {
  const h = findHeader(table);
  if (!h) throw new Error('Could not find the header row. Expected columns like: Invoice No, Billing Date, Customer, Total Amount, Tax Amount, Grand Total, Received Amount, Balance.');
  const get = (r: any[], f: StmtField) => (h.cols[f] == null ? '' : r[h.cols[f]!]);
  const out: ParsedRow[] = [];
  let skipped = 0;
  const seen = new Map<string, number>();
  for (let i = h.index + 1; i < table.length; i++) {
    const r = table[i] || [];
    if (r.every(c => String(c ?? '').trim() === '')) continue;
    if (findHeader([r])) { skipped++; continue; } // header repeated on next PDF page
    const invoiceNo = String(get(r, 'invoiceNo') ?? '').trim();
    const customer = String(get(r, 'customer') ?? '').trim().replace(/\s+/g, ' ');
    const firstText = String(r.find(c => String(c ?? '').trim()) ?? '').toLowerCase();
    const totalsLine = /^(grand\s*)?totals?\b|^sub\s*total|^balance\b|^page\s|^closing/.test(firstText);
    if (totalsLine && (!invoiceNo || !customer)) { skipped++; continue; } // totals / footer lines
    const rawDateV = get(r, 'billingDate');
    const row: ParsedRow = {
      line: i + 1, invoiceNo, customer, salesman: String(get(r, 'salesman') ?? '').trim(), remarks: String(get(r, 'remarks') ?? '').trim(),
      rawDate: typeof rawDateV === 'number' ? String(rawDateV) : String(rawDateV ?? '').trim(), billingDate: parseDate(rawDateV),
      total: 0, tax: 0, grand: 0, received: 0, balance: 0, fileAgeing: parseNum(get(r, 'ageing')), ageing: null, errors: [], warnings: []
    };
    let total = parseNum(get(r, 'total')), tax = parseNum(get(r, 'tax')), grand = parseNum(get(r, 'grand'));
    const received = parseNum(get(r, 'received')), balance = parseNum(get(r, 'balance'));
    if (!invoiceNo) row.errors.push('Missing invoice number.');
    if (!row.billingDate) row.errors.push(row.rawDate ? `Bad billing date "${row.rawDate}".` : 'Missing billing date.');
    if (!customer) row.errors.push('Missing customer.');
    if (grand == null && total != null) { grand = r2(total + (tax || 0)); row.warnings.push('Grand Total missing - calculated as Total + Tax.'); }
    if (total == null && grand != null) { total = r2(grand - (tax || 0)); }
    if (tax == null) tax = total != null && grand != null ? r2(grand - total) : 0;
    if (grand == null) row.errors.push('Missing amounts (Grand Total / Total Amount).');
    row.total = total ?? 0; row.tax = tax ?? 0; row.grand = grand ?? 0; row.received = received ?? 0;
    if (grand != null && total != null && Math.abs(r2(row.total + row.tax) - row.grand) > 0.01)
      row.warnings.push(`Grand Total mismatch: ${row.grand.toFixed(2)} ≠ Total ${row.total.toFixed(2)} + Tax ${row.tax.toFixed(2)} = ${r2(row.total + row.tax).toFixed(2)}.`);
    const expBal = r2(row.grand - row.received);
    if (balance == null) { row.balance = expBal; }
    else {
      row.balance = balance;
      if (Math.abs(balance - expBal) > 0.01) row.warnings.push(`Balance mismatch: file ${balance.toFixed(2)} ≠ Grand Total − Received = ${expBal.toFixed(2)}.`);
    }
    if (row.received > row.grand + 0.01) row.warnings.push('Received is more than Grand Total.');
    if (row.billingDate) {
      row.ageing = daysBetween(row.billingDate, asOf);
      if (row.ageing < 0) row.warnings.push('Billing date is in the future.');
      if (row.fileAgeing != null && Math.abs(row.fileAgeing - row.ageing) > 1) row.warnings.push(`Ageing in file (${row.fileAgeing}) differs from recomputed ${row.ageing} days.`);
    }
    const key = invoiceNo.toLowerCase();
    if (invoiceNo && seen.has(key)) row.errors.push(`Duplicate invoice number in file (also on row ${seen.get(key)}).`);
    else if (invoiceNo) seen.set(key, row.line);
    out.push(row);
  }
  const missingColumns = (['invoiceNo', 'billingDate', 'customer', 'grand'] as StmtField[]).filter(f => h.cols[f] == null && !(f === 'grand' && h.cols.total != null));
  return { rows: out, columns: h.cols, headerLine: h.index + 1, missingColumns, skipped };
}

// ---------- PDF text layout -> table ----------
export interface PdfItem { str: string; x: number; y: number; w: number; page: number }
interface Cell { text: string; x0: number; x1: number }

/** Group PDF text items into lines (same baseline) and merge touching items into cells. */
export function pdfItemsToLines(items: PdfItem[]): Cell[][] {
  const byPage = new Map<number, PdfItem[]>();
  for (const it of items) if (it.str.trim()) (byPage.get(it.page) || byPage.set(it.page, []).get(it.page)!).push(it);
  const lines: Cell[][] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const its = byPage.get(page)!.sort((a, b) => b.y - a.y || a.x - b.x);
    const groups: PdfItem[][] = [];
    for (const it of its) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g[0].y - it.y) <= 3) g.push(it); else groups.push([it]);
    }
    for (const g of groups) {
      g.sort((a, b) => a.x - b.x);
      const cells: Cell[] = [];
      for (const it of g) {
        const last = cells[cells.length - 1];
        const gap = last ? it.x - last.x1 : Infinity;
        if (last && gap < 3.5) { last.text += (gap > 0.8 ? ' ' : '') + it.str; last.x1 = Math.max(last.x1, it.x + it.w); }
        else cells.push({ text: it.str, x0: it.x, x1: it.x + it.w });
      }
      cells.forEach(c => (c.text = c.text.replace(/\s+/g, ' ').trim()));
      lines.push(cells);
    }
  }
  return lines;
}

/** Convert PDF lines into a 2-D table using the header line's column positions. */
export function pdfLinesToTable(lines: Cell[][]): any[][] {
  const hi = lines.findIndex(l => l.filter(c => matchHeader(c.text)).length >= 4 && l.some(c => matchHeader(c.text) === 'invoiceNo'));
  if (hi < 0) throw new Error('No statement table header found in the PDF (is it a scanned image? Only text-based PDFs can be read).');
  const head = lines[hi];
  const centers = head.map(c => (c.x0 + c.x1) / 2);
  const table: any[][] = [head.map(c => c.text)];
  for (let i = hi + 1; i < lines.length; i++) {
    const row: string[] = head.map(() => '');
    for (const c of lines[i]) {
      // choose the header column with the largest horizontal overlap, else the nearest centre
      let best = -1, bestOv = 0;
      head.forEach((h, j) => { const ov = Math.min(h.x1, c.x1) - Math.max(h.x0, c.x0); if (ov > bestOv) { bestOv = ov; best = j; } });
      if (best < 0) { const cc = (c.x0 + c.x1) / 2; let d = Infinity; centers.forEach((x, j) => { if (Math.abs(x - cc) < d) { d = Math.abs(x - cc); best = j; } }); }
      row[best] = row[best] ? row[best] + ' ' + c.text : c.text;
    }
    table.push(row);
  }
  return table;
}

// ---------- file readers (lazy-load heavy libraries) ----------
export async function readSheetTable(buf: ArrayBuffer, name: string): Promise<any[][]> {
  const XLSX = await import('xlsx');
  const isCsv = /\.csv$/i.test(name);
  const wb = isCsv ? XLSX.read(new TextDecoder().decode(buf).replace(/^\uFEFF/, ''), { type: 'string', raw: true }) : XLSX.read(new Uint8Array(buf), { type: 'array' });
  // first sheet that has a recognisable header
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
    if (findHeader(rows)) return rows;
  }
  return XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
}

let pdfjsP: Promise<any> | null = null;
async function pdfjs() {
  if (!pdfjsP) pdfjsP = (async () => {
    const lib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (typeof window !== 'undefined') {
      const w: any = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      lib.GlobalWorkerOptions.workerSrc = w.default;
    }
    return lib;
  })();
  return pdfjsP;
}
export async function readPdfItems(buf: ArrayBuffer): Promise<PdfItem[]> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const items: PdfItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items as any[]) if ('str' in it) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p });
  }
  await doc.destroy();
  return items;
}
export async function readPdfTable(buf: ArrayBuffer): Promise<any[][]> {
  const items = await readPdfItems(buf);
  if (!items.some(i => i.str.trim())) throw new Error('This PDF has no text layer (probably scanned). Please export the statement as Excel or a text PDF.');
  return pdfLinesToTable(pdfItemsToLines(items));
}

export function fileKind(name: string): 'xlsx' | 'xls' | 'csv' | 'pdf' | null {
  const m = name.toLowerCase().match(/\.(xlsx|xls|csv|pdf)$/);
  return (m?.[1] as any) || null;
}
export async function parseStatementFile(buf: ArrayBuffer, name: string, asOf = todayISO()): Promise<ParseResult & { kind: string }> {
  const kind = fileKind(name);
  if (!kind) throw new Error('Unsupported file type. Use .xlsx, .xls, .csv or a text-based .pdf');
  const table = kind === 'pdf' ? await readPdfTable(buf) : await readSheetTable(buf, name);
  return { ...rowsToStatement(table, asOf), kind };
}

/** SHA-256 (hex) of the file bytes - used to recognise a re-import of the same file. */
export async function fileHash(buf: ArrayBuffer): Promise<string> {
  const c: any = (globalThis as any).crypto;
  if (c?.subtle) { const h = await c.subtle.digest('SHA-256', buf); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  let h = 0x811c9dc5; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return 'fnv' + h.toString(16);
}
