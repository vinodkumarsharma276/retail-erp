import path from 'node:path';
import { aiEnabled } from '../config.js';
import type { ParseResult, RawTransaction } from '../types.js';
import { aiExtractFromImage, aiExtractFromPdfFile, aiExtractFromText, type AiExtractResult } from './ai.js';
import { detectAccountHint, detectBank, detectIfsc } from './bankDetect.js';
import { detectCurrency, reconciliationRate } from './normalize.js';
import { extractPdfLines } from './pdf.js';
import { parseSpreadsheet } from './spreadsheet.js';
import { parseLines } from './textTable.js';

export { PdfPasswordError } from './pdf.js';

export const SPREADSHEET_EXT = ['.xlsx', '.xls', '.xlsm', '.csv', '.ods', '.tsv'];
export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
export const SUPPORTED_EXT = ['.pdf', ...SPREADSHEET_EXT, ...IMAGE_EXT];

export class UnsupportedError extends Error {}

export interface ParseInput {
  buffer: Buffer;
  fileName: string;
  password?: string;
}

/** Put rows oldest-first so running balances and charts read naturally. */
function chronological(rows: RawTransaction[]) {
  if (rows.length > 1 && rows[0].date > rows[rows.length - 1].date) return [...rows].reverse();
  return rows;
}

function recon(rows: RawTransaction[]) {
  return reconciliationRate(rows);
}

function fromAi(ai: AiExtractResult, method: ParseResult['method'], warnings: string[]): ParseResult {
  const rows = chronological(ai.transactions);
  return { transactions: rows, method, bank: ai.bank, accountHint: ai.accountHint, currency: ai.currency, warnings, reconciliation: recon(rows) };
}

export async function parseStatement({ buffer, fileName, password }: ParseInput): Promise<ParseResult> {
  const ext = path.extname(fileName).toLowerCase();
  const warnings: string[] = [];

  if (IMAGE_EXT.includes(ext)) {
    if (!aiEnabled()) throw new UnsupportedError('Images need AI extraction. Add OPENAI_API_KEY to .env.');
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return fromAi(await aiExtractFromImage(buffer, mime, fileName), 'ai-vision', warnings);
  }

  if (SPREADSHEET_EXT.includes(ext)) {
    const sheet = parseSpreadsheet(buffer, fileName);
    warnings.push(...sheet.warnings);
    let rows = chronological(sheet.rows);
    const base = {
      bank: detectBank(sheet.text) ?? detectBank(fileName),
      accountHint: detectAccountHint(sheet.text),
      ifsc: detectIfsc(sheet.text),
      currency: detectCurrency(sheet.text),
    };
    if (rows.length === 0 && aiEnabled()) {
      warnings.push('Could not map spreadsheet columns; used AI to read the sheet.');
      const ai = await aiExtractFromText(sheet.text, fileName);
      return { ...fromAi(ai, 'ai-text', warnings), bank: base.bank ?? ai.bank, currency: base.currency ?? ai.currency, ifsc: base.ifsc };
    }
    return { transactions: rows, method: 'spreadsheet', ...base, warnings, reconciliation: recon(rows) };
  }

  if (ext === '.pdf') {
    const { lines, pageCount, charCount } = await extractPdfLines(buffer, password);
    const text = lines.map((l) => l.text).join('\n');
    const base = {
      bank: detectBank(text) ?? detectBank(fileName),
      accountHint: detectAccountHint(text),
      ifsc: detectIfsc(text),
      currency: detectCurrency(text),
    };

    // Scanned PDF: almost no text layer.
    if (charCount < 80 * pageCount) {
      if (!aiEnabled()) throw new UnsupportedError('This PDF is a scanned image. Add OPENAI_API_KEY to .env to read it with AI.');
      if (password) warnings.push('Scanned, password-protected PDFs may fail; if so, save an unlocked copy and retry.');
      const ai = await aiExtractFromPdfFile(buffer, fileName);
      return { ...fromAi(ai, 'ai-vision', warnings), bank: base.bank ?? ai.bank, ifsc: base.ifsc };
    }

    const heuristic = parseLines(lines, { fallbackOrder: base.currency === 'USD' ? 'mdy' : 'dmy' });
    const hRows = chronological(heuristic.rows);
    const hRecon = recon(hRows);
    const poor = hRows.length < 3 || (hRecon !== null && hRecon < 0.9);

    if (poor && aiEnabled()) {
      const ai = await aiExtractFromText(text, fileName);
      const aRows = chronological(ai.transactions);
      const aRecon = recon(aRows);
      const aiBetter = aRows.length > 0 && (hRows.length < 3 || (aRecon ?? 0) >= (hRecon ?? 0));
      if (aiBetter) {
        return {
          transactions: aRows,
          method: 'ai-text',
          bank: base.bank ?? ai.bank,
          accountHint: base.accountHint ?? ai.accountHint,
          ifsc: base.ifsc,
          currency: base.currency ?? ai.currency,
          warnings: [...warnings, 'Layout was unusual; AI was used to read this statement.'],
          reconciliation: aRecon,
        };
      }
    }
    warnings.push(...heuristic.warnings);
    if (hRows.length === 0) throw new UnsupportedError('No transactions found in this PDF.');
    return { transactions: hRows, method: 'pdf-text', ...base, warnings, reconciliation: hRecon };
  }

  throw new UnsupportedError(`Unsupported file type "${ext}". Use PDF, Excel/CSV, or PNG/JPG.`);
}
