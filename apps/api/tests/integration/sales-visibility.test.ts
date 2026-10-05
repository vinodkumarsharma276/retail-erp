import { describe, expect, it } from 'vitest';
import { tenantContext } from '../../src/config/tenant-context.js';
import { getSaleForRestrictedViewer, listSalesForRestrictedViewer } from '../../src/modules/sales/sales.public-view.js';
import { createInstallmentSale, day, prisma, type SaleFixture } from '../helpers/fixtures';

/**
 * S — Two copies of a self-finance sale (owner's rule, 2026-10-05).
 * Users without "see real sales" get every sale as it is, except
 * self-finance sales, which they see only as a cash sale.
 */
async function withSales() {
  // The fixture's sale is self-finance; give it its sanitized copy.
  const sale = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 3000 }, { due: '2026-12-04', amount: 3000 }], totalInterest: 600 });
  const real = await prisma.saleRecord.findUniqueOrThrow({ where: { id: sale.saleId } });
  await prisma.saleRecord.update({ where: { id: sale.saleId }, data: { interestRate: 2, fileCharge: 300, numInstallments: 2, emiAmount: 3000, notes: 'EMI 2 months, guarantor Ramesh' } });
  await prisma.saleRecordSanitized.create({
    data: {
      tenantId: sale.tenantId, id: real.id, saleNumber: real.saleNumber, ledgerNumber: real.ledgerNumber, shopId: real.shopId,
      productId: real.productId, customerId: real.customerId, saleDate: real.saleDate, saleType: 'full_payment',
      sellingPrice: real.sellingPrice, totalAmount: real.totalAmount, paymentMode: 'cash', createdBy: real.createdBy,
    },
  });
  // A cash sale and an NBFC sale in the same shop — one record each.
  const cash = await otherSale(sale, 'full_payment', 'S-CASH');
  const nbfc = await otherSale(sale, 'company_finance', 'S-NBFC');
  return { sale, cash, nbfc };
}

async function otherSale(base: SaleFixture, saleType: 'full_payment' | 'company_finance', saleNumber: string) {
  const product = await prisma.product.create({
    data: { tenantId: base.tenantId, shopId: base.shopId, categoryId: (await prisma.product.findFirstOrThrow({ where: { tenantId: base.tenantId } })).categoryId, brand: 'LG', modelNumber: saleNumber, mrp: 20000, sellingPrice: 19000, purchasePrice: 15000, status: 'sold' },
  });
  const finance = saleType === 'company_finance'
    ? await prisma.financeCompany.upsert({ where: { code: 'BAJAJ' }, update: {}, create: { name: 'Bajaj Finance', code: 'BAJAJ' } })
    : null;
  return prisma.saleRecord.create({
    data: {
      tenantId: base.tenantId, shopId: base.shopId, productId: product.id, customerId: base.customerId, saleNumber, ledgerNumber: saleNumber,
      saleDate: day('2026-09-01'), saleType, mrp: 20000, sellingPrice: 19000, netAmount: 19000, totalAmount: 19000,
      paymentMode: saleType === 'company_finance' ? 'cash' : 'upi', createdBy: base.userId,
      ...(finance ? { financeCompanyId: finance.id, financedAmount: 15000, downPayment: 4000 } : {}),
    },
  });
}

const restricted = (s: SaleFixture) =>
  tenantContext.runAs(s.tenantId, () => listSalesForRestrictedViewer({ shopId: s.shopId }, { skip: 0, take: 50 }));

describe('S. Sales seen without "see real sales"', () => {
  it('S1 a self-finance sale shows as a cash sale', async () => {
    const { sale } = await withSales();
    const { sales } = await restricted(sale);
    expect(sales.find((x) => x.id === sale.saleId)).toMatchObject({ saleType: 'full_payment', paymentMode: 'cash' });
  });

  it('S2 nothing in the response gives the self-finance sale away — same fields as a cash sale, no EMI words', async () => {
    const { sale, cash } = await withSales();
    const { sales } = await restricted(sale);
    const sf = sales.find((x) => x.id === sale.saleId)!;
    const c = sales.find((x) => x.id === cash.id)!;
    expect(Object.keys(sf).sort()).toEqual(Object.keys(c).sort());
    const text = JSON.stringify(sf);
    for (const word of ['self_finance', 'interestRate', 'emiAmount', 'fileCharge', 'numInstallments', 'guarantor', 'EMI']) {
      expect(text, word).not.toContain(word);
    }
  });

  it('S3 cash and NBFC sales are shown as they really are', async () => {
    const { sale, cash, nbfc } = await withSales();
    const { sales } = await restricted(sale);
    expect(sales.find((x) => x.id === cash.id)).toMatchObject({ saleType: 'full_payment', paymentMode: 'upi' });
    expect(sales.find((x) => x.id === nbfc.id)).toMatchObject({ saleType: 'company_finance', financeCompany: { code: 'BAJAJ' } });
    expect(Number(sales.find((x) => x.id === nbfc.id)!.financedAmount)).toBe(15000);
  });

  it('S4 filtering by "self finance" finds nothing; "full payment" includes the self-finance sale', async () => {
    const { sale } = await withSales();
    const only = (saleType: string) =>
      tenantContext.runAs(sale.tenantId, () => listSalesForRestrictedViewer({ shopId: sale.shopId }, { skip: 0, take: 50, saleType }));
    expect((await only('self_finance')).sales).toHaveLength(0);
    expect((await only('full_payment')).sales.map((x) => x.id)).toContain(sale.saleId);
  });

  it('S5 opening the sale shows the cash-sale copy too', async () => {
    const { sale } = await withSales();
    const detail = await tenantContext.runAs(sale.tenantId, () => getSaleForRestrictedViewer(sale.saleId));
    expect(detail).toMatchObject({ saleType: 'full_payment', paymentMode: 'cash', notes: null });
  });

  it('S6 every sale is counted once — no duplicates from the second copy', async () => {
    const { sale } = await withSales();
    const { sales, totalItems } = await restricted(sale);
    expect(totalItems).toBe(3);
    expect(new Set(sales.map((x) => x.id)).size).toBe(3);
  });
});
