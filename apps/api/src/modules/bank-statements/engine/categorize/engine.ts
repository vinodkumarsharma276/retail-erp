import { aiEnabled } from '../config.js';
import { query } from '../db.js';
import { aiCategorize } from '../parsers/ai.js';
import type { Direction, EnrichedTransaction, RawTransaction } from '../types.js';
import { UNCATEGORIZED, normalizeCategory } from './categories.js';
import { descriptionKey, detectChannel, extractCounterparty } from './merchant.js';
import { applyBuiltinRules, compileUserRules, type UserRule } from './rules.js';

export async function loadUserRules(tenantId: string, shopId: string | null) {
  // Shop-specific rules win over tenant-wide ones; newest first within each.
  const { rows } = await query<UserRule>(
    `SELECT id, pattern, match_type, category, shop_id FROM statement_rules
      WHERE tenant_id = $1 AND (shop_id IS NULL OR shop_id = $2)
      ORDER BY shop_id NULLS LAST, created_at DESC`,
    [tenantId, shopId],
  );
  return compileUserRules(rows);
}

/** Heuristic fallback when neither rules nor AI can place a transaction. */
function fallbackCategory(direction: Direction, channel: string) {
  if (channel === 'UPI' || channel === 'NEFT/IMPS/RTGS') {
    return direction === 'credit'
      ? { category: 'Business Income', confidence: 0.45 }
      : { category: 'Personal Transfers', confidence: 0.4 };
  }
  return { category: UNCATEGORIZED, confidence: 0 };
}

export interface EnrichOptions {
  tenantId: string;
  shopId: string;
  useAi?: boolean;
  onProgress?: (msg: string) => void;
}

/** Rules first (user > built-in), then one batched AI pass over the distinct leftovers. */
export async function enrichTransactions(raw: RawTransaction[], opts: EnrichOptions): Promise<{ rows: EnrichedTransaction[]; aiUsed: boolean; aiError?: string }> {
  const userRules = await loadUserRules(opts.tenantId, opts.shopId);
  const rows: EnrichedTransaction[] = raw.map((t) => {
    const direction: Direction = t.amount < 0 ? 'debit' : 'credit';
    const channel = detectChannel(t.description);
    const base: EnrichedTransaction = {
      ...t,
      direction,
      channel,
      counterparty: extractCounterparty(t.description),
      category: UNCATEGORIZED,
      categorySource: 'none',
      confidence: null,
      aiNote: null,
    };
    const user = userRules.find((r) => r.re.test(t.description));
    if (user) return { ...base, category: normalizeCategory(user.category), categorySource: 'user-rule', confidence: 1 };
    const hit = applyBuiltinRules(t.description, direction, channel);
    if (hit) return { ...base, category: hit.category, categorySource: 'rule', confidence: hit.confidence };
    return base;
  });

  const pending = rows.filter((r) => r.categorySource === 'none');
  let aiUsed = false;
  let aiError: string | undefined;

  if (pending.length && (opts.useAi ?? true) && aiEnabled()) {
    // Same narration pattern -> one AI call.
    const groups = new Map<string, EnrichedTransaction[]>();
    for (const r of pending) {
      const key = `${r.direction}:${descriptionKey(r.description)}`;
      const g = groups.get(key);
      if (g) g.push(r);
      else groups.set(key, [r]);
    }
    const inputs = [...groups.entries()].map(([key, g]) => ({
      key,
      description: g[0].description.slice(0, 240),
      amount: g[0].amount,
      channel: g[0].channel,
    }));
    try {
      opts.onProgress?.(`AI categorizing ${inputs.length} unique descriptions`);
      const results = await aiCategorize(inputs);
      aiUsed = true;
      for (const [key, g] of groups) {
        const res = results.get(key);
        if (!res) continue;
        for (const r of g) {
          r.category = normalizeCategory(res.category);
          r.categorySource = 'ai';
          r.confidence = Math.max(0, Math.min(1, res.confidence));
          r.counterparty = res.counterparty || r.counterparty;
          r.aiNote = res.suspicious ? `⚠ ${res.note ?? 'Marked unusual by AI'}` : res.note;
        }
      }
    } catch (err: any) {
      aiError = err?.message ?? String(err);
    }
  }

  for (const r of rows) {
    if (r.categorySource !== 'none') continue;
    const fb = fallbackCategory(r.direction, r.channel);
    r.category = fb.category;
    r.confidence = fb.confidence;
  }
  return { rows, aiUsed, aiError };
}
