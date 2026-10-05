import { describe, expect, it } from 'vitest';
import { tenantContext } from '../../src/config/tenant-context.js';
import { TENANT_SCOPED_MODELS } from '../../src/config/database.js';
import { createInstallmentSale, prisma } from '../helpers/fixtures';

/**
 * T — Tenant isolation. Inside a tenant's context (every API request), the
 * database layer must only ever show or change that tenant's rows, even when
 * the calling code forgets to filter.
 */
describe('T. Tenant isolation', () => {
  it('T1 a list query only returns the current tenant\'s rows, even without a tenant filter', async () => {
    const a = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const b = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const seenByA = await tenantContext.runAs(a.tenantId, () => prisma.customer.findMany({ select: { id: true } }));
    const ids = seenByA.map((c) => c.id);
    expect(ids).toContain(a.customerId);
    expect(ids).not.toContain(b.customerId);
  });

  it('T2 opening another tenant\'s record by its id finds nothing', async () => {
    const a = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const b = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const sale = await tenantContext.runAs(a.tenantId, () => prisma.saleRecord.findUnique({ where: { id: b.saleId } }));
    expect(sale).toBeNull();
  });

  it('T3 updating or deleting another tenant\'s rows changes nothing', async () => {
    const a = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const b = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const updated = await tenantContext.runAs(a.tenantId, () =>
      prisma.customer.updateMany({ where: { id: b.customerId }, data: { name: 'Hijacked' } }),
    );
    expect(updated.count).toBe(0);
    await expect(
      tenantContext.runAs(a.tenantId, () => prisma.customer.update({ where: { id: b.customerId }, data: { name: 'Hijacked' } })),
    ).rejects.toThrow();
    const untouched = await prisma.customer.findUniqueOrThrow({ where: { id: b.customerId } });
    expect(untouched.name).not.toBe('Hijacked');
  });

  it('T4 new rows are stamped with the current tenant automatically', async () => {
    const a = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const created = await tenantContext.runAs(a.tenantId, () =>
      prisma.customer.create({ data: { shopId: a.shopId, customerCode: 'AUTO1', name: 'Auto Stamped', phone: '9000000000' } as any }),
    );
    expect(created.tenantId).toBe(a.tenantId);
  });

  it('T5 writing a row for a different tenant is blocked', async () => {
    const a = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const b = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    await expect(
      tenantContext.runAs(a.tenantId, () =>
        prisma.customer.create({ data: { tenantId: b.tenantId, shopId: b.shopId, customerCode: 'X1', name: 'Wrong tenant', phone: '9000000001' } }),
      ),
    ).rejects.toThrow('cross-tenant');
  });

  it('T6 counts and totals only add up the current tenant\'s rows', async () => {
    const a = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }, { due: '2026-12-04', amount: 1000 }] });
    await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 5000 }] });
    const sum = await tenantContext.runAs(a.tenantId, () => prisma.installment.aggregate({ _sum: { amountDue: true } }));
    expect(Number(sum._sum.amountDue)).toBe(2000);
  });

  it('T7 transactions stay scoped too', async () => {
    const a = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const b = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
    const found = await tenantContext.runAs(a.tenantId, () =>
      prisma.$transaction(async (tx) => tx.installmentSchedule.findFirst({ where: { id: b.scheduleId } })),
    );
    expect(found).toBeNull();
  });

  it('T8 every business table is covered (has a tenant column)', () => {
    for (const model of ['Shop', 'User', 'Customer', 'Product', 'Distributor', 'Purchase', 'SaleRecord', 'SaleRecordSanitized', 'Installment', 'InstallmentPayment', 'InstallmentPromise', 'Expense', 'ProductCategory', 'Role']) {
      expect(TENANT_SCOPED_MODELS.has(model), model).toBe(true);
    }
  });
});
