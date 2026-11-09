import { describe, expect, it } from 'vitest';
import { tenantContext } from '../../src/config/tenant-context.js';
import { applySupplierMatches, SUPPLIER_CATEGORY } from '../../src/modules/bank-statements/engine/categorize/suppliers.js';
import {
  deleteImpact, deleteStatement, deleteTransactions, getTransaction, HttpError, patchTransactions, recordSupplierPayment,
} from '../../src/modules/bank-statements/bank-statements.service.js';
import { ROLE_ADMIN_PERMISSIONS, ROLE_OWNER_PERMISSIONS } from '@retailerp/shared-types';
import { distributorsService } from '../../src/modules/distributors/distributors.service.js';
import { purchasesService } from '../../src/modules/purchases/purchases.service.js';
import { createInstallmentSale, day, prisma, toNumber } from '../helpers/fixtures';

/** A tenant with two shops, a supplier with bills at both, and a bank statement for the first shop. */
async function setup() {
  const base = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
  const { tenantId, shopId, userId } = base;
  const other = await prisma.shop.create({
    data: {
      tenantId, name: 'Other Shop', code: `O${shopId.slice(0, 4)}`, gstNumber: `09OTHR${shopId.slice(0, 4).toUpperCase()}1Z5`,
      panNumber: 'AAAAA0000A', addressLine1: '2 Test Road', city: 'Ghaziabad', state: 'Uttar Pradesh', pincode: '201001', phone: '9999999999',
    },
  });
  const supplier = await prisma.distributor.create({
    data: { tenantId, companyName: 'NAVRANG MARKETING', contactPerson: 'Ravi', phone: '9811111111', addressLine1: 'Market', city: 'Delhi', state: 'Delhi', pincode: '110001' },
  });
  await prisma.distributor.create({
    data: { tenantId, companyName: 'NAVRANG DISTRIBUTORS', contactPerson: 'Amit', phone: '9822222222', addressLine1: 'Market', city: 'Delhi', state: 'Delhi', pincode: '110001' },
  });
  const bill = (shop: string, n: string, date: string, amount: number) =>
    prisma.purchase.create({
      data: { tenantId, shopId: shop, distributorId: supplier.id, invoiceNumber: n, invoiceDate: day(date), totalAmount: amount, netAmount: amount },
    });
  const older = await bill(shopId, 'NM-1', '2026-09-01', 300000);
  const newer = await bill(shopId, 'NM-2', '2026-09-20', 300000);
  const elsewhere = await bill(other.id, 'NM-9', '2026-08-01', 100000);

  const statement = await prisma.bankStatement.create({
    data: { tenantId, shopId, fileName: 'fed.pdf', fileHash: `h-${shopId}`, fileType: 'pdf', fileSize: 1, bank: 'Federal Bank', parseMethod: 'pdf-text' },
  });
  const tx = (description: string, amount: number, channel: string, reference: string | null, rowIndex: number) =>
    prisma.statementTransaction.create({
      data: {
        tenantId, statementId: statement.id, shopId, bank: 'Federal Bank', date: day('2026-10-12'), description, amount,
        direction: amount < 0 ? 'debit' : 'credit', channel, reference, fingerprint: `${rowIndex}`, rowIndex, category: 'Uncategorized',
      },
    });
  const cheque = await tx('NAVRANG MARKETING / CLG', -490000, 'Cheque', 'S93945867', 0);
  const cash = await tx('CASH:SELF / CASH', -200000, 'ATM/Cash', 'FB107405', 1);
  const deposit = await tx('NAVRANG MARKETING REFUND / TFR', 5000, 'NEFT/IMPS/RTGS', 'S1', 2);
  // A supplier paid before any bill from them is recorded.
  const laxmi = await prisma.distributor.create({
    data: { tenantId, companyName: 'LAXMI ENTERPRISES', contactPerson: 'Laxmi', phone: '9833333333', addressLine1: 'Market', city: 'Delhi', state: 'Delhi', pincode: '110001' },
  });
  const neft = await tx('NFT/FBBT262925890053 Laxmi Enterpris ICIC0001917 V / FT', -166500, 'NEFT/IMPS/RTGS', 'S8958855', 3);
  return {
    tenantId, shopId, otherShopId: other.id, userId, supplier, laxmi, older, newer, elsewhere, statement, cheque, cash, deposit, neft,
    scope: { tenantId, shopIds: [shopId] },
  };
}

describe('B. Bank withdrawals as supplier payments', () => {
  it('B1 suggests the supplier named in a withdrawal, and only for withdrawals', async () => {
    const f = await setup();
    await applySupplierMatches(f.tenantId, f.statement.id, { useAi: false });
    const rows = await prisma.statementTransaction.findMany({ where: { statementId: f.statement.id }, orderBy: { rowIndex: 'asc' } });
    expect(rows.map((r) => r.distributorId)).toEqual([f.supplier.id, null, null, f.laxmi.id]);
    expect(rows[0].distributorSource).toBe('match');
    expect(rows[0].category).toBe(SUPPLIER_CATEGORY);
  });

  it('B2 records the withdrawal against the shop\'s oldest bills, linked to the bank row', async () => {
    const f = await setup();
    await applySupplierMatches(f.tenantId, f.statement.id, { useAi: false });
    const result = await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.cheque.id, { paymentMode: 'cheque' }, f.userId));

    expect(result.totalDistributed).toBe(490000);
    expect(result.remainingAmount).toBe(0);
    const payments = await prisma.purchasePayment.findMany({ where: { statementTransactionId: f.cheque.id }, orderBy: { amount: 'desc' } });
    expect(payments.map((p) => [p.purchaseId, toNumber(p.amount), p.paymentMode, p.referenceNumber])).toEqual([
      [f.older.id, 300000, 'cheque', 'S93945867'],
      [f.newer.id, 190000, 'cheque', 'S93945867'],
    ]);
    const bills = await prisma.purchase.findMany({ where: { id: { in: [f.older.id, f.newer.id, f.elsewhere.id] } } });
    const status = Object.fromEntries(bills.map((b) => [b.invoiceNumber, b.paymentStatus]));
    expect(status).toEqual({ 'NM-1': 'paid', 'NM-2': 'partial', 'NM-9': 'pending' });

    const row = await getTransaction(f.scope, f.cheque.id);
    expect(row.supplier_paid_amount).toBe(490000);
    expect(row.distributor_source).toBe('user');
  });

  it('B3 the same withdrawal cannot be recorded twice', async () => {
    const f = await setup();
    await applySupplierMatches(f.tenantId, f.statement.id, { useAi: false });
    await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.cheque.id, {}, f.userId));
    await expect(tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.cheque.id, {}, f.userId))).rejects.toMatchObject({ statusCode: 409 });
  });

  it('B4 money paid in is never recorded as a supplier payment', async () => {
    const f = await setup();
    await expect(
      tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.deposit.id, { distributorId: f.supplier.id }, f.userId)),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('B5 a person\'s choice survives re-matching', async () => {
    const f = await setup();
    await applySupplierMatches(f.tenantId, f.statement.id, { useAi: false });
    await patchTransactions(f.scope, [f.cheque.id], { distributor_id: null }, 'Tester');
    await applySupplierMatches(f.tenantId, f.statement.id, { useAi: false });
    const row = await prisma.statementTransaction.findUniqueOrThrow({ where: { id: f.cheque.id } });
    expect(row.distributorId).toBeNull();
    expect(row.distributorSource).toBe('user');
  });
});

/** A bill entered through the purchase screen's own code path, so advances are used the real way. */
async function recordBill(f: Awaited<ReturnType<typeof setup>>, distributorId: string, invoiceNumber: string, amount: number) {
  const category = await prisma.productCategory.findFirstOrThrow({ where: { tenantId: f.tenantId } });
  return tenantContext.runAs(f.tenantId, () =>
    purchasesService.create(f.shopId, f.tenantId, {
      distributorId, invoiceNumber, invoiceDate: '2026-10-25', totalAmount: amount,
      items: [{ categoryId: category.id, brand: 'Samsung', modelNumber: 'AC-1', mrp: amount, purchasePrice: amount }],
    }, f.userId),
  );
}

describe('A. Paying a supplier before the bill: advances', () => {
  it('A1 a payment with no bill to settle asks first, then is kept as an advance', async () => {
    const f = await setup();
    await applySupplierMatches(f.tenantId, f.statement.id, { useAi: false });
    expect((await getTransaction(f.scope, f.neft.id)).distributor_id).toBe(f.laxmi.id);

    const ask = await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.neft.id, {}, f.userId)).catch((e) => e);
    expect(ask).toBeInstanceOf(HttpError);
    expect(ask.details).toMatchObject({ code: 'advance_needed', due: 0, advance: 166500, supplier: 'LAXMI ENTERPRISES' });
    expect(ask.message).toContain('no unpaid bills');

    const done = await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.neft.id, { asAdvance: true }, f.userId));
    expect(done).toMatchObject({ totalDistributed: 0, advanceAmount: 166500, remainingAmount: 0 });
    expect(done.transaction).toMatchObject({ supplier_paid_amount: 166500, supplier_advance_amount: 166500 });
    const advance = await prisma.supplierAdvance.findFirstOrThrow({ where: { statementTransactionId: f.neft.id } });
    expect([toNumber(advance.amount), toNumber(advance.remaining), advance.shopId, advance.paymentMode]).toEqual([166500, 166500, f.shopId, 'bank_transfer']);

    // The supplier's balance shows money paid ahead, and the same withdrawal can't be recorded again.
    const supplier = await tenantContext.runAs(f.tenantId, () => distributorsService.getById(f.laxmi.id));
    expect(supplier?.advanceBalance).toBe(166500);
    const listed = await tenantContext.runAs(f.tenantId, () => distributorsService.list({ skip: 0, take: 50, search: 'LAXMI' } as any));
    expect((listed as any).distributors[0]).toMatchObject({ pendingPayment: -166500, advanceBalance: 166500 });
    await expect(tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.neft.id, { asAdvance: true }, f.userId))).rejects.toMatchObject({ statusCode: 409 });
  });

  it('A2 the shop\'s next bills from the supplier are paid from the advance automatically', async () => {
    const f = await setup();
    await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.neft.id, { distributorId: f.laxmi.id, asAdvance: true }, f.userId));

    const first = await recordBill(f, f.laxmi.id, 'LX-1', 100000);
    expect(first).toMatchObject({ paymentStatus: 'paid' });
    expect(toNumber(first!.amountPaid)).toBe(100000);
    const second = await recordBill(f, f.laxmi.id, 'LX-2', 100000);
    expect(second).toMatchObject({ paymentStatus: 'partial' });
    expect(toNumber(second!.amountPaid)).toBe(66500);

    const advance = await prisma.supplierAdvance.findFirstOrThrow({ where: { distributorId: f.laxmi.id } });
    expect(toNumber(advance.remaining)).toBe(0);
    const uses = await prisma.purchasePayment.findMany({ where: { supplierAdvanceId: advance.id }, orderBy: { amount: 'desc' } });
    expect(uses.map((u) => [toNumber(u.amount), u.referenceNumber, u.statementTransactionId])).toEqual([
      [100000, 'S8958855', f.neft.id],
      [66500, 'S8958855', f.neft.id],
    ]);
    // The bank row still says what was paid, not counted twice.
    expect((await getTransaction(f.scope, f.neft.id)).supplier_paid_amount).toBe(166500);
    // Another shop's bills don't touch this shop's advance.
    await prisma.supplierAdvance.update({ where: { id: advance.id }, data: { remaining: 5000 } });
    const otherBill = await prisma.$transaction(async (tx) => {
      const bill = await tx.purchase.create({
        data: { tenantId: f.tenantId, shopId: f.otherShopId, distributorId: f.laxmi.id, invoiceNumber: 'LX-9', invoiceDate: day('2026-10-26'), totalAmount: 1000, netAmount: 1000 },
      });
      const { applySupplierAdvances } = await import('../../src/modules/distributors/supplier-advances.js');
      await applySupplierAdvances(tx, f.otherShopId, f.laxmi.id);
      return tx.purchase.findUniqueOrThrow({ where: { id: bill.id } });
    });
    expect(otherBill.paymentStatus).toBe('pending');
  });

  it('A3 more than the open bills: the bills are paid and the rest is kept as an advance', async () => {
    const f = await setup();
    await prisma.purchase.update({ where: { id: f.newer.id }, data: { amountPaid: 300000, paymentStatus: 'paid' } });
    // Only NM-1 (300000) is open at this shop; the cheque is 490000.
    const ask = await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.cheque.id, { distributorId: f.supplier.id }, f.userId)).catch((e) => e);
    expect(ask.details).toMatchObject({ code: 'advance_needed', due: 300000, advance: 190000 });
    const done = await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.cheque.id, { distributorId: f.supplier.id, asAdvance: true }, f.userId));
    expect(done).toMatchObject({ totalDistributed: 300000, advanceAmount: 190000 });
    expect(done.transaction).toMatchObject({ supplier_paid_amount: 490000, supplier_advance_amount: 190000 });
  });

  it('A4 merging suppliers carries the advance over; deleting a supplier with an advance is refused', async () => {
    const f = await setup();
    await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.neft.id, { distributorId: f.laxmi.id, asAdvance: true }, f.userId));
    await expect(tenantContext.runAs(f.tenantId, () => distributorsService.remove([f.laxmi.id]))).rejects.toThrow(/advance payment/);

    const keep = await prisma.distributor.create({
      data: { tenantId: f.tenantId, companyName: 'LAXMI ENTERPRISES PVT LTD', contactPerson: 'L', phone: '9844444444', addressLine1: 'M', city: 'Delhi', state: 'Delhi', pincode: '110001' },
    });
    await tenantContext.runAs(f.tenantId, () => distributorsService.merge([f.laxmi.id], keep.id));
    const moved = await prisma.supplierAdvance.findFirstOrThrow({ where: { statementTransactionId: f.neft.id } });
    expect(moved.distributorId).toBe(keep.id);
  });
});

const bills = async (ids: string[]) =>
  Object.fromEntries(
    (await prisma.purchase.findMany({ where: { id: { in: ids } } })).map((b) => [b.invoiceNumber, [toNumber(b.amountPaid), b.paymentStatus]]),
  );

describe('D. Deleting bank rows takes back the supplier payments recorded from them', () => {
  it('D1 previews the payments, refuses without the payment permission, then reverses exactly what was paid', async () => {
    const f = await setup();
    // Paid before payments were itemised: no payment row behind it, and it must survive.
    await prisma.purchase.update({ where: { id: f.older.id }, data: { amountPaid: 50000, paymentStatus: 'partial' } });
    await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.cheque.id, { distributorId: f.supplier.id }, f.userId));
    expect(await bills([f.older.id, f.newer.id])).toEqual({ 'NM-1': [300000, 'paid'], 'NM-2': [240000, 'partial'] });

    const impact = await deleteImpact(f.scope, { ids: [f.cheque.id, f.cash.id] });
    expect(impact.transactions).toBe(2);
    expect(impact.supplierPayments).toMatchObject([{ supplier: 'NAVRANG MARKETING', amount: 490000, advance: 0, bills: 2 }]);

    await expect(
      tenantContext.runAs(f.tenantId, () => deleteTransactions(f.scope, [f.cheque.id], { canUndoPayments: false })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.statementTransaction.count({ where: { id: f.cheque.id } })).toBe(1);

    const done = await tenantContext.runAs(f.tenantId, () => deleteTransactions(f.scope, [f.cheque.id, f.cash.id], { canUndoPayments: true }));
    expect(done).toMatchObject({ deleted: 2, statementsRemoved: 0, supplierPayments: { payments: 2, bills: 2, amount: 490000 } });
    expect(await bills([f.older.id, f.newer.id])).toEqual({ 'NM-1': [50000, 'partial'], 'NM-2': [0, 'pending'] });
    expect(await prisma.purchasePayment.count({ where: { purchase: { distributorId: f.supplier.id } } })).toBe(0);
    const statement = await prisma.bankStatement.findUniqueOrThrow({ where: { id: f.statement.id } });
    expect(statement.txCount).toBe(2);
  });

  it('D2 deleting the row of an advance removes the advance and what it paid on later bills', async () => {
    const f = await setup();
    await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.neft.id, { distributorId: f.laxmi.id, asAdvance: true }, f.userId));
    const bill = await recordBill(f, f.laxmi.id, 'LX-1', 100000);
    expect(bill).toMatchObject({ paymentStatus: 'paid' });

    expect((await deleteImpact(f.scope, { ids: [f.neft.id] })).supplierPayments).toMatchObject([
      { supplier: 'LAXMI ENTERPRISES', amount: 166500, advance: 66500 },
    ]);
    const done = await tenantContext.runAs(f.tenantId, () => deleteTransactions(f.scope, [f.neft.id], { canUndoPayments: true }));
    expect(done.supplierPayments).toMatchObject({ payments: 1, advances: 1, bills: 1, amount: 166500 });
    expect(await bills([bill!.id])).toEqual({ 'LX-1': [0, 'pending'] });
    expect(await prisma.supplierAdvance.count({ where: { distributorId: f.laxmi.id } })).toBe(0);
  });

  it('D3 a statement emptied of rows goes; deleting a statement reverses its payments too', async () => {
    const f = await setup();
    await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.cheque.id, { distributorId: f.supplier.id }, f.userId));
    const result = await tenantContext.runAs(f.tenantId, () => deleteStatement(f.scope, f.statement.id, { canUndoPayments: true }));
    expect(result.supplierPayments).toMatchObject({ payments: 2, amount: 490000 });
    expect(await bills([f.older.id, f.newer.id])).toEqual({ 'NM-1': [0, 'pending'], 'NM-2': [0, 'pending'] });

    const g = await setup();
    const all = [g.cheque.id, g.cash.id, g.deposit.id, g.neft.id];
    const gone = await tenantContext.runAs(g.tenantId, () => deleteTransactions(g.scope, all, { canUndoPayments: true }));
    expect(gone.statementsRemoved).toBe(1);
    expect(await prisma.bankStatement.count({ where: { id: g.statement.id } })).toBe(0);
  });
});

describe('C. Clearing a supplier\'s payments (owner)', () => {
  it('C1 settles the shop\'s bills: payments and advances deleted, paid and pending 0, other shops untouched', async () => {
    const f = await setup();
    await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.cheque.id, { distributorId: f.supplier.id }, f.userId));
    await tenantContext.runAs(f.tenantId, () =>
      distributorsService.recordLumpsumPayment(f.supplier.id, { tenders: [{ amount: 120000, paymentMode: 'cash' }], paymentDate: '2026-10-30' } as any, f.userId, { shopId: f.shopId, advanceShopId: f.shopId }),
    );
    await prisma.purchase.update({ where: { id: f.elsewhere.id }, data: { amountPaid: 100000, paymentStatus: 'paid' } });

    const impact = await tenantContext.runAs(f.tenantId, () => distributorsService.clearPaymentsImpact(f.supplier.id, [f.shopId]));
    // 490000 from the bank + 110000 cash on NM-2 + 10000 kept as an advance; both bills fully paid.
    expect(impact).toMatchObject({ supplier: 'NAVRANG MARKETING', bills: 2, advances: 1, paid: 610000, pending: 0 });

    await tenantContext.runAs(f.tenantId, () => distributorsService.clearPayments(f.supplier.id, [f.shopId], f.userId));
    expect(await bills([f.older.id, f.newer.id, f.elsewhere.id])).toEqual({
      'NM-1': [0, 'settled'], 'NM-2': [0, 'settled'], 'NM-9': [100000, 'paid'],
    });
    expect(await prisma.purchasePayment.count({ where: { purchase: { distributorId: f.supplier.id, shopId: f.shopId } } })).toBe(0);
    expect(await prisma.supplierAdvance.count({ where: { distributorId: f.supplier.id } })).toBe(0);
    // The bank row stays, free to be recorded again — but settled bills are never paid again.
    expect((await getTransaction(f.scope, f.cheque.id)).supplier_paid_amount).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: f.supplier.id, action: 'clear_payments' } })).toBe(1);
  });

  it('C3 cleared across every shop (several suppliers at once), Total paid and Pending are both 0', async () => {
    const f = await setup();
    await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.cheque.id, { distributorId: f.supplier.id }, f.userId));
    // Paid with no payment row behind it (imported / older data), in the other shop.
    await prisma.purchase.update({ where: { id: f.elsewhere.id }, data: { amountPaid: 40000, paymentStatus: 'partial' } });
    await tenantContext.runAs(f.tenantId, () => recordSupplierPayment(f.scope, f.neft.id, { distributorId: f.laxmi.id, asAdvance: true }, f.userId));
    const shops = [f.shopId, f.otherShopId];

    const preview = await tenantContext.runAs(f.tenantId, () => distributorsService.clearPaymentsImpactMany([f.supplier.id, f.laxmi.id], shops));
    // NAVRANG: paid 490000 + 40000, pending 110000 + 60000. LAXMI: an advance of 166500.
    expect(preview).toMatchObject({ paid: 696500, pending: 170000, bills: 3, advances: 1 });

    await tenantContext.runAs(f.tenantId, () => distributorsService.clearPaymentsMany([f.supplier.id, f.laxmi.id], shops, f.userId));
    const listed = await tenantContext.runAs(f.tenantId, () => distributorsService.list({ skip: 0, take: 50 } as any));
    for (const name of ['NAVRANG MARKETING', 'LAXMI ENTERPRISES']) {
      expect((listed as any).distributors.find((d: any) => d.companyName === name)).toMatchObject({
        totalPaymentPaid: 0, pendingPayment: 0, advanceBalance: 0,
      });
    }
    // A settled bill takes no new payment; a new bill starts a fresh balance.
    await expect(
      tenantContext.runAs(f.tenantId, () =>
        distributorsService.recordLumpsumPayment(f.supplier.id, { tenders: [{ amount: 1000, paymentMode: 'cash' }], paymentDate: '2026-11-01' } as any, f.userId, { shopId: f.shopId }),
      ),
    ).rejects.toThrow(/No pending invoices/);
    await expect(
      tenantContext.runAs(f.tenantId, () => purchasesService.recordPayment(f.older.id, { amount: 1, paymentMode: 'cash', paymentDate: '2026-11-01' }, f.userId)),
    ).rejects.toThrow(/settled/);
    await recordBill(f, f.supplier.id, 'NM-NEW', 5000);
    const after = await tenantContext.runAs(f.tenantId, () => distributorsService.list({ skip: 0, take: 50, search: 'NAVRANG MARKETING' } as any));
    expect((after as any).distributors[0]).toMatchObject({ totalPaymentPaid: 0, pendingPayment: 5000 });
  });
  it('C2 only the owner role gets the permission by default', () => {
    expect(ROLE_OWNER_PERMISSIONS).toContain('distributors.clear_payments');
    expect(ROLE_ADMIN_PERMISSIONS).not.toContain('distributors.clear_payments');
  });
});