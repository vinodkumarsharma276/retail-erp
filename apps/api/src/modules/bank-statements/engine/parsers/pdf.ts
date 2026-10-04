import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface TextItem {
  str: string;
  x: number; // left edge
  w: number;
}
export interface Line {
  page: number;
  y: number;
  items: TextItem[];
  text: string; // items joined with gap-aware spacing (2+ spaces = column gap)
}

export class PdfPasswordError extends Error {
  constructor(public needsPassword: boolean) {
    super(needsPassword ? 'This PDF is password protected. Enter the password and retry.' : 'Incorrect PDF password.');
  }
}

/** Load a PDF and rebuild visual lines from positioned text runs. */
export async function extractPdfLines(data: Buffer, password?: string): Promise<{ lines: Line[]; pageCount: number; charCount: number }> {
  let doc: PDFDocumentProxy;
  const task = getDocument({
    data: new Uint8Array(data),
    password: password || undefined,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    doc = await task.promise;
  } catch (err: any) {
    if (err?.name === 'PasswordException') throw new PdfPasswordError(err.code === 1);
    throw err;
  }

  const lines: Line[] = [];
  let charCount = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const runs: { str: string; x: number; y: number; w: number; h: number }[] = [];
    for (const it of content.items as any[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      runs.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height || 8 });
      charCount += it.str.length;
    }
    // Group runs into rows: same baseline within ~40% of the glyph height.
    runs.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: (typeof runs)[] = [];
    for (const r of runs) {
      const row = rows.find((rw) => Math.abs(rw[0].y - r.y) <= Math.max(2, r.h * 0.4));
      if (row) row.push(r);
      else rows.push([r]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      // Merge runs that touch (pdfs often split words into glyph runs).
      const items: TextItem[] = [];
      for (const r of row) {
        const last = items[items.length - 1];
        const gap = last ? r.x - (last.x + last.w) : Infinity;
        if (last && gap < Math.max(1.5, r.h * 0.25)) {
          last.str += (gap > r.h * 0.1 ? ' ' : '') + r.str;
          last.w = r.x + r.w - last.x;
        } else {
          items.push({ str: r.str, x: r.x, w: r.w });
        }
      }
      let text = '';
      for (let i = 0; i < items.length; i++) {
        if (i > 0) {
          const gap = items[i].x - (items[i - 1].x + items[i - 1].w);
          text += gap > 12 ? '   ' : ' ';
        }
        text += items[i].str.trim();
      }
      lines.push({ page: p, y: row[0].y, items: items.map((i) => ({ ...i, str: i.str.trim() })), text });
    }
    page.cleanup();
  }
  const pageCount = doc.numPages;
  await task.destroy();
  return { lines, pageCount, charCount };
}
