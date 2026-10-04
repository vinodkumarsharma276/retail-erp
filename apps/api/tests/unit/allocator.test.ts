import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { allocatePayment } from '../../src/modules/installments/installments.allocator.js';

const emi = (id: string, due: string, remaining: number) => ({
  id,
  dueDate: new Date(`${due}T00:00:00.000Z`),
  remainingAmount: new Prisma.Decimal(remaining),
});
const lines = (r: ReturnType<typeof allocatePayment>) => r.lines.map((l) => [l.installmentId, Number(l.amount)]);

/** C — Where a payment goes: oldest unpaid EMI first, extra to the next. */
describe('C. Payment allocation', () => {
  const schedule = [emi('e3', '2026-11-04', 3000), emi('e1', '2026-09-04', 3000), emi('e2', '2026-10-04', 3000)];

  it('C1 money goes to the oldest unpaid EMI first, whatever order the EMIs are listed in', () => {
    expect(lines(allocatePayment(3000, schedule))).toEqual([['e1', 3000]]);
  });

  it('C2 more than one EMI\'s worth spills into the next EMI', () => {
    expect(lines(allocatePayment(4500, schedule))).toEqual([['e1', 3000], ['e2', 1500]]);
  });

  it('C3 a short payment stays on the oldest EMI', () => {
    const r = allocatePayment(1200, schedule);
    expect(lines(r)).toEqual([['e1', 1200]]);
    expect(Number(r.unallocated)).toBe(0);
  });

  it('C4 more than everything owed leaves the extra unallocated (it becomes credit)', () => {
    const r = allocatePayment(10000, schedule);
    expect(lines(r)).toEqual([['e1', 3000], ['e2', 3000], ['e3', 3000]]);
    expect(Number(r.unallocated)).toBe(1000);
  });

  it('C5 a chosen EMI is paid first; anything left goes to the rest, oldest first', () => {
    expect(lines(allocatePayment(4000, schedule, 'e3'))).toEqual([['e3', 3000], ['e1', 1000]]);
  });

  it('C6 already-paid EMIs are skipped', () => {
    const partlyPaid = [emi('e1', '2026-09-04', 0), emi('e2', '2026-10-04', 3000)];
    expect(lines(allocatePayment(3000, partlyPaid))).toEqual([['e2', 3000]]);
  });

  it('C7 choosing an EMI that is not on this schedule is refused', () => {
    expect(() => allocatePayment(1000, schedule, 'not-here')).toThrow('Target installment not found');
  });

  it('C8 a zero payment allocates nothing', () => {
    expect(allocatePayment(0, schedule).lines).toEqual([]);
  });
});
