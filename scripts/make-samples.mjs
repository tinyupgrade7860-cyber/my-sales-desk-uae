// Generates FICTIONAL sample customer-statement files for testing the importer.
// node scripts/make-samples.mjs  ->  samples/*.xlsx|pdf|csv and public/samples/*
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import fs from 'node:fs';

const AS_OF = '2026-10-22';
const day = (s) => new Date(s + 'T00:00:00Z');
const ageing = (d) => Math.round((day(AS_OF) - day(d)) / 86400000);
const dmy = (s) => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
const C = ['Al Noor Grocery LLC (Fictional)', 'Crescent Foods Trading (Fictional)', 'Marina Mini Mart (Fictional)'];
const S = ['Sample Salesman', 'Sample Salesman', 'Second Rep (Fictional)'];
// [invoice, date, customerIdx, total, received]
const raw = [
  ['BT-26-0101', '2026-06-15', 0, 12000, 12000], ['BT-26-0118', '2026-07-03', 0, 8500, 4000], ['BT-26-0142', '2026-08-11', 0, 15250.5, 0],
  ['BT-26-0156', '2026-09-02', 0, 4300, 0], ['BT-26-0107', '2026-06-20', 1, 22000, 22000], ['BT-26-0133', '2026-07-28', 1, 9800, 5000],
  ['BT-26-0161', '2026-09-14', 1, 18760, 0], ['BT-26-0177', '2026-10-05', 1, 6400, 0], ['BT-26-0112', '2026-06-25', 2, 3150, 0],
  ['BT-26-0149', '2026-08-19', 2, 2780.4, 1000], ['BT-26-0170', '2026-09-28', 2, 5120, 0], ['BT-26-0183', '2026-10-12', 2, 1990, 0]
];
const r2 = (n) => Math.round(n * 100) / 100;
const rows = raw.map(([no, d, c, total, rec]) => {
  const tax = r2(total * 0.05), grand = r2(total + tax), received = rec ? (rec >= total ? grand : rec) : 0;
  return { no, d, cust: C[c], sm: S[c], total, tax, grand, received, balance: r2(grand - received), age: ageing(d), remarks: received >= grand ? 'Settled' : received ? 'Part paid' : '' };
});
const HEAD = ['Invoice No', 'Billing Date', 'Sales Man', 'Customer', 'Total Amount', 'Tax Amount', 'Grand Total', 'Received Amount', 'Balance', 'Ageing Days', 'Remarks'];
fs.mkdirSync('samples', { recursive: true }); fs.mkdirSync('public/samples', { recursive: true });
const out = (name, data) => { fs.writeFileSync('samples/' + name, data); fs.writeFileSync('public/samples/' + name, data); };

// XLSX: title block above the table (importer finds the header row), real Excel dates
const aoa = [['Bisbelluk Trading LLC - Customer Statement (FICTIONAL SAMPLE)'], [`As of ${dmy(AS_OF)}`], [], HEAD,
  ...rows.map(r => [r.no, { t: 'd', v: new Date(r.d + 'T00:00:00Z'), z: 'dd/mm/yyyy' }, r.sm, r.cust, r.total, r.tax, r.grand, r.received, r.balance, r.age, r.remarks]),
  [], ['Total', '', '', '', r2(rows.reduce((a, r) => a + r.total, 0)), r2(rows.reduce((a, r) => a + r.tax, 0)), r2(rows.reduce((a, r) => a + r.grand, 0)), r2(rows.reduce((a, r) => a + r.received, 0)), r2(rows.reduce((a, r) => a + r.balance, 0))]];
const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
ws['!cols'] = [14, 12, 20, 34, 13, 11, 13, 15, 13, 11, 12].map(w => ({ wch: w }));
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Statement');
out('sample-statement-2026-10.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
// legacy .xls with lower-case / spaced header variants
const ws2 = XLSX.utils.aoa_to_sheet([['invoice  no', 'BILLING DATE', 'Salesman', 'customer name', 'Total amount', 'VAT', 'Grand total', 'Received', 'Balance amount', 'Aging days', 'remarks'],
  ...rows.slice(0, 4).map(r => [r.no, dmy(r.d), r.sm, r.cust, r.total, r.tax, r.grand, r.received, r.balance, r.age, r.remarks])]);
const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, ws2, 'Sheet1');
out('sample-statement-variants.xls', XLSX.write(wb2, { type: 'buffer', bookType: 'biff8' }));

// text PDF (landscape table)
const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
doc.setFontSize(14); doc.text('Bisbelluk Trading LLC - Customer Statement', 40, 40);
doc.setFontSize(9); doc.text(`FICTIONAL SAMPLE  |  As of ${dmy(AS_OF)}`, 40, 56);
const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
autoTable(doc, { startY: 70, head: [HEAD], body: rows.map(r => [r.no, dmy(r.d), r.sm, r.cust, fmt(r.total), fmt(r.tax), fmt(r.grand), fmt(r.received), fmt(r.balance), String(r.age), r.remarks]),
  foot: [['Total', '', '', '', fmt(r2(rows.reduce((a, r) => a + r.total, 0))), fmt(r2(rows.reduce((a, r) => a + r.tax, 0))), fmt(r2(rows.reduce((a, r) => a + r.grand, 0))), fmt(r2(rows.reduce((a, r) => a + r.received, 0))), fmt(r2(rows.reduce((a, r) => a + r.balance, 0))), '', '']],
  styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' }, headStyles: { fillColor: [15, 118, 110] }, columnStyles: { 3: { cellWidth: 150 }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } }, margin: { left: 30, right: 30 } });
out('sample-statement-2026-10.pdf', Buffer.from(doc.output('arraybuffer')));

// CSV with deliberate problems, to show validation
const bad = [HEAD.join(','),
  'BT-26-0201,05/10/2026,Sample Salesman,"Al Noor Grocery LLC (Fictional)",1000.00,50.00,1100.00,0,1100.00,17,Grand total wrong',
  'BT-26-0202,31/02/2026,Sample Salesman,"Al Noor Grocery LLC (Fictional)",500.00,25.00,525.00,0,525.00,0,Bad date',
  'BT-26-0203,06/10/2026,Sample Salesman,,800.00,40.00,840.00,0,840.00,16,No customer',
  'BT-26-0204,07/10/2026,Sample Salesman,"Marina Mini Mart (Fictional)",2000.00,100.00,2100.00,500.00,1900.00,15,Balance wrong',
  'BT-26-0204,07/10/2026,Sample Salesman,"Marina Mini Mart (Fictional)",2000.00,100.00,2100.00,500.00,1600.00,15,Duplicate',
  'BT-26-0205,08/10/2026,Sample Salesman,"Marina Mini Mart (Fictional)",300.00,15.00,315.00,0,315.00,14,OK'];
out('sample-statement-with-errors.csv', '\uFEFF' + bad.join('\r\n') + '\r\n');
console.log('samples written', rows.length, 'rows; total balance', r2(rows.reduce((a, r) => a + r.balance, 0)));
