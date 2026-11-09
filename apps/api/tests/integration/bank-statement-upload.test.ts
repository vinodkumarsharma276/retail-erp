import { describe, expect, it, vi } from 'vitest';

// Keep the test offline and repeatable: no AI categorisation or name matching.
vi.hoisted(() => {
  process.env.OPENAI_API_KEY = 'disabled';
});

import { tenantContext } from '../../src/config/tenant-context.js';
import { deleteStatement, HttpError, uploadStatement } from '../../src/modules/bank-statements/bank-statements.service.js';
import { createInstallmentSale, prisma } from '../helpers/fixtures';

const ACCOUNT = '13400200029970';

/** A bank statement as CSV, its rows chained by running balance from 100000. */
function statement(rows: [string, string, number][]) {
  let balance = 100000;
  const lines = rows.map(([date, desc, amount]) => {
    balance = Math.round((balance + amount) * 100) / 100;
    return `${date},${desc},${amount < 0 ? (-amount).toFixed(2) : ''},${amount > 0 ? amount.toFixed(2) : ''},${balance.toFixed(2)}`;
  });
  return Buffer.from([`Account Number : ${ACCOUNT}`, 'Date,Narration,Withdrawal,Deposit,Balance', ...lines].join('\n'));
}

const OCTOBER: [string, string, number][] = [
  ['01/10/2026', 'UPI IN/1111 RAMESH', 2500],
  ['02/10/2026', 'NAVRANG MARKETING CLG', -49000],
  ['03/10/2026', 'UPI IN/2222 SURESH', 1800],
  ['04/10/2026', 'CASH SELF', 20000],
];
const LATE_OCTOBER: [string, string, number][] = [...OCTOBER, ['05/10/2026', 'UPI IN/3333 MAHESH', 900], ['06/10/2026', 'LAXMI ENTERPRISES CLG', -16000]];

/** One tenant, two shops; the account is registered to the first ("Home Appliances"). */
async function setup() {
  const base = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
  const { tenantId, shopId: homeId, userId } = base;
  const electronics = await prisma.shop.create({
    data: {
      tenantId, name: 'Electronics', code: `E${homeId.slice(0, 4)}`, gstNumber: `09ELEC${homeId.slice(0, 4).toUpperCase()}1Z5`,
      panNumber: 'AAAAA0000A', addressLine1: '2 Test Road', city: 'Ghaziabad', state: 'Uttar Pradesh', pincode: '201001', phone: '9999999999',
    },
  });
  await prisma.shop.update({ where: { id: homeId }, data: { name: 'Home Appliances' } });
  await prisma.bankAccount.create({ data: { tenantId, shopId: homeId, bankName: 'Federal Bank', accountNumber: ACCOUNT, accountType: 'current' } as any });
  const scope = { tenantId, shopIds: [homeId, electronics.id] };
  const upload = (buffer: Buffer, fileName: string, shopId: string, extra: Record<string, unknown> = {}) =>
    tenantContext.runAs(tenantId, () => uploadStatement(scope, { buffer, fileName, shopId, uploadedById: userId, ...extra }));
  const refusal = async (p: Promise<unknown>) => {
    const err = await p.then(() => null, (e) => e);
    expect(err).toBeInstanceOf(HttpError);
    return err as HttpError;
  };
  return { tenantId, homeId, electronicsId: electronics.id, scope, upload, refusal };
}

describe('U. Uploading a statement twice, or to the wrong shop', () => {
  it('U1 a statement uploaded to the wrong shop is a warning naming the right one, and says it is already there', async () => {
    const f = await setup();
    await f.upload(statement(OCTOBER), 'october.csv', f.homeId);

    const err = await f.refusal(f.upload(statement(OCTOBER), 'october-copy.csv', f.electronicsId));
    expect(err.statusCode).toBe(422);
    expect(err.details?.code).toBe('account_other_shop');
    expect(err.message).toContain('looks like a Home Appliances statement');
    expect(err.message).toContain('All 4 of its transactions are already imported there');
    expect(err.details?.otherShopName).toBe('Home Appliances');
    expect((err.details?.alreadyImported as any).fresh).toBe(0);
    expect((err.details?.alreadyImported as any).statements[0]).toMatchObject({ file_name: 'october.csv', shop_name: 'Home Appliances', same_file: true });
  });

  it('U2 the same file renamed is caught per transaction, listing each repeated row', async () => {
    const f = await setup();
    await f.upload(statement(OCTOBER), 'october.csv', f.homeId);

    const err = await f.refusal(f.upload(statement(OCTOBER), 'renamed.csv', f.homeId));
    expect(err.statusCode).toBe(409);
    expect(err.details).toMatchObject({ code: 'overlap', total: 4, duplicates: 4, fresh: 0 });
    expect(err.message).toContain('same file as "october.csv"');
    const samples = err.details?.samples as { description: string; shop_name: string }[];
    expect(samples).toHaveLength(4);
    expect(samples[1]).toMatchObject({ description: 'NAVRANG MARKETING CLG', shop_name: 'Home Appliances' });

    // Even asking to keep everything can't store the same file twice in one shop.
    expect((await f.refusal(f.upload(statement(OCTOBER), 'renamed.csv', f.homeId, { duplicates: 'keep' }))).statusCode).toBe(409);
  });

  it('U3 a longer statement imported into another shop anyway flags its repeats, naming where the first copy is', async () => {
    const f = await setup();
    await f.upload(statement(OCTOBER), 'october.csv', f.homeId);

    // Warned first, then the overlap is found across shops before anything is imported.
    expect((await f.refusal(f.upload(statement(LATE_OCTOBER), 'late.csv', f.electronicsId))).details?.code).toBe('account_other_shop');
    const overlap = await f.refusal(f.upload(statement(LATE_OCTOBER), 'late.csv', f.electronicsId, { allowOtherShop: true }));
    expect(overlap.details).toMatchObject({ code: 'overlap', duplicates: 4, fresh: 2 });

    const { statement: stored } = await f.upload(statement(LATE_OCTOBER), 'late.csv', f.electronicsId, { allowOtherShop: true, duplicates: 'keep' });
    expect(stored.shop_id).toBe(f.electronicsId);
    const rows = await prisma.statementTransaction.findMany({ where: { statementId: stored.id }, orderBy: { rowIndex: 'asc' } });
    const dupLabels = rows.map((r) => (r.flagReasons as { code: string; label: string }[]).find((x) => x.code === 'duplicate')?.label ?? null);
    expect(dupLabels.slice(0, 4)).toEqual(Array(4).fill('Possible duplicate: already in "october.csv" (Home Appliances)'));
    expect(dupLabels.slice(4)).toEqual([null, null]);

    // The first copy stays clean; deleting it clears the later copy's flags in the other shop.
    const first = await prisma.bankStatement.findFirstOrThrow({ where: { tenantId: f.tenantId, fileName: 'october.csv' } });
    const firstRows = await prisma.statementTransaction.findMany({ where: { statementId: first.id } });
    expect(firstRows.every((r) => !(r.flagReasons as { code: string }[]).some((x) => x.code === 'duplicate'))).toBe(true);
    await tenantContext.runAs(f.tenantId, () => deleteStatement(f.scope, first.id, { canUndoPayments: true }));
    const after = await prisma.statementTransaction.findMany({ where: { statementId: stored.id } });
    expect(after.some((r) => (r.flagReasons as { code: string }[]).some((x) => x.code === 'duplicate'))).toBe(false);
  });

  it('U4 skipping repeats imports only the new transactions', async () => {
    const f = await setup();
    await f.upload(statement(OCTOBER), 'october.csv', f.homeId);
    const { statement: stored } = await f.upload(statement(LATE_OCTOBER), 'late.csv', f.homeId, { duplicates: 'skip' });
    expect(stored.tx_count).toBe(2);
  });
});
