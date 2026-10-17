/**
 * Filling in a product's specifications from the web, on demand.
 *
 * A Tally purchase register carries cost and nothing else — no MRP, no HSN,
 * no RAM, no tonnage, no star rating. Units imported from one are therefore
 * stored at cost with `priceNotSet`, and their category attributes are empty.
 * Looking all of that up during the import was too slow and too costly (a
 * month's register can name 200 distinct models), so it is a separate action
 * the user asks for: on one product, or across a whole import run.
 *
 * Nothing already entered is ever overwritten, and no price is ever written —
 * an MRP found on the web comes back as a suggestion to confirm by hand.
 */

/** One attribute the lookup touched, named as the form names it. */
export interface EnrichedAttribute {
  attributeName: string;
  label: string;
  value: string;
}

/** What a lookup did to a single product. */
export interface ProductEnrichResult {
  productId: string;
  brand: string;
  modelNumber: string;
  categoryName: string | null;
  /** Attributes that were empty and have now been filled. */
  filled: EnrichedAttribute[];
  /** Attributes that already had a value — left exactly as they were. */
  kept: EnrichedAttribute[];
  /** Attributes still empty: the lookup could not establish them. */
  unresolved: Array<{ attributeName: string; label: string }>;
  /**
   * An MRP found on the web, in rupees. Saved as a suggestion only — the
   * product's own MRP and selling price are never changed by a lookup.
   */
  mrpSuggestion: number | null;
  /** False when no API key is configured; nothing was looked up. */
  aiEnabled: boolean;
  /** Plain-language note for the user when nothing could be done. */
  message?: string;
}

/** One brand + model of an import run, and what the lookup did to its units. */
export interface ProductEnrichBatchModel {
  brand: string;
  modelNumber: string;
  categoryName: string | null;
  /** Units of this model in the import run. */
  units: number;
  /** Units that gained at least one attribute. */
  unitsUpdated: number;
  /** Attribute labels filled in for this model. */
  filled: string[];
  mrpSuggestion: number | null;
  /** Why nothing was written, when nothing was. */
  note?: string;
}

/**
 * One pass over an import run. The run is deliberately chunked: each call
 * looks up the next few models and reports how many are still waiting, so a
 * register with 200 models shows progress and can be stopped and resumed.
 */
export interface ProductEnrichBatchResult {
  batchId: string;
  /** Models looked up in this pass. */
  models: ProductEnrichBatchModel[];
  /** Models still waiting, after this pass. */
  remainingModels: number;
  /** Product rows updated in this pass. */
  unitsUpdated: number;
  aiEnabled: boolean;
  message?: string;
}

/** How much of an import run still has no specifications. */
export interface ProductEnrichBatchStatus {
  batchId: string;
  fileName: string;
  /** Distinct brand + model combinations the run brought in. */
  totalModels: number;
  /** Of those, how many still have empty specifications. */
  pendingModels: number;
  /** Units belonging to the pending models. */
  pendingUnits: number;
  aiEnabled: boolean;
}

export interface ProductEnrichBatchRequest {
  /** Models to look up in this pass. Kept small so progress is visible. */
  limit?: number;
  /** Look models up again even if they have been looked up before. */
  refresh?: boolean;
}
