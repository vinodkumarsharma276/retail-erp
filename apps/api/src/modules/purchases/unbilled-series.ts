import { prisma } from '../../config/database.js';

/**
 * The shop's own invoice numbering for purchases made without a bill.
 *
 * A supplier's bill arrives with its own number. Goods bought without one
 * still have to be identifiable afterwards — which almirah was this, and when
 * did it come in — so the shop numbers them itself, per product type: FURN1,
 * FURN2 for furniture, ALMR1 for an almirah.
 *
 * The first number of each series is entered by hand, so it can carry on from
 * whatever the written books already use rather than restarting at one and
 * colliding with numbers already written down.
 */

/**
 * The shorthand the shop already uses, where it differs from the obvious.
 *
 * ALMIRAH shortens to ALMR in their books, not ALMI. Only a suggestion: the
 * letters are settled when somebody starts the numbering, and can be anything
 * they like.
 */
const KNOWN_PREFIXES: Record<string, string> = {
  furniture: 'FURN',
  almirah: 'ALMR',
};

/** Letters suggested for a type whose numbering has not been started. */
export function suggestPrefix(categoryName: string): string {
  const name = String(categoryName ?? '').trim().toLowerCase();
  if (KNOWN_PREFIXES[name]) return KNOWN_PREFIXES[name];
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  return letters.slice(0, 4) || 'PUR';
}

export interface SeriesState {
  categoryId: string;
  categoryName: string;
  /** False until somebody sets the first number. */
  started: boolean;
  prefix: string;
  /** The number the next purchase would take, once started. */
  nextNumber: number;
  /** What that next invoice would be called, e.g. "FURN12". */
  nextInvoiceNumber: string;
}

export const unbilledSeriesService = {
  /** Every product type that can be bought without a bill, and its numbering. */
  async list(tenantId: string): Promise<SeriesState[]> {
    const categories = await prisma.productCategory.findMany({
      where: { tenantId, isActive: true, purchaseModes: { in: ['unbilled', 'both'] } },
      select: { id: true, name: true, displayOrder: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    const series = await prisma.purchaseInvoiceSeries.findMany({
      where: { tenantId, categoryId: { in: categories.map((c) => c.id) } },
    });
    const byCategory = new Map(series.map((s) => [s.categoryId, s]));

    return categories.map((category) => {
      const existing = byCategory.get(category.id);
      const prefix = existing?.prefix ?? suggestPrefix(category.name);
      const nextNumber = existing?.nextNumber ?? 1;
      return {
        categoryId: category.id,
        categoryName: category.name,
        started: Boolean(existing),
        prefix,
        nextNumber,
        nextInvoiceNumber: `${prefix}${nextNumber}`,
      };
    });
  },

  /**
   * The same thing the picker on the "without a bill" screen shows: each type
   * bought that way, the kinds of goods filed under it, and the invoice
   * number its next purchase would take.
   */
  async types(tenantId: string): Promise<UnbilledType[]> {
    const categories = await prisma.productCategory.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, parentId: true, displayOrder: true, purchaseModes: true },
    });
    const marked = categories.filter((c) => c.purchaseModes !== 'billed');
    if (marked.length === 0) return [];
    const series = await prisma.purchaseInvoiceSeries.findMany({
      where: { tenantId, categoryId: { in: marked.map((c) => c.id) } },
      select: { categoryId: true, prefix: true, nextNumber: true },
    });
    return buildUnbilledTypes(categories, series);
  },

  /**
   * Start a type's numbering, or correct it before it has been used.
   *
   * Changing where a series continues from is deliberately allowed: the shop
   * may discover its written books are further along than it thought.
   */
  async start(
    tenantId: string,
    data: { categoryId: string; prefix: string; startNumber: number },
    userId: string,
  ): Promise<SeriesState> {
    const category = await prisma.productCategory.findFirst({
      where: { id: data.categoryId, tenantId },
      select: { id: true, name: true, purchaseModes: true },
    });
    if (!category) throw new Error('Product type not found');
    if (category.purchaseModes === 'billed') {
      throw new Error(`${category.name} is not bought without a bill, so it has no numbering of its own.`);
    }

    const prefix = String(data.prefix ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (!prefix) throw new Error('The numbering needs some letters in front of it, such as FURN.');
    const startNumber = Math.max(1, Math.trunc(Number(data.startNumber) || 1));

    // The letters have to be the type's own, or two types would produce the
    // same invoice number and nothing would tell them apart afterwards.
    const clash = await prisma.purchaseInvoiceSeries.findFirst({
      where: { tenantId, prefix, categoryId: { not: data.categoryId } },
      select: { category: { select: { name: true } } },
    });
    if (clash) throw new Error(`${prefix} is already used for ${clash.category.name}.`);

    const saved = await prisma.purchaseInvoiceSeries.upsert({
      where: { tenantId_categoryId: { tenantId, categoryId: data.categoryId } },
      update: { prefix, nextNumber: startNumber },
      create: { tenantId, categoryId: data.categoryId, prefix, nextNumber: startNumber, createdBy: userId },
    });

    return {
      categoryId: category.id,
      categoryName: category.name,
      started: true,
      prefix: saved.prefix,
      nextNumber: saved.nextNumber,
      nextInvoiceNumber: `${saved.prefix}${saved.nextNumber}`,
    };
  },

  /**
   * Take the next number for a type and move the series on.
   *
   * Done inside the caller's transaction so a number is never handed out
   * twice, and never burnt if the purchase it was for fails to save.
   */
  async take(
    tx: { purchaseInvoiceSeries: { findFirst: Function; update: Function } },
    tenantId: string,
    categoryId: string,
  ): Promise<string> {
    const series = await tx.purchaseInvoiceSeries.findFirst({ where: { tenantId, categoryId } });
    if (!series) {
      throw new Error('This product type has no numbering yet. Set its first invoice number before adding purchases.');
    }
    const updated = await tx.purchaseInvoiceSeries.update({
      where: { id: series.id },
      data: { nextNumber: { increment: 1 } },
    });
    return `${series.prefix}${updated.nextNumber - 1}`;
  },
};

/** One product type that can be filed against a series, e.g. Wardrobe. */
export interface UnbilledTypeChoice {
  categoryId: string;
  /** The type's own name, e.g. "Wardrobe". */
  categoryName: string;
  /** Read down from the non-billed type, e.g. "Furniture › Wardrobe". */
  label: string;
}

/** A type bought without a bill, with the kinds of goods filed under it. */
export interface UnbilledType {
  series: SeriesState;
  choices: UnbilledTypeChoice[];
}

interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  displayOrder: number;
  purchaseModes: string;
}

interface SeriesRow {
  categoryId: string;
  prefix: string;
  nextNumber: number;
}

/**
 * Work out what the "without a bill" picker offers.
 *
 * Only a handful of types are bought this way, and the numbering belongs to
 * the type: Furniture has one series, so a wardrobe and a sofa bought off the
 * books both take a FURN number. The picker therefore shows the marked type
 * as a heading and the actual kinds of goods beneath it as the choices, since
 * a product is filed against the leaf it really is, not against "Furniture".
 *
 * A type marked inside another marked type keeps its own numbering, so it
 * becomes a heading of its own rather than a choice under its parent.
 */
export function buildUnbilledTypes(categories: CategoryRow[], series: SeriesRow[]): UnbilledType[] {
  const children = new Map<string | null, CategoryRow[]>();
  for (const category of categories) {
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category);
    children.set(category.parentId, siblings);
  }
  const inOrder = (rows: CategoryRow[]) =>
    [...rows].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));

  const isMarked = (category: CategoryRow) => category.purchaseModes !== 'billed';
  const bySeriesCategory = new Map(series.map((s) => [s.categoryId, s]));

  const marked = inOrder(categories.filter(isMarked));

  return marked.map((type) => {
    const choices: UnbilledTypeChoice[] = [];

    const walk = (category: CategoryRow, trail: string[]) => {
      const kids = inOrder(children.get(category.id) ?? []).filter((kid) => !isMarked(kid));
      if (kids.length === 0) {
        choices.push({
          categoryId: category.id,
          categoryName: category.name,
          label: [...trail, category.name].join(' › '),
        });
        return;
      }
      for (const kid of kids) walk(kid, [...trail, category.name]);
    };
    walk(type, []);

    const existing = bySeriesCategory.get(type.id);
    const prefix = existing?.prefix ?? suggestPrefix(type.name);
    const nextNumber = existing?.nextNumber ?? 1;
    return {
      series: {
        categoryId: type.id,
        categoryName: type.name,
        started: Boolean(existing),
        prefix,
        nextNumber,
        nextInvoiceNumber: `${prefix}${nextNumber}`,
      },
      choices,
    };
  });
}
