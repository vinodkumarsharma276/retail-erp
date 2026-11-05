import { describe, expect, it } from 'vitest';
import { tenantContext } from '../../src/config/tenant-context.js';
import { applySupplierMatches, SUPPLIER_CATEGORY } from '../../src/modules/bank-statements/engine/categorize/suppliers.js';
import { getTransaction, HttpError, patchTransactions, recordSupplierPayment } from '../../src/modules/bank-statements/bank-statements.service.js';
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
  return { tenantId, shopId, userId, supplier, older, newer, elsewhere, statement, cheque, cash, deposit, scope: { tenantId, shopIds: [shopId] } };
}

describe('B. Bank withdrawals as supplier payments', () => {
  it('B1 suggests the supplier named in a withdrawal, and only for withdrawals', async () => {
    const f = await setup();
    await applySupplierMatches(f.tenantId, f.statement.id, { useAi: false });
    const rows = await prisma.statementTransaction.findMany({ where: { statementId: f.statement.id }, orderBy: { rowIndex: 'asc' } });
    expect(rows.map((r) => r.distributorId)).toEqual([f.supplier.id, null, null]);
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
