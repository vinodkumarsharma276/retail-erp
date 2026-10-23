import * as XLSX from 'xlsx';
import { isValidElement, type ReactNode } from 'react';

/**
 * Getting a table out of the screen and into a file or a printer.
 *
 * The awkward part is that a column renders JSX, not text: a cell might be
 * a badge, a link, an amount in a coloured span. So each value is looked
 * for in the places most likely to hold it in plain form, and only read off
 * the rendered node as a last resort.
 */

/** Pull the text out of whatever a column's `render` returned. */
export function textFromNode(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join(' ').replace(/\s+/g, ' ').trim();
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return textFromNode(props.children);
  }
  return '';
}

export interface ExportColumn<T> {
  key: string;
  header: string;
  /** Plain value for this cell, if the column knows one. */
  exportValue?: (row: T) => string | number | null | undefined;
  sortAccessor?: (row: T) => string | number | Date | null | undefined;
  render: (row: T, index: number) => ReactNode;
}

/** One cell, as text. */
export function cellText<T>(col: ExportColumn<T>, row: T, index: number): string {
  if (col.exportValue) {
    const v = col.exportValue(row);
    return v == null ? '' : String(v);
  }
  if (col.sortAccessor) {
    const v = col.sortAccessor(row);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v != null) return String(v);
  }
  const raw = (row as Record<string, unknown>)[col.key];
  if (raw != null && (typeof raw === 'string' || typeof raw === 'number')) return String(raw);
  return textFromNode(col.render(row, index));
}

/** Header row plus one row per record. */
export function toGrid<T>(columns: ExportColumn<T>[], rows: T[]): string[][] {
  return [
    columns.map((c) => c.header || c.key),
    ...rows.map((row, i) => columns.map((col) => cellText(col, row, i))),
  ];
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the download a tick to start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv<T>(columns: ExportColumn<T>[], rows: T[], fileName: string) {
  const grid = toGrid(columns, rows);
  const csv = grid
    .map((line) =>
      line
        // Quote anything a spreadsheet would otherwise read as structure.
        .map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(','),
    )
    .join('\r\n');
  // The BOM is what makes Excel read it as UTF-8 rather than mangling ₹.
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `${fileName}.csv`);
}

export function exportExcel<T>(columns: ExportColumn<T>[], rows: T[], fileName: string) {
  const grid = toGrid(columns, rows);
  const sheet = XLSX.utils.aoa_to_sheet(grid);
  sheet['!cols'] = grid[0].map((_, col) => ({
    // Wide enough for the longest thing in the column, within reason.
    wch: Math.min(50, Math.max(10, ...grid.map((line) => (line[col] ?? '').length + 2))),
  }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Export');
  XLSX.writeFile(book, `${fileName}.xlsx`);
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/**
 * Print through a hidden iframe rather than a new window: no popup to be
 * blocked, and the app's own stylesheet cannot bleed into the page.
 */
export function printTable<T>(
  columns: ExportColumn<T>[],
  rows: T[],
  title: string,
  subtitle?: string,
) {
  const grid = toGrid(columns, rows);
  const [head, ...body] = grid;
  const alignedRight = columns.map((c) => c.key);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 11px/1.4 -apple-system, Segoe UI, Roboto, sans-serif; color: #111; margin: 16px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  p.sub { margin: 0 0 12px; color: #555; font-size: 11px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fafafa; }
  @page { margin: 12mm; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
</style></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ''}
  <table>
    <thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${body
      .map((line) => `<tr>${line.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
      .join('')}</tbody>
  </table>
</body></html>`;
  void alignedRight;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const run = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Leave it around long enough for the dialog to take its copy.
    setTimeout(() => frame.remove(), 1000);
  };
  if (doc.readyState === 'complete') run();
  else frame.onload = run;
}
