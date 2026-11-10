import { describe, expect, it, vi } from 'vitest';
import { tenantContext } from '../../src/config/tenant-context.js';
import { commitImport as commitImportRaw, previewImport } from '../../src/modules/customer-search/customer-search.import.js';
import { customerSearchService, CustomerSearchError } from '../../src/modules/customer-search/customer-search.service.js';
import { syncRegister, SyncResetError, type SyncProjection } from '../../src/modules/customer-search/customer-search.sync.js';
import type { ImportCommitInput, ImportRow } from '../../src/modules/customer-search/customer-search.validation.js';
import { createInstallmentSale, prisma } from '../helpers/fixtures';

const commitImport = (input: Omit<ImportCommitInput, 'productTypes'> & { productTypes?: ImportCommitInput['productTypes'] }, userId: string, canCreateTypes = true) =>
  commitImportRaw({ productTypes: {}, ...input }, userId, { canCreateTypes });

// The model is never called in tests; borderline names fall back to edit distance.
vi.mock('../../src/modules/customer-search/customer-name-adjudicator.js', () => ({
  customerNameAdjudicatorEnabled: () => false,
  adjudicatePersonNames: async () => [],
}));

/**
 * CS — Customer Searching: the account register moved off the Google Sheet.
 *
 * Runs against the real database. Every test has its own tenant, whose
 * fixture customer is "Asha Verma" on 9876543210.
 */

let recordNo = 0;
const row = (over: Partial<ImportRow>): ImportRow => {
  recordNo += 1;
  return {
    sheetRow: recordNo + 1, recordNo,
    accountNumber: '', customerName: '', address: '', mobile: '', coName: '', coMobile: '',
    area: '', purchaseDate: '', product: '', brand: '', model: '', shop: '',
    ...over,
  };
};

async function setup() {
  const fx = await createInstallmentSale({ emis: [{ due: '2026-11-04', amount: 1000 }] });
  await prisma.userShop.create({ data: { tenantId: fx.tenantId, userId: fx.userId, shopId: fx.shopId } as any });
  // A second shop of the same business, which the user also works in.
  const second = await prisma.shop.create({
    data: {
      tenantId: fx.tenantId, name: 'Naveen Electronics', code: 'NE', gstNumber: `09NEXT${fx.tenantId.slice(0, 4).toUpperCase()}1Z5`,
      panNumber: 'AAAAA0000A', addressLine1: '2 Test Road', city: 'Ghaziabad', state: 'Uttar Pradesh', pincode: '201001', phone: '9999999998',
    },
  });
  await prisma.userShop.create({ data: { tenantId: fx.tenantId, userId: fx.userId, shopId: second.id } as any });
  const run = <T>(fn: () => Promise<T>) => tenantContext.runAs(fx.tenantId, fn);
  const cat = (name: string, slug: string, parent: { id: string; path: string; level: number } | null, isLeaf: boolean) =>
    prisma.productCategory.create({
      data: {
        tenantId: fx.tenantId, name, slug, parentId: parent?.id ?? null,
        level: parent ? parent.level + 1 : 0, path: parent ? `${parent.path}.${slug}` : slug, isLeaf,
      },
    });
  const electronics = await cat('Electronics', 'electronics', null, false);
  const tv = await cat('TV', 'tv', electronics, false);
  const led = await cat('LED TV', 'led-tv', tv, true);
  const fridge = await cat('Fridge', 'fridge', null, true);
  const types = { electronics: electronics.id, tv: tv.id, led: led.id, fridge: fridge.id };
  return { ...fx, run, types, secondShopId: second.id };
}

const batch = (shopId: string, rows: ImportRow[], resolutions = {}) => ({
  fileName: 'register.xlsx', shopId, rowFrom: rows[0].recordNo, rowTo: rows[rows.length - 1].recordNo, rows, resolutions,
});

describe('CS. Customer Searching import and entries', () => {
  it('CS1 imports a range as it is: links the existing customer, creates the rest, flags what needs review', async () => {
    const { shopId, userId, customerId, run } = await setup();
    const rows = [
      row({ accountNumber: 'mj12', customerName: 'Asha Verma', mobile: '98765 43210', coName: 'Ram Lal', coMobile: '9812345678', purchaseDate: '05/03/2024', product: 'TV' }),
      row({ accountNumber: 'MJ13', customerName: 'Sunil', mobile: '9898989898', purchaseDate: '2024-03-06' }),
      row({ accountNumber: '', customerName: 'No Number', mobile: '9898989898', purchaseDate: '07/03/2024' }),
      row({ accountNumber: 'MI1', customerName: 'Bad Mobile', mobile: '12345', purchaseDate: '31/02/2024' }),
    ];

    const preview = await run(() => previewImport(batch(shopId, rows)));
    // Sunil and "No Number" share a mobile, so they form a name group (plainly different people).
    expect(preview.summary).toMatchObject({ total: 4, new: 4, exists: 0, invalid: 0, groups: 1, flagged: 2 });
    expect(preview.rows[0].customer).toMatchObject({ kind: 'existing', customerId });
    expect(preview.rows[2].issues).toEqual(['missing_account']);
    expect(preview.rows[3].issues).toEqual(['invalid_mobile', 'invalid_date']);

    const result = await run(() => commitImport(batch(shopId, rows), userId));
    expect(result).toMatchObject({ inserted: 4, invalid: 0, customersCreated: 4, customersLinked: 1 });

    const entries = await run(() => prisma.customerSearchEntry.findMany({ orderBy: { sheetRowNumber: 'asc' } }));
    expect(entries.map((e) => [e.accountNumber, e.prefix, e.seriesNo, e.mobile, e.issues])).toEqual([
      // "TV" on the sheet matched the existing sub-type Electronics › TV.
      ['MJ12', 'MJ', 12, '9876543210', []],
      ['MJ13', 'MJ', 13, '9898989898', ['no_product_type']],
      ['', '', null, '9898989898', ['missing_account', 'no_product_type']],
      ['MI1', 'MI', 1, '', ['invalid_mobile', 'invalid_date', 'no_product_type']],
    ]);
    // What the sheet said is kept for whoever fixes it.
    expect(entries[3].rawValues).toEqual({ mobile: '12345', purchaseDate: '31/02/2024' });
    expect(entries[0].customerId).toBe(customerId);
    const co = await prisma.customer.findUnique({ where: { id: entries[0].coCustomerId! } });
    expect(co).toMatchObject({ name: 'Ram Lal', phone: '9812345678', isGuarantor: true, shopId });
    // No usable mobile: a customer of its own, with no phone.
    const own = await prisma.customer.findUnique({ where: { id: entries[3].customerId! } });
    expect(own).toMatchObject({ name: 'Bad Mobile', phone: '' });
  });

  it('CS2 re-importing skips rows already in; a reused number is imported and flagged on every entry using it', async () => {
    const { shopId, userId, run } = await setup();
    const rows = [row({ accountNumber: 'DI32', customerName: 'Kamal', mobile: '9811111111' })];
    await run(() => commitImport(batch(shopId, rows), userId));

    const again = await run(() => commitImport(batch(shopId, rows), userId));
    expect(again).toMatchObject({ inserted: 0, skipped: 1, customersCreated: 0 });

    const other = [row({ accountNumber: 'DI32', customerName: 'Other', mobile: '9822222222' })];
    const clash = await run(() => previewImport(batch(shopId, other)));
    // The product type is settled in its own card, so the row lists the reused number (and its missing date).
    expect(clash.rows[0]).toMatchObject({ status: 'new', issues: ['duplicate_account', 'missing_date'] });
    expect(clash.rows[0].warnings[0]).toMatch(/DI32 is also used for Kamal/);

    await run(() => commitImport(batch(shopId, other), userId));
    const both = await run(() => prisma.customerSearchEntry.findMany({ where: { accountNumber: 'DI32' } }));
    expect(both).toHaveLength(2);
    expect(both.every((e) => e.issues.includes('duplicate_account'))).toBe(true);

    // The same row twice in one range: the copy is skipped, not imported twice.
    const twice = [row({ accountNumber: 'DI40', customerName: 'Twin', mobile: '9833333331' }), row({ accountNumber: 'DI40', customerName: 'twin', mobile: '9833333331' })];
    const p = await run(() => previewImport(batch(shopId, twice)));
    expect(p.rows.map((r) => r.status)).toEqual(['new', 'exists']);
  });

  it('CS3 name variants on one mobile follow the choices made', async () => {
    const { shopId, userId, run } = await setup();
    const mobile = '9833333333';
    const rows = [
      row({ accountNumber: 'MJ20', customerName: 'Jitender', mobile }),
      row({ accountNumber: 'MJ21', customerName: 'Jintendar', mobile }),
      row({ accountNumber: 'MJ22', customerName: 'Kamla Devi', mobile }),
    ];
    const preview = await run(() => previewImport(batch(shopId, rows)));
    expect(preview.groups).toHaveLength(1);
    const group = preview.groups[0];
    expect(group.needsReview).toBe(true);
    // Suggested: the two spellings are one person; Kamla Devi is someone else.
    expect(group.suggestion['n:jintendar']).toBe('n:jitender');
    expect(group.suggestion['n:kamla devi']).toBe('n:kamla devi');

    // The person keeps "Jintendar" as the spelling instead.
    const resolution = { 'n:jitender': 'n:jintendar', 'n:jintendar': 'n:jintendar', 'n:kamla devi': 'n:kamla devi' };
    const result = await run(() => commitImport(batch(shopId, rows, { [mobile]: resolution }), userId));
    expect(result).toMatchObject({ inserted: 3, customersCreated: 2 });

    const customers = await run(() => prisma.customer.findMany({ where: { phone: mobile }, orderBy: { name: 'asc' } }));
    expect(customers.map((c) => c.name)).toEqual(['Jintendar', 'Kamla Devi']);
    const items = await run(() => customerSearchService.forCustomer(customers[0].id));
    expect(items.items.map((e) => e.accountNumber).sort()).toEqual(['MJ20', 'MJ21']);

    // A resolution that no longer fits the rows is refused, not guessed at.
    await expect(
      run(() => commitImport(batch(shopId, [row({ accountNumber: 'MJ30', customerName: 'Jitendar', mobile })], { [mobile]: { 'n:x': 'n:x' } }), userId)),
    ).rejects.toThrow(/Preview again/);
  });

  it('CS4 app entries: next number, match by name + mobile, duplicate number refused', async () => {
    const { shopId, userId, customerId, run, types } = await setup();
    const ctx = { shopId, userId };
    await run(() => commitImport(batch(shopId, [row({ accountNumber: 'MJ009', customerName: 'Asha Verma', mobile: '9876543210' })]), userId));

    expect(await run(() => customerSearchService.nextNumber('mj'))).toMatchObject({ nextAccountNumber: 'MJ010' });

    const base = { customerName: 'asha  verma', mobile: '9876543210', purchaseDate: '2026-11-01', categoryId: types.led };
    const entry = await run(() => customerSearchService.create({ ...base, accountNumber: 'MJ010' }, ctx));
    expect(entry.customerId).toBe(customerId);

    const err = await run(() => customerSearchService.create({ ...base, accountNumber: 'mj010' }, ctx)).catch((e) => e);
    expect(err).toBeInstanceOf(CustomerSearchError);
    expect(err.statusCode).toBe(409);
    expect(err.details).toMatchObject({ nextAccountNumber: 'MJ011', usedBy: [{ customerName: 'asha verma' }] });

    // A different name on the same mobile is a different customer.
    const other = await run(() => customerSearchService.create({ ...base, customerName: 'Mohan Verma', accountNumber: 'MJ011' }, ctx));
    expect(other.customerId).not.toBe(customerId);

    // Editing the number keeps it unique; editing the name re-links the customer.
    const edited = await run(() => customerSearchService.update(other.id, { accountNumber: 'MJ012', customerName: 'Asha Verma' }, ctx));
    expect(edited).toMatchObject({ accountNumber: 'MJ012', seriesNo: 12, customerId });

    const prefixes = await run(() => customerSearchService.prefixes());
    expect(prefixes).toEqual([{ prefix: 'MJ', count: 3, lastAccountNumber: 'MJ012', nextAccountNumber: 'MJ013' }]);

    const found = await run(() => customerSearchService.list({ q: '98765' }, { skip: 0, take: 20 }));
    expect(found.totalItems).toBe(3);
    expect(found.entries[0].customerItemCount).toBe(3);
  });

  it('CS5 one tenant never sees another tenant\'s register', async () => {
    const a = await setup();
    const b = await setup();
    await a.run(() => commitImport(batch(a.shopId, [row({ accountNumber: 'ZZ1', customerName: 'Asha Verma', mobile: '9876543210' })]), a.userId));
    expect((await b.run(() => customerSearchService.list({ q: 'ZZ1' }, { skip: 0, take: 20 }))).totalItems).toBe(0);
    // And B can file the same account number for its own customer.
    const own = await b.run(() => commitImport(batch(b.shopId, [row({ accountNumber: 'ZZ1', customerName: 'Asha Verma', mobile: '9876543210' })]), b.userId));
    expect(own.inserted).toBe(1);
  });

  it('CS6 sheet Product text: matched to top-level types, new ones created only when confirmed, choices remembered', async () => {
    const { shopId, userId, run, types } = await setup();
    const rows = [
      row({ accountNumber: 'P1', customerName: 'A', mobile: '9810000001', product: 'fridge' }),
      row({ accountNumber: 'P2', customerName: 'B', mobile: '9810000002', product: 'Fridges' }),
      row({ accountNumber: 'P3', customerName: 'C', mobile: '9810000003', product: 'Cooler' }),
      row({ accountNumber: 'P4', customerName: 'D', mobile: '9810000004', product: 'Inverter' }),
      row({ accountNumber: 'P5', customerName: 'E', mobile: '9810000005', product: '' }),
    ];
    const preview = await run(() => previewImport(batch(shopId, rows)));
    const kinds = Object.fromEntries(preview.productTypes.map((t) => [t.textKey, [t.kind, t.categoryId]]));
    expect(kinds).toEqual({
      fridge: ['matched', types.fridge],
      fridges: ['matched', types.fridge],
      cooler: ['new', null],
      inverter: ['new', null],
    });
    expect(preview.summary.newProductTypes).toBe(2);
    // Only top-level types are offered: the sheet never named a sub-type.
    expect(preview.topLevelTypes.map((t) => t.name).sort()).toEqual(['Electronics', 'Fridge', 'LED TV']);

    // Without permission, creating a type is refused.
    await expect(
      run(() => commitImport({ ...batch(shopId, rows), productTypes: { cooler: { action: 'create', name: 'Cooler' } } }, userId, false)),
    ).rejects.toMatchObject({ statusCode: 403 });

    const result = await run(() =>
      commitImport({ ...batch(shopId, rows), productTypes: { cooler: { action: 'create', name: 'Cooler' }, inverter: { action: 'blank' } } }, userId),
    );
    expect(result).toMatchObject({ inserted: 5, productTypesCreated: 1 });

    const cooler = await run(() => prisma.productCategory.findFirst({ where: { name: 'Cooler' } }));
    expect(cooler).toMatchObject({ parentId: null, level: 0, path: 'cooler', isLeaf: true });
    const entries = await run(() => prisma.customerSearchEntry.findMany({ orderBy: { accountNumber: 'asc' } }));
    expect(entries.map((e) => [e.accountNumber, e.categoryId, e.product])).toEqual([
      ['P1', types.fridge, 'fridge'],
      ['P2', types.fridge, 'Fridges'],
      ['P3', cooler!.id, 'Cooler'],
      ['P4', null, 'Inverter'],
      ['P5', null, null],
    ]);

    // The next range reuses the choices without asking again.
    const later = [row({ accountNumber: 'P6', customerName: 'F', mobile: '9810000006', product: 'COOLER' }), row({ accountNumber: 'P7', customerName: 'G', mobile: '9810000007', product: 'inverter' })];
    const again = await run(() => previewImport(batch(shopId, later)));
    expect(again.productTypes.map((t) => [t.textKey, t.kind, t.categoryId])).toEqual(
      expect.arrayContaining([['cooler', 'mapped', cooler!.id], ['inverter', 'mapped', null]]),
    );
    await run(() => commitImport(batch(shopId, later), userId));
    const p6 = await run(() => prisma.customerSearchEntry.findFirst({ where: { accountNumber: 'P6' } }));
    expect(p6?.categoryId).toBe(cooler!.id);
  });

  it('CS7 app entries need a leaf type of this tenant; the type filter includes sub-types', async () => {
    const a = await setup();
    const b = await setup();
    const ctx = { shopId: a.shopId, userId: a.userId };
    const base = { customerName: 'Asha Verma', mobile: '9876543210', purchaseDate: '2026-11-01' };

    const notLeaf = await a.run(() => customerSearchService.create({ ...base, accountNumber: 'T1', categoryId: a.types.tv }, ctx)).catch((e) => e);
    expect(notLeaf).toMatchObject({ statusCode: 400, message: expect.stringMatching(/last level/) });
    const foreign = await a.run(() => customerSearchService.create({ ...base, accountNumber: 'T1', categoryId: b.types.led }, ctx)).catch((e) => e);
    expect(foreign).toMatchObject({ statusCode: 400 });

    await a.run(() => customerSearchService.create({ ...base, accountNumber: 'T1', categoryId: a.types.led }, ctx));
    await a.run(() => customerSearchService.create({ ...base, accountNumber: 'T2', categoryId: a.types.fridge }, ctx));
    await a.run(() => commitImport(batch(a.shopId, [row({ accountNumber: 'T3', customerName: 'X', mobile: '9811111111', product: 'Geyser' })]), a.userId));

    const list = (categoryId: string) =>
      a.run(() => customerSearchService.list({ categoryId }, { skip: 0, take: 20 })).then((r) => r.entries.map((e) => e.accountNumber).sort());
    expect(await list(a.types.electronics)).toEqual(['T1']);
    expect(await list(a.types.led)).toEqual(['T1']);
    expect(await list(a.types.fridge)).toEqual(['T2']);
    expect(await list('none')).toEqual(['T3']);

    const t1 = (await a.run(() => customerSearchService.list({ q: 'T1' }, { skip: 0, take: 5 }))).entries[0];
    expect(t1.productType).toEqual(['Electronics', 'TV', 'LED TV']);
  });

  it('CS8 export: full path plus one column per level, up to the deepest type exported', async () => {
    const { shopId, userId, run, types } = await setup();
    const ctx = { shopId, userId };
    const base = { customerName: 'Asha Verma', mobile: '9876543210', purchaseDate: '2026-11-01' };
    await run(() => customerSearchService.create({ ...base, accountNumber: 'E1', categoryId: types.led }, ctx));
    await run(() => customerSearchService.create({ ...base, accountNumber: 'E2', categoryId: types.fridge }, ctx));
    await run(() => commitImport(batch(shopId, [row({ accountNumber: 'E3', customerName: 'X', mobile: '9811111111', product: 'Geyser' })]), userId));

    const file = await run(() => customerSearchService.export({}));
    const XLSX = await import('xlsx');
    const sheet = XLSX.read(file.body, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet.Sheets[sheet.SheetNames[0]], { header: 1, defval: '' });
    const h = rows[0];
    const col = (name: string) => h.indexOf(name);
    expect(h.slice(col('Product Type'), col('Brand'))).toEqual(['Product Type', 'Type Level 1', 'Type Level 2', 'Type Level 3']);
    const byAcc = Object.fromEntries(rows.slice(1).map((r) => [r[0], r.slice(col('Product Type'), col('Brand'))]));
    expect(byAcc).toEqual({
      E1: ['Electronics › TV › LED TV', 'Electronics', 'TV', 'LED TV'],
      E2: ['Fridge', 'Fridge', '', ''],
      E3: ['Geyser', '', '', ''],
    });
  });

  it('CS9 deleting an entry removes it from the register but keeps the customers', async () => {
    const { shopId, userId, run, types } = await setup();
    const ctx = { shopId, userId };
    const entry = await run(() =>
      customerSearchService.create(
        { accountNumber: 'D1', customerName: 'Asha Verma', mobile: '9876543210', coName: 'Ram Lal', coMobile: '9812345678', purchaseDate: '2026-11-01', categoryId: types.led },
        ctx,
      ),
    );
    expect(await run(() => customerSearchService.remove(entry.id))).toEqual({ id: entry.id, accountNumber: 'D1' });
    expect(await run(() => prisma.customerSearchEntry.count())).toBe(0);
    expect(await run(() => prisma.customer.count({ where: { id: { in: [entry.customerId, entry.coCustomerId!] } } }))).toBe(2);

    const again = await run(() => customerSearchService.remove(entry.id)).catch((e) => e);
    expect(again).toMatchObject({ statusCode: 404 });
    // The number is free again.
    await run(() => customerSearchService.create({ accountNumber: 'D1', customerName: 'Asha Verma', mobile: '9876543210', purchaseDate: '2026-11-01', categoryId: types.led }, ctx));
  });

  it('CS10 one tenant cannot delete another tenant\'s entry', async () => {
    const a = await setup();
    const b = await setup();
    const entry = await a.run(() =>
      customerSearchService.create({ accountNumber: 'X1', customerName: 'Asha Verma', mobile: '9876543210', purchaseDate: '2026-11-01', categoryId: a.types.led }, { shopId: a.shopId, userId: a.userId }),
    );
    const err = await b.run(() => customerSearchService.remove(entry.id)).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 404 });
    expect(await a.run(() => prisma.customerSearchEntry.count())).toBe(1);
  });

  it('CS11 a reused number in the app: warned first, saved when confirmed, both flagged; deleting one clears the other', async () => {
    const { shopId, userId, run, types } = await setup();
    const ctx = { shopId, userId };
    // Tests run on 4 October 2026; a date before that.
    const base = { purchaseDate: '2026-09-01', categoryId: types.led };
    const first = await run(() => customerSearchService.create({ ...base, accountNumber: 'BD-264', customerName: 'Anand Singh', mobile: '9871034843' }, ctx));
    expect(first.issues).toEqual([]);

    const warned = await run(() => customerSearchService.create({ ...base, accountNumber: 'bd-264', customerName: 'Sani', mobile: '8851857629' }, ctx)).catch((e) => e);
    expect(warned).toMatchObject({ statusCode: 409, details: { nextAccountNumber: 'BD-265', usedBy: [{ customerName: 'Anand Singh' }] } });

    const second = await run(() =>
      customerSearchService.create({ ...base, accountNumber: 'bd-264', customerName: 'Sani', mobile: '8851857629', allowDuplicate: true }, ctx),
    );
    expect(second.issues).toEqual(['duplicate_account']);
    const firstNow = await run(() => prisma.customerSearchEntry.findUniqueOrThrow({ where: { id: first.id } }));
    expect(firstNow.issues).toEqual(['duplicate_account']);

    await run(() => customerSearchService.remove(second.id));
    const firstAfter = await run(() => prisma.customerSearchEntry.findUniqueOrThrow({ where: { id: first.id } }));
    expect(firstAfter.issues).toEqual([]);
  });

  it('CS12 Shop column: each row goes to its shop; a changed Shop on re-import moves the entry and its customer', async () => {
    const { shopId, secondShopId, userId, run } = await setup();
    const rows = [
      row({ accountNumber: 'BD-1', customerName: 'Pawan', mobile: '9599418909', shop: '' }),
      row({ accountNumber: 'BD-2', customerName: 'Darshan', mobile: '8377812002', shop: 'Naveen Electronics' }),
      row({ accountNumber: 'BD-3', customerName: 'Kiran', mobile: '8377812003', shop: 'ne' }),
      row({ accountNumber: 'BD-4', customerName: 'Nobody', mobile: '8377812004', shop: 'Some Other Shop' }),
    ];
    const preview = await run(() => previewImport(batch(shopId, rows)));
    expect(preview.rows.map((r) => [r.status, r.shopCode])).toEqual([['new', expect.any(String)], ['new', 'NE'], ['new', 'NE'], ['invalid', null]]);
    expect(preview.rows[3].errors[0]).toMatch(/isn't one of this business's shops/);

    await run(() => commitImport(batch(shopId, rows), userId));
    const pawan = await run(() => prisma.customerSearchEntry.findFirstOrThrow({ where: { accountNumber: 'BD-1' } }));
    const darshan = await run(() => prisma.customerSearchEntry.findFirstOrThrow({ where: { accountNumber: 'BD-2' } }));
    expect(pawan.shopId).toBe(shopId);
    expect(darshan.shopId).toBe(secondShopId);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: darshan.customerId! } })).shopId).toBe(secondShopId);

    // The sheet now says Pawan belongs to Naveen Electronics.
    const moved = [{ ...rows[0], shop: 'NE' }];
    const p2 = await run(() => previewImport(batch(shopId, moved)));
    expect(p2.rows[0]).toMatchObject({ status: 'move', moveFrom: expect.any(String), shopCode: 'NE' });
    const r2 = await run(() => commitImport(batch(shopId, moved), userId));
    expect(r2).toMatchObject({ inserted: 0, moved: 1 });
    const pawanNow = await run(() => prisma.customerSearchEntry.findUniqueOrThrow({ where: { id: pawan.id } }));
    expect(pawanNow.shopId).toBe(secondShopId);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: pawan.customerId! } })).shopId).toBe(secondShopId);
  });

  it('CS13 changing the shop on an entry moves the customer, unless they still have a sale in the old shop', async () => {
    const { shopId, secondShopId, userId, customerId, run, types } = await setup();
    const ctx = { shopId, userId };
    const base = { purchaseDate: '2026-11-01', categoryId: types.led };
    // Asha (the fixture customer) has a sale in the first shop; Mohan has nothing else.
    const asha = await run(() => customerSearchService.create({ ...base, accountNumber: 'S1', customerName: 'Asha Verma', mobile: '9876543210' }, ctx));
    const mohan = await run(() => customerSearchService.create({ ...base, accountNumber: 'S2', customerName: 'Mohan', mobile: '9876500000' }, ctx));
    expect(asha.customerId).toBe(customerId);

    await run(() => customerSearchService.update(asha.id, { shopId: secondShopId }, ctx));
    await run(() => customerSearchService.update(mohan.id, { shopId: secondShopId }, ctx));

    expect((await run(() => prisma.customerSearchEntry.findUniqueOrThrow({ where: { id: asha.id } }))).shopId).toBe(secondShopId);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).shopId).toBe(shopId);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: mohan.customerId! } })).shopId).toBe(secondShopId);
  });

  it('CS14 Needs review: counted per problem, filterable, and cleared by fixing the entry', async () => {
    const { shopId, userId, run, types } = await setup();
    await run(() =>
      commitImport(
        batch(shopId, [
          row({ accountNumber: 'R1', customerName: 'No Mobile', mobile: 'XXXXX', purchaseDate: '01/01/2025' }),
          row({ accountNumber: 'R2', customerName: 'Nine Digits', mobile: '706556835', purchaseDate: '01/01/2025' }),
          row({ accountNumber: 'R3', customerName: 'Fine', mobile: '9810000003', purchaseDate: '01/01/2025' }),
        ]),
        userId,
      ),
    );
    const summary = await run(() => customerSearchService.reviewSummary());
    const count = (code: string) => summary.issues.find((i) => i.code === code)!.count;
    expect(summary.total).toBe(3); // all three have no product type
    expect([count('missing_mobile'), count('invalid_mobile'), count('no_product_type')]).toEqual([1, 1, 3]);

    const missing = await run(() => customerSearchService.list({ issue: 'missing_mobile' }, { skip: 0, take: 10 }));
    expect(missing.entries.map((e) => e.accountNumber)).toEqual(['R1']);

    const r2 = await run(() => prisma.customerSearchEntry.findFirstOrThrow({ where: { accountNumber: 'R2' } }));
    const fixed = await run(() => customerSearchService.update(r2.id, { mobile: '7065568350', categoryId: types.led }, { shopId, userId }));
    expect(fixed.issues).toEqual([]);
    expect(fixed.rawValues).toBeNull();
  });

  it('CS15 new customer codes continue past CUST-9999 and ignore other tenants\' codes', async () => {
    const { tenantId, shopId, userId, run, types } = await setup();
    const other = await setup();
    const customer = (fx: { tenantId: string; shopId: string; userId: string }, customerCode: string) =>
      prisma.customer.create({ data: { tenantId: fx.tenantId, shopId: fx.shopId, createdBy: fx.userId, customerCode, name: customerCode, phone: '' } as any });
    await customer(other, 'CUST-50000');
    // Compared as text, CUST-9999 sorts after CUST-10000.
    await customer({ tenantId, shopId, userId }, 'CUST-10000');
    await customer({ tenantId, shopId, userId }, 'CUST-9999');

    await run(() =>
      commitImport(
        batch(shopId, [
          row({ accountNumber: 'P1', customerName: 'Past Nine Thousand', mobile: '9810000101', purchaseDate: '01/01/2025' }),
          row({ accountNumber: 'P2', customerName: 'And One More', mobile: '9810000102', purchaseDate: '01/01/2025' }),
        ]),
        userId,
      ),
    );
    await run(() =>
      customerSearchService.create(
        { accountNumber: 'P3', customerName: 'From The Form', mobile: '9810000103', purchaseDate: '2026-11-01', categoryId: types.led },
        { shopId, userId },
      ),
    );
    const codes = await run(() =>
      prisma.customer.findMany({ where: { phone: { in: ['9810000101', '9810000102', '9810000103'] } }, orderBy: { phone: 'asc' } }),
    );
    expect(codes.map((c) => c.customerCode)).toEqual(['CUST-10001', 'CUST-10002', 'CUST-10003']);
  });
});

/** What the mobile app does with sync pages: a fresh copy during bootstrap, swapped in when complete. */
class Mirror {
  live = new Map<string, any>();
  staging: Map<string, any> | null = null;
  token: string | undefined;
  reference: any;

  apply(page: Awaited<ReturnType<typeof syncRegister>>) {
    if (page.phase === 'bootstrap') {
      if (page.start) this.staging = new Map();
      for (const e of page.entries) this.staging!.set(e.id, e);
      if (page.complete) {
        this.live = this.staging!;
        this.staging = null;
      }
    } else {
      for (const e of page.entries) this.live.set(e.id, e);
      for (const id of page.deleted) this.live.delete(id);
    }
    if ('reference' in page && page.reference) this.reference = page.reference;
    this.token = page.next;
  }

  async step(run: <T>(fn: () => Promise<T>) => Promise<T>, projection: SyncProjection = FULL, limit?: number) {
    const page = await run(() => syncRegister(this.token, projection, limit));
    this.apply(page);
    return page;
  }

  /** Call until the server says there is nothing more for now. */
  async sync(run: <T>(fn: () => Promise<T>) => Promise<T>, projection: SyncProjection = FULL, limit?: number) {
    for (let i = 0; i < 200; i++) {
      const page = await this.step(run, projection, limit);
      if (!page.more) return;
    }
    throw new Error('sync did not settle');
  }
}

const FULL: SyncProjection = { phones: true, rawValues: true };

const current = (run: <T>(fn: () => Promise<T>) => Promise<T>) =>
  run(() => prisma.customerSearchEntry.findMany({ select: { id: true, customerName: true, issues: true, shopId: true, categoryId: true } }));

const expectMirrors = async (mirror: Mirror, run: <T>(fn: () => Promise<T>) => Promise<T>) => {
  const rows = await current(run);
  expect([...mirror.live.keys()].sort()).toEqual(rows.map((r) => r.id).sort());
  for (const r of rows) {
    expect(mirror.live.get(r.id)).toMatchObject({ customerName: r.customerName, issues: r.issues, shopId: r.shopId, categoryId: r.categoryId });
  }
};

describe('CS. Customer Searching sync for the mobile app', () => {
  it('CS16 bootstrap pages plus the delta converge, even with edits, inserts and deletes made mid-bootstrap', async () => {
    const { shopId, userId, run, types } = await setup();
    await run(() =>
      commitImport(
        batch(shopId, [
          row({ accountNumber: 'S1', customerName: 'One', mobile: '9810000201', purchaseDate: '01/02/2025', product: 'Fridge' }),
          row({ accountNumber: 'S2', customerName: 'Two', mobile: '9810000202', purchaseDate: '02/02/2025' }),
          row({ accountNumber: 'S3', customerName: 'Three', mobile: '9810000203', purchaseDate: '03/02/2025' }),
          row({ accountNumber: 'S4', customerName: 'Four', mobile: '9810000204', purchaseDate: '04/02/2025' }),
          row({ accountNumber: 'S5', customerName: 'Five', mobile: '9810000205', purchaseDate: '05/02/2025' }),
        ]),
        userId,
      ),
    );
    const mirror = new Mirror();
    const first = await mirror.step(run, FULL, 2);
    expect(first).toMatchObject({ phase: 'bootstrap', start: true, complete: false, more: true });
    expect(first.entries).toHaveLength(2);
    expect(first.entries[0]).toMatchObject({ purchaseDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), customerCode: expect.any(String) });

    // While the device is still downloading: one sent row edited, one deleted, one new entry.
    const [sentA, sentB] = first.entries;
    await run(() => customerSearchService.update(sentA.id, { customerName: 'Edited Mid Bootstrap' }, { shopId, userId }));
    await run(() => customerSearchService.remove(sentB.id));
    await run(() =>
      customerSearchService.create(
        { accountNumber: 'S6', customerName: 'Added Mid Bootstrap', mobile: '9810000206', purchaseDate: '2026-01-01', categoryId: types.led },
        { shopId, userId },
      ),
    );

    await mirror.sync(run, FULL, 2);
    expect(mirror.staging).toBeNull();
    await expectMirrors(mirror, run);
    expect(mirror.live.has(sentB.id)).toBe(false);
    expect(mirror.reference.shops.map((s: any) => s.id)).toContain(shopId);
    expect(mirror.reference.categories.map((c: any) => c.id)).toEqual(expect.arrayContaining([types.led, types.fridge]));

    // Nothing changed since: the delta is empty and the token stays put.
    const idle = await mirror.step(run);
    expect(idle).toMatchObject({ phase: 'delta', entries: [], deleted: [], more: false });
  });

  it('CS17 import, duplicate-number flags, shop moves and category deletion all reach the device', async () => {
    const { shopId, userId, run, types, secondShopId } = await setup();
    await run(() =>
      commitImport(
        batch(shopId, [
          row({ accountNumber: 'D1', customerName: 'Old Holder', mobile: '9810000301', purchaseDate: '01/03/2025', product: 'Fridge' }),
          row({ accountNumber: 'D2', customerName: 'Mover', mobile: '9810000302', purchaseDate: '02/03/2025', product: 'Fridge' }),
        ]),
        userId,
      ),
    );
    const mirror = new Mirror();
    await mirror.sync(run);
    const oldHolder = [...mirror.live.values()].find((e) => e.accountNumber === 'D1');
    expect(oldHolder.issues).toEqual([]);

    // A later import reuses D1: the existing entry is flagged too.
    await run(() => commitImport(batch(shopId, [row({ accountNumber: 'D1', customerName: 'New Holder', mobile: '9810000303', purchaseDate: '03/03/2025' })]), userId));
    const mover = [...mirror.live.values()].find((e) => e.accountNumber === 'D2');
    await run(() => customerSearchService.update(mover.id, { shopId: secondShopId }, { shopId, userId }));
    await prisma.customerSearchProductMapping.deleteMany({ where: { categoryId: types.fridge } });
    await prisma.productCategory.delete({ where: { id: types.fridge } });

    await mirror.sync(run);
    await expectMirrors(mirror, run);
    expect(mirror.live.get(oldHolder.id).issues).toContain('duplicate_account');
    expect(mirror.live.get(mover.id).shopId).toBe(secondShopId);
    expect(mirror.live.get(oldHolder.id).categoryId).toBeNull();
    expect(mirror.reference.categories.map((c: any) => c.id)).not.toContain(types.fridge);
  });

  it('CS18 a change still being written holds the device back until it commits, so it is never skipped', async () => {
    const { shopId, userId, run, types } = await setup();
    await run(() => commitImport(batch(shopId, [row({ accountNumber: 'W1', customerName: 'Before', mobile: '9810000401', purchaseDate: '01/04/2025' })]), userId));
    const mirror = new Mirror();
    await mirror.sync(run);

    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inserted = new Promise<void>((resolve) => (started = resolve));
    // An older transaction that has written but not committed yet...
    const slow = run(() =>
      prisma.$transaction(
        async (tx) => {
          await tx.customerSearchEntry.create({
            data: { shopId, accountNumber: 'W2', prefix: 'W', seriesNo: 2, customerName: 'Slow Writer', mobile: '', categoryId: types.led } as any,
          });
          started();
          await gate;
        },
        { timeout: 20_000 },
      ),
    );
    await inserted;
    // ...and a newer one that commits first.
    const w1 = [...mirror.live.values()][0];
    await run(() => customerSearchService.update(w1.id, { customerName: 'After' }, { shopId, userId }));

    await mirror.sync(run);
    expect([...mirror.live.values()].some((e) => e.accountNumber === 'W2')).toBe(false);

    release();
    await slow;
    await mirror.sync(run);
    await expectMirrors(mirror, run);
    expect(mirror.live.get(w1.id).customerName).toBe('After');
    expect([...mirror.live.values()].some((e) => e.accountNumber === 'W2')).toBe(true);
  });

  it('CS19 another tenant never appears, and its token is refused', async () => {
    const a = await setup();
    const b = await setup();
    await a.run(() => commitImport(batch(a.shopId, [row({ accountNumber: 'TA1', customerName: 'Tenant A', mobile: '9810000501', purchaseDate: '01/05/2025' })]), a.userId));
    await b.run(() => commitImport(batch(b.shopId, [row({ accountNumber: 'TB1', customerName: 'Tenant B', mobile: '9810000502', purchaseDate: '01/05/2025' })]), b.userId));
    const mirror = new Mirror();
    await mirror.sync(a.run);
    expect([...mirror.live.values()].map((e) => e.accountNumber)).toEqual(['TA1']);
    expect(mirror.reference.shops.map((s: any) => s.id)).toEqual(expect.arrayContaining([a.shopId, a.secondShopId]));
    expect(mirror.reference.shops.map((s: any) => s.id)).not.toContain(b.shopId);

    const err = await b.run(() => syncRegister(mirror.token, FULL)).catch((e) => e);
    expect(err).toBeInstanceOf(SyncResetError);
    expect(err).toMatchObject({ statusCode: 410, details: { reset: true, reason: 'tenant' } });
  });

  it('CS20 what the user may see is part of the position: a change restarts the download; raw values only with details', async () => {
    const { shopId, userId, run } = await setup();
    await run(() => commitImport(batch(shopId, [row({ accountNumber: 'R1', customerName: 'Raw Mobile', mobile: '12345', purchaseDate: '01/06/2025' })]), userId));
    const full = new Mirror();
    await full.sync(run);
    expect([...full.live.values()][0].rawValues).toEqual({ mobile: '12345' });

    const err = await run(() => syncRegister(full.token, { phones: false, rawValues: false })).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 410, details: { reset: true, reason: 'projection' } });

    const listOnly = new Mirror();
    await listOnly.sync(run, { phones: true, rawValues: false });
    expect('rawValues' in [...listOnly.live.values()][0]).toBe(false);

    const garbage = await run(() => syncRegister('not-a-token', FULL)).catch((e) => e);
    expect(garbage).toMatchObject({ statusCode: 410, details: { reason: 'invalid' } });
  });
});

describe('CS. Safe saves from a device', () => {
  it('CS21 repeating a save with the same request id returns the same entry; another user cannot reuse it', async () => {
    const { tenantId, shopId, userId, run, types } = await setup();
    const input = {
      accountNumber: 'Q1', customerName: 'Retried Save', mobile: '9810000601', purchaseDate: '2026-02-01',
      categoryId: types.led, clientRequestId: '6f1c6f8e-3b0a-4f43-9d6b-1a2b3c4d5e6f',
    };
    const first = await run(() => customerSearchService.create(input, { shopId, userId }));
    const again = await run(() => customerSearchService.create(input, { shopId, userId }));
    expect(again.id).toBe(first.id);
    expect(await run(() => prisma.customerSearchEntry.count({ where: { accountNumber: 'Q1' } }))).toBe(1);

    const other = await prisma.user.create({ data: { tenantId, username: `other-${tenantId.slice(0, 6)}`, passwordHash: 'x', fullName: 'Other', phone: '9999999990', role: 'admin' } as any });
    const err = await run(() => customerSearchService.create(input, { shopId, userId: other.id })).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 409, details: { code: 'request_reused' } });

    // A duplicate number is still refused first, then saved once confirmed.
    const dup = await run(() => customerSearchService.create({ ...input, clientRequestId: undefined }, { shopId, userId })).catch((e) => e);
    expect(dup).toMatchObject({ statusCode: 409, details: { code: 'duplicate_account', nextAccountNumber: 'Q2' } });
  });

  it('CS22 an edit made from an out-of-date copy is refused; a current one (or one without a version, as the web sends) is saved', async () => {
    const { shopId, userId, run, types } = await setup();
    const entry = await run(() =>
      customerSearchService.create(
        { accountNumber: 'V1', customerName: 'Versioned', mobile: '9810000701', purchaseDate: '2026-03-01', categoryId: types.led },
        { shopId, userId },
      ),
    );
    const seen = entry.updatedAt.toISOString();
    const web = await run(() => customerSearchService.update(entry.id, { area: 'Web edit' }, { shopId, userId }));

    const stale = await run(() => customerSearchService.update(entry.id, { area: 'Phone edit', expectedUpdatedAt: seen }, { shopId, userId })).catch((e) => e);
    expect(stale).toBeInstanceOf(CustomerSearchError);
    expect(stale).toMatchObject({ statusCode: 409, details: { code: 'stale', updatedAt: web.updatedAt.toISOString() } });
    expect((await run(() => prisma.customerSearchEntry.findUniqueOrThrow({ where: { id: entry.id } }))).area).toBe('Web edit');

    const ok = await run(() => customerSearchService.update(entry.id, { area: 'Phone edit', expectedUpdatedAt: web.updatedAt.toISOString() }, { shopId, userId }));
    expect(ok.area).toBe('Phone edit');
  });
});
