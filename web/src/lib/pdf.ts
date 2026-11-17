// A minimal PDF writer: text only, built-in Helvetica, A4, automatic line wrapping and page breaks.
// No library and no font file, so it works offline and adds almost nothing to the bundle.

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;

type Line = { text: string; size: number; bold: boolean };

/** Replace anything the built-in encoding cannot show, so a stray character never corrupts the file. */
function latin(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7e]/g, '?');
}

const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Break text into lines that fit the page. Helvetica averages about half the font size per character. */
function wrap(text: string, size: number): string[] {
  const width = Math.floor((PAGE_W - 2 * MARGIN) / (size * 0.5));
  const out: string[] = [];
  for (const paragraph of latin(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      let w = word;
      while (w.length > width) {
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if ((line ? line.length + 1 : 0) + w.length > width) { out.push(line); line = w; }
      else line = line ? `${line} ${w}` : w;
    }
    out.push(line);
  }
  return out;
}

export interface PdfBlock { text: string; size?: number; bold?: boolean }

export function buildPdf(blocks: PdfBlock[]): Uint8Array {
  const lines: Line[] = [];
  for (const b of blocks) {
    const size = b.size ?? 10;
    for (const text of wrap(b.text, size)) lines.push({ text, size, bold: b.bold ?? false });
  }
  // Paginate.
  const pages: Line[][] = [[]];
  let y = PAGE_H - MARGIN;
  for (const line of lines) {
    const step = line.size * 1.35;
    if (y - step < MARGIN) { pages.push([]); y = PAGE_H - MARGIN; }
    pages[pages.length - 1]!.push(line);
    y -= step;
  }

  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages, filled below
  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds: number[] = [];
  for (const page of pages) {
    let cursor = PAGE_H - MARGIN;
    let stream = 'BT\n';
    let x = 0;
    for (const line of page) {
      const step = line.size * 1.35;
      cursor -= step;
      stream += `/${line.bold ? 'F2' : 'F1'} ${line.size} Tf\n1 0 0 1 ${MARGIN} ${cursor.toFixed(2)} Tm\n(${escape(line.text)}) Tj\n`;
      x++;
    }
    stream += 'ET';
    void x;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is 7-bit ASCII after latin(), so one byte per character.
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
