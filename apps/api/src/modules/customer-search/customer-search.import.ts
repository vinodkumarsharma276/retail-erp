import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/database.js';
import { tenantContext } from '../../config/tenant-context.js';
import { generateCustomerCode } from '../../utils/id-generator.js';
import {
  isIsoDate,
  isValidMobile,
  mobileProblem,
  normalizeMobile,
  parseAccountNumber,
  parseSheetDate,
  personNameKey,
  REGISTER_ISSUES,
  tidyName,
  type RegisterIssue,
} from '@retailerp/shared-utils';
import { moveCustomersWithEntry, refreshIssues, rowIssues, type RawValues } from './customer-search.issues.js';
import {
  borderlinePairs,
  buildVariants,
  outcomesFor,
  personPairKey,
  suggestGroup,
  validResolution,
  variantFor,
  type ExistingCustomer,
  type NameGroup,
  type PersonMention,
  type PersonOutcome,
  type Resolution,
  type Variant,
} from './customer-search.matching.js';
import { adjudicatePersonNames, customerNameAdjudicatorEnabled } from './customer-name-adjudicator.js';
import { siblingClash, clashMessage } from '../categories/categories.service.js';
import {
  categoryPaths,
  categorySlug,
  defaultDecision,
  matchProductTexts,
  productTextKey,
  TYPE_PATH_SEPARATOR,
  type ProductTypeDecision,
} from './customer-search.product-types.js';
import type { ImportCommitInput, ImportPreviewInput, ImportRow } from './customer-search.validation.js';

/**
 * Bringing the Google Sheet register in, a range of rows at a time.
 *
 * Preview and commit run the same checks; preview saves nothing and asks a
 * model about borderline name pairs, commit applies the person's choices.
 *
 * The sheet is taken as it is: a reused account number, a missing mobile or
 * an unreadable date doesn't stop a row — it is imported and listed under
 * "Needs review" with what is wrong. Only a Shop the business doesn't have
 * stops a row. Re-importing a range is safe: a row already in the register
 * (same account number, name and mobile) is skipped, or moved when its Shop
 * changed.
 */

export class ImportError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

/** `move`: already in the register under another shop; importing moves it. */
export type RowStatus = 'new' | 'exists' | 'move' | 'invalid';

export interface PersonMatch {
  /** `existing`: links to that customer; `new`: will be created; `group`: depends on the name choices for the mobile. */
  kind: 'existing' | 'new' | 'group';
  variantKey: string;
  customerId?: string;
  customerCode?: string;
}

export interface ShopRef {
  id: string;
  name: string;
  code: string;
}

export interface AnalysedRow extends ImportRow {
  status: RowStatus;
  errors: string[];
  warnings: string[];
  /** Review problems the entry will carry (product type is decided separately). */
  issues: RegisterIssue[];
  shopCode: string | null;
  /** For `move`: the shop it is in now. */
  moveFrom?: string;
  normalized?: {
    accountNumber: string;
    prefix: string;
    seriesNo: number | null;
    customerName: string;
    /** 10 digits, or '' when there is no valid mobile. */
    mobile: string;
    coName: string | null;
    /** Set only when valid; an invalid co-applicant mobile is kept on `coMobileText`. */
    coMobile: string | null;
    coMobileText: string | null;
    purchaseDate: string | null;
    shopId: string;
    rawValues: RawValues;
    /** Identifies "the same row" across imports. */
    key: string;
    /** For `move`: the entry to move. */
    moveEntryId?: string;
  };
  customer?: PersonMatch;
  co?: PersonMatch;
}

export interface Analysis {
  rows: AnalysedRow[];
  groups: NameGroup[];
  variantsByMobile: Map<string, Variant[]>;
  aiUsed: boolean;
  /** Borderline pairs were sent to the model (it may still have failed to answer). */
  aiAsked: boolean;
}

const shopKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** A Shop cell to a shop: by name or code, ignoring case, spaces and punctuation. */
export function resolveShop(text: string, shops: ShopRef[], defaultShopId: string): ShopRef | null {
  const key = shopKey(text);
  if (!key) return shops.find((s) => s.id === defaultShopId) ?? null;
  return shops.find((s) => shopKey(s.name) === key || shopKey(s.code) === key) ?? null;
}

/**
 * What makes two rows the same row: account number, name and mobile — and,
 * for rows with no account number, the purchase date too.
 */
export function rowKey(accountNumber: string, name: string, mobile: string, purchaseDate: string | null): string {
  return [accountNumber, personNameKey(name), mobile, accountNumber ? '' : purchaseDate ?? ''].join('|');
}

const toIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function checkRow(row: ImportRow, shops: ShopRef[], defaultShopId: string): AnalysedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw: RawValues = {};
  const acc = parseAccountNumber(row.accountNumber);
  if (acc.accountNumber.length > 30) errors.push('Account Number is longer than 30 characters');

  const customerName = tidyName(row.customerName).slice(0, 200);

  const problem = mobileProblem(row.mobile);
  const mobile = problem ? '' : normalizeMobile(row.mobile);
  if (problem && row.mobile.trim()) raw.mobile = row.mobile.trim().slice(0, 30);

  let purchaseDate: string | null = null;
  if (row.purchaseDate.trim()) {
    const parsed = parseSheetDate(row.purchaseDate);
    purchaseDate = parsed && isIsoDate(parsed) ? parsed : null;
    if (!purchaseDate) raw.purchaseDate = row.purchaseDate.trim().slice(0, 30);
  }

  const coName = tidyName(row.coName).slice(0, 200) || null;
  const coMobileText = row.coMobile.trim() || null;
  let coMobile: string | null = null;
  if (coMobileText) {
    if (isValidMobile(coMobileText)) coMobile = normalizeMobile(coMobileText);
    else raw.coMobile = coMobileText.slice(0, 30);
  }

  const shop = resolveShop(row.shop ?? '', shops, defaultShopId);
  if (!shop) errors.push(`Shop "${row.shop}" isn't one of this business's shops`);

  const normalized = {
    accountNumber: acc.accountNumber,
    prefix: acc.prefix,
    seriesNo: acc.seriesNo,
    customerName,
    mobile,
    coName,
    coMobile: coName ? coMobile : null,
    coMobileText: coMobile ?? coMobileText,
    purchaseDate,
    shopId: shop?.id ?? '',
    rawValues: raw,
    key: rowKey(acc.accountNumber, customerName, mobile, purchaseDate),
  };
  const issues = rowIssues({
    ...normalized,
    coCustomerId: coName && coMobile ? 'will-link' : null,
    purchaseDate: purchaseDate ? new Date(`${purchaseDate}T00:00:00Z`) : null,
    // The product type is matched separately; don't flag it per row here.
    categoryId: 'decided-separately',
  });
  for (const issue of issues) warnings.push(REGISTER_ISSUES[issue]);

  return {
    ...row,
    status: errors.length ? 'invalid' : 'new',
    errors,
    warnings,
    issues,
    shopCode: shop?.code ?? null,
    normalized,
  };
}

export async function analyseRows(
  rows: ImportRow[],
  options: { useAi: boolean; defaultShopId: string },
): Promise<Analysis> {
  const shops = await prisma.shop.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true } });
  const analysed = rows.map((r) => checkRow(r, shops, options.defaultShopId));
  const codeOf = new Map(shops.map((s) => [s.id, s.code]));

  // The same row twice in the range: the later copy is skipped.
  const firstByKey = new Map<string, AnalysedRow>();
  for (const r of analysed) {
    if (r.status !== 'new') continue;
    const first = firstByKey.get(r.normalized!.key);
    if (first) {
      r.status = 'exists';
      r.warnings = [`Same as record ${first.recordNo}`];
    } else {
      firstByKey.set(r.normalized!.key, r);
    }
  }

  // Already in the register: skip it, or move it when its shop changed.
  const numbers = [...new Set(analysed.map((r) => r.normalized!.accountNumber).filter(Boolean))];
  const blankNumberNames = [...new Set(analysed.filter((r) => !r.normalized!.accountNumber).map((r) => r.normalized!.customerName))];
  const existingEntries =
    numbers.length || blankNumberNames.length
      ? await prisma.customerSearchEntry.findMany({
          where: {
            OR: [
              ...(numbers.length ? [{ accountNumber: { in: numbers } }] : []),
              ...(blankNumberNames.length ? [{ accountNumber: '', customerName: { in: blankNumberNames } }] : []),
            ],
          },
          select: { id: true, accountNumber: true, customerName: true, mobile: true, purchaseDate: true, shopId: true },
        })
      : [];
  const existingByKey = new Map(existingEntries.map((e) => [rowKey(e.accountNumber, e.customerName, e.mobile, toIso(e.purchaseDate)), e]));
  const othersByNumber = new Map<string, typeof existingEntries>();
  for (const e of existingEntries) {
    if (e.accountNumber) othersByNumber.set(e.accountNumber, [...(othersByNumber.get(e.accountNumber) ?? []), e]);
  }
  for (const r of analysed) {
    if (r.status !== 'new') continue;
    const n = r.normalized!;
    const prior = existingByKey.get(n.key);
    if (prior) {
      if (prior.shopId === n.shopId) {
        r.status = 'exists';
        r.warnings = [];
      } else {
        r.status = 'move';
        r.moveFrom = codeOf.get(prior.shopId) ?? '?';
        n.moveEntryId = prior.id;
        r.warnings = [`Moves from ${r.moveFrom} to ${r.shopCode}`];
      }
    }
  }

  // Reused account numbers: allowed, but flagged on every entry that shares one.
  const inRange = new Map<string, AnalysedRow[]>();
  for (const r of analysed) {
    if (r.status === 'new' && r.normalized!.accountNumber) {
      inRange.set(r.normalized!.accountNumber, [...(inRange.get(r.normalized!.accountNumber) ?? []), r]);
    }
  }
  for (const [number, list] of inRange) {
    const others = othersByNumber.get(number) ?? [];
    if (list.length + others.length < 2) continue;
    for (const r of list) {
      const names = [
        ...others.map((o) => `${o.customerName || '(no name)'} (in the register)`),
        ...list.filter((l) => l !== r).map((l) => `${l.normalized!.customerName || '(no name)'} (record ${l.recordNo})`),
      ];
      if (!r.issues.includes('duplicate_account')) r.issues = ['duplicate_account', ...r.issues];
      r.warnings.unshift(`${number} is also used for ${names.join(', ')}`);
    }
  }

  // Everyone the new rows name, grouped by mobile with existing customers.
  const fresh = analysed.filter((r) => r.status === 'new');
  const mentions: PersonMention[] = [];
  for (const r of fresh) {
    const n = r.normalized!;
    mentions.push({ name: n.customerName, mobile: n.mobile });
    if (n.coName && n.coMobile) mentions.push({ name: n.coName, mobile: n.coMobile });
  }
  const mobiles = [...new Set(mentions.map((m) => m.mobile))];
  const customers = mobiles.length
    ? await prisma.customer.findMany({
        where: { phone: { in: mobiles } },
        select: { id: true, name: true, phone: true, customerCode: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const existing: ExistingCustomer[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    mobile: normalizeMobile(c.phone),
    customerCode: c.customerCode,
  }));
  const variantsByMobile = buildVariants(mentions, existing);

  const groupMobiles = [...variantsByMobile.entries()]
    .filter(([, vs]) => vs.length > 1 && vs.some((v) => !v.customerId))
    .map(([m]) => m);

  const aiVerdicts = new Map<string, { same: boolean; reason?: string }>();
  let aiUsed = false;
  let aiAsked = false;
  if (options.useAi && customerNameAdjudicatorEnabled()) {
    const pairs = groupMobiles.flatMap((m) => borderlinePairs(variantsByMobile.get(m)!));
    const unique = [...new Map(pairs.map((p) => [personPairKey(p.a, p.b), p])).values()];
    if (unique.length) {
      aiAsked = true;
      const verdicts = await adjudicatePersonNames(unique);
      for (const v of verdicts) aiVerdicts.set(personPairKey(v.a, v.b), { same: v.same, reason: v.reason });
      aiUsed = verdicts.length > 0;
    }
  }
  const groups = groupMobiles.map((m) => suggestGroup(m, variantsByMobile.get(m)!, aiVerdicts));
  const grouped = new Set(groupMobiles);

  const match = (name: string, mobile: string): PersonMatch | undefined => {
    const variant = variantFor(variantsByMobile.get(mobile) ?? [], name);
    if (!variant) return undefined;
    if (grouped.has(mobile)) return { kind: 'group', variantKey: variant.key };
    return variant.customerId
      ? { kind: 'existing', variantKey: variant.key, customerId: variant.customerId, customerCode: variant.customerCode }
      : { kind: 'new', variantKey: variant.key };
  };
  for (const r of fresh) {
    const n = r.normalized!;
    r.customer = match(n.customerName, n.mobile);
    if (n.coName && n.coMobile) r.co = match(n.coName, n.coMobile);
  }

  return { rows: analysed, groups, variantsByMobile, aiUsed, aiAsked };
}

export function summarise(analysis: Analysis) {
  const count = (s: RowStatus) => analysis.rows.filter((r) => r.status === s).length;
  return {
    total: analysis.rows.length,
    new: count('new'),
    exists: count('exists'),
    move: count('move'),
    invalid: count('invalid'),
    /** New rows that will be listed under "Needs review" (product type not counted). */
    flagged: analysis.rows.filter((r) => r.status === 'new' && r.issues.length > 0).length,
    groups: analysis.groups.length,
    groupsNeedingReview: analysis.groups.filter((g) => g.needsReview).length,
    aiUsed: analysis.aiUsed,
    aiFailed: analysis.aiAsked && !analysis.aiUsed,
    aiAvailable: customerNameAdjudicatorEnabled(),
  };
}

/** Product texts of the rows about to be imported, matched to the tenant's top-level types. */
async function productTypeMatches(rows: AnalysedRow[]) {
  const [all, mappings] = await Promise.all([
    prisma.productCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, parentId: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.customerSearchProductMapping.findMany({ select: { textKey: true, categoryId: true } }),
  ]);
  const topLevel = all.filter((c) => !c.parentId);
  const pathOf = categoryPaths(all);
  const deeper = all
    .filter((c) => c.parentId)
    .map((c) => ({ id: c.id, name: c.name, pathLabel: (pathOf(c.id) ?? [c.name]).join(TYPE_PATH_SEPARATOR) }));
  const texts = rows.filter((r) => r.status === 'new').map((r) => r.product);
  const matches = matchProductTexts(texts, topLevel, new Map(mappings.map((m) => [m.textKey, m.categoryId])), deeper);
  return { matches, topLevel };
}

export async function previewImport(input: ImportPreviewInput) {
  const analysis = await analyseRows(input.rows, { useAi: true, defaultShopId: input.shopId });
  const { matches, topLevel } = await productTypeMatches(analysis.rows);
  return {
    rows: analysis.rows.map(({ normalized: _n, ...rest }) => rest),
    groups: analysis.groups,
    productTypes: matches,
    topLevelTypes: topLevel.map((t) => ({ id: t.id, name: t.name })),
    summary: { ...summarise(analysis), newProductTypes: matches.filter((m) => m.kind === 'new').length },
  };
}

async function assertShopAccess(userId: string, shopId: string) {
  const access = await prisma.userShop.findFirst({
    where: { userId, shopId, shop: { isActive: true } },
    select: { id: true },
  });
  if (!access) throw new ImportError('You do not have access to that shop', 403);
}

/** Resolve every mobile: the person's choices for name groups, one customer per name elsewhere. */
function resolveOutcomes(analysis: Analysis, given: Record<string, Resolution>) {
  const groupByMobile = new Map(analysis.groups.map((g) => [g.mobile, g]));
  const outcomes = new Map<string, Map<string, PersonOutcome>>();
  const decisions: Record<string, Resolution> = {};
  for (const [mobile, variants] of analysis.variantsByMobile) {
    const group = groupByMobile.get(mobile);
    let resolution: Resolution;
    if (group) {
      const provided = given[mobile];
      const valid = validResolution(variants, provided);
      if (provided && !valid) {
        throw new ImportError(`The name choices for mobile ${mobile} no longer match the rows. Preview again.`);
      }
      resolution = valid ?? group.suggestion;
      decisions[mobile] = resolution;
    } else {
      resolution = Object.fromEntries(variants.map((v) => [v.key, v.key]));
    }
    outcomes.set(mobile, outcomesFor(mobile, variants, resolution));
  }
  return { outcomes, decisions };
}

export async function commitImport(input: ImportCommitInput, userId: string, options: { canCreateTypes: boolean }) {
  await assertShopAccess(userId, input.shopId);
  const analysis = await analyseRows(input.rows, { useAi: false, defaultShopId: input.shopId });
  const { outcomes, decisions } = resolveOutcomes(analysis, input.resolutions);
  const fresh = analysis.rows.filter((r) => r.status === 'new');
  const moving = analysis.rows.filter((r) => r.status === 'move');
  for (const shopId of new Set([...fresh, ...moving].map((r) => r.normalized!.shopId))) {
    if (shopId !== input.shopId) await assertShopAccess(userId, shopId);
  }

  // What each Product text means: the person's choice, else the obvious match.
  const { matches } = await productTypeMatches(analysis.rows);
  const typeDecisions = new Map<string, ProductTypeDecision>(
    matches.map((m) => [m.textKey, input.productTypes[m.textKey] ?? defaultDecision(m)]),
  );
  if (!options.canCreateTypes && [...typeDecisions.values()].some((d) => d.action === 'create')) {
    throw new ImportError('You are not allowed to create product types. Pick an existing type or leave it blank.', 403);
  }

  const outcomeOf = (name: string, mobile: string) => {
    const variant = variantFor(analysis.variantsByMobile.get(mobile) ?? [], name);
    return variant ? outcomes.get(mobile)?.get(variant.key) : undefined;
  };

  return prisma.$transaction(
    async (tx) => {
      const last = await tx.customer.findFirst({
        where: { customerCode: { startsWith: 'CUST-' } },
        orderBy: { customerCode: 'desc' },
        select: { customerCode: true },
      });
      let lastCode = last?.customerCode;

      type NewCustomer = {
        id: string;
        customerCode: string;
        name: string;
        phone: string;
        addressLine1: string | null;
        addressLine2: string | null;
        isGuarantor: boolean;
        shopId: string;
        createdBy: string;
      };
      const created = new Map<string, NewCustomer>();
      const linked = new Set<string>();
      const renames = new Map<string, string>();
      const guarantors = new Set<string>();

      const customerIdFor = (
        outcome: PersonOutcome | undefined,
        mobile: string,
        asGuarantor: boolean,
        address: { line1: string | null; line2: string | null },
        shopId: string,
      ): string | null => {
        if (!outcome) return null;
        if (outcome.kind === 'existing') {
          linked.add(outcome.customerId);
          if (outcome.rename) renames.set(outcome.customerId, outcome.rename);
          if (asGuarantor) guarantors.add(outcome.customerId);
          return outcome.customerId;
        }
        let row = created.get(outcome.ref);
        if (!row) {
          lastCode = generateCustomerCode(lastCode ?? undefined);
          row = {
            id: randomUUID(),
            customerCode: lastCode,
            name: outcome.name,
            phone: mobile,
            addressLine1: null,
            addressLine2: null,
            isGuarantor: false,
            shopId,
            createdBy: userId,
          };
          created.set(outcome.ref, row);
        }
        if (asGuarantor) row.isGuarantor = true;
        if (!row.addressLine1 && address.line1) row.addressLine1 = address.line1;
        if (!row.addressLine2 && address.line2) row.addressLine2 = address.line2;
        return row.id;
      };

      const batchId = randomUUID();

      // Product types: create the confirmed new top-level ones, check the
      // chosen existing ones are this tenant's, and remember every decision.
      const topLevel = await tx.productCategory.findMany({
        where: { parentId: null },
        select: { id: true, name: true, slug: true, isActive: true },
      });
      const typeIdByKey = new Map<string, string | null>();
      const createdTypes = new Map<string, string>();
      let typesCreated = 0;
      const tenantId = tenantContext.currentTenantId()!;
      const chosenIds = [...typeDecisions.values()].flatMap((d) => (d.action === 'existing' ? [d.categoryId] : []));
      const known = new Set(
        chosenIds.length
          ? (await tx.productCategory.findMany({ where: { id: { in: chosenIds } }, select: { id: true } })).map((c) => c.id)
          : [],
      );
      for (const [key, decision] of typeDecisions) {
        if (decision.action === 'blank') {
          typeIdByKey.set(key, null);
        } else if (decision.action === 'existing') {
          if (!known.has(decision.categoryId)) throw new ImportError(`The product type chosen for "${key}" no longer exists. Preview again.`);
          typeIdByKey.set(key, decision.categoryId);
        } else {
          const name = decision.name.replace(/\s+/g, ' ').trim();
          const nameKey = productTextKey(name);
          let id = createdTypes.get(nameKey);
          if (!id) {
            const slug = categorySlug(name);
            if (!slug) throw new ImportError(`"${name}" can't be a product type name.`);
            const clash = siblingClash(topLevel, { name, slug });
            if (clash && !clash.isActive) throw new ImportError(clashMessage(clash, null));
            if (clash) {
              id = clash.id;
            } else {
              const made = await tx.productCategory.create({
                data: { name, slug, parentId: null, level: 0, path: slug, isLeaf: true, purchaseModes: 'billed' } as any,
                select: { id: true, name: true, slug: true, isActive: true },
              });
              topLevel.push(made);
              id = made.id;
              typesCreated += 1;
            }
            createdTypes.set(nameKey, id);
          }
          typeIdByKey.set(key, id);
        }
        await tx.customerSearchProductMapping.upsert({
          where: { tenantId_textKey: { tenantId, textKey: key } },
          update: { categoryId: typeIdByKey.get(key) ?? null },
          create: { textKey: key, categoryId: typeIdByKey.get(key) ?? null, createdBy: userId } as any,
        });
      }

      const entries = fresh.map((r) => {
        const n = r.normalized!;
        const address = { line1: r.address ? r.address.slice(0, 255) : null, line2: r.area ? r.area.slice(0, 255) : null };
        // A name with no usable mobile can't be matched to anyone: it is a customer of its own.
        const ownOutcome: PersonOutcome | undefined =
          !n.mobile && personNameKey(n.customerName) ? { kind: 'new', ref: `row:${r.recordNo}`, name: n.customerName } : undefined;
        const customerId = customerIdFor(ownOutcome ?? outcomeOf(n.customerName, n.mobile), n.mobile, false, address, n.shopId);
        const coCustomerId =
          n.coName && n.coMobile
            ? customerIdFor(outcomeOf(n.coName, n.coMobile), n.coMobile, true, { line1: null, line2: null }, n.shopId)
            : null;
        const purchaseDate = n.purchaseDate ? new Date(`${n.purchaseDate}T00:00:00Z`) : null;
        const categoryId = typeIdByKey.get(productTextKey(r.product)) ?? null;
        const coMobile = n.coMobile;
        return {
          id: randomUUID(),
          shopId: n.shopId,
          accountNumber: n.accountNumber,
          prefix: n.prefix,
          seriesNo: n.seriesNo,
          customerId,
          customerName: n.customerName,
          mobile: n.mobile,
          address: r.address ? r.address.slice(0, 500) : null,
          area: r.area ? r.area.slice(0, 100) : null,
          coCustomerId,
          coName: n.coName,
          coMobile,
          purchaseDate,
          categoryId,
          product: r.product ? r.product.slice(0, 200) : null,
          brand: r.brand ? r.brand.slice(0, 100) : null,
          model: r.model ? r.model.slice(0, 200) : null,
          issues: rowIssues({ ...n, coMobile, coCustomerId, purchaseDate, categoryId }),
          rawValues: Object.keys(n.rawValues).length ? n.rawValues : undefined,
          source: 'import',
          importBatchId: batchId,
          sheetRowNumber: r.sheetRow,
          createdBy: userId,
          updatedBy: userId,
        };
      });

      if (created.size) {
        await tx.customer.createMany({ data: [...created.values()] as any });
      }
      for (const [id, name] of renames) {
        await tx.customer.update({ where: { id }, data: { name } });
      }
      if (guarantors.size) {
        await tx.customer.updateMany({ where: { id: { in: [...guarantors] }, isGuarantor: false }, data: { isGuarantor: true } });
      }

      await tx.customerSearchImportBatch.create({
        data: {
          id: batchId,
          shopId: input.shopId,
          fileName: input.fileName,
          rowFrom: input.rowFrom,
          rowTo: input.rowTo,
          nameDecisions: decisions as any,
          createdBy: userId,
        } as any,
      });
      if (entries.length) await tx.customerSearchEntry.createMany({ data: entries as any });

      // Rows already in the register whose Shop changed: move them, and their
      // customers when nothing else keeps those in the old shop.
      for (const r of moving) {
        const entry = await tx.customerSearchEntry.update({
          where: { id: r.normalized!.moveEntryId! },
          data: { shopId: r.normalized!.shopId, updatedBy: userId },
          select: { customerId: true, coCustomerId: true },
        });
        await moveCustomersWithEntry(tx, [entry.customerId, entry.coCustomerId], r.normalized!.shopId);
      }

      // Flag reused account numbers on these entries and on the ones they share a number with.
      await refreshIssues(tx, { accountNumbers: entries.map((e) => e.accountNumber) });
      const flagged = entries.length
        ? await tx.customerSearchEntry.count({ where: { importBatchId: batchId, NOT: { issues: { isEmpty: true } } } })
        : 0;

      const result = {
        batchId,
        inserted: entries.length,
        skipped: analysis.rows.filter((r) => r.status === 'exists').length,
        moved: moving.length,
        invalid: analysis.rows.filter((r) => r.status === 'invalid').length,
        flagged,
        customersCreated: created.size,
        customersLinked: linked.size,
        productTypesCreated: typesCreated,
      };
      await tx.customerSearchImportBatch.update({
        where: { id: batchId },
        data: {
          inserted: result.inserted,
          skipped: result.skipped,
          invalid: result.invalid,
          moved: result.moved,
          flagged: result.flagged,
          customersCreated: result.customersCreated,
          customersLinked: result.customersLinked,
        },
      });
      return result;
    },
    { timeout: 180_000, maxWait: 10_000 },
  );
}
