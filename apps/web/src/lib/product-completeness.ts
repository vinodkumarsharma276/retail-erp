import type { Product } from '@retailerp/shared-types';

/**
 * What a product record is still missing.
 *
 * A purchase sheet says what was bought and little else: no retail price, no
 * specifications, and sometimes not even a model number, because the shop
 * writes "USHA SCISSORS" and moves on. None of that is reason to refuse the
 * unit — it exists, it was paid for, and it is sitting on a shelf. So it is
 * imported and the gaps are shown, here on the list where someone will
 * notice, rather than holding up the sheet it arrived on.
 */

export type ProductGap = 'model' | 'price' | 'imei' | 'specs';

export interface MissingProductDetail {
  gap: ProductGap;
  label: string;
  /** Needed before the unit can be sold or traced. */
  important: boolean;
}

export interface ProductCompleteness {
  missing: MissingProductDetail[];
  importantMissing: MissingProductDetail[];
  isComplete: boolean;
  /** True for a unit brought in from a sheet, which is why it may be thin. */
  fromImport: boolean;
}

const attributesOf = (product: Product): Record<string, unknown> =>
  (product.dynamicAttributes as Record<string, unknown> | undefined) ?? {};

const isBlank = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/**
 * `requiresImei` comes from the category, which the list may not have loaded.
 * When it is unknown the IMEI gap is simply not reported, rather than guessed
 * at from the product's name.
 */
export function productCompleteness(
  product: Product,
  options?: { requiresImei?: boolean },
): ProductCompleteness {
  const attributes = attributesOf(product);
  const missing: MissingProductDetail[] = [];

  // Only what genuinely stops the unit being used counts as important, and so
  // shows red. A model number identifies the thing; a phone without its IMEI
  // cannot be traced to whoever buys it. Everything else is a job to get round
  // to — after an import that is every unit, and colouring them all as faults
  // makes the mark useless.
  if (attributes.modelNotSet === true || isBlank(product.modelNumber)) {
    missing.push({ gap: 'model', label: 'Model number', important: true });
  }
  if (options?.requiresImei && isBlank(attributes.imeiNumbers)) {
    missing.push({ gap: 'imei', label: 'IMEI number', important: true });
  }
  if (attributes.priceNotSet === true) {
    missing.push({ gap: 'price', label: 'Selling price not set yet', important: false });
  }

  // Anything beyond the importer's own bookkeeping keys counts as a real
  // specification; with none, the unit is a name and a price and nothing more.
  const bookkeeping = new Set([
    'importedFrom', 'priceNotSet', 'modelNotSet', 'isDemoUnit',
    'mrpSuggestion', 'specsLookedUpAt', 'needsReview', 'imeiNumbers',
  ]);
  const hasSpecs = Object.entries(attributes).some(([key, value]) => !bookkeeping.has(key) && !isBlank(value));
  if (!hasSpecs) missing.push({ gap: 'specs', label: 'Specifications', important: false });

  return {
    missing,
    importantMissing: missing.filter((detail) => detail.important),
    isComplete: missing.length === 0,
    fromImport: attributes.importedFrom === 'excel',
  };
}
