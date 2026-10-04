import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/config/database.js';
import type { InstallmentEngineContext } from '../../src/modules/installments/installments.engine.js';
import { computeInstallmentStatus } from '../../src/modules/installments/installments.derivations.js';

export { prisma };

/** UTC midnight for YYYY-MM-DD — how `@db.Date` columns are stored. */
export const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface SaleFixture {
  tenantId: string;
  shopId: string;
  userId: string;
  customerId: string;
  saleId: string;
  scheduleId: string;
  /** EMI ids in installment-number order: emis[0] is EMI #1. */
  emis: string[];
  ctx: InstallmentEngineContext;
}

export interface SaleOptions {
  /** One entry per EMI, in order. */
  emis: Array<{ due: string; amount: number }>;
  /** Interest taken at sale time (drives the early-payment deduction). */
  totalInterest?: number;
  /** ₹/day late penalty for this sale; null = the shop default (₹2). */
  penaltyPerDay?: number | null;
}

let planId: string | null = null;

/**
 * A complete self-finance sale with its EMI schedule, in a tenant of its own
 * so tests never see each other's data.
 */
export async function createInstallmentSale(options: SaleOptions): Promise<SaleFixture> {
  const tag = randomUUID().slice(0, 8);
  if (!planId) {
    const plan = await prisma.plan.upsert({ where: { code: 'test-plan' }, update: {}, create: { code: 'test-plan', name: 'Test plan' } });
    planId = plan.id;
  }
  const tenant = await prisma.tenant.create({ data: { slug: `t-${tag}`, name: `Test ${tag}`, planId } });
  const tenantId = tenant.id;
  const shop = await prisma.shop.create({
    data: {
      tenantId, name: 'Test Shop', code: `T${tag.slice(0, 4)}`, gstNumber: `09TEST${tag.slice(0, 4).toUpperCase()}1Z5`,
      panNumber: 'AAAAA0000A', addressLine1: '1 Test Road', city: 'Ghaziabad', state: 'Uttar Pradesh', pincode: '201001', phone: '9999999999',
    },
  });
  const user = await prisma.user.create({
    data: { tenantId, username: `collector-${tag}`, passwordHash: 'x', fullName: 'Test Collector', phone: '9999999999', role: 'admin' },
  });
  const customer = await prisma.customer.create({
    data: { tenantId, shopId: shop.id, customerCode: `C${tag}`, name: 'Asha Verma', phone: '9876543210' },
  });
  const category = await prisma.productCategory.create({
    data: { tenantId, name: 'LED TV', slug: `led-tv-${tag}`, path: `led-tv-${tag}`, isLeaf: true },
  });
  const product = await prisma.product.create({
    data: {
      tenantId, shopId: shop.id, categoryId: category.id, brand: 'Samsung', modelNumber: 'UA43T5310',
      mrp: 40000, sellingPrice: 38000, purchasePrice: 30000, status: 'sold',
    },
  });

  const totalInterest = options.totalInterest ?? 0;
  const totalPayable = options.emis.reduce((s, e) => s + e.amount, 0);
  const sale = await prisma.saleRecord.create({
    data: {
      tenantId, shopId: shop.id, productId: product.id, customerId: customer.id,
      saleNumber: `S-${tag}`, ledgerNumber: `L-${tag}`, saleDate: day(options.emis[0].due), saleType: 'self_finance',
      mrp: 40000, sellingPrice: 38000, netAmount: totalPayable, totalAmount: totalPayable, paymentMode: 'cash',
      createdBy: user.id,
      penaltyPerDay: options.penaltyPerDay ?? null,
    },
  });
  const schedule = await prisma.installmentSchedule.create({
    data: {
      tenantId, saleId: sale.id, totalPrincipal: totalPayable - totalInterest, totalInterest, totalPayable,
      numInstallments: options.emis.length, emiAmount: options.emis[0].amount, startDate: day(options.emis[0].due),
    },
  });

  const emis: string[] = [];
  for (const [index, emi] of options.emis.entries()) {
    const dueDate = day(emi.due);
    const row = await prisma.installment.create({
      data: {
        tenantId, scheduleId: schedule.id, installmentNumber: index + 1, dueDate,
        amountDue: emi.amount, plannedAmount: emi.amount, amountPaid: 0, remainingAmount: emi.amount,
        status: computeInstallmentStatus({ dueDate, amountPaid: 0, remainingAmount: emi.amount }),
      },
    });
    emis.push(row.id);
  }

  return {
    tenantId, shopId: shop.id, userId: user.id, customerId: customer.id, saleId: sale.id, scheduleId: schedule.id, emis,
    ctx: { tenantId, actorUserId: user.id },
  };
}

export interface EmiState {
  number: number;
  due: string;
  planned: number;
  amountDue: number;
  paid: number;
  remaining: number;
  status: string;
}

/** Current EMIs of a sale, as plain numbers, in installment order. */
export async function emiStates(scheduleId: string): Promise<EmiState[]> {
  const rows = await prisma.installment.findMany({
    where: { scheduleId, parentInstallmentNumber: null },
    orderBy: { installmentNumber: 'asc' },
  });
  return rows.map((r) => ({
    number: r.installmentNumber,
    due: iso(r.dueDate),
    planned: Number(r.plannedAmount ?? r.amountDue),
    amountDue: Number(r.amountDue),
    paid: Number(r.amountPaid),
    remaining: Number(r.remainingAmount),
    status: r.status,
  }));
}

export const toNumber = (v: Prisma.Decimal | number | string | null | undefined) => Number(v ?? 0);
