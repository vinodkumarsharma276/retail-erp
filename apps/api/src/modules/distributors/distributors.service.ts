import { prisma } from '../../config/database.js';
import { Prisma } from '@prisma/client';
import { reasonPurchasesCannotBeDeleted } from '../purchases/purchases.service.js';
import {
  findDuplicateDistributors,
  type CandidateDistributor,
} from '@retailerp/shared-utils';

/** A supplier that cannot be deleted, because the books still point at it. */
export class DistributorInUseError extends Error {}

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
  totalPaymentPaid: number;
  pendingPayment: number;
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

  const [productCounts, purchaseSums] = await Promise.all([
    prisma.product.groupBy({
      by: ['distributorId'],
      where: { distributorId: { in: ids } },
      _count: { id: true },
    }),
    prisma.purchase.groupBy({
      by: ['distributorId'],
      where: { distributorId: { in: ids } },
      _sum: { netAmount: true, amountPaid: true },
    }),
  ]);

  const at = (id: string) => {
    const existing = totals.get(id);
    if (existing) return existing;
    const fresh = { totalProductsPurchased: 0, totalPaymentPaid: 0, pendingPayment: 0 };
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

  return totals;
}

function withTotals<T extends { id: string }>(distributor: T, totals: Map<string, DistributorTotals>) {
  const t = totals.get(distributor.id);
  return {
    ...distributor,
    totalProductsPurchased: t?.totalProductsPurchased ?? 0,
    totalPaymentPaid: t?.totalPaymentPaid ?? 0,
    pendingPayment: t?.pendingPayment ?? 0,
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

    return distributor;
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
    const existing = await prisma.distributor.findMany({
      select: { id: true, companyName: true, phone: true, gstNumber: true, panNumber: true },
    });
    return findDuplicateDistributors(candidates, existing);
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
        paymentStatus: { not: 'paid' },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    if (pendingPurchases.length === 0) {
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
      unallocated += left;
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

      return {
        totalDistributed,
        invoicesPaidFull,
        invoicesPaidPartial,
        remainingAmount: unallocated,
      };
    });

    return result;
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
        purchase: {
          id: purchase.id,
          invoiceNumber: purchase.invoiceNumber,
          invoiceDate: purchase.invoiceDate,
          netAmount: purchase.netAmount,
          shop: purchase.shop,
        },
      })),
    );

    // Sort by payment date descending
    payments.sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());

    return payments;
  },
};
