import OpenAI from 'openai';
import type {
  ClassifyItemsRequest,
  ClassifyItemsResponse,
  ItemClassification,
  LookupItemRequest,
  LookupItemResponse,
  SaveClassificationsRequest,
} from '@retailerp/shared-types';
import { prisma } from '../../config/database.js';
import { config as appConfig } from '../../config/index.js';
import { resolveProductSpecsByWebSearch } from '../ocr/providers/openai-vision.provider.js';

/**
 * Working out what an item name on a purchase sheet means.
 *
 * A Tally purchase register is otherwise completely machine-readable, so the
 * sheet is parsed outright with no model involved. The one thing it does not
 * contain is what each product *is*: there is no category, brand, colour or
 * specification column anywhere, only the shop's own shorthand in a single
 * "Particulars" cell —
 *
 *     SAM LED-UA 32H4680FUXXL          → TV › LED TV, Samsung, UA32H4680FUXXL
 *     LG W/M- T80KMMB3Z                → Washing Machine › Top Load, LG
 *     USHA Mod:-SM BANDHAN COMPOSITE   → Sewing Machine, Usha
 *     HIAER REF HRD- 2362BUSA-N/215L   → Refrigerator, Haier (name misspelt)
 *
 * No rule table survives that, which is where a language model earns its
 * place. Every answer is written to `import_item_classification`, so the same
 * names next month cost nothing, and anything corrected by hand in the
 * preview is never overwritten by a later run.
 */

const MODEL_TIMEOUT_MS = 120_000;
/**
 * Names per request. Smaller batches are markedly more accurate: at 40 the
 * model started overlooking categories that were on the list and proposing
 * duplicates of them instead.
 */
const BATCH_SIZE = 20;
/** Requests in flight at once. */
const CONCURRENCY = 3;

let client: OpenAI | null = null;
function openai(): OpenAI {
  client ??= new OpenAI({
    apiKey: appConfig.statements.openAiApiKey,
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: 2,
  });
  return client;
}

export const classifierEnabled = () => appConfig.statements.openAiApiKey.length > 0;

/** The item name reduced for lookup: lower case, single spaces, no trailing punctuation. */
export function itemNameKey(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:\-]+$/, '')
    .trim()
    .slice(0, 300);
}

// --- Category context handed to the model --------------------------------------

interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  isLeaf: boolean;
  /** "Mobile > Smartphone" */
  label: string;
  attributes: Array<{ name: string; label: string; type: string; options: string[] }>;
}

async function loadCategories(tenantId: string): Promise<CategoryNode[]> {
  const rows = await prisma.productCategory.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true,
      name: true,
      parentId: true,
      isLeaf: true,
      attributes: {
        where: { isActive: true },
        select: { attributeName: true, attributeLabel: true, attributeType: true, options: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
    orderBy: { displayOrder: 'asc' },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const labelOf = (row: (typeof rows)[number]): string => {
    const parts: string[] = [row.name];
    let parentId = row.parentId;
    // Guard against a cycle in the tree rather than looping for ever.
    for (let depth = 0; parentId && depth < 10; depth += 1) {
      const parent = byId.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId;
    }
    return parts.join(' > ');
  };

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    isLeaf: row.isLeaf,
    label: labelOf(row),
    attributes: row.attributes.map((attribute) => ({
      name: attribute.attributeName,
      label: attribute.attributeLabel,
      type: String(attribute.attributeType),
      options: Array.isArray(attribute.options) ? (attribute.options as unknown[]).map(String) : [],
    })),
  }));
}

/** The category list and each category's attributes, as the prompt presents them. */
function describeCategories(categories: CategoryNode[]): string {
  const lines: string[] = [];
  for (const category of [...categories].sort((a, b) => a.label.localeCompare(b.label))) {
    const attributes = category.attributes
      .map((attribute) => {
        if (attribute.type === 'select' && attribute.options.length) {
          return `${attribute.name} (one of: ${attribute.options.join(' | ')})`;
        }
        if (attribute.type === 'checkbox') return `${attribute.name} (true/false)`;
        if (attribute.type === 'number') return `${attribute.name} (number)`;
        return attribute.name;
      })
      .join('; ');
    lines.push(`- ${category.label}${attributes ? `  [attributes: ${attributes}]` : ''}`);
  }
  return lines.join('\n');
}

// --- Prompt ---------------------------------------------------------------------

const SYSTEM_PROMPT = `You identify products from the shorthand an Indian retail shop writes in its own accounting books.

The shop sells consumer electronics, home appliances, mobile phones and furniture. Each input is one line copied from the "Particulars" column of a Tally purchase register: the whole product description squeezed into a single cell by a shop employee, in no fixed format. Your job is to say what each one is.

For every input, return one object with its index.

CATEGORY
- "category_path" must be copied EXACTLY from the allowed category list, including the " > " separators. Choose the most specific entry that fits — prefer a child over its parent when the name makes the sub-type clear ("W/M- T80KMMB3Z" is a top loader, "FRONT LOAD" or "PX900H9SO4Z" a front loader).
- When the sub-type genuinely cannot be told from the name, use the parent category instead of guessing a child.
- **Read the whole allowed list before deciding that nothing fits.** An existing category is almost always the right answer, and proposing a new one that duplicates an entry already on the list is the single worst mistake you can make here. A dry iron or steam iron is the list's "Iron". A mixer, grinder, JMG, juicer mixer grinder or food processor is its "Mixer Grinder". A phone, smartphone or mobile handset is its "Smartphone" (a basic keypad handset is "Feature Phone"). A steel almirah is its "Wardrobe". An inverter or tubular battery is its "Inverter Battery".
- Only when NO entry on the list could reasonably hold the product: set "category_path" to null and fill "new_category". Whenever "category_path" is null you MUST give a "new_category" — returning null for both is never acceptable, because it leaves a person to work the product out with no help at all. A sewing machine, a fan, a microwave oven, a speaker, a home theatre, earbuds and a deep freezer are all real products that simply may not be on the list yet; name them plainly.
- "new_category" needs a short, conventional retail name ("Fan", "Sewing Machine", "Microwave Oven", "Deep Freezer") and, as "parent", the top-level entry from the list that genuinely contains it — a deep freezer belongs with refrigeration, not with batteries. If no top-level entry genuinely contains it, use null rather than forcing a poor fit.
- Never invent a "category_path" that is not on the list.

BRAND
- Return the real, properly spelled brand name, expanding the shop's abbreviations and correcting its typos: SAM / SAM MOB / SAMSUNG → Samsung; WHIR → Whirlpool; HIAER → Haier; SPK / ZEB → Zebronics; POLYCAB → Polycab; LUMINOUS → Luminous; WHIR REF → Whirlpool; SUJATA → Sujata.
- Watch for brands that only appear mid-name, and for names where the leading token is a product type rather than a brand ("IRON MOD- GC098/30 DRY" and "DST1510/20 STEAM IRON PHILIPS" are both Philips; "SM BANDHAN DLX" is a Usha sewing machine model; "ALMIRAH TRIVENI GT3-PF" and "TRIVENI ALMIRAH UGM-WF" are both Triveni, where ALMIRAH is the product type and TRIVENI the maker).
- If no brand can be established, return an empty string and say so in "note".

PRODUCT-TYPE ABBREVIATIONS the trade uses
  W/M, WM = washing machine        REF = refrigerator          LED = LED television
  MW, MWO = microwave oven         DF = deep freezer           HT = home theatre
  JMG = juicer mixer grinder       MG = mixer grinder           SM = sewing machine
  SPK = speaker                    AC = air conditioner         ALMIRAH = steel wardrobe
  MOB = mobile phone               PBC = plastic base cover     HA = hand attachment

MODEL NUMBER
- The manufacturer's model designation only, with the brand, the colour and any RAM/storage figures removed, and stray spacing inside it closed up ("UA 32H4680FUXXL" → "UA32H4680FUXXL").

COLOUR
- The colour as written, in Title Case ("ICE WHITE" → "Ice White", "SAPPHIRE BLUE" → "Sapphire Blue"). Null when the name gives none. Do not treat a finish that is part of the model code as a colour.

ATTRIBUTES
- Only attribute names listed against the category you chose, as {"name","value"} pairs. Omit any you cannot read off the name. Values for a fixed-choice attribute must match one of its options exactly. RAM and storage are written as "(6+128)", "6+128GB", "8/256GB" — the first figure is RAM in GB, the second storage in GB.

DISPLAY PIECES
- Set "is_demo_unit" true when the name marks it as a shop display or demonstration unit: DUMMY, DEMO, "IN DEMO", a dummy handset. These were bought but cannot be sold as new.

CARE
- Judge only from the text and what you know of these products. Do not search the internet.
- "confidence" is 0 to 1 for the category and brand together. Below 0.6 means a person should check it.
- Put anything doubtful or ambiguous in "note", in one short sentence. Never pad a field with a guess to avoid leaving it empty.
- Return exactly one object per input index, and nothing else.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'index',
          'category_path',
          'new_category',
          'brand',
          'model_number',
          'color',
          'attributes',
          'is_demo_unit',
          'confidence',
          'note',
        ],
        properties: {
          index: { type: 'integer' },
          category_path: { type: ['string', 'null'] },
          new_category: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['name', 'parent'],
            properties: {
              name: { type: 'string' },
              parent: { type: ['string', 'null'] },
            },
          },
          brand: { type: 'string' },
          model_number: { type: 'string' },
          color: { type: ['string', 'null'] },
          attributes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'value'],
              properties: { name: { type: 'string' }, value: { type: 'string' } },
            },
          },
          is_demo_unit: { type: 'boolean' },
          confidence: { type: 'number' },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

interface ModelItem {
  index: number;
  category_path: string | null;
  new_category: { name: string; parent: string | null } | null;
  brand: string;
  model_number: string;
  color: string | null;
  attributes: Array<{ name: string; value: string }>;
  is_demo_unit: boolean;
  confidence: number;
  note: string | null;
}

/** Run async work with a concurrency cap, keeping results in order. */
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

async function askModel(names: string[], categoryList: string): Promise<ModelItem[]> {
  const numbered = names.map((name, index) => `${index}. ${name}`).join('\n');
  const response = await openai().chat.completions.create({
    model: appConfig.statements.model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Allowed categories (copy "category_path" exactly from this list):\n${categoryList}\n\nIdentify these ${names.length} item names:\n${numbered}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'item_classifications', strict: true, schema: RESPONSE_SCHEMA as any },
    },
  });

  const message = response.choices[0]?.message;
  if (message?.refusal) throw new Error(`The model declined to classify these items: ${message.refusal}`);
  const parsed = JSON.parse(message?.content ?? '{}') as { items?: ModelItem[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

// --- Turning the model's answer into something storable --------------------------

/** A category name reduced for comparison: lower case, letters and digits only. */
function simplify(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The existing category a proposed new one really means, if any.
 *
 * Models reach for a new category far too readily — proposing "Iron" when
 * "Small Appliances > Iron" is already on the list, or "Juicer Mixer Grinder"
 * for what the shop files under "Mixer Grinder". Creating those would split
 * one product type across two categories for ever, so a proposal is matched
 * back by name first: exactly, then by an existing name appearing whole
 * inside the proposed one, longest match winning.
 */
function existingCategoryFor(
  proposedName: string,
  categoryByName: Map<string, CategoryNode>,
): CategoryNode | null {
  const proposed = simplify(proposedName);
  if (!proposed) return null;
  const exact = categoryByName.get(proposed);
  if (exact) return exact;

  let best: CategoryNode | null = null;
  let bestLength = 0;
  for (const [name, category] of categoryByName) {
    if (name.length <= bestLength) continue;
    // Whole words only, so "Iron" never matches "Ironing Board".
    if (new RegExp(`(^| )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(proposed)) {
      best = category;
      bestLength = name.length;
    }
  }
  return best;
}

const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .trim();

function cleanAttributes(
  pairs: Array<{ name: string; value: string }>,
  category: CategoryNode | null,
): Record<string, string> {
  if (!category) return {};
  const allowed = new Map(category.attributes.map((attribute) => [attribute.name, attribute]));
  const out: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const attribute = allowed.get(pair.name);
    if (!attribute) continue;
    const value = String(pair.value ?? '').trim();
    if (!value || /^(unknown|n\/?a|none)$/i.test(value)) continue;
    if (attribute.type === 'select' && attribute.options.length) {
      const canonical = attribute.options.find((option) => option.toLowerCase() === value.toLowerCase());
      if (!canonical) continue;
      out[attribute.name] = canonical;
      continue;
    }
    if (attribute.type === 'number' && !Number.isFinite(Number(value))) continue;
    out[attribute.name] = value.slice(0, 200);
  }
  return out;
}

/** A classification with nothing resolved, used when the model is unavailable. */
function unresolved(rawName: string, note: string): ItemClassification {
  return {
    rawName,
    nameKey: itemNameKey(rawName),
    categoryId: null,
    categoryLabel: null,
    brand: '',
    modelNumber: rawName,
    color: null,
    attributes: {},
    isDemoUnit: false,
    confidence: 0,
    decidedBy: 'ai',
    suggestedCategory: null,
    note,
  };
}

export interface ClassifierContext {
  tenantId: string;
}

export const itemClassifier = {
  /**
   * Resolve each item name, answering from the stored table where possible
   * and asking the model only about names not seen before.
   */
  async classify(request: ClassifyItemsRequest, ctx: ClassifierContext): Promise<ClassifyItemsResponse> {
    // Distinct names, first spelling kept for display.
    const byKey = new Map<string, string>();
    for (const name of request.names ?? []) {
      const key = itemNameKey(name);
      if (key && !byKey.has(key)) byKey.set(key, String(name).replace(/\s+/g, ' ').trim());
    }
    const keys = [...byKey.keys()];
    if (keys.length === 0) {
      return {
        classifications: [],
        fromCache: 0,
        fromModel: 0,
        suggestedCategories: [],
        aiEnabled: classifierEnabled(),
      };
    }

    const [categories, cached] = await Promise.all([
      loadCategories(ctx.tenantId),
      prisma.importItemClassification.findMany({
        where: { tenantId: ctx.tenantId, nameKey: { in: keys } },
      }),
    ]);
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const categoryByLabel = new Map(categories.map((category) => [category.label.toLowerCase(), category]));
    // By plain name, a leaf winning over a parent of the same name: used to
    // catch a proposal for a category the tenant already has.
    const categoryByName = new Map<string, CategoryNode>();
    for (const category of [...categories].sort((a, b) => Number(a.isLeaf) - Number(b.isLeaf))) {
      categoryByName.set(simplify(category.name), category);
    }
    const topLevelByName = new Map(
      categories.filter((category) => !category.parentId).map((category) => [category.name.toLowerCase(), category]),
    );

    const results = new Map<string, ItemClassification>();
    for (const row of cached) {
      // A correction made by hand always stands, even on a refresh.
      if (request.refresh && row.decidedBy !== 'user') continue;
      const category = row.categoryId ? categoryById.get(row.categoryId) ?? null : null;
      results.set(row.nameKey, {
        rawName: row.rawName,
        nameKey: row.nameKey,
        categoryId: category?.id ?? null,
        categoryLabel: category?.label ?? null,
        brand: row.brand ?? '',
        modelNumber: row.modelNumber ?? row.rawName,
        color: row.color,
        attributes: (row.attributes ?? {}) as Record<string, string>,
        isDemoUnit: row.isDemoUnit,
        confidence: Number(row.confidence),
        decidedBy: row.decidedBy === 'user' ? 'user' : 'cache',
        suggestedCategory: null,
        note: null,
      });
    }

    const pending = keys.filter((key) => !results.has(key));
    let error: string | undefined;
    let fromModel = 0;

    if (pending.length > 0 && !classifierEnabled()) {
      error = 'Product identification is switched off. Set OPENAI_API_KEY to have item names read automatically, or choose categories by hand below.';
      for (const key of pending) results.set(key, unresolved(byKey.get(key)!, 'Not identified — no AI key configured.'));
    } else if (pending.length > 0) {
      const categoryList = describeCategories(categories);
      const batches: string[][] = [];
      for (let start = 0; start < pending.length; start += BATCH_SIZE) {
        batches.push(pending.slice(start, start + BATCH_SIZE));
      }

      const answers = await mapLimit(batches, CONCURRENCY, async (batch) => {
        const names = batch.map((key) => byKey.get(key)!);
        try {
          return { batch, items: await askModel(names, categoryList) };
        } catch (cause) {
          console.warn('[purchase-import] item classification failed:', cause);
          return { batch, items: null, cause };
        }
      });

      const toStore: ItemClassification[] = [];
      for (const answer of answers) {
        if (!answer.items) {
          error ??=
            answer.cause instanceof Error
              ? `Could not identify some items: ${answer.cause.message}`
              : 'Could not identify some items.';
          for (const key of answer.batch) {
            results.set(key, unresolved(byKey.get(key)!, 'Not identified — the request to the model failed.'));
          }
          continue;
        }
        const byIndex = new Map(answer.items.map((item) => [item.index, item]));
        answer.batch.forEach((key, index) => {
          const item = byIndex.get(index);
          const rawName = byKey.get(key)!;
          if (!item) {
            results.set(key, unresolved(rawName, 'The model returned no answer for this name.'));
            return;
          }
          let category = item.category_path
            ? categoryByLabel.get(item.category_path.toLowerCase().replace(/\s*>\s*/g, ' > ')) ?? null
            : null;
          // A proposal for something the tenant already has is that existing
          // category, not a new one.
          if (!category && item.new_category?.name) {
            category = existingCategoryFor(item.new_category.name, categoryByName);
          }
          const suggestion =
            !category && item.new_category?.name
              ? {
                  name: titleCase(item.new_category.name).slice(0, 100),
                  parentName: item.new_category.parent
                    ? topLevelByName.get(item.new_category.parent.toLowerCase())?.name ?? null
                    : null,
                }
              : null;

          const classification: ItemClassification = {
            rawName,
            nameKey: key,
            categoryId: category?.id ?? null,
            categoryLabel: category?.label ?? null,
            brand: String(item.brand ?? '').trim().slice(0, 200),
            modelNumber: String(item.model_number ?? '').trim().slice(0, 200) || rawName,
            color: item.color ? titleCase(String(item.color)).slice(0, 50) : null,
            attributes: cleanAttributes(item.attributes, category),
            isDemoUnit: Boolean(item.is_demo_unit),
            confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
            decidedBy: 'ai',
            suggestedCategory: suggestion,
            note:
              item.note?.trim()
                ? item.note.trim().slice(0, 300)
                : !category && !suggestion
                  ? 'No category could be worked out from this name.'
                  : null,
          };
          results.set(key, classification);
          // Only answers that settled on a category are worth remembering;
          // a suggestion becomes storable once the category exists.
          if (classification.categoryId) toStore.push(classification);
          fromModel += 1;
        });
      }

      await this.remember(toStore, ctx);
    }

    // Categories the classifier asked for that the tenant does not have.
    //
    // Grouped by name alone, never by name-and-parent: the model may file the
    // same product type under different parents across batches, and offering
    // "Sewing Machine" twice invites exactly the duplicate this is meant to
    // avoid. When the parents disagree it is guessing, so the proposal goes to
    // the top level rather than under a parent that may be wrong.
    const suggestions = new Map<
      string,
      { name: string; parentName: string | null; examples: string[]; items: number; parents: Set<string | null> }
    >();
    for (const classification of results.values()) {
      const suggestion = classification.suggestedCategory;
      if (!suggestion) continue;
      const key = simplify(suggestion.name);
      const entry = suggestions.get(key) ?? { ...suggestion, examples: [], items: 0, parents: new Set() };
      entry.items += 1;
      entry.parents.add(suggestion.parentName);
      if (entry.examples.length < 4) entry.examples.push(classification.rawName);
      suggestions.set(key, entry);
    }
    for (const entry of suggestions.values()) {
      if (entry.parents.size > 1) entry.parentName = null;
    }

    return {
      classifications: keys.map((key) => results.get(key)!),
      fromCache: cached.length,
      fromModel,
      suggestedCategories: [...suggestions.values()]
        .map(({ parents, ...entry }) => entry)
        .sort((a, b) => b.items - a.items),
      aiEnabled: classifierEnabled(),
      error,
    };
  },

  /** Store classifications, leaving anything a person decided untouched. */
  async remember(classifications: ItemClassification[], ctx: ClassifierContext): Promise<void> {
    for (const classification of classifications) {
      const data = {
        rawName: classification.rawName.slice(0, 300),
        categoryId: classification.categoryId,
        brand: classification.brand || null,
        modelNumber: classification.modelNumber || null,
        color: classification.color,
        attributes: classification.attributes,
        isDemoUnit: classification.isDemoUnit,
        confidence: classification.confidence,
        decidedBy: classification.decidedBy === 'user' ? 'user' : 'ai',
      };
      try {
        // A stored decision made by a person outranks anything a later run
        // produces, so an AI answer only updates rows not marked `user`. When
        // such a row is there, the update matches nothing and the create is
        // skipped as a duplicate — the correction stays exactly as it was.
        const updated = await prisma.importItemClassification.updateMany({
          where: {
            tenantId: ctx.tenantId,
            nameKey: classification.nameKey,
            ...(data.decidedBy === 'user' ? {} : { decidedBy: { not: 'user' } }),
          },
          data,
        });
        if (updated.count === 0) {
          await prisma.importItemClassification.createMany({
            data: [{ tenantId: ctx.tenantId, nameKey: classification.nameKey, ...data }],
            skipDuplicates: true,
          });
        }
      } catch (cause) {
        // Remembering is an optimisation; never fail an import over it.
        console.warn('[purchase-import] could not store classification:', cause);
      }
    }
  },

  /**
   * Fetch one product’s specifications from the web.
   *
   * A register says what was bought but nothing about it, so this is offered
   * per row once a brand and model are settled — either worked out by the
   * classifier or typed in by hand. Without a model there is nothing to
   * search for, which is why the model is required rather than optional.
   */
  async lookup(request: LookupItemRequest, ctx: ClassifierContext): Promise<LookupItemResponse> {
    const modelNumber = String(request.modelNumber ?? '').trim();
    if (!modelNumber) {
      return { attributes: {}, filled: [], aiEnabled: classifierEnabled(), message: 'Enter the model number first — there is nothing to search for without it.' };
    }
    if (!classifierEnabled()) {
      return { attributes: {}, filled: [], aiEnabled: false, message: 'Looking details up is switched off. Set OPENAI_API_KEY to use it.' };
    }

    const categories = await loadCategories(ctx.tenantId);
    const category = categories.find((entry) => entry.id === request.categoryId) ?? null;
    if (!category) {
      return { attributes: {}, filled: [], aiEnabled: true, message: 'Choose a category first — it decides which details are worth looking for.' };
    }
    if (category.attributes.length === 0) {
      return { attributes: {}, filled: [], aiEnabled: true, message: `${category.name} has no attributes set up, so there is nothing to fill in.` };
    }

    const found = await resolveProductSpecsByWebSearch({
      brand: String(request.brand ?? '').trim() || null,
      modelNumber,
      categoryName: category.name,
      attributes: category.attributes.map((attribute) => ({
        attributeName: attribute.name,
        attributeLabel: attribute.label,
        attributeType: attribute.type,
        options: attribute.options,
      })),
    });

    const attributes = cleanAttributes(
      Object.entries(found).map(([name, value]) => ({ name, value: String(value) })),
      category,
    );
    const byName = new Map(category.attributes.map((attribute) => [attribute.name, attribute.label]));
    const filled = Object.keys(attributes).map((name) => byName.get(name) ?? name);

    return {
      attributes,
      filled,
      aiEnabled: true,
      message: filled.length === 0 ? 'Nothing reliable was found for this model.' : undefined,
    };
  },

  /** Save corrections made in the preview so they hold for every later import. */
  async save(request: SaveClassificationsRequest, ctx: ClassifierContext): Promise<{ saved: number }> {
    const categories = await loadCategories(ctx.tenantId);
    const categoryById = new Map(categories.map((category) => [category.id, category]));

    const rows: ItemClassification[] = [];
    for (const entry of request.classifications ?? []) {
      const nameKey = itemNameKey(entry.nameKey || entry.rawName);
      if (!nameKey) continue;
      const category = entry.categoryId ? categoryById.get(entry.categoryId) ?? null : null;
      if (entry.categoryId && !category) continue; // not this tenant's category
      rows.push({
        rawName: entry.rawName || nameKey,
        nameKey,
        categoryId: category?.id ?? null,
        categoryLabel: category?.label ?? null,
        brand: (entry.brand ?? '').trim().slice(0, 200),
        modelNumber: (entry.modelNumber ?? '').trim().slice(0, 200) || entry.rawName,
        color: entry.color ? String(entry.color).slice(0, 50) : null,
        attributes: cleanAttributes(
          Object.entries(entry.attributes ?? {}).map(([name, value]) => ({ name, value: String(value) })),
          category,
        ),
        isDemoUnit: Boolean(entry.isDemoUnit),
        confidence: 1,
        decidedBy: 'user',
        suggestedCategory: null,
        note: null,
      });
    }

    await this.remember(rows, ctx);
    return { saved: rows.length };
  },
};
