import type { Prisma } from '@prisma/client';

/**
 * Advances paid to a supplier, and using them up.
 *
 * Money sometimes goes to a supplier before their bill is in the books — a cheque for stock
 * still on its way, or more than the open bills came to. It is real money paid, so it is kept
 * (a `SupplierAdvance`, per shop, since each shop keeps its own books) rather than refused or
 * dropped. The moment that shop records a bill from the supplier, the advance pays it: each
 * use becomes an ordinary `PurchasePayment` on the bill, carrying the advance's date, mode and
 * reference, and pointing back at the advance.
 */

type Tx = Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Use a shop's open advances to a supplier against that shop's unpaid bills from them:
 * oldest advance first, oldest bill first. Run inside the transaction that records a bill.
 * Returns how much of the advances was used.
 */
export async function applySupplierAdvances(tx: Tx, shopId: string, distributorId: string): Promise<number> {
  const advances = await tx.supplierAdvance.findMany({
    where: { shopId, distributorId, remaining: { gt: 0 } },
    orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
  });
  if (!advances.length) return 0;
  const bills = await tx.purchase.findMany({
    where: { shopId, distributorId, paymentStatus: { notIn: ['paid', 'settled'] } },
    orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
  });

  const left = new Map(advances.map((a) => [a.id, Number(a.remaining)]));
  let used = 0;
  for (const bill of bills) {
    const net = Number(bill.netAmount);
    let paid = Number(bill.amountPaid);
    for (const advance of advances) {
      const due = round2(net - paid);
      if (due <= 0) break;
      const available = left.get(advance.id) ?? 0;
      if (available <= 0) continue;
      const take = round2(Math.min(available, due));
      await tx.purchasePayment.create({
        data: {
          tenantId: bill.tenantId,
          purchaseId: bill.id,
          amount: take,
          paymentMode: advance.paymentMode,
          paymentDate: advance.paymentDate,
          referenceNumber: advance.referenceNumber,
          notes: `Adjusted from advance paid on ${advance.paymentDate.toISOString().slice(0, 10)}`,
          createdBy: advance.createdBy,
          statementTransactionId: advance.statementTransactionId,
          supplierAdvanceId: advance.id,
        },
      });
      left.set(advance.id, round2(available - take));
      paid = round2(paid + take);
      used = round2(used + take);
    }
    if (paid !== Number(bill.amountPaid)) {
      await tx.purchase.update({
        where: { id: bill.id },
        data: { amountPaid: paid, paymentStatus: paid >= net ? 'paid' : 'partial' },
      });
    }
  }
  for (const advance of advances) {
    const remaining = left.get(advance.id)!;
    if (remaining !== Number(advance.remaining)) {
      await tx.supplierAdvance.update({ where: { id: advance.id }, data: { remaining } });
    }
  }
  return used;
}

/** Unused advance per supplier (optionally limited to some suppliers / one shop). */
export async function advanceBalances(
  client: Pick<Tx, 'supplierAdvance'>,
  where: { distributorIds?: string[]; shopId?: string } = {},
): Promise<Map<string, number>> {
  const rows = await client.supplierAdvance.groupBy({
    by: ['distributorId'],
    where: {
      remaining: { gt: 0 },
      ...(where.distributorIds ? { distributorId: { in: where.distributorIds } } : {}),
      ...(where.shopId ? { shopId: where.shopId } : {}),
    },
    _sum: { remaining: true },
  });
  return new Map(rows.map((r) => [r.distributorId, Number(r._sum.remaining ?? 0)]));
}

export interface UndoneSupplierPayments {
  /** Payment rows removed from bills (including uses of removed advances). */
  payments: number;
  /** Advances removed. */
  advances: number;
  /** Bills whose paid amount went down. */
  bills: number;
  /** Money taken back off the suppliers' books: payments on bills + unused advances removed. */
  amount: number;
}

/**
 * Take supplier payments and advances back off the books — the bank row they were recorded
 * from was deleted, or the owner is clearing a supplier's payments.
 *
 * Every bill loses exactly what was removed from it (a bill's paid amount isn't recomputed
 * from scratch, so money paid before payments were itemised isn't lost), and goes back to
 * partly paid or unpaid. Removing an advance removes the payments it made on bills too; a
 * removed use of an advance that stays gives the money back to that advance. Advances still
 * open then pay the reopened bills again, as they would a new bill.
 */
export async function undoSupplierPayments(
  tx: Tx,
  select: { payments?: Prisma.PurchasePaymentWhereInput; advances?: Prisma.SupplierAdvanceWhereInput },
): Promise<UndoneSupplierPayments> {
  const advances = select.advances
    ? await tx.supplierAdvance.findMany({ where: select.advances, select: { id: true, remaining: true } })
    : [];
  const advanceIds = advances.map((a) => a.id);
  const which: Prisma.PurchasePaymentWhereInput[] = [];
  if (select.payments) which.push(select.payments);
  if (advanceIds.length) which.push({ supplierAdvanceId: { in: advanceIds } });
  const payments = which.length
    ? await tx.purchasePayment.findMany({
        where: { OR: which },
        select: { id: true, amount: true, purchaseId: true, supplierAdvanceId: true, purchase: { select: { shopId: true, distributorId: true } } },
      })
    : [];
  if (!payments.length && !advances.length) return { payments: 0, advances: 0, bills: 0, amount: 0 };

  const removedAdvance = new Set(advanceIds);
  const perBill = new Map<string, number>();
  const backToAdvance = new Map<string, number>();
  const pairs = new Map<string, { shopId: string; distributorId: string }>();
  for (const p of payments) {
    perBill.set(p.purchaseId, round2((perBill.get(p.purchaseId) ?? 0) + Number(p.amount)));
    pairs.set(`${p.purchase.shopId}|${p.purchase.distributorId}`, p.purchase);
    if (p.supplierAdvanceId && !removedAdvance.has(p.supplierAdvanceId)) {
      backToAdvance.set(p.supplierAdvanceId, round2((backToAdvance.get(p.supplierAdvanceId) ?? 0) + Number(p.amount)));
    }
  }

  await tx.purchasePayment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
  if (advanceIds.length) await tx.supplierAdvance.deleteMany({ where: { id: { in: advanceIds } } });
  for (const [id, amount] of backToAdvance) {
    await tx.supplierAdvance.update({ where: { id }, data: { remaining: { increment: amount } } });
  }

  const bills = await tx.purchase.findMany({
    where: { id: { in: [...perBill.keys()] } },
    select: { id: true, netAmount: true, amountPaid: true },
  });
  for (const bill of bills) {
    const net = Number(bill.netAmount);
    const paid = Math.max(0, round2(Number(bill.amountPaid) - (perBill.get(bill.id) ?? 0)));
    await tx.purchase.update({
      where: { id: bill.id },
      data: { amountPaid: paid, paymentStatus: paid >= net && net > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending' },
    });
  }
  for (const { shopId, distributorId } of pairs.values()) await applySupplierAdvances(tx, shopId, distributorId);

  return {
    payments: payments.length,
    advances: advances.length,
    bills: bills.length,
    // What reached the bills, plus what was still sitting unused on the removed advances.
    amount: round2(
      payments.reduce((sum, p) => sum + Number(p.amount), 0) + advances.reduce((sum, a) => sum + Number(a.remaining), 0),
    ),
  };
}