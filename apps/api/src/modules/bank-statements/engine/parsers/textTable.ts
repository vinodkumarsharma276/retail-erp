import type { Line } from './pdf.js';
import type { RawTransaction } from '../types.js';
import { DATE_TOKEN, detectDateOrder, parseAmount, parseDate, round2, type DateOrder, type ParsedAmount } from './normalize.js';

type ColKey = 'date' | 'desc' | 'ref' | 'type' | 'debit' | 'credit' | 'amount' | 'balance' | 'drcr';

/**
 * Column header words. `weak` entries (a bare "Dr" / "Cr") only name a column when no
 * explicit header does: Federal Bank prints a "DR/CR" balance-marker column whose "DR"
 * would otherwise be read as the Withdrawals column, turning every withdrawal into a deposit.
 */
const HEADER_WORDS: [ColKey, RegExp, { weak?: boolean }?][] = [
  ['date', /^(txn\.?\s*|tran\.?\s*|transaction\s*|value\s*|posting\s*)?date$/i],
  ['desc', /^(narration|description|particulars|details|transaction details|remarks|transaction remarks|transaction description)$/i],
  ['ref', /^(chq\.?\s*\/?\s*ref\.?\s*no\.?|ref\.?\s*no\.?|cheque\s*no\.?|chq\.?\s*no\.?|reference(\s*no\.?)?|ref|(tran|txn|transaction)\.?\s*id)$/i],
  // A transaction-type code column (Federal Bank: TFR / CLG / CASH / FT). Kept out of the narration.
  ['type', /^(tran|txn|transaction)\.?\s*type$/i],
  ['debit', /^(withdrawal(s)?(\s*amt\.?)?(\s*\(?(dr|inr|rs\.?)\)?)?|debit(s)?(\s*amount)?(\s*\(?(inr|rs\.?)\)?)?|paid out|money out)$/i],
  ['credit', /^(deposit(s)?(\s*amt\.?)?(\s*\(?(cr|inr|rs\.?)\)?)?|credit(s)?(\s*amount)?(\s*\(?(inr|rs\.?)\)?)?|paid in|money in)$/i],
  ['amount', /^(amount|transaction amount|amt)(\s*\(?(inr|rs\.?|₹)\)?)?$/i],
  ['balance', /^((closing|running|available)\s*)?balance(\s*\(?(inr|rs\.?|₹)\)?)?$/i],
  ['drcr', /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type)$/i],
  ['debit', /^dr\.?$/i, { weak: true }],
  ['credit', /^cr\.?$/i, { weak: true }],
];

const SKIP_LINE =
  /^(opening balance|closing balance|balance (b\/f|c\/f|brought|carried)|total|grand total|page \d|statement summary|\*+\s*end|this is a (computer|system) generated)/i;
const OPENING = /opening balance|balance b\/f|brought forward/i;

type Cols = Partial<Record<ColKey, number>>; // x-centre of each column

/**
 * Page headers and footers ("The Federal Bank Ltd. Corporate Office: … Page 3 of 18"): the same
 * text, digits aside, among the first or last few lines of most pages. Left in, they'd be read as
 * the next line of whichever narration ends the page. Short or reference-like lines never count,
 * so a narration continuation that happens to recur ("/…@ybl/Payment f/…") is kept.
 */
function boilerplateLines(lines: Line[]): Set<Line> {
  const byPage = new Map<number, Line[]>();
  for (const l of lines) {
    const list = byPage.get(l.page);
    if (list) list.push(l);
    else byPage.set(l.page, [l]);
  }
  if (byPage.size < 3) return new Set();
  const key = (l: Line) => l.text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
  const pagesOf = new Map<string, Set<number>>();
  const edgeLines: Line[] = [];
  for (const [page, list] of byPage) {
    const sorted = [...list].sort((a, b) => b.y - a.y);
    for (const l of new Set([...sorted.slice(0, 3), ...sorted.slice(-3)])) {
      if (l.text.includes('@') || key(l).replace(/[^a-z]/g, '').length < 12 || DATE_TOKEN.test(l.text.slice(0, 24))) continue;
      const k = key(l);
      if (!pagesOf.has(k)) pagesOf.set(k, new Set());
      pagesOf.get(k)!.add(page);
      edgeLines.push(l);
    }
  }
  const min = Math.max(3, Math.ceil(byPage.size * 0.6));
  return new Set(edgeLines.filter((l) => (pagesOf.get(key(l))?.size ?? 0) >= min));
}

/** Header cells can wrap ("Closing" / "Balance"); join cells from the following lines that overlap horizontally. */
function headerCells(line: Line, ...more: Line[]) {
  const cells = line.items.map((i) => ({ ...i }));
  for (const next of more) {
    for (const it of next.items) {
      const over = cells.find((c) => it.x < c.x + c.w + 2 && c.x < it.x + it.w + 2);
      if (over) {
        over.str = `${over.str} ${it.str}`;
        const right = Math.max(over.x + over.w, it.x + it.w);
        over.x = Math.min(over.x, it.x);
        over.w = right - over.x;
      } else cells.push({ ...it });
    }
  }
  return cells;
}

/** Detect a table header, optionally wrapped onto the following one or two lines. */
function detectHeader(line: Line, next?: Line, next2?: Line): { cols: Cols; consumed: number } | null {
  const close = (a: Line, b?: Line): b is Line => !!b && b.page === a.page && Math.abs(a.y - b.y) <= 14 && !DATE_TOKEN.test(b.text);
  const count = (c: Cols | null) => (c ? Object.keys(c).length : 0);
  let best: { cols: Cols; consumed: number } | null = null;
  const single = classifyCells(line.items);
  if (single) best = { cols: single, consumed: 0 };
  if (close(line, next)) {
    const two = classifyCells(headerCells(line, next));
    if (two && count(two) > count(best?.cols ?? null)) best = { cols: two, consumed: 1 };
    if (close(next, next2)) {
      const three = classifyCells(headerCells(line, next, next2));
      if (three && count(three) > count(best?.cols ?? null)) best = { cols: three, consumed: 2 };
    }
  }
  return best;
}

function classifyCells(cells: { str: string; x: number; w: number }[]): Cols | null {
  const cols: Cols = {};
  // Explicit names first; a bare "Dr"/"Cr" only fills a column nothing else named.
  for (const pass of [false, true]) {
    for (const it of cells) {
      const s = it.str.replace(/\s+/g, ' ').trim();
      for (const [key, re, opt] of HEADER_WORDS) {
        if (!!opt?.weak !== pass) continue;
        if (re.test(s)) {
          if (cols[key] === undefined) cols[key] = it.x + it.w / 2;
          break;
        }
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
  /** Transaction-type code from its own column (TFR, CLG, CASH…), appended after the narration. */
  typeCode: string | null;
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
  const boilerplate = boilerplateLines(lines);
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
    const h = detectHeader(line, lines[li + 1], lines[li + 2]);
    if (h) {
      header = h.cols;
      sawHeader = true;
      current = null;
      li += h.consumed;
      continue;
    }
    if (boilerplate.has(line)) {
      current = null;
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
      const draft: Draft = { dateRaw: dateMatch![0], desc: [], ref: null, typeCode: null, debit: null, credit: null, amount: null, balance: null, drcrHint: null };
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
        // Some banks (e.g. Federal Bank) print whole rupees with no decimals ("0", "2000").
        // A bare integer counts as money only when it sits under a money column of the header,
        // so reference numbers in other columns are never mistaken for amounts.
        const underMoneyCol =
          /^\d{1,12}$/.test(s) &&
          ['debit', 'credit', 'amount', 'balance'].includes(nearestCol(cx, ['date', 'desc', 'ref', 'debit', 'credit', 'amount', 'balance', 'drcr']) ?? '');
        if (isAmountStr(s) || underMoneyCol) {
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
        const col = nearestCol(cx, ['desc', 'ref', 'type', 'date']);
        if (col === 'ref' && /\d/.test(s) && s.length <= 30) draft.ref = s;
        else if (col === 'type' && s.length <= 12 && !draft.typeCode) draft.typeCode = s;
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
    // The type code goes after a separator, so it still tells the channel (CLG = cheque) without
    // running into the payee's name.
    const narration = joinDesc(d.desc).replace(/\s+/g, ' ').trim();
    const description = (d.typeCode ? `${narration} / ${d.typeCode}` : narration).trim() || '(no description)';
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

  const corrected = resolveSignsFromBalance(rows, openingBalance);
  if (corrected) warnings.push(`${corrected} transaction${corrected === 1 ? '' : 's'} had their withdrawal/deposit side corrected from the running balance.`);
  if (!sawHeader && rows.length) warnings.push('No column header detected; amounts were inferred from line positions.');
  return {
    rows: rows.map(({ fixed: _f, magnitude: _m, ...r }) => r as RawTransaction),
    dateOrder,
    warnings,
  };
}

/**
 * Derive each row's direction from the running balance: money in when the balance rose by the
 * row's amount, out when it fell. Rows without a known sign always take it from the balance.
 * Rows whose sign came from a column are checked too, and corrected when the balance chain is
 * trustworthy (most rows step by exactly their amount) and says the opposite — so a misread
 * Withdrawals/Deposits column can't silently flip money in and out. Handles statements listed
 * newest-first by testing both orders. Returns how many column-derived signs were corrected.
 */
export function resolveSignsFromBalance(rows: SignRow[], opening: number | null): number {
  const steps = (order: SignRow[]) => {
    let hits = 0, checked = 0;
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1].balance;
      const b = order[i].balance;
      if (a == null || b == null) continue;
      checked++;
      if (Math.abs(Math.abs(round2(b - a)) - order[i].magnitude) < 0.011) hits++;
    }
    return { hits, checked };
  };
  const reversed = [...rows].reverse();
  const fwd = steps(rows);
  const rev = steps(reversed);
  const isReversed = rev.hits > fwd.hits;
  const seq = isReversed ? reversed : rows;
  const chain = isReversed ? rev : fwd;
  const trustBalance = chain.checked >= 3 && chain.hits / chain.checked >= 0.8;
  if (!trustBalance && !rows.some((r) => !r.fixed)) return 0;
  let corrected = 0;
  for (let i = 0; i < seq.length; i++) {
    const r = seq[i];
    if (r.balance == null || (r.fixed && !trustBalance)) continue;
    const prev = i > 0 ? seq[i - 1].balance : isReversed ? null : opening;
    if (prev == null) continue;
    const delta = round2(r.balance - prev);
    if (Math.abs(Math.abs(delta) - r.magnitude) >= 0.011 || delta === 0) continue;
    const signed = delta > 0 ? r.magnitude : -r.magnitude;
    if (r.fixed && Math.sign(r.amount) !== Math.sign(signed)) corrected++;
    r.amount = signed;
  }
  return corrected;
}
