import { prisma } from '../../config/database.js';
import { Prisma } from '@prisma/client';
import { reasonPurchasesCannotBeDeleted } from '../purchases/purchases.service.js';
import type { CandidateDistributor } from '@retailerp/shared-utils';
import { checkCandidatesForDuplicates } from './distributors.import.js';
import { advanceBalances, undoSupplierPayments } from './supplier-advances.js';

/** A supplier that cannot be deleted, because the books still point at it. */
export class DistributorInUseError extends Error {}

/** Money paid to a supplier is in the books: deleting the supplier would lose it. */
async function refuseIfAdvancesPaid(distributorIds: string[]) {
  const paid = await prisma.supplierAdvance.findFirst({
    where: { distributorId: { in: distributorIds } },
    select: { amount: true, distributor: { select: { companyName: true } } },
  });
  if (paid) {
    throw new DistributorInUseError(
      `${paid.distributor.companyName} cannot be deleted: an advance payment of ₹${Number(paid.amount).toLocaleString('en-IN')} is recorded against it. Merge it into the right supplier instead.`,
    );
  }
}

/** Columns the supplier table has, which the database can order on directly. */
const PLAIN_SORT_KEYS = ['companyName', 'contactPerson', 'phone', 'gstNumber'] as const;
/** Figures summed from a supplier's purchases, which it cannot. */
const TOTAL_SORT_KEYS = ['pendingPayment', 'totalPaymentPaid', 'totalProductsPurchased'] as const;

export type PlainSortKey = (typeof PLAIN_SORT_KEYS)[number];
export type TotalSortKey = (typeof TOTAL_SORT_KEYS)[number];
/** What a supplier list can be ordered by. */
export type DistributorSortKey = PlainSortKey | TotalSortKey;

export type SortDirection = 'asc' | 'desc';

export const DISTRIBUTOR_SORT_KEYS: DistributorSortKey[] = [
  ...PLAIN_SORT_KEYS,
  ...TOTAL_SORT_KEYS,
];

const isPlainSort = (key: DistributorSortKey): key is PlainSortKey =>
  (PLAIN_SORT_KEYS as readonly string[]).includes(key);

interface DistributorTotals {
  totalProductsPurchased: number;
  /** Paid on bills, plus advances not yet used. */
  totalPaymentPaid: number;
  /** Bills minus everything paid; below zero when an advance is waiting for the next bill. */
  pendingPayment: number;
  /** Paid in advance and not yet used against a bill. */
  advanceBalance: number;
}

/**
 * What each supplier has bought, paid and still owes.
 *
 * Summed in the database rather than by reading every purchase back: the
 * aggregate-sorted path asks for these across the whole list, not one page,
 * and that is a lot of rows to drag over the wire to add up three numbers.
 */
async function distributorTotals(ids: string[]): Promise<Map<string, DistributorTotals>> {
  const totals = new Map<string, DistributorTotals>();
  if (ids.length === 0) return totals;

  const [productCounts, purchaseSums, advances] = await Promise.all([
    prisma.product.groupBy({
      by: ['distributorId'],
      where: { distributorId: { in: ids } },
      _count: { id: true },
    }),
    prisma.purchase.groupBy({
      by: ['distributorId'],
      // Settled bills (cleared by the owner) owe nothing and had nothing paid.
      where: { distributorId: { in: ids }, paymentStatus: { not: 'settled' } },
      _sum: { netAmount: true, amountPaid: true },
    }),
    advanceBalances(prisma, { distributorIds: ids }),
  ]);

  const at = (id: string) => {
    const existing = totals.get(id);
    if (existing) return existing;
    const fresh = { totalProductsPurchased: 0, totalPaymentPaid: 0, pendingPayment: 0, advanceBalance: 0 };
    totals.set(id, fresh);
    return fresh;
  };

  for (const row of productCounts) {
    if (row.distributorId) at(row.distributorId).totalProductsPurchased = row._count.id;
  }
  for (const row of purchaseSums) {
    const entry = at(row.distributorId);
    const net = Number(row._sum.netAmount ?? 0);
    const paid = Number(row._sum.amountPaid ?? 0);
    entry.totalPaymentPaid = paid;
    entry.pendingPayment = net - paid;
  }
  for (const [distributorId, advance] of advances) {
    const entry = at(distributorId);
    entry.advanceBalance = advance;
    entry.totalPaymentPaid += advance;
    entry.pendingPayment -= advance;
  }

  return totals;
}

function withTotals<T extends { id: string }>(distributor: T, totals: Map<string, DistributorTotals>) {
  const t = totals.get(distributor.id);
  return {
    ...distributor,
    totalProductsPurchased: t?.totalProductsPurchased ?? 0,
    totalPaymentPaid: t?.totalPaymentPaid ?? 0,
    pendingPayment: t?.pendingPayment ?? 0,
    advanceBalance: t?.advanceBalance ?? 0,
  };
}

export const distributorsService = {
  async list(filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    search?: string;
    sortBy?: DistributorSortKey;
    sortDir?: SortDirection;
  }) {
    const where: Prisma.DistributorWhereInput = {};

    if (filters.search) {
      where.OR = [
        { companyName: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { gstNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const sortBy: DistributorSortKey = filters.sortBy ?? 'companyName';
    // Money and counts are asked about biggest-first — "who do I owe most"
    // — while text is looked up A to Z.
    const sortDir: SortDirection = filters.sortDir ?? (isPlainSort(sortBy) ? 'asc' : 'desc');

    const include = {
      categories: {
        include: {
          category: { select: { id: true, name: true, slug: true, path: true } },
        },
      },
    } satisfies Prisma.DistributorInclude;

    // --- Sorting on a column the table actually has ------------------------
    // The database can order and cut the page in one go.
    if (isPlainSort(sortBy)) {
      const [distributors, totalItems] = await Promise.all([
        prisma.distributor.findMany({
          where,
          include,
          // A second key keeps paging stable where the first one ties —
          // every imported supplier has a blank phone, for instance.
          orderBy: [{ [sortBy]: sortDir }, { companyName: 'asc' }],
          skip: filters.skip,
          take: filters.take,
        }),
        prisma.distributor.count({ where }),
      ]);

      const totals = await distributorTotals(distributors.map((d) => d.id));
      return { distributors: distributors.map((d) => withTotals(d, totals)), totalItems };
    }

    // --- Sorting on a figure that has to be worked out ---------------------
    // Pending, paid and stock bought are not columns on the supplier: they
    // are sums over its purchases. Every matching supplier therefore has to
    // be weighed before the page can be cut, or "the ten I owe most" would
    // only ever mean "the ten I owe most on this page", which is the whole
    // complaint.
    const matching = await prisma.distributor.findMany({
      where,
      select: { id: true, companyName: true },
    });

    const totals = await distributorTotals(matching.map((d) => d.id));

    const metric = (id: string) => {
      const t = totals.get(id);
      if (!t) return 0;
      if (sortBy === 'pendingPayment') return t.pendingPayment;
      if (sortBy === 'totalPaymentPaid') return t.totalPaymentPaid;
      return t.totalProductsPurchased;
    };

    const ordered = [...matching].sort((a, b) => {
      const diff = metric(b.id) - metric(a.id);
      if (diff !== 0) return sortDir === 'desc' ? diff : -diff;
      // Suppliers with nothing against them all score zero, so without a
      // second key the order would shuffle between pages.
      return a.companyName.localeCompare(b.companyName);
    });

    const pageIds = ordered.slice(filters.skip, filters.skip + filters.take).map((d) => d.id);
    const rows = await prisma.distributor.findMany({ where: { id: { in: pageIds } }, include });
    const byId = new Map(rows.map((r) => [r.id, r]));

    return {
      // findMany returns its own order; the sorted one is the point here.
      distributors: pageIds
        .map((id) => byId.get(id))
        .filter((d): d is (typeof rows)[number] => d != null)
        .map((d) => withTotals(d, totals)),
      totalItems: matching.length,
    };
  },

  async getById(id: string) {
    const distributor = await prisma.distributor.findUnique({
      where: { id },
      include: {
        categories: {
          include: {
            category: {
              select: { id: true, name: true, slug: true, path: true },
            },
          },
        },
        creator: {
          select: { id: true, username: true, fullName: true },
        },
      },
    });
    if (!distributor) return distributor;

    // Advances waiting for this supplier's next bills, per shop.
    const open = await prisma.supplierAdvance.groupBy({
      by: ['shopId'],
      where: { distributorId: id, remaining: { gt: 0 } },
      _sum: { remaining: true },
    });
    const shops = open.length
      ? await prisma.shop.findMany({ where: { id: { in: open.map((a) => a.shopId) } }, select: { id: true, name: true, code: true } })
      : [];
    const advances = open.map((a) => ({
      shop: shops.find((s) => s.id === a.shopId) ?? { id: a.shopId, name: '', code: '' },
      remaining: Number(a._sum.remaining ?? 0),
    }));
    return { ...distributor, advances, advanceBalance: advances.reduce((s, a) => s + a.remaining, 0) };
  },

  async create(data: {
    companyName: string;
    contactPerson: string;
    phone: string;
    altPhone?: string | null;
    email?: string | null;
    gstNumber?: string | null;
    panNumber?: string | null;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    pincode: string;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    bankBranch?: string | null;
    paymentTerms?: string | null;
    creditLimit?: number;
    categoryIds?: string[];
  }, userId: string, tenantId: string) {
    const { categoryIds, ...distributorData } = data;

    // Check for duplicate GST number (scoped to tenant)
    if (distributorData.gstNumber) {
      const existingGst = await prisma.distributor.findFirst({
        where: { tenantId, gstNumber: distributorData.gstNumber },
      });
      if (existingGst) {
        throw new Error(`A distributor with GST number "${distributorData.gstNumber}" already exists (${existingGst.companyName})`);
      }
    }

    // Check for duplicate PAN number (scoped to tenant)
    if (distributorData.panNumber) {
      const existingPan = await prisma.distributor.findFirst({
        where: { tenantId, panNumber: distributorData.panNumber },
      });
      if (existingPan) {
        throw new Error(`A distributor with PAN number "${distributorData.panNumber}" already exists (${existingPan.companyName})`);
      }
    }

    // Check for duplicate bank account number (scoped to tenant)
    if (distributorData.bankAccountNumber) {
      const existingBank = await prisma.distributor.findFirst({
        where: { tenantId, bankAccountNumber: distributorData.bankAccountNumber },
      });
      if (existingBank) {
        throw new Error(`A distributor with bank account "${distributorData.bankAccountNumber}" already exists (${existingBank.companyName})`);
      }
    }

    // Validate categories exist if provided
    if (categoryIds && categoryIds.length > 0) {
      const categories = await prisma.productCategory.findMany({
        where: { id: { in: categoryIds } },
      });
      if (categories.length !== categoryIds.length) {
        throw new Error('One or more category IDs are invalid');
      }
    }

    const distributor = await prisma.distributor.create({
      data: {
        companyName: distributorData.companyName,
        contactPerson: distributorData.contactPerson,
        phone: distributorData.phone,
        altPhone: distributorData.altPhone ?? null,
        email: distributorData.email ?? null,
        gstNumber: distributorData.gstNumber ?? null,
        panNumber: distributorData.panNumber ?? null,
        addressLine1: distributorData.addressLine1,
        addressLine2: distributorData.addressLine2 ?? null,
        city: distributorData.city,
        state: distributorData.state,
        pincode: distributorData.pincode,
        bankName: distributorData.bankName ?? null,
        bankAccountNumber: distributorData.bankAccountNumber ?? null,
        bankIfsc: distributorData.bankIfsc ?? null,
        bankBranch: distributorData.bankBranch ?? null,
        paymentTerms: distributorData.paymentTerms ?? null,
        creditLimit: distributorData.creditLimit ?? 0,
        tenant: { connect: { id: tenantId } },
        creator: { connect: { id: userId } },
        // Nested creates don't inherit the parent's tenant, so each join row
        // has to carry `tenantId` explicitly.
        categories: categoryIds && categoryIds.length > 0
          ? {
              create: categoryIds.map((categoryId) => ({
                tenantId,
                categoryId,
              })),
            }
          : undefined,
      },
      include: {
        categories: {
          include: {
            category: {
              select: { id: true, name: true, slug: true, path: true },
            },
          },
        },
      },
    });

    return distributor;
  },

  /**
   * Delete one supplier, or a batch of them.
   *
   * A supplier is the other half of every purchase recorded against it, so
   * one that has traded cannot be taken away: the purchase would be left
   * pointing at nobody, and the stock it brought in would have arrived from
   * nowhere. Same for stock still carrying this supplier's name. Those are
   * the shop's own books, not clutter, so the answer is to refuse and say
   * which supplier and why — this exists for the duplicates and typos a
   * sheet import leaves behind, which have no history at all.
   *
   * The categories a supplier is marked as supplying are its own, and go
   * with it.
   *
   * All or nothing: either every supplier named goes, or none does.
   */
  async remove(ids: string[]) {
    const distributors = await prisma.distributor.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        companyName: true,
        _count: { select: { purchases: true, products: true } },
      },
    });

    const missing = ids.filter((id) => !distributors.some((d) => d.id === id));
    if (missing.length > 0) {
      throw new DistributorInUseError(
        missing.length === ids.length
          ? 'That distributor is not here to delete.'
          : `${missing.length} of those distributors are not here to delete.`,
      );
    }

    for (const distributor of distributors) {
      const { purchases, products } = distributor._count;
      if (purchases > 0) {
        throw new DistributorInUseError(
          `${distributor.companyName} cannot be deleted: ${purchases} purchase${purchases === 1 ? '' : 's'} recorded against it. Delete those first.`,
        );
      }
      if (products > 0) {
        throw new DistributorInUseError(
          `${distributor.companyName} cannot be deleted: ${products} product${products === 1 ? ' carries' : 's carry'} its name.`,
        );
      }
    }
    await refuseIfAdvancesPaid(distributors.map((d) => d.id));

    const distributorIds = distributors.map((d) => d.id);
    return prisma.$transaction(async (tx) => {
      await tx.distributorCategory.deleteMany({
        where: { distributorId: { in: distributorIds } },
      });
      const removed = await tx.distributor.deleteMany({
        where: { id: { in: distributorIds } },
      });
      return { distributors: removed.count };
    });
  },

  /**
   * Who among these is already on file.
   *
   * Compared against every supplier the tenant has, not a page of them:
   * a duplicate that happens to be on page seven is still a duplicate.
   * Only the four fields the check looks at are read back.
   */
  async checkDuplicates(candidates: CandidateDistributor[]) {
    return checkCandidatesForDuplicates(candidates);
  },

  /**
   * What deleting these suppliers would take with them.
   *
   * Shown before the fact, because the counts are the whole decision: a
   * supplier is not worth much on its own, but three invoices and
   * seventy-nine units of stock are.
   */
  async deletionImpact(ids: string[]) {
    const distributors = await prisma.distributor.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        companyName: true,
        _count: { select: { purchases: true, products: true } },
      },
    });

    return distributors.map((d) => ({
      id: d.id,
      companyName: d.companyName,
      purchases: d._count.purchases,
      products: d._count.products,
    }));
  },

  /**
   * Delete suppliers along with everything that came in through them.
   *
   * `purchases.distributor_id` is NOT NULL, so a supplier cannot be removed
   * while an invoice still points at it — and an invoice cannot be removed
   * without the units it brought in. Deleting a supplier that has traded is
   * therefore always this: the supplier, its invoices, and its stock, or
   * nothing.
   *
   * The same rules that protect a purchase from deletion apply here, from
   * the same shared guard: a unit that has been sold or transferred, or an
   * invoice with money against it, stops the whole thing. Coming at the
   * books from the supplier end must not erase what the purchase end
   * refuses to.
   */
  async removeWithHistory(ids: string[]) {
    const distributors = await prisma.distributor.findMany({
      where: { id: { in: ids } },
      select: { id: true, companyName: true },
    });

    const missing = ids.filter((id) => !distributors.some((d) => d.id === id));
    if (missing.length > 0) {
      throw new DistributorInUseError(
        missing.length === ids.length
          ? 'That distributor is not here to delete.'
          : `${missing.length} of those distributors are not here to delete.`,
      );
    }

    const distributorIds = distributors.map((d) => d.id);

    const purchases = await prisma.purchase.findMany({
      where: { distributorId: { in: distributorIds } },
      select: {
        id: true,
        invoiceNumber: true,
        amountPaid: true,
        products: { select: { id: true, status: true } },
      },
    });

    const blocked = await reasonPurchasesCannotBeDeleted(purchases);
    if (blocked) throw new DistributorInUseError(blocked);
    await refuseIfAdvancesPaid(distributorIds);

    // Stock can carry a supplier's name without belonging to one of its
    // invoices — a transfer makes units that way. Those go too, and face the
    // same test, or a sold unit could slip out through this door.
    const loose = await prisma.product.findMany({
      where: {
        distributorId: { in: distributorIds },
        id: { notIn: purchases.flatMap((p) => p.products.map((u) => u.id)) },
      },
      select: { id: true, status: true, modelNumber: true },
    });
    if (loose.length > 0) {
      const looseBlocked = await reasonPurchasesCannotBeDeleted([
        { invoiceNumber: 'Stock held against this supplier', amountPaid: new Prisma.Decimal(0), products: loose },
      ]);
      if (looseBlocked) throw new DistributorInUseError(looseBlocked);
    }

    const purchaseIds = purchases.map((p) => p.id);
    const productIds = [
      ...purchases.flatMap((p) => p.products.map((u) => u.id)),
      ...loose.map((u) => u.id),
    ];

    return prisma.$transaction(async (tx) => {
      await tx.productAuditTrail.deleteMany({ where: { productId: { in: productIds } } });
      await tx.purchasePayment.deleteMany({ where: { purchaseId: { in: purchaseIds } } });
      const units = await tx.product.deleteMany({ where: { id: { in: productIds } } });
      const invoices = await tx.purchase.deleteMany({ where: { id: { in: purchaseIds } } });
      await tx.distributorCategory.deleteMany({ where: { distributorId: { in: distributorIds } } });
      const removed = await tx.distributor.deleteMany({ where: { id: { in: distributorIds } } });
      return { distributors: removed.count, purchases: invoices.count, units: units.count };
    });
  },

  /**
   * Fold duplicate suppliers into one.
   *
   * A sheet import spells the same supplier three ways, and by the time
   * anyone notices, each spelling owns real purchases and real stock. Those
   * cannot be thrown away and must not be stranded, so they move onto the
   * supplier being kept and the emptied duplicates go.
   *
   * What moves: every purchase, every product, and any category the kept
   * supplier was not already marked as supplying. Nothing is recalculated —
   * the rows only change which supplier they point at, so totals on the kept
   * supplier come out as the sum of what went in.
   *
   * All or nothing: one transaction, so a half-merged supplier cannot exist.
   */
  async merge(sourceIds: string[], targetId: string) {
    if (sourceIds.includes(targetId)) {
      throw new DistributorInUseError(
        'The supplier being kept cannot also be one of the duplicates being merged into it.',
      );
    }

    const ids = [...sourceIds, targetId];
    const found = await prisma.distributor.findMany({
      where: { id: { in: ids } },
      select: { id: true, companyName: true },
    });

    const missing = ids.filter((id) => !found.some((d) => d.id === id));
    if (missing.length > 0) {
      throw new DistributorInUseError(
        missing.includes(targetId)
          ? 'The supplier to keep is not here.'
          : `${missing.length} of those duplicates ${missing.length === 1 ? 'is' : 'are'} not here.`,
      );
    }

    const target = found.find((d) => d.id === targetId)!;

    return prisma.$transaction(async (tx) => {
      const purchases = await tx.purchase.updateMany({
        where: { distributorId: { in: sourceIds } },
        data: { distributorId: targetId },
      });
      const products = await tx.product.updateMany({
        where: { distributorId: { in: sourceIds } },
        data: { distributorId: targetId },
      });
      // Money paid in advance to a duplicate was paid to the supplier being kept.
      await tx.supplierAdvance.updateMany({
        where: { distributorId: { in: sourceIds } },
        data: { distributorId: targetId },
      });

      // Categories are a set, not a count: the kept supplier ends up marked
      // as supplying everything any of them did, with no duplicate rows.
      const targetCategories = await tx.distributorCategory.findMany({
        where: { distributorId: targetId },
        select: { categoryId: true },
      });
      const alreadyThere = new Set(targetCategories.map((c) => c.categoryId));
      const fromSources = await tx.distributorCategory.findMany({
        where: { distributorId: { in: sourceIds } },
        select: { id: true, categoryId: true },
      });
      const toMove = fromSources.filter((c) => !alreadyThere.has(c.categoryId));
      // One category can arrive from two duplicates at once; keep the first.
      const seen = new Set<string>();
      const moveIds: string[] = [];
      for (const row of toMove) {
        if (seen.has(row.categoryId)) continue;
        seen.add(row.categoryId);
        moveIds.push(row.id);
      }
      if (moveIds.length > 0) {
        await tx.distributorCategory.updateMany({
          where: { id: { in: moveIds } },
          data: { distributorId: targetId },
        });
      }
      await tx.distributorCategory.deleteMany({
        where: { distributorId: { in: sourceIds } },
      });

      const removed = await tx.distributor.deleteMany({
        where: { id: { in: sourceIds } },
      });

      return {
        keptName: target.companyName,
        merged: removed.count,
        purchases: purchases.count,
        products: products.count,
        categories: moveIds.length,
      };
    });
  },

  async update(id: string, data: {
    companyName?: string;
    contactPerson?: string;
    phone?: string;
    altPhone?: string | null;
    email?: string | null;
    gstNumber?: string | null;
    panNumber?: string | null;
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    pincode?: string;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    bankBranch?: string | null;
    paymentTerms?: string | null;
    creditLimit?: number;
    isActive?: boolean;
    categoryIds?: string[];
  }) {
    const existing = await prisma.distributor.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }

    const { categoryIds, ...updateData } = data;

    // Check for duplicate GST number (exclude self)
    if (updateData.gstNumber) {
      const existingGst = await prisma.distributor.findFirst({
        where: { gstNumber: updateData.gstNumber, id: { not: id } },
      });
      if (existingGst) {
        throw new Error(`A distributor with GST number "${updateData.gstNumber}" already exists (${existingGst.companyName})`);
      }
    }

    // Check for duplicate PAN number (exclude self)
    if (updateData.panNumber) {
      const existingPan = await prisma.distributor.findFirst({
        where: { panNumber: updateData.panNumber, id: { not: id } },
      });
      if (existingPan) {
        throw new Error(`A distributor with PAN number "${updateData.panNumber}" already exists (${existingPan.companyName})`);
      }
    }

    // Check for duplicate bank account number (exclude self)
    if (updateData.bankAccountNumber) {
      const existingBank = await prisma.distributor.findFirst({
        where: { bankAccountNumber: updateData.bankAccountNumber, id: { not: id } },
      });
      if (existingBank) {
        throw new Error(`A distributor with bank account "${updateData.bankAccountNumber}" already exists (${existingBank.companyName})`);
      }
    }

    // Validate categories exist if provided
    if (categoryIds && categoryIds.length > 0) {
      const categories = await prisma.productCategory.findMany({
        where: { id: { in: categoryIds } },
      });
      if (categories.length !== categoryIds.length) {
        throw new Error('One or more category IDs are invalid');
      }
    }

    // Use transaction to update distributor and replace category associations
    const distributor = await prisma.$transaction(async (tx) => {
      // If categoryIds provided, replace all associations
      if (categoryIds !== undefined) {
        await tx.distributorCategory.deleteMany({
          where: { distributorId: id },
        });

        if (categoryIds.length > 0) {
          await tx.distributorCategory.createMany({
            data: categoryIds.map((categoryId) => ({
              tenantId: existing.tenantId,
              distributorId: id,
              categoryId,
            })),
            skipDuplicates: true,
          });
        }
      }

      const updated = await tx.distributor.update({
        where: { id },
        data: updateData,
        include: {
          categories: {
            include: {
              category: {
                select: { id: true, name: true, slug: true, path: true },
              },
            },
          },
        },
      });

      return updated;
    });

    return distributor;
  },

  async getProducts(distributorId: string, filters: {
    skip: number;
    take: number;
    page: number;
    pageSize: number;
    dateFrom?: string;
    dateTo?: string;
  }) {
    // Verify distributor exists
    const distributor = await prisma.distributor.findUnique({
      where: { id: distributorId },
    });
    if (!distributor) {
      return null;
    }

    const where: Prisma.ProductWhereInput = {
      distributorId,
    };

    // Filter by date range via purchase.invoiceDate
    if (filters.dateFrom || filters.dateTo) {
      const purchaseFilter: Prisma.PurchaseWhereInput = {};
      if (filters.dateFrom) {
        purchaseFilter.invoiceDate = {
          ...(purchaseFilter.invoiceDate as object),
          gte: new Date(filters.dateFrom),
        };
      }
      if (filters.dateTo) {
        purchaseFilter.invoiceDate = {
          ...(purchaseFilter.invoiceDate as object),
          lte: new Date(filters.dateTo),
        };
      }
      where.purchase = purchaseFilter;
    }

    const [products, totalItems] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true, slug: true, path: true },
          },
          purchase: {
            select: { id: true, invoiceNumber: true, invoiceDate: true },
          },
          shop: {
            select: { id: true, name: true, code: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: filters.skip,
        take: filters.take,
      }),
      prisma.product.count({ where }),
    ]);

    return { products, totalItems };
  },

  /**
   * Settle a supplier's oldest invoices with one payment, which may be made
   * up of several tenders.
   *
   * A payment to a supplier is rarely one clean thing: half in cash, the
   * rest by cheque, and the cheque has a number worth keeping against it.
   * So the money arrives as a list, each part carrying its own mode and
   * reference, and each lands as its own `PurchasePayment` row — an invoice
   * settled by cash and cheque together shows both, which is what the
   * payment history has to be able to say.
   *
   * The invoices themselves are still filled oldest-first across the whole
   * payment: the tenders decide what the money *is*, not where it goes.
   */
  async recordLumpsumPayment(
    distributorId: string,
    data: {
      tenders: Array<{
        amount: number;
        paymentMode: string;
        referenceNumber?: string | null;
        notes?: string | null;
      }>;
      paymentDate: string;
      notes?: string;
    },
    userId: string,
    /**
     * `shopId`: settle only that shop's bills (money paid from a shop's bank account).
     * `statementTransactionId`: the bank row this payment was recorded from.
     * `advanceShopId`: keep whatever the open bills don't take as an advance for that shop,
     *   used up by its next bills from this supplier. Without it there must be bills to pay,
     *   and any excess is reported back unrecorded.
     */
    options: { shopId?: string; statementTransactionId?: string; advanceShopId?: string } = {},
  ) {
    // Verify distributor exists
    const distributor = await prisma.distributor.findUnique({
      where: { id: distributorId },
    });
    if (!distributor) {
      throw new Error('Distributor not found');
    }

    // Find all unpaid/partial purchases, oldest first (FIFO)
    const pendingPurchases = await prisma.purchase.findMany({
      where: {
        distributorId,
        paymentStatus: { notIn: ['paid', 'settled'] },
        ...(options.shopId ? { shopId: options.shopId } : {}),
      },
      orderBy: { invoiceDate: 'asc' },
    });

    if (pendingPurchases.length === 0 && !options.advanceShopId) {
      throw new Error('No pending invoices found for this distributor');
    }

    /** What each invoice has been paid so far, as this payment proceeds. */
    const paidSoFar = new Map(
      pendingPurchases.map((p) => [p.id, Number(p.amountPaid)]),
    );
    const rowsToWrite: Array<{
      purchase: (typeof pendingPurchases)[number];
      amount: number;
      paymentMode: string;
      referenceNumber: string | null;
      notes: string | null;
    }> = [];

    let totalDistributed = 0;
    let unallocated = 0;
    /** What each tender has left once the bills are paid — kept as advances when allowed. */
    const leftovers: Array<{ amount: number; paymentMode: string; referenceNumber: string | null; notes: string | null }> = [];

    for (const tender of data.tenders) {
      let left = tender.amount;
      for (const purchase of pendingPurchases) {
        if (left <= 0) break;
        const pending = Number(purchase.netAmount) - (paidSoFar.get(purchase.id) ?? 0);
        if (pending <= 0) continue;

        const payAmount = Math.min(left, pending);
        rowsToWrite.push({
          purchase,
          amount: payAmount,
          paymentMode: tender.paymentMode,
          referenceNumber: tender.referenceNumber ?? null,
          notes: tender.notes ?? data.notes ?? null,
        });

        paidSoFar.set(purchase.id, (paidSoFar.get(purchase.id) ?? 0) + payAmount);
        totalDistributed += payAmount;
        left -= payAmount;
      }
      // More money than there are invoices to put it against.
      left = Math.round(left * 100) / 100;
      if (left > 0) {
        unallocated += left;
        leftovers.push({
          amount: left,
          paymentMode: tender.paymentMode,
          referenceNumber: tender.referenceNumber ?? null,
          notes: tender.notes ?? data.notes ?? null,
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      for (const row of rowsToWrite) {
        // `tenantId` comes from the parent purchase rather than the request
        // context, so a payment can never land in a different tenant than
        // the invoice it settles.
        await tx.purchasePayment.create({
          data: {
            tenantId: row.purchase.tenantId,
            purchaseId: row.purchase.id,
            amount: row.amount,
            paymentMode: row.paymentMode as any,
            paymentDate: new Date(data.paymentDate),
            referenceNumber: row.referenceNumber,
            notes: row.notes,
            createdBy: userId,
            statementTransactionId: options.statementTransactionId ?? null,
          },
        });
      }

      let invoicesPaidFull = 0;
      let invoicesPaidPartial = 0;

      // One update per invoice at the end, not one per tender that touched
      // it: an invoice settled by cash and cheque together is still one
      // invoice that has moved to "paid".
      for (const purchase of pendingPurchases) {
        const finalPaid = paidSoFar.get(purchase.id) ?? 0;
        if (finalPaid === Number(purchase.amountPaid)) continue;

        const paymentStatus = finalPaid >= Number(purchase.netAmount) ? 'paid' : 'partial';
        if (paymentStatus === 'paid') invoicesPaidFull++;
        else invoicesPaidPartial++;

        await tx.purchase.update({
          where: { id: purchase.id },
          data: { amountPaid: finalPaid, paymentStatus },
        });
      }

      // Money beyond the open bills is kept, not dropped, when the caller said which shop holds it.
      let advanceAmount = 0;
      if (options.advanceShopId) {
        for (const part of leftovers) {
          await tx.supplierAdvance.create({
            data: {
              tenantId: distributor.tenantId,
              shopId: options.advanceShopId,
              distributorId,
              amount: part.amount,
              remaining: part.amount,
              paymentMode: part.paymentMode as any,
              paymentDate: new Date(data.paymentDate),
              referenceNumber: part.referenceNumber,
              notes: part.notes,
              statementTransactionId: options.statementTransactionId ?? null,
              createdBy: userId,
            },
          });
          advanceAmount += part.amount;
        }
      }

      return {
        totalDistributed,
        invoicesPaidFull,
        invoicesPaidPartial,
        /** Kept as an advance against this supplier's next bills. */
        advanceAmount: Math.round(advanceAmount * 100) / 100,
        /** Neither used on a bill nor kept — only when no shop was given to hold an advance. */
        remainingAmount: options.advanceShopId ? 0 : Math.round(unallocated * 100) / 100,
      };
    });

    return result;
  },

  /**
   * What clearing a supplier's payments in these shops would do, per shop: "Total paid" drops by
   * what was paid on bills plus unused advances, and "Pending" by what the open bills still owe.
   */
  async clearPaymentsImpact(distributorId: string, shopIds: string[]) {
    const distributor = await prisma.distributor.findUnique({ where: { id: distributorId }, select: { companyName: true } });
    if (!distributor) return null;
    const open = { distributorId, shopId: { in: shopIds }, paymentStatus: { not: 'settled' } };
    const [bills, advances, payments, shops] = await Promise.all([
      prisma.purchase.groupBy({ by: ['shopId'], where: open, _sum: { amountPaid: true, netAmount: true }, _count: true }),
      prisma.supplierAdvance.groupBy({
        by: ['shopId'],
        where: { distributorId, shopId: { in: shopIds } },
        _sum: { remaining: true },
        _count: true,
      }),
      prisma.purchasePayment.count({ where: { purchase: { distributorId, shopId: { in: shopIds } }, supplierAdvanceId: null } }),
      prisma.shop.findMany({ where: { id: { in: shopIds } }, select: { id: true, name: true } }),
    ]);
    const round = (n: number) => Math.round(n * 100) / 100;
    const perShop = shops
      .map((s) => {
        const b = bills.find((x) => x.shopId === s.id);
        const a = advances.find((x) => x.shopId === s.id);
        const paidOnBills = Number(b?._sum.amountPaid ?? 0);
        const advance = Number(a?._sum.remaining ?? 0);
        return {
          shopId: s.id,
          shopName: s.name,
          bills: b?._count ?? 0,
          advances: a?._count ?? 0,
          paid: round(paidOnBills + advance),
          advance,
          pending: round(Math.max(0, Number(b?._sum.netAmount ?? 0) - paidOnBills)),
        };
      })
      .filter((s) => s.bills > 0 || s.advances > 0);
    return {
      supplier: distributor.companyName,
      payments,
      advances: perShop.reduce((n, s) => n + s.advances, 0),
      bills: perShop.reduce((n, s) => n + s.bills, 0),
      paid: round(perShop.reduce((n, s) => n + s.paid, 0)),
      pending: round(perShop.reduce((n, s) => n + s.pending, 0)),
      shops: perShop,
    };
  },

  /** The same, for several suppliers at once (the list page's selection). */
  async clearPaymentsImpactMany(ids: string[], shopIds: string[]) {
    const each = (await Promise.all(ids.map((id) => this.clearPaymentsImpact(id, shopIds)))).filter((x) => x !== null);
    const sum = (k: 'paid' | 'pending' | 'bills' | 'payments' | 'advances') => each.reduce((n, x) => n + x[k], 0);
    return {
      suppliers: each.map((x) => ({ supplier: x.supplier, paid: x.paid, pending: x.pending, bills: x.bills })),
      paid: Math.round(sum('paid') * 100) / 100,
      pending: Math.round(sum('pending') * 100) / 100,
      bills: sum('bills'),
      payments: sum('payments'),
      advances: sum('advances'),
    };
  },

  /**
   * Close a supplier's account in these shops, as the owner decided: every payment and advance
   * is deleted and every bill is marked settled, so both "Total paid" and "Pending" go to ₹0. The
   * bills and the stock they brought in stay. Bank rows the payments came from stay, and can be
   * recorded as payments again. New bills from the supplier start a fresh balance. Owner-only.
   */
  async clearPayments(distributorId: string, shopIds: string[], userId: string) {
    const before = await this.clearPaymentsImpact(distributorId, shopIds);
    if (!before) return null;
    await prisma.$transaction(async (tx) => {
      await undoSupplierPayments(tx, {
        payments: { purchase: { distributorId, shopId: { in: shopIds } } },
        advances: { distributorId, shopId: { in: shopIds } },
      });
      // Also covers paid amounts from before payments were itemised (no payment row behind them).
      await tx.purchase.updateMany({
        where: { distributorId, shopId: { in: shopIds } },
        data: { amountPaid: 0, paymentStatus: 'settled' },
      });
      await tx.auditLog.create({
        data: {
          userId,
          shopId: shopIds.length === 1 ? shopIds[0] : null,
          entityType: 'distributor',
          entityId: distributorId,
          action: 'clear_payments',
          oldValues: { ...before, shopIds },
        },
      });
    });
    return before;
  },

  async clearPaymentsMany(ids: string[], shopIds: string[], userId: string) {
    const done = [];
    for (const id of ids) {
      const r = await this.clearPayments(id, shopIds, userId);
      if (r) done.push(r);
    }
    return {
      suppliers: done.length,
      paid: Math.round(done.reduce((n, x) => n + x.paid, 0) * 100) / 100,
      pending: Math.round(done.reduce((n, x) => n + x.pending, 0) * 100) / 100,
    };
  },
  async getPayments(distributorId: string) {
    // Verify distributor exists
    const distributor = await prisma.distributor.findUnique({
      where: { id: distributorId },
    });
    if (!distributor) {
      return null;
    }

    // Get all purchases for this distributor, then their payments
    const purchases = await prisma.purchase.findMany({
      where: { distributorId },
      include: {
        payments: {
          include: {
            creator: {
              select: { id: true, username: true, fullName: true },
            },
          },
          orderBy: { paymentDate: 'desc' },
        },
        shop: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { invoiceDate: 'desc' },
    });

    // Flatten payments with purchase context
    const payments = purchases.flatMap((purchase) =>
      purchase.payments.map((payment) => ({
        ...payment,
        /** Part of an advance, used up by this bill — the money itself is the advance row below. */
        fromAdvance: payment.supplierAdvanceId != null,
        purchase: {
          id: purchase.id,
          invoiceNumber: purchase.invoiceNumber,
          invoiceDate: purchase.invoiceDate,
          netAmount: purchase.netAmount,
          shop: purchase.shop,
        },
      })),
    );

    // Advances: money paid before (or beyond) the bills, with how much is still unused.
    const advances = await prisma.supplierAdvance.findMany({
      where: { distributorId },
      include: {
        creator: { select: { id: true, username: true, fullName: true } },
        shop: { select: { id: true, name: true, code: true } },
      },
    });
    const advanceRows = advances.map((a) => ({
      id: a.id,
      amount: a.amount,
      paymentMode: a.paymentMode,
      paymentDate: a.paymentDate,
      referenceNumber: a.referenceNumber,
      notes: a.notes,
      createdAt: a.createdAt,
      creator: a.creator,
      isAdvance: true,
      advanceRemaining: Number(a.remaining),
      shop: a.shop,
      purchase: null,
    }));

    // Sort by payment date descending
    const all = [...payments, ...advanceRows];
    all.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());

    return all;
  },
};
