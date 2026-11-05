import { nameSimilarity, normalizeCompanyName, SIMILAR_NAME_THRESHOLD } from '@retailerp/shared-utils';
import { adjudicateNames, type NamePair } from '../../../distributors/name-adjudicator.js';
import { aiEnabled } from '../config.js';
import { query, type Db } from '../db.js';

/**
 * Which supplier a bank withdrawal paid.
 *
 * Narrations rarely carry a clean name: "TARUN ENTERPRISES", but also
 * "NFT/FBBT262925890053 Laxmi Enterpris ICIC0001917 V" (cut short, wrapped in
 * references) or "MS CRIMSONWAVE PRIVATE LTD" against the books' "CRIMSONWAVE
 * PRIVATE LIMITED". So the first test is containment: every distinctive word of
 * the supplier's name appears in the narration (a cut-off word still counts),
 * and the most specific supplier wins — "NAVRANG MARKETING" beats "NAVRANG
 * DISTRIBUTORS" for a cheque to Navrang Marketing. Failing that, trigram
 * similarity against the extracted payee, and only for names in the uncertain
 * middle is a model asked (the same adjudicator the supplier import uses).
 *
 * It only ever suggests: a person confirms before any payment is recorded.
 */

export interface Supplier {
  id: string;
  name: string;
}

export interface BankRowForMatch {
  description: string;
  counterparty: string | null;
  channel: string;
}

export interface SupplierMatch {
  distributorId: string;
  source: 'match' | 'ai';
  confidence: number;
}

/** Withdrawals that are never a supplier payment. */
const SKIP_CHANNELS = new Set(['ATM/Cash', 'Bank']);

/** Words of a narration that could be part of a name: no VPAs, IFSCs or tokens with digits. */
function narrationWords(desc: string): string[] {
  const cleaned = desc
    .replace(/[a-z0-9._-]+@[a-z]+/gi, ' ')
    .replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/gi, ' ');
  return normalizeCompanyName(cleaned)
    .split(' ')
    .filter((w) => w && !/\d/.test(w));
}

/** Every word of the name, initials included: "A & M Associates" needs the A and the M, not just "associates". */
function nameWords(name: string): string[] {
  return normalizeCompanyName(name).split(' ').filter(Boolean);
}

/** Same word, or one is a cut-off of the other ("enterpris" / "enterprises"); initials must match exactly. */
function wordHit(word: string, words: string[]) {
  return words.some((w) => w === word || (Math.min(w.length, word.length) >= 4 && (w.startsWith(word) || word.startsWith(w))));
}

/** The supplier whose whole name appears in the narration; null when none, or two equally specific ones. */
export function containedSupplier(desc: string, suppliers: Supplier[]): Supplier | null {
  const words = narrationWords(desc);
  if (!words.length) return null;
  let best: { s: Supplier; weight: number } | null = null;
  let tie = false;
  for (const s of suppliers) {
    const nw = nameWords(s.name);
    // Letters of the distinctive words; a name that's only initials ("LG", "A M") is too short to find safely.
    const weight = nw.filter((w) => w.length >= 2).reduce((n, w) => n + w.length, 0);
    if (weight < 4 || !nw.every((w) => wordHit(w, words))) continue;
    if (!best || weight > best.weight) {
      best = { s, weight };
      tie = false;
    } else if (weight === best.weight && normalizeCompanyName(s.name) !== normalizeCompanyName(best.s.name)) {
      tie = true;
    }
  }
  return best && !tie ? best.s : null;
}

/** Below this, a payee and a supplier have nothing to do with each other. */
const ASK_FLOOR = 0.4;

/**
 * Match without a model: containment, then trigram similarity of the payee name.
 * Returns the match per row, plus the uncertain pairs worth asking a model about.
 */
export function matchSuppliersLocally(rows: BankRowForMatch[], suppliers: Supplier[]) {
  const matches: (SupplierMatch | null)[] = rows.map(() => null);
  const uncertain: { row: number; pair: NamePair }[] = [];
  rows.forEach((r, i) => {
    if (SKIP_CHANNELS.has(r.channel) || !suppliers.length) return;
    const hit = containedSupplier(r.description, suppliers);
    if (hit) {
      matches[i] = { distributorId: hit.id, source: 'match', confidence: 0.9 };
      return;
    }
    if (!r.counterparty || r.counterparty.replace(/[^a-z]/gi, '').length < 4) return;
    const payeeWords = nameWords(r.counterparty);
    let top: { s: Supplier; score: number } | null = null;
    for (const s of suppliers) {
      // Trigrams can't tell "A K A S Associates" from "A & M Associates"; the initials can.
      if (!nameWords(s.name).every((w) => w.length > 1 || payeeWords.includes(w))) continue;
      const score = nameSimilarity(r.counterparty, s.name);
      if (!top || score > top.score) top = { s, score };
    }
    if (!top || top.score < ASK_FLOOR) return;
    if (top.score >= SIMILAR_NAME_THRESHOLD) {
      matches[i] = { distributorId: top.s.id, source: 'match', confidence: Math.min(0.85, top.score) };
    } else {
      uncertain.push({ row: i, pair: { candidateName: r.counterparty, existingId: top.s.id, existingName: top.s.name, score: top.score } });
    }
  });
  return { matches, uncertain };
}

export async function loadSuppliers(tenantId: string, db?: Db): Promise<Supplier[]> {
  // Raw SQL isn't tenant-scoped automatically.
  const { rows } = await query<{ id: string; company_name: string }>(
    'SELECT id, company_name FROM distributors WHERE tenant_id = $1 AND is_active',
    [tenantId],
    db,
  );
  return rows.map((r) => ({ id: r.id, name: r.company_name }));
}

/** Containment and trigrams, then (if a key is set) a model for the uncertain middle. */
export async function matchSuppliers(rows: BankRowForMatch[], suppliers: Supplier[], opts: { useAi?: boolean } = {}) {
  const { matches, uncertain } = matchSuppliersLocally(rows, suppliers);
  if (uncertain.length && (opts.useAi ?? true) && aiEnabled()) {
    const verdicts = await adjudicateNames(uncertain.map((u) => u.pair));
    const same = new Set(verdicts.filter((v) => v.same).map((v) => `${v.candidateName}|${v.existingId}`));
    for (const u of uncertain) {
      if (same.has(`${u.pair.candidateName}|${u.pair.existingId}`)) {
        matches[u.row] = { distributorId: u.pair.existingId, source: 'ai', confidence: 0.75 };
      }
    }
  }
  return matches;
}

export const SUPPLIER_CATEGORY = 'Vendor & Supplier Payments';

/**
 * Suggest a supplier for every withdrawal in a statement that a person hasn't decided on,
 * and file matched rows under supplier payments unless a person or their rule chose a category.
 */
export async function applySupplierMatches(tenantId: string, statementId: string, opts: { useAi?: boolean } = {}) {
  const { rows } = await query<{ id: string; description: string; counterparty: string | null; channel: string }>(
    `SELECT id, description, counterparty, channel FROM statement_transactions
      WHERE tenant_id = $1 AND statement_id = $2 AND direction = 'debit' AND distributor_source IS DISTINCT FROM 'user'`,
    [tenantId, statementId],
  );
  if (!rows.length) return 0;
  const matches = await matchSuppliers(rows, await loadSuppliers(tenantId), opts);
  const updates = rows.map((r, i) => ({
    id: r.id,
    distributor_id: matches[i]?.distributorId ?? null,
    source: matches[i]?.source ?? null,
    confidence: matches[i]?.confidence ?? null,
  }));
  await query(
    `UPDATE statement_transactions t
        SET distributor_id = u.distributor_id, distributor_source = u.source,
            category = CASE WHEN u.distributor_id IS NOT NULL AND t.category_source NOT IN ('user', 'user-rule') THEN $2 ELSE t.category END,
            confidence = CASE WHEN u.distributor_id IS NOT NULL AND t.category_source NOT IN ('user', 'user-rule') THEN u.confidence ELSE t.confidence END,
            category_source = CASE WHEN u.distributor_id IS NOT NULL AND t.category_source NOT IN ('user', 'user-rule') THEN 'rule' ELSE t.category_source END
       FROM jsonb_to_recordset($1::jsonb) AS u(id text, distributor_id text, source text, confidence real)
      WHERE t.id = u.id`,
    [JSON.stringify(updates), SUPPLIER_CATEGORY],
  );
  return updates.filter((u) => u.distributor_id).length;
}
