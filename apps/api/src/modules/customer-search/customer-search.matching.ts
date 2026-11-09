import {
  FALLBACK_SAME_PERSON_SCORE,
  MAYBE_SAME_PERSON_SCORE,
  SAME_PERSON_SCORE,
  personNameKey,
  personNameScore,
} from '@retailerp/shared-utils';

/**
 * Who is who in an account-register import.
 *
 * A customer is a name plus a mobile, not a mobile alone: relatives share a
 * phone. So everyone in a batch (buyers and co-applicants) is grouped by
 * mobile, and within a mobile every distinct way of writing a name is a
 * "variant". Existing customers on that mobile are variants too.
 *
 * A mobile with more than one variant is a name group, and the person
 * importing decides which variants are one person and which spelling to
 * keep — a resolution maps every variant to the variant whose name is kept.
 * Suggestions come from edit distance and, for the borderline pairs, a model.
 */

export interface ExistingCustomer {
  id: string;
  name: string;
  /** Normalised 10-digit mobile. */
  mobile: string;
  customerCode: string;
}

export interface PersonMention {
  name: string;
  /** Normalised 10-digit mobile. */
  mobile: string;
}

export interface Variant {
  /** `c:<customerId>` for an existing customer, `n:<name key>` for a name from the sheet. */
  key: string;
  name: string;
  /** Rows of this batch naming this variant (as buyer or co-applicant). */
  rows: number;
  customerId?: string;
  customerCode?: string;
}

export interface PairVerdict {
  a: string;
  b: string;
  score: number;
  same: boolean;
  by: 'score' | 'ai';
  reason?: string;
}

export interface NameGroup {
  mobile: string;
  variants: Variant[];
  /** Variant key → key of the variant whose name is kept. */
  suggestion: Record<string, string>;
  /** Some pair is close enough that it may be one person; otherwise all are plainly different names. */
  needsReview: boolean;
  verdicts: PairVerdict[];
}

export type Resolution = Record<string, string>;

export const customerVariantKey = (id: string) => `c:${id}`;
export const nameVariantKey = (name: string) => `n:${personNameKey(name)}`;

/** Variants on every mobile mentioned, existing customers first (oldest first, as given). */
export function buildVariants(mentions: PersonMention[], existing: ExistingCustomer[]): Map<string, Variant[]> {
  const byMobile = new Map<string, Variant[]>();
  const spellings = new Map<string, Map<string, number>>();

  for (const c of existing) {
    const list = byMobile.get(c.mobile) ?? [];
    list.push({ key: customerVariantKey(c.id), name: c.name, rows: 0, customerId: c.id, customerCode: c.customerCode });
    byMobile.set(c.mobile, list);
  }

  for (const m of mentions) {
    if (!m.mobile || !personNameKey(m.name)) continue;
    const list = byMobile.get(m.mobile) ?? [];
    byMobile.set(m.mobile, list);
    const nameKey = personNameKey(m.name);
    const exact = list.find((v) => v.customerId && personNameKey(v.name) === nameKey);
    if (exact) {
      exact.rows += 1;
      continue;
    }
    const key = `n:${nameKey}`;
    let variant = list.find((v) => v.key === key);
    if (!variant) {
      variant = { key, name: m.name, rows: 0 };
      list.push(variant);
    }
    variant.rows += 1;
    // Keep the spelling written most often as the variant's display name.
    const counts = spellings.get(`${m.mobile}|${key}`) ?? new Map<string, number>();
    counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    spellings.set(`${m.mobile}|${key}`, counts);
    variant.name = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0];
  }

  // Existing customers nobody in the batch named stay listed only where the
  // mobile is also mentioned, so the person sees who else is on that phone.
  for (const [mobile, list] of byMobile) {
    if (!list.some((v) => v.rows > 0)) byMobile.delete(mobile);
  }
  return byMobile;
}

/** Pairs on one mobile worth asking a model about (borderline scores, not two existing customers). */
export function borderlinePairs(variants: Variant[]): Array<{ a: string; b: string }> {
  const out: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      if (variants[i].customerId && variants[j].customerId) continue;
      const score = personNameScore(variants[i].name, variants[j].name);
      if (score >= MAYBE_SAME_PERSON_SCORE && score < SAME_PERSON_SCORE) {
        out.push({ a: variants[i].name, b: variants[j].name });
      }
    }
  }
  return out;
}

const pairKey = (a: string, b: string) => [personNameKey(a), personNameKey(b)].sort().join('|');

/**
 * Suggest who is the same person on one mobile. `aiVerdicts` holds the
 * model's answers keyed by `pairKey`; missing ones fall back to the score.
 */
export function suggestGroup(
  mobile: string,
  variants: Variant[],
  aiVerdicts: Map<string, { same: boolean; reason?: string }> = new Map(),
): NameGroup {
  const parent = new Map(variants.map((v) => [v.key, v.key]));
  const find = (k: string): string => {
    while (parent.get(k) !== k) k = parent.get(k)!;
    return k;
  };

  const verdicts: PairVerdict[] = [];
  let needsReview = false;
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const a = variants[i];
      const b = variants[j];
      // Two customers already in the books are not merged by an import.
      if (a.customerId && b.customerId) continue;
      const score = personNameScore(a.name, b.name);
      let same = score >= SAME_PERSON_SCORE;
      let by: PairVerdict['by'] = 'score';
      let reason: string | undefined;
      if (score >= MAYBE_SAME_PERSON_SCORE) needsReview = true;
      if (score >= MAYBE_SAME_PERSON_SCORE && score < SAME_PERSON_SCORE) {
        const ai = aiVerdicts.get(pairKey(a.name, b.name));
        if (ai) {
          same = ai.same;
          by = 'ai';
          reason = ai.reason;
        } else {
          same = score >= FALLBACK_SAME_PERSON_SCORE;
        }
      }
      verdicts.push({ a: a.key, b: b.key, score: Math.round(score * 100) / 100, same, by, reason });
      if (same) {
        const ra = find(a.key);
        const rb = find(b.key);
        if (ra !== rb) parent.set(rb, ra);
      }
    }
  }

  const clusters = new Map<string, Variant[]>();
  for (const v of variants) {
    const root = find(v.key);
    clusters.set(root, [...(clusters.get(root) ?? []), v]);
  }
  const suggestion: Resolution = {};
  for (const members of clusters.values()) {
    const target =
      members.find((m) => m.customerId) ??
      [...members].sort((x, y) => y.rows - x.rows)[0];
    for (const m of members) suggestion[m.key] = target.key;
  }

  return { mobile, variants, suggestion, needsReview, verdicts };
}

export { pairKey as personPairKey };

/** Check a resolution sent back for a group; null when it doesn't fit the group. */
export function validResolution(variants: Variant[], given: Resolution | undefined): Resolution | null {
  if (!given) return null;
  const keys = new Set(variants.map((v) => v.key));
  const out: Resolution = {};
  for (const v of variants) {
    const target = given[v.key];
    if (!target || !keys.has(target) || given[target] !== target) return null;
    out[v.key] = target;
  }
  return out;
}

/** What a resolved person turns into when the batch is saved. */
export type PersonOutcome =
  | { kind: 'existing'; customerId: string; rename?: string }
  | { kind: 'new'; ref: string; name: string };

/**
 * Turn a mobile's resolution into one outcome per variant: link to an
 * existing customer (renaming it if a sheet spelling was chosen), or create
 * one new customer per kept variant.
 */
export function outcomesFor(mobile: string, variants: Variant[], resolution: Resolution): Map<string, PersonOutcome> {
  const byKey = new Map(variants.map((v) => [v.key, v]));
  const out = new Map<string, PersonOutcome>();
  const targets = new Set(Object.values(resolution));
  for (const targetKey of targets) {
    const target = byKey.get(targetKey)!;
    const members = variants.filter((v) => resolution[v.key] === targetKey);
    const existing = target.customerId ? target : members.find((m) => m.customerId);
    let outcome: PersonOutcome;
    if (existing?.customerId) {
      outcome = { kind: 'existing', customerId: existing.customerId };
      if (!target.customerId && target.name !== existing.name) outcome.rename = target.name;
    } else {
      outcome = { kind: 'new', ref: `${mobile}|${targetKey}`, name: target.name };
    }
    for (const m of members) out.set(m.key, outcome);
  }
  return out;
}

/** The variant a mention belongs to on its mobile. */
export function variantFor(variants: Variant[], name: string): Variant | undefined {
  const nameKey = personNameKey(name);
  return (
    variants.find((v) => v.customerId && personNameKey(v.name) === nameKey) ??
    variants.find((v) => v.key === `n:${nameKey}`)
  );
}
