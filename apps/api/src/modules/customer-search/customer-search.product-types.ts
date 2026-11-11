import { nameSimilarity, SIMILAR_NAME_THRESHOLD } from '@retailerp/shared-utils';
import { glossaryPath, isJunkProduct } from './customer-search.product-glossary.js';

/**
 * Turning the sheet's free-text Product ("TV", "W/M", "ALMARI") into the
 * tenant's product types, and laying product types out in an export.
 *
 * Each distinct text is read, first answer wins: a decision someone already
 * made for it, the built-in glossary of how staff write products, an exact
 * type name, a close spelling of a top-level type, a same-named sub-type.
 * What is left goes to the AI (see the product adjudicator) and to the
 * person importing. Every answer is only pre-filled: the person confirms,
 * and nothing is created on a guess.
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
const sameName = (a: string, b: string) => {
  const x = productTextKey(a);
  const y = productTextKey(b);
  return x === y || singular(x) === singular(y);
};

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

/** A tenant's product types, for finding a type by name or path. */
export class TypeTree {
  readonly topLevel: CategoryRow[];
  private readonly byId: Map<string, CategoryRow>;
  private readonly children = new Map<string | null, CategoryRow[]>();

  constructor(readonly all: CategoryRow[]) {
    this.byId = new Map(all.map((c) => [c.id, c]));
    for (const c of all) {
      const parent = c.parentId && this.byId.has(c.parentId) ? c.parentId : null;
      this.children.set(parent, [...(this.children.get(parent) ?? []), c]);
    }
    this.topLevel = this.children.get(null) ?? [];
  }

  pathOf(id: string | null | undefined): string[] | null {
    if (!id || !this.byId.has(id)) return null;
    const names: string[] = [];
    const seen = new Set<string>();
    for (let cur = this.byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? this.byId.get(cur.parentId) : undefined) {
      seen.add(cur.id);
      names.unshift(cur.name);
    }
    return names;
  }

  label(id: string | null | undefined): string | null {
    return this.pathOf(id)?.join(TYPE_PATH_SEPARATOR) ?? null;
  }

  /**
   * The type at this path, walking down from the top by name. A tree laid out
   * differently still finds it by its last name when only one type has it.
   */
  find(path: string[]): CategoryRow | null {
    let level: CategoryRow[] = this.topLevel;
    let found: CategoryRow | null = null;
    for (const name of path) {
      found = level.find((c) => sameName(c.name, name)) ?? null;
      if (!found) break;
      level = this.children.get(found.id) ?? [];
    }
    if (found) return found;
    const leaf = path[path.length - 1];
    const named = this.all.filter((c) => sameName(c.name, leaf));
    return named.length === 1 ? named[0] : null;
  }

  /**
   * A type whose name is exactly this text: top level first, else one unique
   * sub-type (a same-named sub-type beats creating a duplicate at the top).
   */
  exact(text: string): CategoryRow | null {
    const slug = categorySlug(text);
    const top = this.topLevel.find((t) => sameName(t.name, text) || t.slug === slug);
    if (top) return top;
    const below = this.all.filter((c) => c.parentId && sameName(c.name, text));
    return below.length === 1 ? below[0] : null;
  }
}

export type ProductTypeMatchKind = 'mapped' | 'glossary' | 'matched' | 'similar' | 'ai' | 'new';

/** What the person decided a piece of sheet text means. */
export type ProductTypeDecision =
  | { action: 'existing'; categoryId: string }
  /** A new type, at the top level or under `parentId`. */
  | { action: 'create'; name: string; parentId?: string | null }
  | { action: 'blank' };

export interface NewTypeProposal {
  name: string;
  parentId: string | null;
  /** The full path it would have ("Refrigerator › Deep Freezer"). */
  label: string;
}

export interface ProductTypeMatch {
  textKey: string;
  /** The spelling seen most often in the rows. */
  text: string;
  rows: number;
  kind: ProductTypeMatchKind;
  /** The type it maps / matches / looks like; null when there is none yet. */
  categoryId: string | null;
  categoryName: string | null;
  /** A type the glossary or the AI says to create. */
  create?: NewTypeProposal;
  /** Pre-filled on the screen. */
  suggestion: ProductTypeDecision;
  /** Why (glossary note, AI's reason). */
  reason?: string;
  /** A few "Brand / Model" pairs seen with this text. */
  samples: string[];
}

/** One item as the rows name it, with the Brand and Model written beside it. */
export interface ProductText {
  text: string;
  brand?: string;
  model?: string;
}

/** A new type where `path` says, under the deepest part of it the tenant has. */
export function proposeType(path: string[], tree: TypeTree): NewTypeProposal {
  const name = path[path.length - 1];
  const parent = path.length > 1 ? tree.find(path.slice(0, -1)) : null;
  const parentLabel = parent ? tree.label(parent.id) : null;
  return { name, parentId: parent?.id ?? null, label: parentLabel ? `${parentLabel}${TYPE_PATH_SEPARATOR}${name}` : name };
}

/**
 * Whether a text is already understood (a saved decision, the glossary or an
 * exact type name) — what splitting "W/M-REF" into items relies on. Spelling
 * guesses don't count: they are only suggestions.
 */
export function knownText(tree: TypeTree, mappings: Map<string, string | null>) {
  return (text: string) => mappings.has(productTextKey(text)) || !!glossaryPath(text) || !!tree.exact(text);
}

/**
 * Match every distinct Product text in a batch. `mappings` are earlier
 * decisions (text key → category id, or null for "leave blank").
 */
export function matchProductTexts(
  texts: ProductText[],
  tree: TypeTree,
  mappings: Map<string, string | null>,
): ProductTypeMatch[] {
  const seen = new Map<string, { counts: Map<string, number>; rows: number; samples: Set<string> }>();
  for (const item of texts) {
    const text = String(item.text ?? '').replace(/\s+/g, ' ').trim();
    const key = productTextKey(text);
    if (!key) continue;
    const entry = seen.get(key) ?? { counts: new Map(), rows: 0, samples: new Set<string>() };
    entry.rows += 1;
    entry.counts.set(text, (entry.counts.get(text) ?? 0) + 1);
    const sample = [item.brand, item.model].map((v) => String(v ?? '').trim()).filter(Boolean).join(' / ');
    if (sample && entry.samples.size < 3) entry.samples.add(sample);
    seen.set(key, entry);
  }

  const out: ProductTypeMatch[] = [];
  for (const [key, { counts, rows, samples }] of seen) {
    const text = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const base = { textKey: key, text, rows, samples: [...samples] };
    const existing = (kind: ProductTypeMatchKind, id: string, reason?: string): ProductTypeMatch => ({
      ...base, kind, categoryId: id, categoryName: tree.label(id), suggestion: { action: 'existing', categoryId: id }, reason,
    });

    if (mappings.has(key)) {
      const id = mappings.get(key) ?? null;
      out.push(
        id && tree.label(id)
          ? existing('mapped', id)
          : { ...base, kind: 'mapped', categoryId: null, categoryName: null, suggestion: { action: 'blank' } },
      );
      continue;
    }
    if (isJunkProduct(text)) {
      out.push({ ...base, kind: 'glossary', categoryId: null, categoryName: null, suggestion: { action: 'blank' }, reason: 'Nothing readable' });
      continue;
    }
    // The tenant's own name for a type wins over the glossary's.
    const exact = tree.exact(text);
    if (exact) {
      out.push(existing('matched', exact.id));
      continue;
    }
    const path = glossaryPath(text);
    if (path) {
      const found = tree.find(path);
      if (found) {
        out.push(existing('glossary', found.id));
      } else {
        const create = proposeType(path, tree);
        out.push({
          ...base, kind: 'glossary', categoryId: null, categoryName: null, create,
          suggestion: { action: 'create', name: create.name, parentId: create.parentId },
          reason: `New type ${create.label}`,
        });
      }
      continue;
    }
    const close = tree.topLevel
      .map((t) => ({ t, score: nameSimilarity(t.name, text) }))
      .filter((c) => c.score >= SIMILAR_NAME_THRESHOLD)
      .sort((a, b) => b.score - a.score)[0];
    if (close) {
      out.push(existing('similar', close.t.id));
      continue;
    }
    out.push({ ...base, kind: 'new', categoryId: null, categoryName: null, suggestion: { action: 'blank' } });
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
