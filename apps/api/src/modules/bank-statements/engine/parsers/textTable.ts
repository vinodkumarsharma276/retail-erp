import type { Line } from './pdf.js';
import type { RawTransaction } from '../types.js';
import { DATE_TOKEN, detectDateOrder, parseAmount, parseDate, round2, type DateOrder, type ParsedAmount } from './normalize.js';

type ColKey = 'date' | 'desc' | 'ref' | 'debit' | 'credit' | 'amount' | 'balance' | 'drcr';

const HEADER_WORDS: [ColKey, RegExp][] = [
  ['date', /^(txn\.?\s*|tran\.?\s*|transaction\s*|value\s*|posting\s*)?date$/i],
  ['desc', /^(narration|description|particulars|details|transaction details|remarks|transaction remarks|transaction description)$/i],
  ['ref', /^(chq\.?\s*\/?\s*ref\.?\s*no\.?|ref\.?\s*no\.?|cheque\s*no\.?|chq\.?\s*no\.?|reference(\s*no\.?)?|ref)$/i],
  ['debit', /^(withdrawal(s)?(\s*amt\.?)?(\s*\(?(dr|inr|rs\.?)\)?)?|debit(s)?(\s*amount)?(\s*\(?(inr|rs\.?)\)?)?|dr\.?|paid out|money out)$/i],
  ['credit', /^(deposit(s)?(\s*amt\.?)?(\s*\(?(cr|inr|rs\.?)\)?)?|credit(s)?(\s*amount)?(\s*\(?(inr|rs\.?)\)?)?|cr\.?|paid in|money in)$/i],
  ['amount', /^(amount|transaction amount|amt)(\s*\(?(inr|rs\.?|₹)\)?)?$/i],
  ['balance', /^((closing|running|available)\s*)?balance(\s*\(?(inr|rs\.?|₹)\)?)?$/i],
  ['drcr', /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type)$/i],
];

const SKIP_LINE =
  /^(opening balance|closing balance|balance (b\/f|c\/f|brought|carried)|total|grand total|page \d|statement summary|\*+\s*end|this is a (computer|system) generated)/i;
const OPENING = /opening balance|balance b\/f|brought forward/i;

type Cols = Partial<Record<ColKey, number>>; // x-centre of each column

/** Header cells can wrap ("Closing" / "Balance"); join cells from the next line that overlap horizontally. */
function headerCells(line: Line, next?: Line) {
  const cells = line.items.map((i) => ({ ...i }));
  if (!next) return cells;
  for (const it of next.items) {
    const over = cells.find((c) => it.x < c.x + c.w + 2 && c.x < it.x + it.w + 2);
    if (over) {
      over.str = `${over.str} ${it.str}`;
      const right = Math.max(over.x + over.w, it.x + it.w);
      over.x = Math.min(over.x, it.x);
      over.w = right - over.x;
    } else cells.push({ ...it });
  }
  return cells;
}

/** Detect a table header, optionally wrapped onto the following line. */
function detectHeader(line: Line, next?: Line): { cols: Cols; consumedNext: boolean } | null {
  const single = classifyCells(line.items);
  const canWrap = next && next.page === line.page && Math.abs(line.y - next.y) <= 14 && !DATE_TOKEN.test(next.text);
  const merged = canWrap ? classifyCells(headerCells(line, next)) : null;
  const count = (c: Cols | null) => (c ? Object.keys(c).length : 0);
  if (merged && count(merged) > count(single)) return { cols: merged, consumedNext: true };
  return single ? { cols: single, consumedNext: false } : null;
}

function classifyCells(cells: { str: string; x: number; w: number }[]): Cols | null {
  const cols: Cols = {};
  for (const it of cells) {
    const s = it.str.replace(/\s+/g, ' ').trim();
    for (const [key, re] of HEADER_WORDS) {
      if (re.test(s) && cols[key] === undefined) {
        cols[key] = it.x + it.w / 2;
        break;
      }
    }
  }
  const hasMoney = (cols.debit !== undefined && cols.credit !== undefined) || cols.amount !== undefined;
  return cols.date !== undefined && hasMoney && (cols.desc !== undefined || cols.balance !== undefined) ? cols : null;
}

export function isAmountStr(s: string) {
  if (!/\d/.test(s)) return false;
  if (!/^\(?-?(?:[₹$€£]|Rs\.?|INR)?\s?-?(\d{1,3}(,\d{2,3})+|\d+)(\.\d{1,2})?\)?(\s?(cr|dr)\.?)?$/i.test(s)) return false;
  // Require a decimal part, grouping comma or Dr/Cr marker so bare reference numbers aren't read as money.
  return /[.,]/.test(s) || /(cr|dr)\.?$/i.test(s);
}

interface Draft {
  dateRaw: string;
  desc: string[];
  ref: string | null;
  debit: number | null;
  credit: number | null;
  amount: ParsedAmount | null;
  balance: number | null;
  drcrHint: 'dr' | 'cr' | null;
}

interface SignRow {
  amount: number;
  balance: number | null;
  fixed: boolean;
  magnitude: number;
}

/**
 * Parse transaction rows from positioned text lines (PDF). Works with or without a detected
 * header; with a header, amounts are assigned to Debit/Credit/Balance columns by x-position.
 */
export function parseLines(lines: Line[], opts: { fallbackOrder?: DateOrder } = {}) {
  const warnings: string[] = [];
  const dateOrder = detectDateOrder(
    lines.map((l) => l.text),
    opts.fallbackOrder ?? 'dmy',
  );
  let header: Cols | null = null;
  let sawHeader = false;
  let openingBalance: number | null = null;
  const drafts: Draft[] = [];
  let current: Draft | null = null;

  const nearestCol = (x: number, keys: ColKey[]): ColKey | null => {
    if (!header) return null;
    let best: ColKey | null = null;
    let bestD = Infinity;
    for (const k of keys) {
      const cx = header[k];
      if (cx === undefined) continue;
      const d = Math.abs(cx - x);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const h = detectHeader(line, lines[li + 1]);
    if (h) {
      header = h.cols;
      sawHeader = true;
      current = null;
      if (h.consumedNext) li++;
      continue;
    }

    const text = line.text.trim();
    if (!text) continue;
    if (OPENING.test(text)) {
      const amts = line.items.filter((i) => isAmountStr(i.str));
      if (amts.length) openingBalance = parseAmount(amts[amts.length - 1].str)?.value ?? null;
      current = null;
      continue;
    }
    if (SKIP_LINE.test(text)) {
      current = null;
      continue;
    }

    const first = line.items[0]?.str ?? '';
    const dateMatch = first.match(DATE_TOKEN) ?? text.slice(0, 24).match(DATE_TOKEN);
    const startsWithDate = !!dateMatch && text.indexOf(dateMatch[0]) <= 3 && !!parseDate(dateMatch[0], dateOrder);

    if (startsWithDate) {
      const draft: Draft = { dateRaw: dateMatch![0], desc: [], ref: null, debit: null, credit: null, amount: null, balance: null, drcrHint: null };
      current = draft;
      drafts.push(draft);
      const unassigned: ParsedAmount[] = [];
      let datesStripped = 0;
      for (const it of line.items) {
        let s = it.str;
        // Strip leading date tokens (transaction date and optional value date).
        while (datesStripped < 2) {
          const dm = s.match(DATE_TOKEN);
          if (dm && s.indexOf(dm[0]) === 0 && parseDate(dm[0], dateOrder)) {
            s = s.slice(dm[0].length).trim();
            datesStripped++;
          } else break;
        }
        if (!s) continue;
        const cx = it.x + it.w / 2;
        if (isAmountStr(s)) {
          const v = parseAmount(s)!;
          const col = nearestCol(cx, ['debit', 'credit', 'amount', 'balance', 'desc', 'ref']);
          if (col === 'debit') draft.debit = v.value;
          else if (col === 'credit') draft.credit = v.value;
          else if (col === 'balance') draft.balance = v.drcr === 'dr' || v.negative ? -v.value : v.value;
          else if (col === 'amount') draft.amount = v;
          else unassigned.push(v);
          continue;
        }
        if (/^(cr|dr)\.?$/i.test(s)) {
          draft.drcrHint = s.slice(0, 2).toLowerCase() as 'cr' | 'dr';
          continue;
        }
        const col = nearestCol(cx, ['desc', 'ref', 'date']);
        if (col === 'ref' && /\d/.test(s) && s.length <= 30) draft.ref = s;
        else draft.desc.push(s);
      }
      draft.desc = [draft.desc.join(' ')];
      // No header / no column hit: last amount is the balance, the one before is the transaction amount.
      if (unassigned.length) {
        if (draft.debit == null && draft.credit == null && draft.amount == null) {
          if (unassigned.length >= 2) {
            const bal = unassigned[unassigned.length - 1];
            draft.balance = bal.drcr === 'dr' || bal.negative ? -bal.value : bal.value;
            draft.amount = unassigned[unassigned.length - 2];
          } else draft.amount = unassigned[0];
        } else if (draft.balance == null) {
          draft.balance = unassigned[unassigned.length - 1].value;
        }
      }
      continue;
    }

    // Continuation of a multi-line narration.
    if (current && current.desc.length < 8) {
      const extra = line.items
        .filter((i) => !isAmountStr(i.str))
        .map((i) => i.str)
        .join(' ')
        .trim();
      if (extra && extra.length < 160) current.desc.push(extra);
    }
  }

  // Banks usually wrap narrations at a fixed character width, cutting words in half
  // ("SAMSUNG INDIA ELEC" / "TRONICS"). If most wrapped first lines share the same max length,
  // a full-width line was cut mid-word and joins without a space; shorter lines broke at a space.
  const wrapped = drafts.filter((d) => d.desc.length > 1).map((d) => d.desc[0].length);
  const wrapWidth = wrapped.length ? Math.max(...wrapped) : 0;
  const fixedWidth = wrapped.length >= 3 && wrapped.filter((n) => n === wrapWidth).length / wrapped.length >= 0.4;
  const joinDesc = (parts: string[]) =>
    parts.reduce((acc, part, i) => {
      if (i === 0) return part;
      const prev = parts[i - 1];
      const midWord = fixedWidth && prev.length === wrapWidth && /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(part);
      return acc + (midWord ? '' : ' ') + part;
    }, '');

  const rows: (RawTransaction & SignRow)[] = [];
  for (const d of drafts) {
    const date = parseDate(d.dateRaw, dateOrder);
    if (!date) continue;
    let magnitude: number | null = null;
    let sign: 1 | -1 | 0 = 0;
    if (d.debit != null && d.debit > 0) {
      magnitude = d.debit;
      sign = -1;
    } else if (d.credit != null && d.credit > 0) {
      magnitude = d.credit;
      sign = 1;
    } else if (d.amount) {
      magnitude = d.amount.value;
      const hint = d.amount.drcr ?? d.drcrHint;
      if (hint) sign = hint === 'dr' ? -1 : 1;
      else if (d.amount.negative) sign = -1;
    }
    if (magnitude == null || magnitude === 0) continue;
    const description = joinDesc(d.desc).replace(/\s+/g, ' ').trim() || '(no description)';
    rows.push({
      date,
      description,
      amount: sign ? sign * magnitude : -magnitude,
      balance: d.balance,
      reference: d.ref,
      fixed: sign !== 0,
      magnitude,
    });
  }

  resolveSignsFromBalance(rows, openingBalance);
  if (!sawHeader && rows.length) warnings.push('No column header detected; amounts were inferred from line positions.');
  return {
    rows: rows.map(({ fixed: _f, magnitude: _m, ...r }) => r as RawTransaction),
    dateOrder,
    warnings,
  };
}

/**
 * Where the sign isn't known from a column, derive it from the running balance.
 * Handles statements listed newest-first by testing both orders.
 */
export function resolveSignsFromBalance(rows: SignRow[], opening: number | null) {
  if (!rows.some((r) => !r.fixed)) return;
  const score = (order: SignRow[]) => {
    let hits = 0;
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1].balance;
      const b = order[i].balance;
      if (a != null && b != null && Math.abs(Math.abs(round2(b - a)) - order[i].magnitude) < 0.011) hits++;
    }
    return hits;
  };
  const reversed = [...rows].reverse();
  const isReversed = score(reversed) > score(rows);
  const seq = isReversed ? reversed : rows;
  for (let i = 0; i < seq.length; i++) {
    const r = seq[i];
    if (r.fixed || r.balance == null) continue;
    const prev = i > 0 ? seq[i - 1].balance : isReversed ? null : opening;
    if (prev == null) continue;
    const delta = round2(r.balance - prev);
    if (Math.abs(Math.abs(delta) - r.magnitude) < 0.011) r.amount = delta > 0 ? r.magnitude : -r.magnitude;
  }
}
