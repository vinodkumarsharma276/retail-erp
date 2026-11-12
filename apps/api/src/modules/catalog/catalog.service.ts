import type { Prisma } from '@prisma/client';
import { brandKey, canonicalBrand, isCatalogBrand, modelKey } from '@retailerp/shared-utils';
import { prisma } from '../../config/database.js';

type Db = Prisma.TransactionClient;

export interface CatalogItem {
  categoryId?: string | null;
  brand?: string | null;
  model?: string | null;
}

const CHUNK = 5_000;
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const tidy = (text: string | null | undefined) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The type itself, its parents and its sub-types: brands sold under
 * "Refrigerator" are offered for "Refrigerator › Deep Freezer" and the other
 * way round, but never for "Cooler".
 */
async function familyOf(categoryId: string, db: Db = prisma): Promise<string[]> {
  const type = await db.productCategory.findFirst({ where: { id: categoryId }, select: { path: true } });
  if (!type) return [];
  const parts = type.path.split('.');
  const parents = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'));
  const rows = await db.productCategory.findMany({
    where: {
      OR: [
        { id: categoryId },
        { path: { startsWith: `${type.path}.` } },
        ...(parents.length ? [{ path: { in: parents } }] : []),
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Case-insensitively unique, first spelling kept, A–Z. */
function uniqueSorted(values: Iterable<string>, keyOf: (v: string) => string): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const text = tidy(v);
    const key = keyOf(text);
    if (key && !seen.has(key)) seen.set(key, text);
  }
  return [...seen.values()].sort(byName);
}

const brandKeyOf = (text: string) => brandKey(canonicalBrand(text));

export const catalogService = {
  /**
   * Add the makes and models of saved items to the catalog (Product type →
   * Brand → Model). Items without a type, cells naming several makes and
   * texts that aren't makes are skipped; what's already there is left alone.
   */
  async learn(items: CatalogItem[], db: Db = prisma): Promise<void> {
    const brands = new Map<string, { categoryId: string; name: string; key: string }>();
    const models = new Map<string, { brandRef: string; name: string; key: string }>();
    for (const item of items) {
      if (!item.categoryId || !isCatalogBrand(item.brand)) continue;
      const name = canonicalBrand(item.brand).slice(0, 100);
      const key = brandKey(name);
      const brandRef = `${item.categoryId}|${key}`;
      if (!brands.has(brandRef)) brands.set(brandRef, { categoryId: item.categoryId, name, key });
      const model = tidy(item.model).slice(0, 200);
      const mKey = modelKey(model);
      if (mKey && !models.has(`${brandRef}|${mKey}`)) models.set(`${brandRef}|${mKey}`, { brandRef, name: model, key: mKey });
    }
    if (!brands.size) return;
    const brandRows = [...brands.values()];
    for (let i = 0; i < brandRows.length; i += CHUNK) {
      await db.catalogBrand.createMany({ data: brandRows.slice(i, i + CHUNK) as any, skipDuplicates: true });
    }
    if (!models.size) return;

    const keysByType = new Map<string, string[]>();
    for (const b of brandRows) keysByType.set(b.categoryId, [...(keysByType.get(b.categoryId) ?? []), b.key]);
    const saved = await db.catalogBrand.findMany({
      where: { OR: [...keysByType].map(([categoryId, keys]) => ({ categoryId, key: { in: keys } })) },
      select: { id: true, categoryId: true, key: true },
    });
    const idOf = new Map(saved.map((b) => [`${b.categoryId}|${b.key}`, b.id]));
    const modelRows = [...models.values()].flatMap((m) => {
      const brandId = idOf.get(m.brandRef);
      return brandId ? [{ brandId, name: m.name, key: m.key }] : [];
    });
    for (let i = 0; i < modelRows.length; i += CHUNK) {
      await db.catalogModel.createMany({ data: modelRows.slice(i, i + CHUNK) as any, skipDuplicates: true });
    }
  },

  /**
   * Brands offered for a product type: the catalog's makes for the type's
   * family, the type's own brand list, and makes on stock in it.
   */
  async brands(categoryId: string): Promise<string[]> {
    const family = await familyOf(categoryId);
    if (!family.length) return [];
    const [listed, catalog, stock] = await Promise.all([
      prisma.categoryAttribute.findMany({ where: { categoryId: { in: family }, attributeName: 'brand' }, select: { options: true } }),
      prisma.catalogBrand.findMany({ where: { categoryId: { in: family } }, select: { name: true } }),
      prisma.product.findMany({ where: { categoryId: { in: family } }, select: { brand: true }, distinct: ['brand'], take: 1000 }),
    ]);
    const fromList = listed.flatMap((a) =>
      Array.isArray(a.options)
        ? a.options.map((o) =>
            String(o !== null && typeof o === 'object' ? ((o as Record<string, unknown>).value ?? (o as Record<string, unknown>).label ?? '') : (o ?? '')),
          )
        : [],
    );
    const values = [...fromList, ...catalog.map((b) => b.name), ...stock.map((p) => p.brand)].filter((b) => isCatalogBrand(b));
    return uniqueSorted(values, brandKeyOf);
  },

  /** Model numbers of one make within a product type's family (catalog plus stock). */
  async models(categoryId: string, brand: string): Promise<string[]> {
    const key = brandKeyOf(brand);
    if (!key) return [];
    const family = await familyOf(categoryId);
    if (!family.length) return [];
    const [catalog, stock] = await Promise.all([
      prisma.catalogModel.findMany({
        where: { brand: { categoryId: { in: family }, key } },
        select: { name: true },
        take: 5000,
      }),
      prisma.product.findMany({
        where: { categoryId: { in: family } },
        select: { brand: true, modelNumber: true },
        distinct: ['brand', 'modelNumber'],
        take: 5000,
      }),
    ]);
    const fromStock = stock.filter((p) => brandKeyOf(p.brand) === key).map((p) => p.modelNumber);
    return uniqueSorted([...catalog.map((m) => m.name), ...fromStock], modelKey);
  },
};
