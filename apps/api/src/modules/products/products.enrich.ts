import type { Prisma } from '@prisma/client';
import type {
  EnrichedAttribute,
  ProductEnrichBatchModel,
  ProductEnrichBatchResult,
  ProductEnrichBatchStatus,
  ProductEnrichResult,
} from '@retailerp/shared-types';
import { prisma } from '../../config/database.js';
import { config } from '../../config/index.js';
import {
  resolveProductSpecsByWebSearch,
  type SpecAttributeDef,
} from '../ocr/providers/openai-vision.provider.js';

/**
 * Filling in a product's specifications from the web, on demand.
 *
 * A Tally purchase register has no specification column of any kind — only
 * cost — so a unit imported from one arrives with every category attribute
 * empty and no real MRP. Looking each model up during the import was tried
 * and dropped: a single month's register names around 200 distinct models,
 * and a web search apiece made the import unusably slow.
 *
 * So it is a separate action, asked for after the fact: one product from its
 * detail page, or a whole import run from the screen that just imported it.
 * The lookup itself is the OCR module's `resolveProductSpecsByWebSearch`,
 * which already constrains its answers to a category's own attributes and
 * their allowed options.
 *
 * Two rules hold throughout: a value somebody entered is never overwritten,
 * and no price is ever written. An MRP found on the web is kept as
 * `mrpSuggestion` for a human to accept or ignore, because retail sites
 * disagree about Indian MRPs often enough that writing one silently would be
 * worse than leaving the unit at cost.
 */

/** Models looked up at once. The same cap the item classifier uses. */
const CONCURRENCY = 3;
/** Models per pass of an import run, when the caller does not say. */
const DEFAULT_BATCH_LIMIT = 10;
const MAX_BATCH_LIMIT = 50;

/**
 * Pseudo-attribute used to ask the spec resolver for an MRP alongside the
 * real attributes, rather than standing up a second web-search call for it.
 * It is stripped out of the answer before anything is merged.
 */
const MRP_LOOKUP_KEY = '__mrp';
const MRP_LOOKUP_ATTR: SpecAttributeDef = {
  attributeName: MRP_LOOKUP_KEY,
  attributeLabel: 'Official MRP in Indian rupees — digits only, no symbol, no commas',
  attributeType: 'number',
};

/** Marker left on a unit so a later pass need not pay for the same search. */
const LOOKED_UP_AT_KEY = 'specsLookedUpAt';
/** Where an MRP found on the web is parked for a human to confirm. */
export const MRP_SUGGESTION_KEY = 'mrpSuggestion';

export const enrichEnabled = () => config.ocr.openAiApiKey.length > 0;

const NOT_CONFIGURED =
  'Fetching product details is switched off. Set OPENAI_API_KEY to look specifications up on the web, or fill them in by hand.';

type Attributes = Record<string, unknown>;

/** The shop scope a request carries, as `shopScope` leaves it on the request. */
export interface EnrichScope {
  tenantId: string;
  shopId: string;
  allShops?: boolean;
  shopIds?: string[];
}

function shopWhere(scope: EnrichScope): Prisma.ProductWhereInput {
  return scope.allShops && scope.shopIds?.length
    ? { tenantId: scope.tenantId, shopId: { in: scope.shopIds } }
    : { tenantId: scope.tenantId, shopId: scope.shopId };
}

function attributesOf(product: { dynamicAttributes: Prisma.JsonValue }): Attributes {
  const raw = product.dynamicAttributes;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Attributes) } : {};
}

/** Empty means: never set, cleared, or an empty list. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

type CategoryAttributeRow = {
  attributeName: string;
  attributeLabel: string;
  attributeType: unknown;
  options: Prisma.JsonValue;
};

/**
 * The attributes a web lookup can sensibly fill. Per-unit identifiers (IMEI,
 * serial numbers) belong to the box in the shop, not to the model, so they
 * are left out — the same rule the invoice scan applies.
 */
function specAttributes(attributes: CategoryAttributeRow[]): SpecAttributeDef[] {
  return attributes
    .filter((a) => String(a.attributeType) !== 'multi_text' && !/imei|serial/i.test(a.attributeName))
    .map((a) => ({
      attributeName: a.attributeName,
      attributeLabel: a.attributeLabel,
      attributeType: String(a.attributeType),
      options: Array.isArray(a.options)
        ? (a.options as unknown[]).map((o) =>
            typeof o === 'object' && o !== null ? String((o as Record<string, unknown>).value ?? o) : String(o),
          )
        : undefined,
    }));
}

/** True when the unit was imported at cost and has no suggestion yet. */
function wantsMrp(attributes: Attributes): boolean {
  return attributes.priceNotSet === true && isBlank(attributes[MRP_SUGGESTION_KEY]);
}

export function parseMrp(raw: string | undefined): number | null {
  if (!raw) return null;
  // An answer can arrive as "24990", "Rs. 24,990" or "₹24,990.00", so the
  // separators come out and the first number is taken.
  const digits = raw.replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0];
  if (!digits) return null;
  const value = Number(digits);
  // A plausible retail MRP, so an obvious misread does not reach the screen.
  if (!Number.isFinite(value) || value < 100 || value > 10_000_000) return null;
  return Math.round(value);
}

/**
 * Apply one model's answers to one unit's attributes.
 *
 * The whole promise of this feature lives here: a key that already holds
 * anything is left as it stands, so a value typed in by hand always wins over
 * whatever the web says, however many times the lookup is run. An MRP is
 * parked under its own key and never touched again once set.
 */
export function mergeIntoAttributes(
  current: Attributes,
  specs: Record<string, string>,
  mrp: number | null,
  lookedUpAt: string,
): { next: Attributes; filled: string[] } {
  const next: Attributes = { ...current };
  const filled: string[] = [];

  for (const [name, value] of Object.entries(specs)) {
    if (!isBlank(next[name])) continue;
    next[name] = value;
    filled.push(name);
  }
  if (mrp !== null && wantsMrp(next)) next[MRP_SUGGESTION_KEY] = mrp;
  next[LOOKED_UP_AT_KEY] = lookedUpAt;

  return { next, filled };
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Ask the web for one model's specifications.
 *
 * `blanks` are the attributes worth asking about — the ones still empty.
 * Returns the answers keyed by attribute name, plus an MRP when one was
 * asked for and came back believable.
 */
async function lookUpModel(args: {
  brand: string;
  modelNumber: string;
  categoryName: string | null;
  blanks: SpecAttributeDef[];
  askForMrp: boolean;
}): Promise<{ specs: Record<string, string>; mrp: number | null }> {
  const attributes = args.askForMrp ? [...args.blanks, MRP_LOOKUP_ATTR] : args.blanks;
  if (attributes.length === 0) return { specs: {}, mrp: null };

  const answer = await resolveProductSpecsByWebSearch({
    brand: args.brand,
    modelNumber: args.modelNumber,
    categoryName: args.categoryName,
    attributes,
  });

  const { [MRP_LOOKUP_KEY]: rawMrp, ...specs } = answer;
  return { specs, mrp: args.askForMrp ? parseMrp(rawMrp) : null };
}

export const productEnrichService = {
  /**
   * Fill in one product's empty specifications from the web.
   *
   * Returns null when the product is outside the caller's tenant or shops, so
   * the controller can answer 404 without leaking that it exists elsewhere.
   */
  async enrichProduct(productId: string, scope: EnrichScope): Promise<ProductEnrichResult | null> {
    const product = await prisma.product.findFirst({
      where: { id: productId, ...shopWhere(scope) },
      select: {
        id: true,
        brand: true,
        modelNumber: true,
        dynamicAttributes: true,
        category: {
          select: {
            name: true,
            attributes: {
              where: { isActive: true },
              orderBy: { displayOrder: 'asc' },
              select: {
                attributeName: true,
                attributeLabel: true,
                attributeType: true,
                options: true,
              },
            },
          },
        },
      },
    });
    if (!product) return null;

    const attributes = attributesOf(product);
    const defs = specAttributes(product.category.attributes);
    const labelOf = new Map(defs.map((d) => [d.attributeName, d.attributeLabel]));

    const blanks = defs.filter((d) => isBlank(attributes[d.attributeName]));
    const kept: EnrichedAttribute[] = defs
      .filter((d) => !isBlank(attributes[d.attributeName]))
      .map((d) => ({
        attributeName: d.attributeName,
        label: d.attributeLabel,
        value: String(attributes[d.attributeName]),
      }));
    const askForMrp = wantsMrp(attributes);

    const base: ProductEnrichResult = {
      productId: product.id,
      brand: product.brand,
      modelNumber: product.modelNumber,
      categoryName: product.category.name,
      filled: [],
      kept,
      unresolved: [],
      mrpSuggestion: isBlank(attributes[MRP_SUGGESTION_KEY])
        ? null
        : Number(attributes[MRP_SUGGESTION_KEY]) || null,
      aiEnabled: enrichEnabled(),
    };

    if (!enrichEnabled()) {
      return { ...base, message: NOT_CONFIGURED };
    }
    if (blanks.length === 0 && !askForMrp) {
      return {
        ...base,
        message:
          defs.length === 0
            ? 'This category has no specification fields to fill in.'
            : 'Every detail for this product is already filled in. Nothing was changed.',
      };
    }
    if (!product.modelNumber.trim()) {
      return { ...base, message: 'This product has no model number, so there is nothing to search for.' };
    }

    const { specs, mrp } = await lookUpModel({
      brand: product.brand,
      modelNumber: product.modelNumber.trim(),
      categoryName: product.category.name,
      blanks,
      askForMrp,
    });

    const { next, filled: filledNames } = mergeIntoAttributes(
      attributes,
      specs,
      mrp,
      new Date().toISOString(),
    );
    const filled: EnrichedAttribute[] = filledNames.map((name) => ({
      attributeName: name,
      label: labelOf.get(name) ?? name,
      value: String(next[name]),
    }));

    await prisma.product.update({
      where: { id: product.id },
      data: { dynamicAttributes: next as Prisma.InputJsonValue },
    });

    const unresolved = blanks
      .filter((d) => isBlank(next[d.attributeName]))
      .map((d) => ({ attributeName: d.attributeName, label: d.attributeLabel }));

    return {
      ...base,
      filled,
      unresolved,
      mrpSuggestion: mrp ?? base.mrpSuggestion,
      message:
        filled.length === 0 && mrp === null
          ? 'The search found nothing definite for this model. Nothing was changed.'
          : undefined,
    };
  },

  /** How much of an import run still has no specifications. */
  async batchStatus(batchId: string, scope: EnrichScope): Promise<ProductEnrichBatchStatus | null> {
    const batch = await prisma.purchaseImportBatch.findFirst({
      where: {
        id: batchId,
        tenantId: scope.tenantId,
        ...(scope.allShops && scope.shopIds?.length
          ? { shopId: { in: scope.shopIds } }
          : { shopId: scope.shopId }),
      },
      select: { id: true, fileName: true },
    });
    if (!batch) return null;

    const groups = await loadBatchGroups(batchId, scope);
    const pending = groups.filter((group) => group.pending(false));

    return {
      batchId: batch.id,
      fileName: batch.fileName,
      totalModels: groups.length,
      pendingModels: pending.length,
      pendingUnits: pending.reduce((sum, group) => sum + group.units.length, 0),
      aiEnabled: enrichEnabled(),
    };
  },

  /**
   * Look up the next few models of an import run.
   *
   * The importer writes one product row per unit, so the same model can
   * appear thirty times; the lookup is done once per brand + model and the
   * answer applied to every unit of it. Each pass reports how many models are
   * still waiting, which is how the screen shows progress — and because only
   * empty fields are ever filled, stopping and running it again simply picks
   * up where it left off.
   */
  async enrichBatch(
    batchId: string,
    scope: EnrichScope,
    options: { limit?: number; refresh?: boolean } = {},
  ): Promise<ProductEnrichBatchResult | null> {
    const batch = await prisma.purchaseImportBatch.findFirst({
      where: {
        id: batchId,
        tenantId: scope.tenantId,
        ...(scope.allShops && scope.shopIds?.length
          ? { shopId: { in: scope.shopIds } }
          : { shopId: scope.shopId }),
      },
      select: { id: true },
    });
    if (!batch) return null;

    const refresh = options.refresh === true;
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_BATCH_LIMIT), 1), MAX_BATCH_LIMIT);

    const groups = await loadBatchGroups(batchId, scope);
    const pending = groups.filter((group) => group.pending(refresh));

    if (!enrichEnabled()) {
      return {
        batchId: batch.id,
        models: [],
        remainingModels: pending.length,
        unitsUpdated: 0,
        aiEnabled: false,
        message: NOT_CONFIGURED,
      };
    }

    const thisPass = pending.slice(0, limit);
    const models = await mapLimit(thisPass, CONCURRENCY, (group) => enrichGroup(group));

    return {
      batchId: batch.id,
      models,
      remainingModels: pending.length - thisPass.length,
      unitsUpdated: models.reduce((sum, model) => sum + model.unitsUpdated, 0),
      aiEnabled: true,
    };
  },
};

// ---------------------------------------------------------------------------
// Grouping an import run by brand + model
// ---------------------------------------------------------------------------

interface BatchUnit {
  id: string;
  attributes: Attributes;
  lookedUp: boolean;
}

interface BatchGroup {
  brand: string;
  modelNumber: string;
  categoryName: string | null;
  defs: SpecAttributeDef[];
  units: BatchUnit[];
  /** Still worth a search: some unit has an empty field or wants an MRP. */
  pending: (refresh: boolean) => boolean;
}

async function loadBatchGroups(batchId: string, scope: EnrichScope): Promise<BatchGroup[]> {
  const products = await prisma.product.findMany({
    where: { ...shopWhere(scope), purchase: { is: { importBatchId: batchId } } },
    select: {
      id: true,
      brand: true,
      modelNumber: true,
      categoryId: true,
      dynamicAttributes: true,
      category: {
        select: {
          name: true,
          attributes: {
            where: { isActive: true },
            orderBy: { displayOrder: 'asc' },
            select: {
              attributeName: true,
              attributeLabel: true,
              attributeType: true,
              options: true,
            },
          },
        },
      },
    },
    orderBy: [{ brand: 'asc' }, { modelNumber: 'asc' }],
  });

  const byKey = new Map<string, BatchGroup>();
  for (const product of products) {
    const key = `${product.categoryId}|${product.brand.toLowerCase()}|${product.modelNumber.toLowerCase()}`;
    let group = byKey.get(key);
    if (!group) {
      const defs = specAttributes(product.category.attributes);
      const units: BatchUnit[] = [];
      group = {
        brand: product.brand,
        modelNumber: product.modelNumber,
        categoryName: product.category.name,
        defs,
        units,
        pending: (refresh: boolean) =>
          units.some(
            (unit) =>
              (refresh || !unit.lookedUp) &&
              (defs.some((def) => isBlank(unit.attributes[def.attributeName])) || wantsMrp(unit.attributes)),
          ),
      };
      byKey.set(key, group);
    }
    const attributes = attributesOf(product);
    group.units.push({
      id: product.id,
      attributes,
      lookedUp: !isBlank(attributes[LOOKED_UP_AT_KEY]),
    });
  }

  return [...byKey.values()];
}

/** One model of an import run: search once, then fill every unit's blanks. */
async function enrichGroup(group: BatchGroup): Promise<ProductEnrichBatchModel> {
  const summary: ProductEnrichBatchModel = {
    brand: group.brand,
    modelNumber: group.modelNumber,
    categoryName: group.categoryName,
    units: group.units.length,
    unitsUpdated: 0,
    filled: [],
    mrpSuggestion: null,
  };

  if (!group.modelNumber.trim()) {
    return { ...summary, note: 'No model number to search for.' };
  }

  // Ask about every field that is empty on at least one unit, and for an MRP
  // if any unit is still sitting at cost.
  const blanks = group.defs.filter((def) =>
    group.units.some((unit) => isBlank(unit.attributes[def.attributeName])),
  );
  const askForMrp = group.units.some((unit) => wantsMrp(unit.attributes));
  if (blanks.length === 0 && !askForMrp) {
    return { ...summary, note: 'Already filled in.' };
  }

  let specs: Record<string, string> = {};
  let mrp: number | null = null;
  try {
    const answer = await lookUpModel({
      brand: group.brand,
      modelNumber: group.modelNumber.trim(),
      categoryName: group.categoryName,
      blanks,
      askForMrp,
    });
    specs = answer.specs;
    mrp = answer.mrp;
  } catch (cause) {
    console.warn(`[products] Spec lookup failed for ${group.brand} ${group.modelNumber}:`, cause);
    return {
      ...summary,
      note: cause instanceof Error ? `Lookup failed: ${cause.message}` : 'Lookup failed.',
    };
  }

  const labelOf = new Map(group.defs.map((def) => [def.attributeName, def.attributeLabel]));
  const filledLabels = new Set<string>();
  const lookedUpAt = new Date().toISOString();

  for (const unit of group.units) {
    const gainedMrp = mrp !== null && wantsMrp(unit.attributes);
    const { next, filled } = mergeIntoAttributes(unit.attributes, specs, mrp, lookedUpAt);
    for (const name of filled) filledLabels.add(labelOf.get(name) ?? name);

    await prisma.product.update({
      where: { id: unit.id },
      data: { dynamicAttributes: next as Prisma.InputJsonValue },
    });
    if (filled.length > 0 || gainedMrp) summary.unitsUpdated += 1;
  }

  const filled = [...filledLabels];
  return {
    ...summary,
    filled,
    mrpSuggestion: mrp,
    note: filled.length === 0 && mrp === null ? 'The search found nothing definite.' : undefined,
  };
}
