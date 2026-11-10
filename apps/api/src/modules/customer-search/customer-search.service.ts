import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { generateCustomerCode, lastCustomerCode } from '../../utils/id-generator.js';
import {
  isValidMobile,
  nextAccountNumber,
  normalizeAccountNumber,
  normalizeMobile,
  parseAccountNumber,
  personNameKey,
  personNameScore,
  REGISTER_ISSUE_CODES,
  REGISTER_ISSUES,
  tidyName,
} from '@retailerp/shared-utils';
import type { EntryInput, EntryUpdateInput } from './customer-search.validation.js';
import { buildTypeColumns, categoryPaths } from './customer-search.product-types.js';
import { moveCustomersWithEntry, refreshIssues, type RawValues } from './customer-search.issues.js';

export class CustomerSearchError extends Error {
  constructor(message: string, public statusCode = 400, public details?: Record<string, unknown>) {
    super(message);
  }
}

export interface SearchFilters {
  q?: string;
  prefix?: string;
  area?: string;
  shopId?: string;
  dateFrom?: string;
  dateTo?: string;
  batchId?: string;
  customerId?: string;
  /** A product type (matches it and every type under it), or `none` for entries with no type. */
  categoryId?: string;
  /** "Needs review": `any` problem, or one REGISTER_ISSUES code. */
  issue?: string;
}

/**
 * The register covers every shop of the tenant (it was one sheet for all of
 * them), so searching is tenant-wide; `shopId` is an optional filter.
 */
async function whereFor(filters: SearchFilters): Promise<Prisma.CustomerSearchEntryWhereInput> {
  const where: Prisma.CustomerSearchEntryWhereInput = {};
  const and: Prisma.CustomerSearchEntryWhereInput[] = [];
  const q = filters.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    const or: Prisma.CustomerSearchEntryWhereInput[] = [
      { accountNumber: { contains: normalizeAccountNumber(q), mode: 'insensitive' } },
      { customerName: { contains: q, mode: 'insensitive' } },
      { coName: { contains: q, mode: 'insensitive' } },
      { area: { contains: q, mode: 'insensitive' } },
      { product: { contains: q, mode: 'insensitive' } },
      { category: { name: { contains: q, mode: 'insensitive' } } },
      { brand: { contains: q, mode: 'insensitive' } },
      { model: { contains: q, mode: 'insensitive' } },
      { customer: { customerCode: { contains: q, mode: 'insensitive' } } },
    ];
    if (digits.length >= 3 && digits.length === q.replace(/[\s+-]/g, '').length) {
      or.push({ mobile: { contains: digits.slice(-10) } }, { coMobile: { contains: digits.slice(-10) } });
    }
    and.push({ OR: or });
  }
  if (filters.prefix) where.prefix = normalizeAccountNumber(filters.prefix);
  if (filters.issue === 'any') where.issues = { isEmpty: false };
  else if (filters.issue && (REGISTER_ISSUE_CODES as string[]).includes(filters.issue)) where.issues = { has: filters.issue };
  if (filters.area) where.area = { contains: filters.area.trim(), mode: 'insensitive' };
  if (filters.shopId) where.shopId = filters.shopId;
  if (filters.batchId) where.importBatchId = filters.batchId;
  if (filters.customerId) and.push({ OR: [{ customerId: filters.customerId }, { coCustomerId: filters.customerId }] });
  if (filters.categoryId === 'none') {
    where.categoryId = null;
  } else if (filters.categoryId) {
    const type = await prisma.productCategory.findUnique({ where: { id: filters.categoryId }, select: { path: true } });
    and.push(
      type
        ? { OR: [{ categoryId: filters.categoryId }, { category: { path: { startsWith: `${type.path}.` } } }] }
        : { id: '__no_such_type__' },
    );
  }
  if (filters.dateFrom || filters.dateTo) {
    where.purchaseDate = {
      ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00Z`) } : {}),
      ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T00:00:00Z`) } : {}),
    };
  }
  if (and.length) where.AND = and;
  return where;
}

/** Category id → names top-down, for every type of the tenant (the tree is small). */
async function loadTypePaths() {
  const categories = await prisma.productCategory.findMany({ select: { id: true, name: true, parentId: true } });
  return categoryPaths(categories);
}

/** The product type an entry needs: one of the tenant's, at the deepest level. */
async function assertLeafType(categoryId: string) {
  const type = await prisma.productCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, isLeaf: true, isActive: true, _count: { select: { children: { where: { isActive: true } } } } },
  });
  if (!type || !type.isActive) throw new CustomerSearchError('Choose a product type from the list', 400);
  if (!type.isLeaf && type._count.children > 0) {
    throw new CustomerSearchError('Choose the product type down to its last level', 400);
  }
}

const listInclude = {
  customer: { select: { id: true, name: true, customerCode: true } },
  coCustomer: { select: { id: true, name: true, customerCode: true } },
  shop: { select: { id: true, name: true, code: true } },
} satisfies Prisma.CustomerSearchEntryInclude;

const orderBy: Prisma.CustomerSearchEntryOrderByWithRelationInput[] = [
  { purchaseDate: { sort: 'desc', nulls: 'last' } },
  { accountNumber: 'asc' },
];

const toIsoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function newCustomerCode(tx: Prisma.TransactionClient) {
  return generateCustomerCode(await lastCustomerCode(tx));
}

/**
 * The customer an entry is filed under: the one picked on the form, else the
 * one with the same name and mobile, else a new one in `shopId`. With no
 * mobile there is nothing reliable to match on, so it is always a new one.
 */
async function resolveCustomer(
  tx: Prisma.TransactionClient,
  person: { id?: string | null; name: string; mobile: string; address?: string | null; area?: string | null },
  ctx: { shopId: string; userId: string; asGuarantor: boolean },
): Promise<string> {
  if (person.id) {
    const found = await tx.customer.findUnique({ where: { id: person.id }, select: { id: true, isGuarantor: true } });
    if (!found) throw new CustomerSearchError('The customer picked no longer exists', 404);
    if (ctx.asGuarantor && !found.isGuarantor) await tx.customer.update({ where: { id: found.id }, data: { isGuarantor: true } });
    return found.id;
  }
  const key = personNameKey(person.name);
  const sameMobile = person.mobile
    ? await tx.customer.findMany({
        where: { phone: person.mobile },
        select: { id: true, name: true, isGuarantor: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const exact = sameMobile.find((c) => personNameKey(c.name) === key);
  if (exact) {
    if (ctx.asGuarantor && !exact.isGuarantor) await tx.customer.update({ where: { id: exact.id }, data: { isGuarantor: true } });
    return exact.id;
  }
  const created = await tx.customer.create({
    data: {
      customerCode: await newCustomerCode(tx),
      name: person.name,
      phone: person.mobile,
      addressLine1: person.address ? person.address.slice(0, 255) : null,
      addressLine2: person.area ? person.area.slice(0, 255) : null,
      isGuarantor: ctx.asGuarantor,
      shopId: ctx.shopId,
      createdBy: ctx.userId,
    } as any,
    select: { id: true },
  });
  return created.id;
}

async function assertShopAccess(userId: string, shopId: string) {
  const access = await prisma.userShop.findFirst({ where: { userId, shopId, shop: { isActive: true } }, select: { id: true } });
  if (!access) throw new CustomerSearchError('You do not have access to that shop', 403);
}

/** Other entries already using an account number, for the "already used" warning. */
async function usersOfNumber(accountNumber: string, exceptId?: string) {
  if (!accountNumber) return [];
  return prisma.customerSearchEntry.findMany({
    where: { accountNumber, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, customerName: true, shop: { select: { code: true } } },
    take: 5,
  });
}

export const customerSearchService = {
  async list(filters: SearchFilters, page: { skip: number; take: number }) {
    const where = await whereFor(filters);
    const [entries, totalItems, pathOf] = await Promise.all([
      prisma.customerSearchEntry.findMany({ where, include: listInclude, orderBy, skip: page.skip, take: page.take }),
      prisma.customerSearchEntry.count({ where }),
      loadTypePaths(),
    ]);
    // How many items each customer on this page has bought, for the "3 items" chip.
    const ids = [...new Set(entries.map((e) => e.customerId).filter((id): id is string => !!id))];
    const counts = ids.length
      ? await prisma.customerSearchEntry.groupBy({ by: ['customerId'], where: { customerId: { in: ids } }, _count: { _all: true } })
      : [];
    const itemsByCustomer = new Map(counts.map((c) => [c.customerId, c._count._all]));
    return {
      entries: entries.map((e) => ({
        ...e,
        purchaseDate: toIsoDate(e.purchaseDate),
        productType: pathOf(e.categoryId),
        customerItemCount: e.customerId ? itemsByCustomer.get(e.customerId) ?? 1 : 0,
      })),
      totalItems,
    };
  },

  /** How many entries need review, in all and per problem — for the review tab and its dropdown. */
  async reviewSummary() {
    const [any, ...perIssue] = await Promise.all([
      prisma.customerSearchEntry.count({ where: { issues: { isEmpty: false } } }),
      ...REGISTER_ISSUE_CODES.map((code) => prisma.customerSearchEntry.count({ where: { issues: { has: code } } })),
    ]);
    return {
      total: any,
      issues: REGISTER_ISSUE_CODES.map((code, i) => ({ code, label: REGISTER_ISSUES[code], count: perIssue[i] })),
    };
  },

  async getById(id: string, options: { canSeeSales: boolean }) {
    const entry = await prisma.customerSearchEntry.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, customerCode: true, phone: true, addressLine1: true, addressLine2: true } },
        coCustomer: { select: { id: true, name: true, customerCode: true, phone: true } },
        shop: { select: { id: true, name: true, code: true } },
        creator: { select: { id: true, fullName: true, username: true } },
        importBatch: { select: { id: true, fileName: true, rowFrom: true, rowTo: true, createdAt: true } },
      },
    });
    if (!entry) return null;
    // A sale whose ledger number is this account number, if the register and
    // the sales book turn out to share numbers.
    const matchingSale = options.canSeeSales
      ? await prisma.saleRecord.findFirst({
          where: { ledgerNumber: { equals: entry.accountNumber, mode: 'insensitive' } },
          select: { id: true, saleNumber: true, ledgerNumber: true, saleDate: true, shop: { select: { code: true } } },
        })
      : null;
    const [customerItemCount, pathOf] = await Promise.all([
      entry.customerId ? prisma.customerSearchEntry.count({ where: { customerId: entry.customerId } }) : Promise.resolve(0),
      loadTypePaths(),
    ]);
    return {
      ...entry,
      purchaseDate: toIsoDate(entry.purchaseDate),
      productType: pathOf(entry.categoryId),
      customerItemCount,
      matchingSale: matchingSale ? { ...matchingSale, saleDate: toIsoDate(matchingSale.saleDate) } : null,
    };
  },

  /** Items a customer bought, and entries they stand co-applicant on. */
  async forCustomer(customerId: string) {
    const [items, coApplicantOn, pathOf] = await Promise.all([
      prisma.customerSearchEntry.findMany({ where: { customerId }, include: listInclude, orderBy }),
      prisma.customerSearchEntry.findMany({ where: { coCustomerId: customerId }, include: listInclude, orderBy }),
      loadTypePaths(),
    ]);
    const tidy = (e: (typeof items)[number]) => ({ ...e, purchaseDate: toIsoDate(e.purchaseDate), productType: pathOf(e.categoryId) });
    return { items: items.map(tidy), coApplicantOn: coApplicantOn.map(tidy) };
  },

  /** Prefixes in use, with how many entries and the last number of each series. */
  async prefixes() {
    const groups = await prisma.customerSearchEntry.groupBy({
      by: ['prefix'],
      _count: { _all: true },
      _max: { seriesNo: true },
      orderBy: { prefix: 'asc' },
    });
    const withSeries = groups.filter((g) => g.prefix && g._max.seriesNo != null);
    const lastEntries = withSeries.length
      ? await prisma.customerSearchEntry.findMany({
          where: { OR: withSeries.map((g) => ({ prefix: g.prefix, seriesNo: g._max.seriesNo })) },
          select: { prefix: true, seriesNo: true, accountNumber: true },
        })
      : [];
    const lastByPrefix = new Map(lastEntries.map((e) => [e.prefix, e]));
    return groups
      .filter((g) => g.prefix)
      .map((g) => {
        const last = lastByPrefix.get(g.prefix) ?? null;
        return {
          prefix: g.prefix,
          count: g._count._all,
          lastAccountNumber: last?.accountNumber ?? null,
          nextAccountNumber: nextAccountNumber(g.prefix, last),
        };
      });
  },

  /** The next free number in a series. */
  async nextNumber(prefix: string) {
    const p = normalizeAccountNumber(prefix);
    const last = await prisma.customerSearchEntry.findFirst({
      where: { prefix: p, seriesNo: { not: null } },
      orderBy: { seriesNo: 'desc' },
      select: { accountNumber: true, seriesNo: true },
    });
    let candidate = nextAccountNumber(p, last);
    // An odd-shaped number may already sit where the series goes next.
    for (let i = 0; i < 50; i++) {
      const taken = await prisma.customerSearchEntry.findFirst({ where: { accountNumber: candidate }, select: { id: true } });
      if (!taken) break;
      const parsed = parseAccountNumber(candidate);
      candidate = nextAccountNumber(p, { accountNumber: candidate, seriesNo: parsed.seriesNo });
    }
    return { prefix: p, lastAccountNumber: last?.accountNumber ?? null, nextAccountNumber: candidate };
  },

  /** Customers already on a mobile, closest name first, for the form's autofill and "did you mean". */
  async customerMatches(mobileInput: string, name?: string) {
    const mobile = normalizeMobile(mobileInput);
    if (!mobile) return [];
    const customers = await prisma.customer.findMany({
      where: { phone: mobile },
      select: { id: true, name: true, customerCode: true, phone: true, addressLine1: true, addressLine2: true, isGuarantor: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const counts = customers.length
      ? await prisma.customerSearchEntry.groupBy({
          by: ['customerId'],
          where: { customerId: { in: customers.map((c) => c.id) } },
          _count: { _all: true },
        })
      : [];
    const itemCount = new Map(counts.map((c) => [c.customerId, c._count._all]));
    const key = name ? personNameKey(name) : '';
    return customers
      .map((c) => ({
        ...c,
        itemCount: itemCount.get(c.id) ?? 0,
        exact: key !== '' && personNameKey(c.name) === key,
        score: name ? Math.round(personNameScore(name, c.name) * 100) / 100 : null,
      }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  },

  async create(input: EntryInput, ctx: { shopId: string; userId: string }) {
    // A repeated save (the first response was lost) returns the entry it made.
    if (input.clientRequestId) {
      const prior = await savedForRequest(input.clientRequestId, ctx.userId);
      if (prior) return prior;
    }
    const acc = parseAccountNumber(input.accountNumber);
    const entry = normalizeEntry(input);
    await assertLeafType(input.categoryId);
    const shopId = input.shopId ?? ctx.shopId;
    if (shopId !== ctx.shopId) await assertShopAccess(ctx.userId, shopId);
    // A reused account number is allowed, but only once the person has seen the warning.
    if (!input.allowDuplicate) {
      const used = await usersOfNumber(acc.accountNumber);
      if (used.length) throw await takenError(acc.accountNumber, acc.prefix, used);
    }
    const save = () => prisma.$transaction(async (tx) => {
      const customerId = await resolveCustomer(
        tx,
        { id: input.customerId, name: entry.customerName, mobile: entry.mobile, address: entry.address, area: entry.area },
        { shopId, userId: ctx.userId, asGuarantor: false },
      );
      const coCustomerId =
        entry.coName && entry.coMobileValid
          ? await resolveCustomer(tx, { id: input.coCustomerId, name: entry.coName, mobile: entry.coMobile! }, { shopId, userId: ctx.userId, asGuarantor: true })
          : null;
      const created = await tx.customerSearchEntry.create({
        data: {
          shopId,
          accountNumber: acc.accountNumber,
          prefix: acc.prefix,
          seriesNo: acc.seriesNo,
          customerId,
          customerName: entry.customerName,
          mobile: entry.mobile,
          address: entry.address,
          area: entry.area,
          coCustomerId,
          coName: entry.coName,
          coMobile: entry.coMobile,
          purchaseDate: new Date(`${input.purchaseDate}T00:00:00Z`),
          categoryId: input.categoryId,
          product: entry.product,
          brand: entry.brand,
          model: entry.model,
          source: 'app',
          clientRequestId: input.clientRequestId ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        } as any,
        select: { id: true },
      });
      await refreshIssues(tx, { ids: [created.id] });
      return tx.customerSearchEntry.findUniqueOrThrow({ where: { id: created.id } });
    });
    try {
      return await save();
    } catch (error) {
      // Two copies of the same save raced: the other one made the entry.
      if (input.clientRequestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const prior = await savedForRequest(input.clientRequestId, ctx.userId);
        if (prior) return prior;
      }
      throw error;
    }
  },

  async update(id: string, input: EntryUpdateInput, ctx: { shopId: string; userId: string }) {
    const existing = await prisma.customerSearchEntry.findUnique({ where: { id } });
    if (!existing) throw new CustomerSearchError('Entry not found', 404);
    if (input.expectedUpdatedAt) assertNotStale(existing.updatedAt, input.expectedUpdatedAt);

    const merged: EntryInput = {
      accountNumber: input.accountNumber ?? existing.accountNumber,
      customerName: input.customerName ?? existing.customerName,
      mobile: input.mobile !== undefined ? input.mobile : existing.mobile,
      address: input.address !== undefined ? input.address : existing.address,
      area: input.area !== undefined ? input.area : existing.area,
      coName: input.coName !== undefined ? input.coName : existing.coName,
      coMobile: input.coMobile !== undefined ? input.coMobile : existing.coMobile,
      purchaseDate: input.purchaseDate ?? toIsoDate(existing.purchaseDate) ?? '',
      categoryId: input.categoryId ?? existing.categoryId ?? '',
      product: input.product !== undefined ? input.product : existing.product,
      brand: input.brand !== undefined ? input.brand : existing.brand,
      model: input.model !== undefined ? input.model : existing.model,
      customerId: input.customerId,
      coCustomerId: input.coCustomerId,
    };
    const acc = parseAccountNumber(merged.accountNumber);
    const entry = normalizeEntry(merged);
    // Only a changed type has to be a leaf; an imported top-level type can stay.
    if (input.categoryId && input.categoryId !== existing.categoryId) await assertLeafType(input.categoryId);
    const shopId = input.shopId ?? existing.shopId;
    const shopChanged = shopId !== existing.shopId;
    if (shopChanged) await assertShopAccess(ctx.userId, shopId);
    if (acc.accountNumber !== existing.accountNumber && !input.allowDuplicate) {
      const used = await usersOfNumber(acc.accountNumber, id);
      if (used.length) throw await takenError(acc.accountNumber, acc.prefix, used);
    }
    const personChanged =
      input.customerId !== undefined ||
      entry.mobile !== existing.mobile ||
      personNameKey(entry.customerName) !== personNameKey(existing.customerName);
    const coChanged =
      input.coCustomerId !== undefined ||
      (entry.coMobileValid ? entry.coMobile : null) !== (existing.coCustomerId ? existing.coMobile : null) ||
      personNameKey(entry.coName ?? '') !== personNameKey(existing.coName ?? '');

    // Sheet values that no longer matter once the field holds a good value.
    const raw = { ...((existing.rawValues ?? {}) as RawValues) };
    if (entry.mobile) delete raw.mobile;
    if (merged.purchaseDate) delete raw.purchaseDate;
    if (entry.coMobileValid || !merged.coMobile) delete raw.coMobile;

    return prisma.$transaction(async (tx) => {
      if (input.expectedUpdatedAt) {
        // Lock the row so an edit committed since the check above is caught too.
        const [row] = await tx.$queryRaw<{ updated_at: Date }[]>`
          SELECT updated_at FROM customer_search_entries WHERE id = ${id} FOR UPDATE`;
        assertNotStale(row?.updated_at ?? null, input.expectedUpdatedAt);
      }
      const customerId = personChanged
        ? await resolveCustomer(
            tx,
            { id: merged.customerId, name: entry.customerName, mobile: entry.mobile, address: entry.address, area: entry.area },
            { shopId, userId: ctx.userId, asGuarantor: false },
          )
        : existing.customerId;
      let coCustomerId = existing.coCustomerId;
      if (coChanged) {
        coCustomerId =
          entry.coName && entry.coMobileValid
            ? await resolveCustomer(tx, { id: merged.coCustomerId, name: entry.coName, mobile: entry.coMobile! }, { shopId, userId: ctx.userId, asGuarantor: true })
            : null;
      }
      await tx.customerSearchEntry.update({
        where: { id },
        data: {
          shopId,
          accountNumber: acc.accountNumber,
          prefix: acc.prefix,
          seriesNo: acc.seriesNo,
          customerId,
          customerName: entry.customerName,
          mobile: entry.mobile,
          address: entry.address,
          area: entry.area,
          coCustomerId,
          coName: entry.coName,
          coMobile: entry.coMobile,
          purchaseDate: merged.purchaseDate ? new Date(`${merged.purchaseDate}T00:00:00Z`) : null,
          categoryId: merged.categoryId || null,
          product: entry.product,
          brand: entry.brand,
          model: entry.model,
          rawValues: Object.keys(raw).length ? (raw as Prisma.InputJsonValue) : Prisma.DbNull,
          updatedBy: ctx.userId,
        },
      });
      // The customer goes with the entry unless something keeps them in the old shop.
      if (shopChanged) await moveCustomersWithEntry(tx, [customerId, coCustomerId], shopId);
      await refreshIssues(tx, { ids: [id], accountNumbers: [existing.accountNumber] });
      return tx.customerSearchEntry.findUniqueOrThrow({ where: { id } });
    });
  },

  /**
   * Remove one entry. The customer and co-applicant it was filed under stay:
   * they may have other entries or sales.
   */
  async remove(id: string) {
    const existing = await prisma.customerSearchEntry.findUnique({ where: { id }, select: { id: true, accountNumber: true } });
    if (!existing) throw new CustomerSearchError('Entry not found', 404);
    await prisma.$transaction(async (tx) => {
      await tx.customerSearchEntry.delete({ where: { id } });
      // Its number may now be used only once: clear the others' duplicate flag.
      await refreshIssues(tx, { accountNumbers: [existing.accountNumber] });
    });
    return { id, accountNumber: existing.accountNumber };
  },

  async listImportBatches() {
    return prisma.customerSearchImportBatch.findMany({
      include: {
        shop: { select: { id: true, name: true, code: true } },
        creator: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  },

  /**
   * The register as a spreadsheet, in the sheet's own columns so it can be
   * imported back. Product types differ in depth, so the type is one
   * "Product Type" column (the whole path) plus "Type Level 1…N", N being the
   * deepest type in this export; shallower types leave the extra levels blank.
   */
  async export(filters: SearchFilters) {
    const [entries, pathOf] = await Promise.all([
      prisma.customerSearchEntry.findMany({
        where: await whereFor(filters),
        include: listInclude,
        orderBy: [{ prefix: 'asc' }, { seriesNo: 'asc' }, { accountNumber: 'asc' }],
        take: 100_000,
      }),
      loadTypePaths(),
    ]);
    const fmt = (d: Date | null) => {
      if (!d) return '';
      const iso = d.toISOString().slice(0, 10);
      return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    };
    const types = buildTypeColumns(
      entries.map((e) => pathOf(e.categoryId)),
      entries.map((e) => e.product),
    );
    const header = [
      'Account Number', 'CUSTOMER_NAME', 'Address', 'Mobile', 'CO', 'CO_Mobile', 'AREA', 'Purchase_Date',
      'Product Type', ...types.levelHeaders, 'Brand', 'Model', 'Shop', 'Customer Code', 'Needs review',
    ];
    const rows = entries.map((e, i) => [
      e.accountNumber,
      e.customerName,
      e.address ?? '',
      e.mobile,
      e.coName ?? '',
      e.coMobile ?? '',
      e.area ?? '',
      fmt(e.purchaseDate),
      types.rows[i].path,
      ...types.rows[i].levels,
      e.brand ?? '',
      e.model ?? '',
      e.shop.name,
      e.customer?.customerCode ?? '',
      e.issues.map((code) => REGISTER_ISSUES[code as keyof typeof REGISTER_ISSUES] ?? code).join('; '),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Customer Searching');
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      body: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `customer-searching-${stamp}.xlsx`,
    };
  },
};

function normalizeEntry(input: EntryInput) {
  const customerName = tidyName(input.customerName);
  if (!personNameKey(customerName)) throw new CustomerSearchError('Customer name is required');
  // No mobile is allowed (the entry is listed under "Needs review"); a wrong one isn't.
  const mobileText = (input.mobile ?? '').trim();
  if (mobileText && !isValidMobile(mobileText)) throw new CustomerSearchError('Mobile must be a 10-digit Indian mobile number');
  const coName = tidyName(input.coName ?? '') || null;
  const coMobileText = (input.coMobile ?? '').trim();
  const coMobileValid = coMobileText !== '' && isValidMobile(coMobileText);
  if (coMobileText && !coMobileValid) throw new CustomerSearchError('Co-applicant mobile must be a 10-digit Indian mobile number');
  const clean = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim() || null;
  return {
    customerName,
    mobile: mobileText ? normalizeMobile(mobileText) : '',
    address: clean(input.address),
    area: clean(input.area),
    coName,
    coMobile: coMobileValid ? normalizeMobile(coMobileText) : null,
    coMobileValid,
    product: clean(input.product),
    brand: clean(input.brand),
    model: clean(input.model),
  };
}

/** The entry an earlier save with this client request id made, if any (only the same user's). */
async function savedForRequest(clientRequestId: string, userId: string) {
  const prior = await prisma.customerSearchEntry.findFirst({ where: { clientRequestId } });
  if (prior && prior.createdBy !== userId) {
    throw new CustomerSearchError('This save was already used by someone else. Start a new entry.', 409, { code: 'request_reused' });
  }
  return prior;
}

/** 409 when the entry changed after the editor loaded it. */
function assertNotStale(current: Date | null, expected: string) {
  if (!current || current.getTime() !== new Date(expected).getTime()) {
    throw new CustomerSearchError(
      'Someone else changed this entry after you opened it. Reload it, check the changes, and save again.',
      409,
      { code: 'stale', updatedAt: current ? current.toISOString() : null },
    );
  }
}

/** 409 for a reused account number: who already has it, and the next free one in its series. */
async function takenError(
  accountNumber: string,
  prefix: string,
  usedBy: Array<{ id: string; customerName: string; shop: { code: string } }>,
) {
  const next = prefix ? (await customerSearchService.nextNumber(prefix)).nextAccountNumber : null;
  const who = usedBy.map((u) => `${u.customerName || '(no name)'} (${u.shop.code})`).join(', ');
  return new CustomerSearchError(
    `Account Number ${accountNumber} is already used for ${who}${next ? `. The next free one is ${next}` : ''}.`,
    409,
    { code: 'duplicate_account', nextAccountNumber: next, usedBy: usedBy.map((u) => ({ id: u.id, customerName: u.customerName, shopCode: u.shop.code })) },
  );
}
