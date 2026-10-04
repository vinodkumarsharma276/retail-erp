import { getSettings, query, type Settings } from '../db.js';
import type { FlagReason } from '../types.js';
import { UNCATEGORIZED } from './categories.js';
import { descriptionKey } from './merchant.js';

interface FlagRow {
  id: string;
  statement_id: string;
  /** Upload order (statement upload time, then row) — the first copy of a duplicate is kept clean. */
  seq: number;
  date: string;
  description: string;
  amount: number;
  direction: 'debit' | 'credit';
  counterparty: string | null;
  channel: string;
  category: string;
  category_source: string;
  confidence: number | null;
  ai_note: string | null;
  flagged: boolean;
  flag_reasons: FlagReason[];
  review_status: string | null;
}

const REASONS = {
  uncategorized: { code: 'uncategorized', label: 'No matching category', severity: 'medium' },
  lowConfidence: { code: 'low_confidence', label: 'Category is a low-confidence guess', severity: 'low' },
  aiSuspicious: { code: 'ai_suspicious', label: 'AI marked this as unusual', severity: 'medium' },
  large: { code: 'large_amount', label: 'Large amount to a new or occasional payee', severity: 'high' },
  payeeSpike: { code: 'payee_spike', label: 'Much larger than usual for this payee', severity: 'medium' },
  outlier: { code: 'outlier', label: 'Unusually large for this category', severity: 'medium' },
  cash: { code: 'cash', label: 'Large cash withdrawal', severity: 'medium' },
  newPayee: { code: 'new_payee', label: 'First-time transfer to this person', severity: 'medium' },
  duplicate: { code: 'duplicate', label: 'Possible duplicate (appears in another statement)', severity: 'high' },
  round: { code: 'round_figure', label: 'Large round-figure transfer', severity: 'low' },
} satisfies Record<string, FlagReason>;

export function computeFlags(rows: FlagRow[], s: Settings): Map<string, FlagReason[]> {
  const out = new Map<string, FlagReason[]>();

  // Stats per category+direction for outlier detection.
  const stats = new Map<string, { n: number; mean: number; sd: number }>();
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.category}|${r.direction}`;
    const arr = buckets.get(k);
    if (arr) arr.push(Math.abs(r.amount));
    else buckets.set(k, [Math.abs(r.amount)]);
  }
  for (const [k, arr] of buckets) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
    stats.set(k, { n: arr.length, mean, sd });
  }

  // Payee history: frequency (first-time / recurring) and typical amount (median) per direction.
  const payeeKey = (r: FlagRow) => `${r.direction}|${(r.counterparty ?? descriptionKey(r.description)).toLowerCase()}`;
  const payeeAmounts = new Map<string, number[]>();
  for (const r of rows) {
    const k = payeeKey(r);
    const arr = payeeAmounts.get(k);
    if (arr) arr.push(Math.abs(r.amount));
    else payeeAmounts.set(k, [Math.abs(r.amount)]);
  }
  const payeeMedian = new Map<string, number>();
  for (const [k, arr] of payeeAmounts) {
    const s = [...arr].sort((a, b) => a - b);
    payeeMedian.set(k, s[Math.floor(s.length / 2)]);
  }

  // Duplicates: identical date + amount + narration in a *different* statement (overlapping uploads).
  const seen = new Map<string, { id: string; statement: string }>();
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const dupes = new Set<string>();
  for (const r of sorted) {
    const k = `${r.date}|${r.amount}|${descriptionKey(r.description)}`;
    const prev = seen.get(k);
    if (prev && prev.statement !== r.statement_id) dupes.add(r.id);
    else if (!prev) seen.set(k, { id: r.id, statement: r.statement_id });
  }

  for (const r of rows) {
    const reasons: FlagReason[] = [];
    const abs = Math.abs(r.amount);
    if (dupes.has(r.id)) reasons.push(REASONS.duplicate);
    if (r.category === UNCATEGORIZED) reasons.push(REASONS.uncategorized);
    else if (r.category_source !== 'user' && r.category_source !== 'user-rule' && (r.confidence ?? 1) < s.minAiConfidence) reasons.push(REASONS.lowConfidence);
    if (r.ai_note?.startsWith('⚠')) reasons.push({ ...REASONS.aiSuspicious, label: r.ai_note.replace(/^⚠\s*/, '') });
    const pk = payeeKey(r);
    const seenTimes = payeeAmounts.get(pk)?.length ?? 0;
    const recurring = seenTimes >= 3;
    if (abs >= s.largeAmount && !recurring) reasons.push(REASONS.large);
    else if (recurring && abs >= s.largeAmount / 5 && abs > 3 * (payeeMedian.get(pk) ?? abs)) reasons.push(REASONS.payeeSpike);
    else {
      const st = stats.get(`${r.category}|${r.direction}`);
      if (st && st.n >= 8 && st.sd > 0 && abs > st.mean + 4 * st.sd && abs > s.largeAmount / 5) reasons.push(REASONS.outlier);
    }
    if (r.direction === 'debit' && r.category === 'Cash Withdrawal' && abs >= s.cashAlertAmount) reasons.push(REASONS.cash);
    if (r.direction === 'debit' && r.category === 'Personal Transfers' && abs >= s.unknownPayeeAmount) {
      if (seenTimes <= 1) reasons.push(REASONS.newPayee);
    }
    if (
      r.direction === 'debit' &&
      abs >= 50000 &&
      abs % 10000 === 0 &&
      ['Personal Transfers', UNCATEGORIZED, 'Cash Withdrawal'].includes(r.category)
    ) {
      reasons.push(REASONS.round);
    }
    out.set(r.id, reasons);
  }
  return out;
}

/** Recompute flags for every transaction of a shop and persist only what changed. */
export async function recomputeFlags(tenantId: string, shopId: string) {
  const settings = await getSettings(tenantId);
  const { rows } = await query<FlagRow>(
    `SELECT t.id, t.statement_id, t.date, t.description, t.amount, t.direction, t.counterparty, t.channel, t.category,
            t.category_source, t.confidence, t.ai_note, t.flagged, t.flag_reasons, t.review_status,
            row_number() OVER (ORDER BY s.uploaded_at, t.statement_id, t.row_index) AS seq
       FROM statement_transactions t JOIN bank_statements s ON s.id = t.statement_id
      WHERE t.tenant_id = $1 AND t.shop_id = $2`,
    [tenantId, shopId],
  );
  const flags = computeFlags(rows, settings);

  const changes: { id: string; flagged: boolean; reasons: unknown; status: string | null }[] = [];
  for (const r of rows) {
    const next = flags.get(r.id) ?? [];
    const isFlagged = next.length > 0;
    // Keep human decisions; open new items as pending; close pending items that no longer need review.
    let status = r.review_status;
    if (isFlagged && !status) status = 'pending';
    if (!isFlagged && status === 'pending') status = null;
    if (isFlagged !== r.flagged || JSON.stringify(next) !== JSON.stringify(r.flag_reasons) || status !== r.review_status) {
      changes.push({ id: r.id, flagged: isFlagged, reasons: next, status });
    }
  }
  if (changes.length) {
    await query(
      `UPDATE statement_transactions t SET flagged = u.flagged, flag_reasons = u.reasons, review_status = u.status
         FROM jsonb_to_recordset($1::jsonb) AS u(id text, flagged boolean, reasons jsonb, status text)
        WHERE t.id = u.id AND t.tenant_id = $2`,
      [JSON.stringify(changes), tenantId],
    );
  }
  return { updated: changes.length };
}
