import { describe, expect, it } from 'vitest';
import { recordPayment } from '../../src/modules/installments/installments.engine.js';
import { promisesService } from '../../src/modules/promises/promises.service.js';
import { runResolvePromisesJob } from '../../src/jobs/resolve-promises.job.js';
import { createInstallmentSale, day, emiStates, prisma, toNumber, type SaleFixture } from '../helpers/fixtures';

const monthly = (dates: string[], amount = 3000) => dates.map((due) => ({ due, amount }));
const threeEmis = () => createInstallmentSale({ emis: monthly(['2026-09-04', '2026-11-04', '2026-12-04']) });

const promise = (sale: SaleFixture, emiIndexes: number[], promisedDate: string, promisedAmount: number) =>
  promisesService.create(
    { scheduleId: sale.scheduleId, customerId: sale.customerId, coveredInstallmentIds: emiIndexes.map((i) => sale.emis[i]), promisedDate, promisedAmount },
    sale.ctx,
  );

const labelsOf = async (sale: SaleFixture) => {
  const list = await promisesService.list({ scheduleId: sale.scheduleId }, sale.tenantId);
  return list
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((p) => ({ status: p.status, labels: Object.values(p.labels).sort() }));
};

// ---------------------------------------------------------------------------
describe('H. Promises ("customer will pay on…")', () => {
  it('H1 the first promise on EMI 1 is labelled 1.1', async () => {
    const sale = await threeEmis();
    await promise(sale, [0], '2026-10-20', 3000);
    expect(await labelsOf(sale)).toEqual([{ status: 'pending', labels: ['1.1'] }]);
  });

  it('H2 a new date for the same EMI replaces the old promise (kept as history) and is labelled 1.2', async () => {
    const sale = await threeEmis();
    await promise(sale, [0], '2026-10-20', 3000);
    await promise(sale, [0], '2026-10-25', 3000);
    expect(await labelsOf(sale)).toEqual([
      { status: 'replaced', labels: ['1.1'] },
      { status: 'pending', labels: ['1.2'] },
    ]);
  });

  it('H3 the label follows the EMI number, whether the date is before or after the next EMI is due', async () => {
    const sale = await threeEmis();
    await promise(sale, [0], '2026-11-20', 3000); // after EMI 2 (4 Nov) is due
    expect(await labelsOf(sale)).toEqual([{ status: 'pending', labels: ['1.1'] }]);
  });

  it('H4 one promise covering EMIs 2 and 3 carries both labels: 2.1 and 3.1', async () => {
    const sale = await threeEmis();
    await promise(sale, [1, 2], '2026-12-10', 6000);
    expect(await labelsOf(sale)).toEqual([{ status: 'pending', labels: ['2.1', '3.1'] }]);
  });

  it('H5 a promise cancelled as a mistake takes no number — the next one is still 1.1', async () => {
    const sale = await threeEmis();
    const wrong = await promise(sale, [0], '2026-10-20', 3000);
    await promisesService.cancel(wrong.id, 'typed the wrong date', sale.ctx);
    await promise(sale, [0], '2026-10-21', 3000);
    expect(await labelsOf(sale)).toEqual([
      { status: 'cancelled', labels: [] },
      { status: 'pending', labels: ['1.1'] },
    ]);
  });

  it('H6 a promise date in the past is refused', async () => {
    const sale = await threeEmis();
    await expect(promise(sale, [0], '2026-10-01', 3000)).rejects.toThrow('cannot be in the past');
  });

  it('H7 promising more than is owed on those EMIs is refused', async () => {
    const sale = await threeEmis();
    await expect(promise(sale, [0], '2026-10-20', 3001)).rejects.toThrow('more than is owed');
  });

  it('H8 a promise can\'t cover an EMI that is already paid', async () => {
    const sale = await threeEmis();
    await recordPayment(prisma, { installmentId: sale.emis[0], amount: 3000, paymentMode: 'cash', paymentDate: day('2026-10-04') }, sale.ctx);
    await expect(promise(sale, [0], '2026-10-20', 1000)).rejects.toThrow('only cover unpaid');
  });

  it('H9 a payment whose promise is invalid is NOT saved at all (payment and promise go together)', async () => {
    const sale = await threeEmis();
    await expect(
      recordPayment(
        prisma,
        { installmentId: sale.emis[0], amount: 2000, paymentMode: 'cash', paymentDate: day('2026-10-04'), promise: { promisedDate: '2026-09-30' } },
        sale.ctx,
      ),
    ).rejects.toThrow('cannot be in the past');
    expect((await emiStates(sale.scheduleId))[0]).toMatchObject({ paid: 0, remaining: 3000 });
    expect(await prisma.installmentPayment.count({ where: { installmentId: { in: sale.emis } } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('J. Marking promises kept or broken (nightly job)', () => {
  /** A promise for EMI 1 (₹3,000) dated 1 Oct — already in the past on 4 Oct. */
  const pastPromise = async (sale: SaleFixture) =>
    prisma.installmentPromise.create({
      data: {
        tenantId: sale.tenantId, scheduleId: sale.scheduleId, customerId: sale.customerId,
        coveredInstallmentIds: [sale.emis[0]], promisedDate: day('2026-10-01'), promisedAmount: 3000,
        createdBy: sale.userId, createdAt: new Date('2026-09-20T05:00:00.000Z'),
      },
    });
  const payOn = (sale: SaleFixture, amount: number, date: string) =>
    recordPayment(
      prisma,
      { installmentId: sale.emis[0], amount, paymentMode: 'cash', paymentDate: day(date), shortfall: 'keep' },
      sale.ctx,
    );
  const quiet = { info: () => {}, error: () => {} };
  const statusOf = async (id: string) => prisma.installmentPromise.findUniqueOrThrow({ where: { id } });

  it('J1 paid in full by the promised date → kept', async () => {
    const sale = await threeEmis();
    const p = await pastPromise(sale);
    await payOn(sale, 3000, '2026-09-30');
    await runResolvePromisesJob(prisma, quiet);
    expect((await statusOf(p.id)).status).toBe('kept');
  });

  it('J2 part paid by the promised date → partly kept, with the amount received', async () => {
    const sale = await threeEmis();
    const p = await pastPromise(sale);
    await payOn(sale, 1000, '2026-09-30');
    await runResolvePromisesJob(prisma, quiet);
    const after = await statusOf(p.id);
    expect(after.status).toBe('partially_kept');
    expect(toNumber(after.collectedAmount)).toBe(1000);
  });

  it('J3 nothing paid → broken', async () => {
    const sale = await threeEmis();
    const p = await pastPromise(sale);
    await runResolvePromisesJob(prisma, quiet);
    expect((await statusOf(p.id)).status).toBe('broken');
  });

  it('J4 money paid only AFTER the promised date doesn\'t keep the promise → broken', async () => {
    const sale = await threeEmis();
    const p = await pastPromise(sale);
    await payOn(sale, 3000, '2026-10-02');
    await runResolvePromisesJob(prisma, quiet);
    expect((await statusOf(p.id)).status).toBe('broken');
  });

  it('J5 a promise whose date hasn\'t come yet is left alone', async () => {
    const sale = await threeEmis();
    const p = await promise(sale, [0], '2026-10-20', 3000);
    await runResolvePromisesJob(prisma, quiet);
    expect((await statusOf(p.id)).status).toBe('pending');
  });
});
