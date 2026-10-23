/**
 * Customer statement of account: model (pure) + Excel (ExcelJS) + PDF (jsPDF/autotable) + ZIP (fflate).
 * All libraries are bundled with the app and lazy-loaded, so exports work offline.
 */
import type { DataSet, Customer } from '../types';
import { calcAllInvoices, cnEffective, deductionEffective, ageBucket, AGE_BUCKETS } from '../calc';
import { r2, sum, todayISO, fmtDate, EPS } from '../util';

const live = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter(x => !x.deleted);
export interface StLine { date: string; type: 'Invoice' | 'Payment' | 'Credit note' | 'Deduction'; ref: string; description: string; debit: number; credit: number; balance: number }
export interface StOpen { invoiceNo: string; date: string; due: string; gross: number; paid: number; adjustments: number; balance: number; daysOverdue: number; bucket: string; receipts: string }
export interface Statement {
  company: string; customer: Customer; from: string; to: string; generated: string; currency: string;
  opening: number; lines: StLine[]; totalDebit: number; totalCredit: number; closing: number;
  openInvoices: StOpen[]; ageing: Record<string, number>; unallocated: number;
}
export interface StOpts { from?: string; to?: string; company: string; currency?: string; today?: string }

/** Data as it stood on `to`: only records dated on/before the statement date. */
function asOf(ds: DataSet, to: string): DataSet {
  const colOk = new Set(live(ds.collections).filter(c => c.date <= to).map(c => c.id));
  return { ...ds, invoices: ds.invoices.filter(i => i.invoiceDate <= to), collections: ds.collections.filter(c => c.date <= to),
    allocations: ds.allocations.filter(a => colOk.has(a.collectionId)), creditNotes: ds.creditNotes.filter(c => c.date <= to), deductions: ds.deductions.filter(d => d.date <= to) };
}

export function buildStatement(ds0: DataSet, customerId: string, o: StOpts): Statement {
  const today = o.today || todayISO();
  const to = o.to || today, from = o.from || '';
  const customer = ds0.customers.find(c => c.id === customerId)!;
  const ds = asOf(ds0, to);
  const invNo = new Map(ds.invoices.map(i => [i.id, i.invoiceNo]));
  const raw: Omit<StLine, 'balance'>[] = [];
  for (const i of live(ds.invoices).filter(i => i.customerId === customerId))
    raw.push({ date: i.invoiceDate, type: 'Invoice', ref: i.invoiceNo, description: `Invoice${i.lpo ? ' · LPO ' + i.lpo : ''} · due ${fmtDate(i.dueDate)}`, debit: i.grossAmount, credit: 0 });
  for (const c of live(ds.collections).filter(c => c.customerId === customerId)) {
    const als = live(ds.allocations).filter(a => a.collectionId === c.id);
    const un = r2(c.amount - sum(als.map(a => a.amount)));
    const parts = [...als].sort((a, b) => (invNo.get(a.invoiceId) || '').localeCompare(invNo.get(b.invoiceId) || '')).map(a => `${invNo.get(a.invoiceId) || '?'} ${a.amount.toFixed(2)}`);
    if (un > EPS) parts.push(`on account ${un.toFixed(2)}`);
    raw.push({ date: c.date, type: 'Payment', ref: c.receiptRef, description: `${c.method}${c.chequeNo ? ' #' + c.chequeNo : ''} · allocated: ${parts.join('; ') || 'none'}`, debit: 0, credit: c.amount });
  }
  for (const c of ds.creditNotes.filter(c => c.customerId === customerId && cnEffective(c) > 0))
    raw.push({ date: c.date, type: 'Credit note', ref: c.cnRef, description: `${c.reason}${c.invoiceId ? ' · against ' + invNo.get(c.invoiceId) : ''}`, debit: 0, credit: cnEffective(c) });
  for (const d of ds.deductions.filter(d => d.customerId === customerId && deductionEffective(d) > 0))
    raw.push({ date: d.date, type: 'Deduction', ref: d.ref, description: `${d.status} deduction · ${d.reason}${d.invoiceId ? ' · ' + invNo.get(d.invoiceId) : ''}`, debit: 0, credit: deductionEffective(d) });
  raw.sort((a, b) => a.date.localeCompare(b.date) || (a.debit ? -1 : 1) || a.ref.localeCompare(b.ref));
  let bal = 0, opening = 0;
  const lines: StLine[] = [];
  for (const r of raw) {
    bal = r2(bal + r.debit - r.credit);
    if (from && r.date < from) { opening = bal; continue; }
    lines.push({ ...r, balance: bal });
  }
  const closing = lines.length ? lines[lines.length - 1].balance : opening;
  const { map } = calcAllInvoices(ds, to);
  const ageing: Record<string, number> = Object.fromEntries(AGE_BUCKETS.map(b => [b, 0]));
  const openInvoices: StOpen[] = [];
  for (const c of [...map.values()].filter(c => c.invoice.customerId === customerId && Math.abs(c.remaining) > EPS).sort((a, b) => a.invoice.invoiceDate.localeCompare(b.invoice.invoiceDate))) {
    const receipts = live(ds.allocations).filter(a => a.invoiceId === c.invoice.id).map(a => { const col = ds.collections.find(x => x.id === a.collectionId)!; return `${col.receiptRef} ${fmtDate(col.date)}: ${a.amount.toFixed(2)}`; }).join('; ');
    const b = ageBucket(c);
    ageing[b] = r2(ageing[b] + c.remaining);
    openInvoices.push({ invoiceNo: c.invoice.invoiceNo, date: c.invoice.invoiceDate, due: c.invoice.dueDate, gross: c.invoice.grossAmount, paid: c.allocated, adjustments: c.adjustments, balance: c.remaining, daysOverdue: c.daysOverdue, bucket: b, receipts });
  }
  const unallocated = r2(sum(openInvoices.map(o => o.balance)) - closing);
  return { company: o.company, customer, from, to, generated: today, currency: o.currency || 'AED', opening, lines, totalDebit: sum(lines.map(l => l.debit)), totalCredit: sum(lines.map(l => l.credit)), closing, openInvoices, ageing, unallocated };
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
export const statementFileName = (st: Statement, ext: string) => `Statement_${safe(st.customer.code || st.customer.name)}_${st.to}.${ext}`;
const periodText = (st: Statement) => `${st.from ? fmtDate(st.from) : 'Beginning'} – ${fmtDate(st.to)}`;
const d = (s: string) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));

// ---------- Excel ----------
const NUM = '#,##0.00;[Red]-#,##0.00';
async function excel() { const m: any = await import('exceljs'); return m.default || m; }
function sheetName(wb: any, name: string) {
  let base = name.replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Customer', n = base, k = 2;
  while (wb.getWorksheet(n)) n = `${base.slice(0, 25)} ${k++}`;
  return n;
}
function writeStatementSheet(wb: any, st: Statement) {
  const ws = wb.addWorksheet(sheetName(wb, st.customer.name), { views: [{ state: 'frozen', ySplit: 0 }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 13 }, { width: 13 }, { width: 16 }, { width: 52 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 13 }, { width: 40 }];
  const teal = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  const light = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  const border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  const head = (r: any) => r.eachCell((c: any) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = teal; c.alignment = { vertical: 'middle', wrapText: true }; });
  ws.mergeCells('A1:G1'); ws.getCell('A1').value = st.company; ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0F766E' } };
  ws.mergeCells('A2:G2'); ws.getCell('A2').value = 'STATEMENT OF ACCOUNT'; ws.getCell('A2').font = { bold: true, size: 12 };
  const info: [string, any, string, any][] = [
    ['Customer', st.customer.name, 'Statement date', d(st.to)], ['Customer code', st.customer.code, 'Period', periodText(st)],
    ['TRN', st.customer.trn || '-', 'Currency', st.currency], ['Emirate', st.customer.emirate || '-', 'Payment terms', `${st.customer.paymentTermsDays} days`]
  ];
  info.forEach((r, i) => {
    const row = ws.getRow(4 + i);
    row.getCell(1).value = r[0]; row.getCell(1).font = { bold: true, color: { argb: 'FF475569' } };
    ws.mergeCells(4 + i, 2, 4 + i, 4); row.getCell(2).value = r[1];
    row.getCell(5).value = r[2]; row.getCell(5).font = { bold: true, color: { argb: 'FF475569' } };
    ws.mergeCells(4 + i, 6, 4 + i, 7); row.getCell(6).value = r[3]; if (r[3] instanceof Date) row.getCell(6).numFmt = 'dd-mmm-yyyy';
  });
  let y = 9;
  const ob = ws.getRow(y); ob.getCell(1).value = 'Opening balance'; ob.getCell(1).font = { bold: true }; ob.getCell(7).value = st.opening; ob.getCell(7).numFmt = NUM; ob.getCell(7).font = { bold: true };
  y += 2;
  const hr = ws.getRow(y); hr.values = ['Date', 'Type', 'Reference', 'Description / allocation', 'Debit', 'Credit', 'Balance']; head(hr); hr.height = 20;
  ws.views = [{ state: 'frozen', ySplit: y }];
  for (const l of st.lines) {
    y++;
    const r = ws.getRow(y);
    r.values = [d(l.date), l.type, l.ref, l.description, l.debit || null, l.credit || null, l.balance];
    r.getCell(1).numFmt = 'dd-mmm-yyyy'; [5, 6, 7].forEach(c => (r.getCell(c).numFmt = NUM));
    r.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    r.eachCell((c: any) => (c.border = border));
  }
  y++;
  const tr = ws.getRow(y); tr.values = ['Totals', '', '', '', st.totalDebit, st.totalCredit, st.closing]; tr.eachCell((c: any) => { c.font = { bold: true }; c.fill = light; }); [5, 6, 7].forEach(c => (tr.getCell(c).numFmt = NUM));
  y += 2;
  ws.getCell(y, 1).value = `Open invoices as at ${fmtDate(st.to)}`; ws.getCell(y, 1).font = { bold: true, size: 12 };
  y++;
  const oh = ws.getRow(y); oh.values = ['Invoice date', 'Due date', 'Invoice No', 'Receipts allocated', 'Gross', 'Paid', 'Balance', 'Days overdue', 'Credit notes / deductions']; head(oh);
  for (const o of st.openInvoices) {
    y++;
    const r = ws.getRow(y);
    r.values = [d(o.date), d(o.due), o.invoiceNo, o.receipts || '-', o.gross, o.paid, o.balance, o.daysOverdue, o.adjustments || null];
    [1, 2].forEach(c => (r.getCell(c).numFmt = 'dd-mmm-yyyy')); [5, 6, 7, 9].forEach(c => (r.getCell(c).numFmt = NUM));
    r.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    if (o.daysOverdue > 0) r.getCell(8).font = { color: { argb: 'FFB91C1C' }, bold: true };
    r.eachCell((c: any) => (c.border = border));
  }
  if (st.unallocated > EPS) { y++; const r = ws.getRow(y); r.getCell(4).value = 'Unallocated receipts (on account)'; r.getCell(7).value = -st.unallocated; r.getCell(7).numFmt = NUM; }
  y += 2;
  ws.getCell(y, 1).value = 'Ageing'; ws.getCell(y, 1).font = { bold: true, size: 12 };
  y++;
  const ah = ws.getRow(y); ah.values = [...AGE_BUCKETS.map(b => (b === 'Not due' ? 'Not due' : b + ' days')), 'Total']; head(ah);
  y++;
  const av = ws.getRow(y); av.values = [...AGE_BUCKETS.map(b => st.ageing[b]), sum(Object.values(st.ageing))]; av.eachCell((c: any) => (c.numFmt = NUM));
  y += 2;
  const cr = ws.getRow(y); cr.getCell(5).value = 'Closing balance'; cr.getCell(5).font = { bold: true, size: 12 }; cr.getCell(7).value = st.closing; cr.getCell(7).numFmt = NUM; cr.getCell(7).font = { bold: true, size: 12 };
  ws.getCell(y + 2, 1).value = `Generated ${fmtDate(st.generated)} with My Sales Desk UAE. Please report any discrepancy within 15 days.`;
  ws.getCell(y + 2, 1).font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
  return ws;
}
export async function statementsXlsx(sts: Statement[]): Promise<Uint8Array> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'My Sales Desk UAE'; wb.created = new Date();
  if (sts.length > 1) {
    const s = wb.addWorksheet('Summary');
    s.columns = [{ header: 'Customer', width: 38 }, { header: 'Code', width: 12 }, { header: 'Opening', width: 14 }, { header: 'Debits', width: 14 }, { header: 'Credits', width: 14 }, { header: 'Closing balance', width: 16 }, ...AGE_BUCKETS.map(b => ({ header: b, width: 12 }))];
    s.getRow(1).eachCell((c: any) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }; });
    for (const st of sts) s.addRow([st.customer.name, st.customer.code, st.opening, st.totalDebit, st.totalCredit, st.closing, ...AGE_BUCKETS.map(b => st.ageing[b])]);
    const tot = s.addRow(['Total', '', sum(sts.map(x => x.opening)), sum(sts.map(x => x.totalDebit)), sum(sts.map(x => x.totalCredit)), sum(sts.map(x => x.closing)), ...AGE_BUCKETS.map(b => sum(sts.map(x => x.ageing[b])))]);
    tot.font = { bold: true };
    s.eachRow((r: any, i: number) => { if (i > 1) for (let c = 3; c <= 6 + AGE_BUCKETS.length; c++) r.getCell(c).numFmt = NUM; });
    s.views = [{ state: 'frozen', ySplit: 1 }];
  }
  for (const st of sts) writeStatementSheet(wb, st);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ---------- PDF ----------
async function drawStatement(doc: any, autoTable: any, st: Statement) {
  const W = doc.internal.pageSize.getWidth();
  const m = 36;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(15, 118, 110); doc.text(st.company, m, 46);
  doc.setFontSize(12); doc.setTextColor(30); doc.text('STATEMENT OF ACCOUNT', W - m, 46, { align: 'right' });
  doc.setDrawColor(15, 118, 110); doc.setLineWidth(1.2); doc.line(m, 54, W - m, 54);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(60);
  const left = [['Customer', st.customer.name], ['Code', st.customer.code], ['TRN', st.customer.trn || '-'], ['Emirate', st.customer.emirate || '-']];
  const right = [['Statement date', fmtDate(st.to)], ['Period', periodText(st)], ['Currency', st.currency], ['Terms', `${st.customer.paymentTermsDays} days`]];
  left.forEach(([k, v], i) => { doc.setFont('helvetica', 'bold'); doc.text(k, m, 72 + i * 13); doc.setFont('helvetica', 'normal'); doc.text(String(v).slice(0, 60), m + 62, 72 + i * 13); });
  right.forEach(([k, v], i) => { doc.setFont('helvetica', 'bold'); doc.text(k, W / 2 + 40, 72 + i * 13); doc.setFont('helvetica', 'normal'); doc.text(String(v), W / 2 + 120, 72 + i * 13); });
  const n = (v: number) => (v ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const nz = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const common = { styles: { fontSize: 7.5, cellPadding: 3, valign: 'top' }, headStyles: { fillColor: [15, 118, 110] }, footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: 'bold' }, margin: { left: m, right: m }, theme: 'striped' };
  autoTable(doc, { ...common, startY: 130,
    head: [['Date', 'Type', 'Reference', 'Description / allocation', 'Debit', 'Credit', 'Balance']],
    body: [[{ content: 'Opening balance', colSpan: 6, styles: { fontStyle: 'bold' } }, { content: nz(st.opening), styles: { fontStyle: 'bold', halign: 'right' } }],
      ...st.lines.map(l => [fmtDate(l.date), l.type, l.ref, l.description, n(l.debit), n(l.credit), nz(l.balance)])],
    foot: [['Totals', '', '', '', nz(st.totalDebit), nz(st.totalCredit), nz(st.closing)]],
    columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 50 }, 2: { cellWidth: 62 }, 4: { halign: 'right', cellWidth: 60 }, 5: { halign: 'right', cellWidth: 60 }, 6: { halign: 'right', cellWidth: 64 } } });
  let y = doc.lastAutoTable.finalY + 18;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(15, 118, 110); doc.text(`Open invoices as at ${fmtDate(st.to)}`, m, y);
  autoTable(doc, { ...common, startY: y + 6,
    head: [['Invoice No', 'Date', 'Due', 'Gross', 'Paid', 'CN/Ded.', 'Balance', 'Days o/d', 'Receipts allocated']],
    body: st.openInvoices.length ? st.openInvoices.map(o => [o.invoiceNo, fmtDate(o.date), fmtDate(o.due), nz(o.gross), n(o.paid), n(o.adjustments), nz(o.balance), o.daysOverdue ? String(o.daysOverdue) : '-', o.receipts || '-'])
      : [[{ content: 'No open invoices', colSpan: 9 }]],
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { cellWidth: 120 } } });
  y = doc.lastAutoTable.finalY + 18;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(15, 118, 110); doc.text('Ageing', m, y);
  autoTable(doc, { ...common, startY: y + 6, head: [[...AGE_BUCKETS.map(b => (b === 'Not due' ? b : b + ' days')), 'Total']], body: [[...AGE_BUCKETS.map(b => nz(st.ageing[b])), nz(sum(Object.values(st.ageing)))]], columnStyles: Object.fromEntries((AGE_BUCKETS.map((_, i) => [i, { halign: "right" }]) as any[]).concat([[AGE_BUCKETS.length, { halign: 'right', fontStyle: 'bold' }]])) });
  y = doc.lastAutoTable.finalY + 22;
  if (y > doc.internal.pageSize.getHeight() - 70) { doc.addPage(); y = 50; }
  doc.setFontSize(11); doc.setTextColor(20); doc.setFont('helvetica', 'bold');
  if (st.unallocated > EPS) { doc.setFontSize(9); doc.text(`Unallocated receipts (on account): ${nz(st.unallocated)}`, m, y); y += 14; doc.setFontSize(11); }
  doc.text(`Closing balance: ${st.currency} ${nz(st.closing)}`, W - m, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
  doc.text('Please report any discrepancy within 15 days. Generated with My Sales Desk UAE.', m, y + 18);
}
export async function statementsPdf(sts: Statement[]): Promise<ArrayBuffer> {
  const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable: any = (at as any).default || (at as any).autoTable;
  const doc: any = new jsPDF({ unit: 'pt', format: 'a4' });
  const starts: { page: number; name: string }[] = [];
  for (let i = 0; i < sts.length; i++) {
    if (i > 0) doc.addPage();
    starts.push({ page: doc.getNumberOfPages(), name: sts[i].customer.name });
    await drawStatement(doc, autoTable, sts[i]);
  }
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const own = [...starts].reverse().find(s => s.page <= p)!;
    doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(`${own.name}  ·  page ${p} of ${total}`, doc.internal.pageSize.getWidth() - 36, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }
  return doc.output('arraybuffer');
}
export async function zipFiles(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  const { zipSync } = await import('fflate');
  return zipSync(files, { level: 6 });
}
export const DEFAULT_COMPANY = 'Bisbelluk Trading LLC';
export { todayISO };
