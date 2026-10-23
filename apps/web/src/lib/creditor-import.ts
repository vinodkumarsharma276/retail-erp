import * as XLSX from 'xlsx';
import {
  parseCreditorSheet,
  REQUIRED_CREDITOR_COLUMNS,
  type CreditorSheetResult,
} from '@retailerp/shared-utils';

/**
 * Reading an uploaded creditors workbook in the browser.
 *
 * Parsing happens here rather than on the server, the same way the purchase
 * importer does it: the user sees what was understood before anything is
 * sent, and a sheet that turns out to be the wrong file never leaves the
 * machine. What goes to the API is mapped rows, not a file.
 */
export interface CreditorWorkbook extends CreditorSheetResult {
  fileName: string;
  sheetName: string;
  /** Every sheet in the file, so the user can pick a different one. */
  sheetNames: string[];
  /** Headings actually found, for when the expected ones are missing. */
  headers: string[];
}

/** Read one sheet of an already-loaded workbook. */
function readSheet(
  wb: XLSX.WorkBook,
  sheetName: string,
  fileName: string,
): CreditorWorkbook {
  const ws = wb.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json(ws, {
    raw: false,
    defval: '',
  }) as Record<string, unknown>[];

  // sheet_to_json takes row 1 as the header, so the first record is row 2.
  const parsed = parseCreditorSheet(records, 2);

  return {
    ...parsed,
    fileName,
    sheetName,
    sheetNames: wb.SheetNames,
    headers: Object.keys(records[0] ?? {}),
  };
}

export async function readCreditorWorkbook(
  file: File,
  sheetName?: string,
): Promise<CreditorWorkbook> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array', raw: false });
  if (wb.SheetNames.length === 0) {
    throw new Error('That file has no sheets in it.');
  }
  // A creditors export has one sheet; if several, prefer the one whose name
  // says so before falling back to the first.
  const chosen =
    sheetName ??
    wb.SheetNames.find((n) => /creditor|supplier|vendor/i.test(n)) ??
    wb.SheetNames[0];
  return readSheet(wb, chosen, file.name);
}

export { REQUIRED_CREDITOR_COLUMNS };
