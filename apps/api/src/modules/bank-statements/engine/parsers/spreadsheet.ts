import * as XLSX from 'xlsx';
import type { RawTransaction } from '../types.js';
import { detectDateOrder, parseAmount, parseDate, round2 } from './normalize.js';
import { resolveSignsFromBalance } from './textTable.js';

type Col = 'date' | 'desc' | 'ref' | 'debit' | 'credit' | 'amount' | 'balance' | 'drcr';

// Tested against a normalized (lowercased, single-spaced) header cell. First match wins per cell.
const HEADER_TESTS: [Col, RegExp][] = [
  ['drcr', /^(dr\s*\/\s*cr|cr\s*\/\s*dr|debit\s*\/\s*credit|credit\s*\/\s*debit|type|txn type|transaction type)$/],
  ['balance', /balance/],
  ['debit', /withdraw|debit|\bdr\b|paid out|money out/],
  ['credit', /deposit|credit|\bcr\b|paid in|money in/],
  ['ref', /chq|cheque|ref|utr/],
  ['date', /date/],
  ['desc', /narration|description|particular|detail|remark|memo|payee|merchant/],
  ['amount', /amount|amt/],
];

export interface SheetParse {
  rows: RawTransaction[];
  text: string; // CSV-ish dump, useful for bank detection and AI fallback
  warnings: string[];
}

function normHeader(v: unknown) {
  return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function mapHeader(row: unknown[]): Partial<Record<Col, number>> | null {
  const map: Partial<Record<Col, number>> = {};
  row.forEach((cell, idx) => {
    const h = normHeader(cell);
    if (!h || h.length > 60) return;
    for (const [col, re] of HEADER_TESTS) {
      if (re.test(h)) {
        // Prefer the transaction date over value date when both exist.
        if (map[col] === undefined || (col === 'date' && /txn|tran|posting/.test(h))) map[col] = idx;
        break;
      }
    }
  });
  const money = (map.debit !== undefined && map.credit !== undefined) || map.amount !== undefined || map.debit !== undefined;
  return map.date !== undefined && money && map.desc !== undefined ? map : null;
}

export function parseSpreadsheet(buf: Buffer, fileName: string, fallbackOrder: 'dmy' | 'mdy' = 'dmy'): SheetParse {
  // Text formats: keep cells as strings so dd/mm dates aren't reinterpreted as US mm/dd by SheetJS.
  const isText = /\.(csv|tsv|txt)$/i.test(fileName);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: isText });
  const warnings: string[] = [];
  const rows: RawTransaction[] = [];
  const textParts: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    textParts.push(XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).slice(0, 200_000));

    let headerIdx = -1;
    let map: Partial<Record<Col, number>> | null = null;
    for (let i = 0; i < Math.min(grid.length, 60); i++) {
      map = mapHeader(grid[i]);
      if (map) {
        headerIdx = i;
        break;
      }
    }
    if (!map) continue;
    const m = map;

    const dateSamples = grid.slice(headerIdx + 1, headerIdx + 200).map((r) => (typeof r[m.date!] === 'string' ? (r[m.date!] as string) : ''));
    const order = detectDateOrder(dateSamples, fallbackOrder);

    const sheetRows: (RawTransaction & { fixed: boolean; magnitude: number })[] = [];
    let blankRun = 0;
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const r = grid[i];
      const date = parseDate(r[m.date!], order);
      if (!date) {
        // Continuation line of a wrapped narration directly below a transaction.
        const d = m.desc !== undefined ? r[m.desc] : null;
        const onlyDesc = d && r.filter((c) => c !== null && c !== '').length === 1;
        if (onlyDesc && sheetRows.length) sheetRows[sheetRows.length - 1].description += ' ' + String(d).trim();
        if (++blankRun > 25 && sheetRows.length) break;
        continue;
      }
      blankRun = 0;
      const debit = m.debit !== undefined ? parseAmount(r[m.debit]) : null;
      const credit = m.credit !== undefined ? parseAmount(r[m.credit]) : null;
      const amt = m.amount !== undefined ? parseAmount(r[m.amount]) : null;
      const bal = m.balance !== undefined ? parseAmount(r[m.balance]) : null;
      const drcr = m.drcr !== undefined ? normHeader(r[m.drcr]) : '';

      let magnitude = 0;
      let sign: 1 | -1 | 0 = 0;
      if (debit && debit.value > 0) {
        magnitude = debit.value;
        sign = -1;
      } else if (credit && credit.value > 0) {
        magnitude = credit.value;
        sign = 1;
      } else if (amt && amt.value > 0) {
        magnitude = amt.value;
        if (drcr) sign = /^(cr|c|credit|deposit)/.test(drcr) ? 1 : -1;
        else if (amt.drcr) sign = amt.drcr === 'dr' ? -1 : 1;
        else if (amt.negative) sign = -1;
      }
      if (!magnitude) continue;

      const description = String(m.desc !== undefined ? (r[m.desc] ?? '') : '').replace(/\s+/g, ' ').trim() || '(no description)';
      sheetRows.push({
        date,
        description,
        amount: round2((sign || -1) * magnitude),
        balance: bal ? round2(bal.drcr === 'dr' || bal.negative ? -bal.value : bal.value) : null,
        reference: m.ref !== undefined && r[m.ref] != null ? String(r[m.ref]).trim() || null : null,
        fixed: sign !== 0,
        magnitude,
      });
    }
    if (sheetRows.some((r) => !r.fixed) && m.amount !== undefined && m.drcr === undefined) {
      warnings.push(`Sheet "${sheetName}": single amount column without Dr/Cr — direction inferred from balance.`);
    }
    resolveSignsFromBalance(sheetRows, null);
    rows.push(...sheetRows.map(({ fixed: _f, magnitude: _m, ...rest }) => rest));
  }

  return { rows, text: textParts.join('\n'), warnings };
}
