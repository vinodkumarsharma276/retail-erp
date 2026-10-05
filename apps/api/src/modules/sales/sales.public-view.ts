import type { Prisma, SaleRecord } from '@prisma/client';
import { prisma } from '../../config/database.js';

/**
 * Sales as seen by someone WITHOUT `sales.view_real` (e.g. shop staff).
 *
 * The shop's rule (owner, 2026-10-05):
 *  - A self-finance sale (the shop's own EMI scheme) is stored twice: the
 *    real record, and a sanitized copy recorded as a cash sale. Restricted
 *    users only ever see the copy.
 *  - Every other sale — cash, part payment, NBFC finance (Bajaj, HDB…),
 *    inter-shop transfer — is legitimate as it is and has ONE record.
 *
 * So a restricted user gets the real record for every sale except
 * self-finance ones, which are replaced by their copy. Every row is built
 * to the same shape from an explicit list of fields, so nothing in the
 * response (not even which keys are present) gives a self-finance sale
 * away: it looks exactly like a cash sale.
 */

type RealSale = SaleRecord & {
  product?: unknown;
  customer?: unknown;
  shop?: unknown;
  creator?: unknown;
  financeCompany?: unknown;
};

type SanitizedCopy = { sellingPrice: Prisma.Decimal; totalAmount: Prisma.Decimal; ledgerNumber: string; saleDate: Date };

function toPublicSale(real: RealSale, copy: SanitizedCopy | undefined) {
  const selfFinance = real.saleType === 'self_finance';
  const nbfc = real.saleType === 'company_finance';
  return {
    id: real.id,
    saleNumber: real.saleNumber,
    ledgerNumber: selfFinance && copy ? copy.ledgerNumber : real.ledgerNumber,
    shopId: real.shopId,
    productId: real.productId,
    customerId: real.customerId,
    saleDate: selfFinance && copy ? copy.saleDate : real.saleDate,
    saleType: selfFinance ? 'full_payment' : real.saleType,
    mrp: real.mrp,
    sellingPrice: selfFinance && copy ? copy.sellingPrice : real.sellingPrice,
    discountAmount: real.discountAmount,
    gstRate: real.gstRate,
    gstAmount: real.gstAmount,
    netAmount: selfFinance && copy ? copy.totalAmount : real.netAmount,
    totalAmount: selfFinance && copy ? copy.totalAmount : real.totalAmount,
    paymentMode: selfFinance ? 'cash' : real.paymentMode,
    paymentBreakdown: selfFinance ? null : real.paymentBreakdown,
    promiseDate: real.saleType === 'partial_with_promise' ? real.promiseDate : null,
    pendingAmount: real.saleType === 'partial_with_promise' ? real.pendingAmount : null,
    downPayment: nbfc ? real.downPayment : null,
    financeCompany: nbfc ? (real.financeCompany ?? null) : null,
    financedAmount: nbfc ? real.financedAmount : null,
    financePaymentStatus: nbfc ? real.financePaymentStatus : null,
    approvalStatus: real.approvalStatus,
    notes: selfFinance ? null : real.notes,
    createdAt: real.createdAt,
    product: real.product,
    customer: real.customer,
    shop: real.shop,
    creator: real.creator,
  };
}

async function copiesFor(sales: Array<{ id: string; saleType: string }>) {
  const ids = sales.filter((s) => s.saleType === 'self_finance').map((s) => s.id);
  if (ids.length === 0) return new Map<string, SanitizedCopy>();
  const rows = await prisma.saleRecordSanitized.findMany({
    where: { id: { in: ids } },
    select: { id: true, sellingPrice: true, totalAmount: true, ledgerNumber: true, saleDate: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

const LIST_INCLUDE = {
  product: { select: { id: true, brand: true, modelNumber: true, serialNumber: true } },
  customer: { select: { id: true, name: true, phone: true, customerCode: true } },
  shop: { select: { id: true, name: true, code: true } },
  creator: { select: { id: true, username: true, fullName: true } },
  financeCompany: { select: { id: true, name: true, code: true } },
} satisfies Prisma.SaleRecordInclude;

export async function listSalesForRestrictedViewer(
  scope: { shopId: string; shopIds?: string[] },
  filters: {
    skip: number;
    take: number;
    dateFrom?: string;
    dateTo?: string;
    saleType?: string;
    customerSearch?: string;
    approvalStatus?: 'pending' | 'approved';
  },
) {
  const where: Prisma.SaleRecordWhereInput =
    scope.shopIds && scope.shopIds.length > 0 ? { shopId: { in: scope.shopIds } } : { shopId: scope.shopId };

  // Self-finance sales appear as cash sales, so the type filter follows suit:
  // "full payment" includes them and "self finance" matches nothing.
  if (filters.saleType === 'self_finance') where.saleType = { in: [] };
  else if (filters.saleType === 'full_payment') where.saleType = { in: ['full_payment', 'self_finance'] };
  else if (filters.saleType) where.saleType = filters.saleType as Prisma.EnumSaleTypeFilter['equals'];
  if (filters.approvalStatus) where.approvalStatus = filters.approvalStatus;

  if (filters.dateFrom || filters.dateTo) {
    where.saleDate = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
    };
  }
  if (filters.customerSearch) {
    const q = filters.customerSearch;
    where.OR = [
      { ledgerNumber: { contains: q, mode: 'insensitive' } },
      { customer: { name: { contains: q, mode: 'insensitive' } } },
      { customer: { phone: { contains: q, mode: 'insensitive' } } },
      { customer: { customerCode: { contains: q, mode: 'insensitive' } } },
      { product: { modelNumber: { contains: q, mode: 'insensitive' } } },
      { product: { serialNumber: { contains: q, mode: 'insensitive' } } },
      { product: { brand: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const [rows, totalItems] = await Promise.all([
    prisma.saleRecord.findMany({ where, include: LIST_INCLUDE, orderBy: { saleDate: 'desc' }, skip: filters.skip, take: filters.take }),
    prisma.saleRecord.count({ where }),
  ]);
  const copies = await copiesFor(rows);
  return { sales: rows.map((r) => toPublicSale(r, copies.get(r.id))), totalItems };
}

export async function getSaleForRestrictedViewer(id: string) {
  const row = await prisma.saleRecord.findUnique({
    where: { id },
    include: {
      product: {
        select: {
          id: true, brand: true, modelNumber: true, serialNumber: true, mrp: true, dynamicAttributes: true,
          category: { select: { id: true, name: true, slug: true, hsnCode: true } },
        },
      },
      customer: {
        select: {
          id: true, name: true, phone: true, customerCode: true, addressLine1: true, addressLine2: true,
          city: true, state: true, pincode: true, gstNumber: true,
        },
      },
      shop: {
        select: {
          id: true, name: true, code: true, gstNumber: true, addressLine1: true, addressLine2: true,
          city: true, state: true, pincode: true, phone: true,
        },
      },
      creator: { select: { id: true, username: true, fullName: true } },
      financeCompany: { select: { id: true, name: true, code: true } },
    },
  });
  if (!row) return null;
  const copies = await copiesFor([row]);
  return toPublicSale(row, copies.get(row.id));
}
