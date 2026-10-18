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
