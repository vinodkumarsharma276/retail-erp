import { nameSimilarity, SIMILAR_NAME_THRESHOLD } from '@retailerp/shared-utils';

/**
 * Turning the sheet's free-text Product ("TV", "Fridge") into the tenant's
 * product types, and laying product types out in an export.
 *
 * The sheet only ever named a top-level type, so its text is matched against
 * top-level types alone. What can't be matched is offered as a new type for
 * the person importing to confirm — nothing is created on a guess.
 */

/** "  LED  tv " → "led tv": how sheet text is compared and remembered. */
export function productTextKey(text: string): string {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Same as the web's category slug, so a type made here looks like one made there. */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

const singular = (key: string) => key.replace(/(?<=[a-z]{2})s$/, '');

export interface TopLevelType {
  id: string;
  name: string;
  slug: string;
}

export type ProductTypeMatchKind = 'mapped' | 'matched' | 'similar' | 'new';

export interface ProductTypeMatch {
  textKey: string;
  /** The spelling seen most often in the rows. */
  text: string;
  rows: number;
  kind: ProductTypeMatchKind;
  /** The type it maps / matches / looks like; null for `new`, or a mapping to "leave blank". */
  categoryId: string | null;
  categoryName: string | null;
}

/** What the person decided a piece of sheet text means. */
export type ProductTypeDecision =
  | { action: 'existing'; categoryId: string }
  | { action: 'create'; name: string }
  | { action: 'blank' };

/**
 * Match every distinct Product text in a batch. `mappings` are earlier
 * decisions (text key → category id, or null for "leave blank").
 */
export function matchProductTexts(
  texts: string[],
  topLevel: TopLevelType[],
  mappings: Map<string, string | null>,
  /** Types below the top level, tried only when no top-level type fits ("LED TV" under TV). */
  deeper: Array<{ id: string; name: string; pathLabel: string }> = [],
): ProductTypeMatch[] {
  const seen = new Map<string, { counts: Map<string, number>; rows: number }>();
  for (const raw of texts) {
    const text = raw.replace(/\s+/g, ' ').trim();
    const key = productTextKey(text);
    if (!key) continue;
    const entry = seen.get(key) ?? { counts: new Map(), rows: 0 };
    entry.rows += 1;
    entry.counts.set(text, (entry.counts.get(text) ?? 0) + 1);
    seen.set(key, entry);
  }
  const byId = new Map(topLevel.map((t) => [t.id, t]));

  const out: ProductTypeMatch[] = [];
  for (const [key, { counts, rows }] of seen) {
    const text = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const base = { textKey: key, text, rows };

    if (mappings.has(key)) {
      const id = mappings.get(key) ?? null;
      const name = id ? byId.get(id)?.name ?? deeper.find((d) => d.id === id)?.pathLabel ?? null : null;
      out.push({ ...base, kind: 'mapped', categoryId: id, categoryName: name });
      continue;
    }
    const slug = categorySlug(text);
    const exact = topLevel.find(
      (t) =>
        productTextKey(t.name) === key ||
        t.slug === slug ||
        singular(productTextKey(t.name)) === singular(key),
    );
    if (exact) {
      out.push({ ...base, kind: 'matched', categoryId: exact.id, categoryName: exact.name });
      continue;
    }
    const close = topLevel
      .map((t) => ({ t, score: nameSimilarity(t.name, text) }))
      .filter((c) => c.score >= SIMILAR_NAME_THRESHOLD)
      .sort((a, b) => b.score - a.score)[0];
    if (close) {
      out.push({ ...base, kind: 'similar', categoryId: close.t.id, categoryName: close.t.name });
      continue;
    }
    // Creating a top-level type that already exists further down would put
    // the same goods in two places, so a same-named sub-type wins.
    const below = deeper.filter((d) => productTextKey(d.name) === key || singular(productTextKey(d.name)) === singular(key));
    if (below.length === 1) {
      out.push({ ...base, kind: 'matched', categoryId: below[0].id, categoryName: below[0].pathLabel });
      continue;
    }
    out.push({ ...base, kind: 'new', categoryId: null, categoryName: null });
  }
  return out.sort((a, b) => b.rows - a.rows || a.text.localeCompare(b.text));
}

/**
 * What applies when the person sent no decision for a text: earlier and
 * obvious matches stand, a lookalike is suggested but a new type is never
 * created without being asked for.
 */
export function defaultDecision(match: ProductTypeMatch): ProductTypeDecision {
  if (match.categoryId) return { action: 'existing', categoryId: match.categoryId };
  return { action: 'blank' };
}

// --- Export -----------------------------------------------------------------

export interface TypeColumns {
  /** "Type Level 1" … "Type Level N", N = the deepest type exported (at least 1). */
  levelHeaders: string[];
  /** Per row: the full path joined, and one cell per level ('' past the row's depth). */
  rows: Array<{ path: string; levels: string[] }>;
}

export const TYPE_PATH_SEPARATOR = ' › ';

/**
 * Lay product types out for a spreadsheet whose types differ in depth: one
 * column with the whole path, plus a column per level up to the deepest one
 * in this export. Shallower types leave the extra levels blank, so a type
 * tree that grows a level later simply adds a column.
 */
export function buildTypeColumns(paths: Array<string[] | null>, fallbackText: Array<string | null> = []): TypeColumns {
  const depth = Math.max(1, ...paths.map((p) => p?.length ?? 0));
  const levelHeaders = Array.from({ length: depth }, (_, i) => `Type Level ${i + 1}`);
  const rows = paths.map((p, i) => {
    if (!p || p.length === 0) return { path: fallbackText[i] ?? '', levels: Array(depth).fill('') };
    return { path: p.join(TYPE_PATH_SEPARATOR), levels: Array.from({ length: depth }, (_, l) => p[l] ?? '') };
  });
  return { levelHeaders, rows };
}

/** Category id → names from the top down, for a tenant's whole tree. */
export function categoryPaths(categories: Array<{ id: string; name: string; parentId: string | null }>) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const cache = new Map<string, string[]>();
  const pathOf = (id: string | null | undefined): string[] | null => {
    if (!id || !byId.has(id)) return null;
    if (cache.has(id)) return cache.get(id)!;
    const names: string[] = [];
    let cur = byId.get(id);
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      names.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    cache.set(id, names);
    return names;
  };
  return pathOf;
}
