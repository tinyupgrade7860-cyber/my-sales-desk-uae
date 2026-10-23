/** File export helpers: JSON / CSV / PDF. On iPhone uses the share sheet (Save to Files) when available. */
import { toCSV } from './backup';

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);

export async function saveFile(name: string, content: BlobPart | Uint8Array, mime: string) {
  const blob = new Blob([content as BlobPart], { type: mime });
  const nav: any = navigator;
  if (isIOS() && nav.canShare) {
    try {
      const file = new File([blob], name, { type: mime });
      if (nav.canShare({ files: [file] })) { await nav.share({ files: [file], title: name }); return 'shared'; }
    } catch (e: any) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

export const saveCSV = (name: string, rows: any[], cols?: Parameters<typeof toCSV>[1]) => saveFile(name, toCSV(rows, cols), 'text/csv;charset=utf-8');
export const saveJSON = (name: string, obj: any) => saveFile(name, JSON.stringify(obj, null, 1), 'application/json');

export interface PdfSection { heading: string; head: string[]; body: (string | number)[][]; foot?: (string | number)[] }
export async function savePDF(name: string, title: string, subtitle: string, sections: PdfSection[], landscape = false) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(16); doc.text(title, 40, 44);
  doc.setFontSize(9); doc.setTextColor(100); doc.text(subtitle, 40, 60);
  doc.text(`My Sales Desk UAE  |  Generated ${new Date().toLocaleString('en-GB')}  |  Private - fictional/demo data unless entered by you`, 40, 72);
  let y = 90;
  for (const s of sections) {
    doc.setFontSize(11); doc.setTextColor(15, 118, 110); doc.text(s.heading, 40, y); doc.setTextColor(0);
    autoTable(doc, {
      startY: y + 6, head: [s.head], body: s.body.map(r => r.map(String)), foot: s.foot ? [s.foot.map(String)] : undefined,
      styles: { fontSize: 7.5, cellPadding: 3 }, headStyles: { fillColor: [15, 118, 110] }, footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: 'bold' },
      margin: { left: 40, right: 40 }, theme: 'striped'
    });
    y = (doc as any).lastAutoTable.finalY + 24;
    if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 50; }
  }
  return saveFile(name, doc.output('arraybuffer'), 'application/pdf');
}
