import { describe, expect, it } from 'vitest';
import { recordPayment, revertPayment } from '../../src/modules/installments/installments.engine.js';
import { createInstallmentSale, day, emiStates, iso, prisma, toNumber } from '../helpers/fixtures';

// "Today" in every test is 4 Oct 2026 (see tests/setup-env.ts).
const pay = (sale: Awaited<ReturnType<typeof createInstallmentSale>>, amount: number, extra: Record<string, unknown> = {}) =>
  recordPayment(
    prisma,
    { installmentId: sale.emis[0], amount, paymentMode: 'cash', paymentDate: day('2026-10-04'), ...extra },
    sale.ctx,
  );

const monthly = (dates: string[], amount = 3000) => dates.map((due) => ({ due, amount }));

// ---------------------------------------------------------------------------
describe('D. Recording a payment', () => {
  it('D1 paying one EMI in full marks it paid', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });
    await pay(sale, 3000);
    const [e1, e2] = await emiStates(sale.scheduleId);
    expect(e1).toMatchObject({ paid: 3000, remaining: 0, status: 'paid' });
    expect(e2).toMatchObject({ paid: 0, remaining: 3000 });
  });

  it('D2 a payment opened on a later EMI still goes to the oldest missed EMI', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });
    await recordPayment(prisma, { installmentId: sale.emis[2], amount: 3000, paymentMode: 'cash', paymentDate: day('2026-10-04') }, sale.ctx);
    const [e1, , e3] = await emiStates(sale.scheduleId);
    expect(e1.remaining).toBe(0);
    expect(e3.remaining).toBe(3000);
  });

  it('D3 the collector can choose which EMI to pay first', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });
    await pay(sale, 3000, { explicitInstallmentId: sale.emis[1] });
    const [e1, e2] = await emiStates(sale.scheduleId);
    expect(e1.remaining).toBe(3000);
    expect(e2).toMatchObject({ remaining: 0, status: 'paid' });
  });

  it('D4 paying two EMIs at once clears both, oldest first', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-08-04', '2026-09-04', '2026-11-04']) });
    await pay(sale, 6000);
    const [e1, e2, e3] = await emiStates(sale.scheduleId);
    expect([e1.remaining, e2.remaining, e3.remaining]).toEqual([0, 0, 3000]);
  });

  it('D5 paying the last EMI completes the sale', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-10-04']) });
    await pay(sale, 6000);
    const schedule = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: sale.scheduleId } });
    expect(schedule.status).toBe('completed');
    expect(toNumber(schedule.creditBalance)).toBe(0);
  });

  it('D6 paying more than everything owed keeps the extra as credit on the sale', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-10-04', '2026-11-04']) });
    const result = await pay(sale, 10000);
    expect(result.creditAdded).toBe(1000);
    const schedule = await prisma.installmentSchedule.findUniqueOrThrow({ where: { id: sale.scheduleId } });
    expect(toNumber(schedule.creditBalance)).toBe(1000);
    expect(schedule.status).toBe('completed');
  });

  it('D7 a payment of ₹0 is refused', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04']) });
    await expect(pay(sale, 0)).rejects.toThrow('Amount must be positive');
  });

  it('D8 EMI due dates never move, whatever is paid', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });
    await pay(sale, 1000);
    await pay(sale, 500);
    expect((await emiStates(sale.scheduleId)).map((e) => e.due)).toEqual(['2026-09-04', '2026-11-04', '2026-12-04']);
  });

  it('D9 undoing a payment puts the EMI back exactly as it was', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04']) });
    const { paymentIds } = await pay(sale, 3000);
    await revertPayment(prisma, paymentIds[0], 'entered twice', sale.ctx);
    const [e1] = await emiStates(sale.scheduleId);
    expect(e1).toMatchObject({ paid: 0, remaining: 3000 });
    expect(await prisma.installmentPayment.count({ where: { installmentId: sale.emis[0] } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('E. Short payments', () => {
  it('E1 short on a due EMI: the EMI counts as paid and the shortfall is shared equally by the remaining EMIs', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04', '2027-01-04']) });
    await pay(sale, 2000);
    const emis = await emiStates(sale.scheduleId);
    expect(emis[0]).toMatchObject({ amountDue: 2000, paid: 2000, remaining: 0, status: 'paid' });
    // ₹1,000 over 3 EMIs: ₹333 each, the odd rupee on the next EMI.
    expect(emis.slice(1).map((e) => e.amountDue)).toEqual([3334, 3333, 3333]);
  });

  it('E2 the original planned amounts never change, and every increase is recorded with where it came from', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04', '2027-01-04']) });
    await pay(sale, 2000);
    expect((await emiStates(sale.scheduleId)).map((e) => e.planned)).toEqual([3000, 3000, 3000, 3000]);
    const carries = await prisma.installmentCarryForward.findMany({ where: { scheduleId: sale.scheduleId } });
    expect(carries).toHaveLength(3);
    expect(carries.every((c) => c.fromInstallmentId === sale.emis[0])).toBe(true);
    expect(carries.reduce((s, c) => s + toNumber(c.amount), 0)).toBe(1000);
  });

  it('E3 paise in a shortfall go on the next EMI so the later ones stay round', async () => {
    const sale = await createInstallmentSale({
      emis: [{ due: '2026-09-04', amount: 3000.5 }, { due: '2026-11-04', amount: 3000 }, { due: '2026-12-04', amount: 3000 }],
    });
    await pay(sale, 2000);
    const emis = await emiStates(sale.scheduleId);
    expect([emis[1].amountDue, emis[2].amountDue]).toEqual([3500.5, 3500]);
  });

  it('E4 short on the second of two missed EMIs: the first is cleared, the second\'s shortfall is spread', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-08-04', '2026-09-04', '2026-11-04', '2026-12-04']) });
    await pay(sale, 4500);
    const emis = await emiStates(sale.scheduleId);
    expect(emis[0]).toMatchObject({ remaining: 0, status: 'paid' });
    expect(emis[1]).toMatchObject({ amountDue: 1500, remaining: 0, status: 'paid' });
    expect([emis[2].amountDue, emis[3].amountDue]).toEqual([3750, 3750]);
  });

  it('E5 short on the LAST EMI: nothing to spread onto, so the balance stays owed', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04']) });
    await pay(sale, 1000);
    const [e1] = await emiStates(sale.scheduleId);
    expect(e1).toMatchObject({ remaining: 2000, status: 'partially_paid' });
    expect(await prisma.installmentCarryForward.count({ where: { scheduleId: sale.scheduleId } })).toBe(0);
  });

  it('E6 short with a promise date: the balance stays on the EMI and the promise is saved with the payment', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });
    const result = await pay(sale, 2000, { promise: { promisedDate: '2026-10-20' } });
    const emis = await emiStates(sale.scheduleId);
    expect(emis[0].remaining).toBe(1000);
    expect(emis[1].amountDue).toBe(3000);
    expect(result.promise).toMatchObject({ coveredInstallmentIds: [sale.emis[0]], status: 'pending' });
    expect(toNumber(result.promise!.promisedAmount)).toBe(1000);
    expect(iso(result.promise!.promisedDate)).toBe('2026-10-20');
  });

  it('E7 short with "keep it on this EMI" and no date: the balance stays owed, nothing is spread', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04']) });
    await pay(sale, 2000, { shortfall: 'keep' });
    const emis = await emiStates(sale.scheduleId);
    expect(emis[0].remaining).toBe(1000);
    expect(emis[1].amountDue).toBe(3000);
  });

  it('E8 part-paying an EMI that is not due yet is an advance, not a shortfall — nothing is spread', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-11-04', '2026-12-04']) });
    await pay(sale, 1000);
    const emis = await emiStates(sale.scheduleId);
    expect(emis[0].remaining).toBe(2000);
    expect(emis[1].amountDue).toBe(3000);
  });

  it('E9 undoing a short payment moves the spread amounts back exactly', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04', '2027-01-04']) });
    const { paymentIds } = await pay(sale, 2000);
    await revertPayment(prisma, paymentIds[0], 'wrong amount', sale.ctx);
    const emis = await emiStates(sale.scheduleId);
    expect(emis.map((e) => [e.amountDue, e.remaining])).toEqual([[3000, 3000], [3000, 3000], [3000, 3000], [3000, 3000]]);
    const active = await prisma.installmentCarryForward.count({ where: { scheduleId: sale.scheduleId, rolledBackAt: null } });
    expect(active).toBe(0);
  });

  it('E10 undoing is refused once a later EMI has been paid including its share — undo that payment first', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04', '2027-01-04']) });
    const first = await pay(sale, 2000);
    await pay(sale, 3334, { explicitInstallmentId: sale.emis[1] });
    await expect(revertPayment(prisma, first.paymentIds[0], 'oops', sale.ctx)).rejects.toThrow('Revert that payment first');
    const emis = await emiStates(sale.scheduleId);
    expect(emis[0]).toMatchObject({ amountDue: 2000, paid: 2000 });
    expect(emis[1]).toMatchObject({ amountDue: 3334, paid: 3334 });
  });
});

// ---------------------------------------------------------------------------
describe('F. Late penalty when recording a payment', () => {
  it('F1 ticking "charge penalty" adds ₹2 × days late to the EMI and collects it in the same entry', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04']) });
    await pay(sale, 3060, { applyPenalty: true });
    const [e1, e2] = await emiStates(sale.scheduleId);
    expect(e1).toMatchObject({ amountDue: 3060, paid: 3060, remaining: 0 });
    expect(e2.amountDue).toBe(3000);
    const [charge] = await prisma.installmentInterestApplication.findMany({ where: { scheduleId: sale.scheduleId } });
    expect(toNumber(charge.appliedAmount)).toBe(60);
    expect(toNumber(charge.perDay)).toBe(2);
    expect(iso(charge.chargedThrough!)).toBe('2026-10-04');
  });

  it('F2 not ticking it charges nothing', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04']) });
    await pay(sale, 3000);
    expect(await prisma.installmentInterestApplication.count({ where: { scheduleId: sale.scheduleId } })).toBe(0);
    expect((await emiStates(sale.scheduleId))[0].amountDue).toBe(3000);
  });

  it('F3 two EMIs late still costs ₹2 a day for the sale (from the oldest), not ₹2 per EMI', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-08-04', '2026-09-04', '2026-11-04']) });
    await pay(sale, 3122, { applyPenalty: true });
    const [charge] = await prisma.installmentInterestApplication.findMany({ where: { scheduleId: sale.scheduleId } });
    expect(toNumber(charge.appliedAmount)).toBe(122); // 61 days × ₹2
  });

  it('F4 a later payment only charges the days not already charged', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-08-04', '2026-11-04']) });
    // 24 Aug: part payment, penalty for 20 days (₹40), balance kept on the EMI.
    await recordPayment(
      prisma,
      { installmentId: sale.emis[0], amount: 1000, paymentMode: 'cash', paymentDate: day('2026-08-24'), applyPenalty: true, shortfall: 'keep' },
      sale.ctx,
    );
    expect((await emiStates(sale.scheduleId))[0]).toMatchObject({ amountDue: 3040, remaining: 2040 });
    // 4 Oct: the rest, with penalty only for 24 Aug → 4 Oct (41 days, ₹82).
    await pay(sale, 2122, { applyPenalty: true });
    const charges = await prisma.installmentInterestApplication.findMany({ where: { scheduleId: sale.scheduleId }, orderBy: { appliedAt: 'asc' } });
    expect(charges.map((c) => toNumber(c.appliedAmount))).toEqual([40, 82]);
    expect((await emiStates(sale.scheduleId))[0]).toMatchObject({ remaining: 0, status: 'paid' });
  });

  it('F5 a sale with its own rate uses it (₹5/day × 30 days = ₹150)', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04']), penaltyPerDay: 5 });
    await pay(sale, 3150, { applyPenalty: true });
    const [charge] = await prisma.installmentInterestApplication.findMany({ where: { scheduleId: sale.scheduleId } });
    expect(toNumber(charge.appliedAmount)).toBe(150);
  });

  it('F6 ticking it when nothing is late charges nothing', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-10-04', '2026-11-04']) });
    await pay(sale, 3000, { applyPenalty: true });
    expect(await prisma.installmentInterestApplication.count({ where: { scheduleId: sale.scheduleId } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('G. Early-payment deduction when recording a payment', () => {
  const early = () =>
    createInstallmentSale({ emis: monthly(['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10']), totalInterest: 1200 });

  it('G1 paying an EMI 37 days early with the box ticked takes its interest share (₹300) off the LAST EMI', async () => {
    const sale = await early();
    await pay(sale, 3000, { applyEarlyPaymentDeduction: true });
    const emis = await emiStates(sale.scheduleId);
    expect(emis[0]).toMatchObject({ remaining: 0, status: 'paid' });
    expect(emis[3]).toMatchObject({ amountDue: 2700, planned: 3000 });
    const [rebate] = await prisma.installmentRebate.findMany({ where: { scheduleId: sale.scheduleId } });
    expect(toNumber(rebate.amount)).toBe(300);
    expect(rebate.daysEarly).toBe(37);
  });

  it('G2 without the box ticked, nothing is deducted', async () => {
    const sale = await early();
    await pay(sale, 3000);
    expect((await emiStates(sale.scheduleId))[3].amountDue).toBe(3000);
  });

  it('G3 not offered while an older EMI is still unpaid', async () => {
    const sale = await createInstallmentSale({
      emis: monthly(['2026-09-04', '2026-11-10', '2026-12-10', '2027-01-10']),
      totalInterest: 1200,
    });
    await expect(pay(sale, 3000, { explicitInstallmentId: sale.emis[1], applyEarlyPaymentDeduction: true })).rejects.toThrow(
      'Older EMIs are still unpaid',
    );
  });

  it('G4 needs the EMI paid in full — a part payment with the box ticked is refused and NOTHING is saved', async () => {
    const sale = await early();
    await expect(pay(sale, 2000, { applyEarlyPaymentDeduction: true })).rejects.toThrow('paid in full');
    const emis = await emiStates(sale.scheduleId);
    expect(emis[0].paid).toBe(0);
    expect(emis[3].amountDue).toBe(3000);
    expect(await prisma.installmentPayment.count({ where: { installmentId: { in: sale.emis } } })).toBe(0);
  });

  it('G5 only one deduction per EMI', async () => {
    const sale = await early();
    await pay(sale, 3000, { applyEarlyPaymentDeduction: true });
    // EMI #2 is the next one; paying it early is allowed, paying EMI #1 again isn't possible (it's paid).
    await pay(sale, 3000, { applyEarlyPaymentDeduction: true });
    const rebates = await prisma.installmentRebate.findMany({ where: { scheduleId: sale.scheduleId } });
    expect(new Set(rebates.map((r) => r.sourceInstallmentId)).size).toBe(2);
    expect((await emiStates(sale.scheduleId))[3].amountDue).toBe(2400);
  });

  it('G6 undoing the payment puts the deducted amount back on the last EMI', async () => {
    const sale = await early();
    const { paymentIds } = await pay(sale, 3000, { applyEarlyPaymentDeduction: true });
    await revertPayment(prisma, paymentIds[0], 'mistake', sale.ctx);
    const emis = await emiStates(sale.scheduleId);
    expect(emis[0].remaining).toBe(3000);
    expect(emis[3].amountDue).toBe(3000);
    const [rebate] = await prisma.installmentRebate.findMany({ where: { scheduleId: sale.scheduleId } });
    expect(rebate.rolledBackAt).not.toBeNull();
  });
});
