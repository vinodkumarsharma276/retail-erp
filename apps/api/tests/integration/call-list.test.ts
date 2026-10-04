import { describe, expect, it } from 'vitest';
import { buildPaymentPreview, recordPayment } from '../../src/modules/installments/installments.engine.js';
import { installmentsService } from '../../src/modules/installments/installments.service.js';
import { promisesService } from '../../src/modules/promises/promises.service.js';
import { createInstallmentSale, day, prisma, type SaleFixture } from '../helpers/fixtures';

const monthly = (dates: string[], amount = 3000) => dates.map((due) => ({ due, amount }));

const callList = (sale: SaleFixture, date: string) => installmentsService.getCallList({ shopId: sale.shopId }, sale.tenantId, date);
const rowFor = async (sale: SaleFixture, date: string) =>
  (await callList(sale, date)).rows.find((r) => r.scheduleId === sale.scheduleId);
const kinds = (row: Awaited<ReturnType<typeof rowFor>>) => row?.reasons.map((r) => r.kind);

const promiseOnFirst = (sale: SaleFixture, date: string) =>
  promisesService.create(
    { scheduleId: sale.scheduleId, customerId: sale.customerId, coveredInstallmentIds: [sale.emis[0]], promisedDate: date, promisedAmount: 3000 },
    sale.ctx,
  );

// ---------------------------------------------------------------------------
describe('I. Daily call list', () => {
  it('I1 a customer whose EMI is due today is on the list', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-10-04', '2026-11-04']) });
    expect(kinds(await rowFor(sale, '2026-10-04'))).toEqual(['due_today']);
  });

  it('I2 an EMI not due yet does not put the customer on the list', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-11-04']) });
    expect(await rowFor(sale, '2026-10-04')).toBeUndefined();
  });

  it('I3 an overdue customer with no promise is listed every day until something happens', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04']) });
    const today = await rowFor(sale, '2026-10-04');
    expect(today?.reasons).toEqual([{ kind: 'overdue', oldestInstallmentNumber: 1, daysLate: 30 }]);
    const tomorrow = await rowFor(sale, '2026-10-05');
    expect(tomorrow?.reasons[0]).toMatchObject({ kind: 'overdue', daysLate: 31 });
  });

  it('I4 after promising a later date, the customer is off the list (shown under "waiting on a promise")', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04']) });
    await promiseOnFirst(sale, '2026-10-20');
    const list = await callList(sale, '2026-10-04');
    expect(list.rows.find((r) => r.scheduleId === sale.scheduleId)).toBeUndefined();
    expect(list.snoozed.find((s) => s.scheduleId === sale.scheduleId)).toMatchObject({ label: '1.1', promisedDate: '2026-10-20' });
  });

  it('I5 on the promised date the customer is back on the list', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04']) });
    await promiseOnFirst(sale, '2026-10-20');
    expect((await rowFor(sale, '2026-10-20'))?.reasons[0]).toMatchObject({ kind: 'promise_due', label: '1.1', amount: 3000 });
  });

  it('I6 the day after an unkept promise, the customer is listed as a broken promise', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04']) });
    await promiseOnFirst(sale, '2026-10-20');
    const row = await rowFor(sale, '2026-10-22');
    expect(kinds(row)).toEqual(['promise_broken', 'overdue']);
    expect(row?.reasons[0]).toMatchObject({ label: '1.1', promisedDate: '2026-10-20', daysSince: 2 });
  });

  it('I7 a customer waiting on a promise still shows up the day ANOTHER EMI falls due', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-10-10']) });
    await promiseOnFirst(sale, '2026-10-20');
    const row = await rowFor(sale, '2026-10-10');
    expect(kinds(row)).toEqual(['due_today']); // EMI 1 is covered by the promise, so not "overdue"
    expect(row?.openPromise).toMatchObject({ label: '1.1', promisedDate: '2026-10-20' });
  });

  it('I8 a fully paid customer is not on the list', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-10-04']) });
    await recordPayment(prisma, { installmentId: sale.emis[0], amount: 6000, paymentMode: 'cash', paymentDate: day('2026-10-04') }, sale.ctx);
    expect(await rowFor(sale, '2026-10-04')).toBeUndefined();
  });

  it('I9 an EMI carrying a spread shortfall shows how much came from which earlier EMI', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });
    await recordPayment(prisma, { installmentId: sale.emis[0], amount: 2000, paymentMode: 'cash', paymentDate: day('2026-10-04') }, sale.ctx);
    const row = await rowFor(sale, '2026-11-04');
    expect(row?.dueNow).toEqual([
      expect.objectContaining({ installmentNumber: 2, remainingAmount: 3500, carriedIn: [{ fromInstallmentNumber: 1, amount: 500 }] }),
    ]);
  });

  it('I10 totals: "due now" adds up every EMI due on or before the date', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-08-04', '2026-09-04', '2026-10-04', '2026-11-04']) });
    expect((await rowFor(sale, '2026-10-04'))?.totalDueNow).toBe(9000);
  });
});

// ---------------------------------------------------------------------------
describe('K. Payment screen preview', () => {
  it('K1 opened from any EMI, it works on the oldest unpaid one and lists everything owing, oldest first', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });
    const p = await buildPaymentPreview(prisma, sale.emis[2], { paymentDate: day('2026-10-04') }, { tenantId: sale.tenantId });
    expect(p.installmentNumber).toBe(1);
    expect(p.outstanding.map((o) => o.installmentNumber)).toEqual([1, 2, 3]);
    expect(p.penalty).toMatchObject({ perDay: 2, days: 30, amount: 60, applicable: true, overdueSince: '2026-09-04' });
  });

  it('K2 choosing a specific EMI switches the preview to it', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });
    const p = await buildPaymentPreview(
      prisma, sale.emis[0], { paymentDate: day('2026-10-04'), targetInstallmentId: sale.emis[1] }, { tenantId: sale.tenantId },
    );
    expect(p.installmentNumber).toBe(2);
  });

  it('K3 shows the planned amount and the carried shortfall for each EMI', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });
    await recordPayment(prisma, { installmentId: sale.emis[0], amount: 2000, paymentMode: 'cash', paymentDate: day('2026-10-04') }, sale.ctx);
    const p = await buildPaymentPreview(prisma, sale.emis[1], { paymentDate: day('2026-10-04') }, { tenantId: sale.tenantId });
    expect(p.outstanding[0]).toMatchObject({ installmentNumber: 2, plannedAmount: 3000, remainingAmount: 3500, carriedIn: [{ fromInstallmentNumber: 1, amount: 500 }] });
  });

  it('K4 offers the early-payment deduction only from 30 days ahead', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-11-02', '2026-12-02']), totalInterest: 600 });
    const at29 = await buildPaymentPreview(prisma, sale.emis[0], { paymentDate: day('2026-10-04') }, { tenantId: sale.tenantId });
    expect(at29.earlyPayment.applicable).toBe(false);
    expect(at29.earlyPayment.reason).toContain('30 days');
    const at31 = await buildPaymentPreview(prisma, sale.emis[0], { paymentDate: day('2026-10-02') }, { tenantId: sale.tenantId });
    expect(at31.earlyPayment).toMatchObject({ applicable: true, amount: 300, targetInstallmentNumbers: [2] });
  });

  it('K5 a nothing-late sale shows no penalty to charge', async () => {
    const sale = await createInstallmentSale({ emis: monthly(['2026-10-04', '2026-11-04']) });
    const p = await buildPaymentPreview(prisma, sale.emis[0], { paymentDate: day('2026-10-04') }, { tenantId: sale.tenantId });
    expect(p.penalty).toMatchObject({ applicable: false, amount: 0, overdueSince: null });
  });
});
