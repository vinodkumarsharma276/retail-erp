/**
 * Working out what an item name on a purchase sheet actually is.
 *
 * A Tally purchase register names each product once, in the shop's own
 * shorthand — "SAM LED-UA 32H4680FUXXL", "LG W/M- T80KMMB3Z", "USHA Mod:-SM
 * BANDHAN COMPOSITE WITH PBC" — and carries no category, brand or colour
 * column at all. The sheet itself is read without any help from a model; this
 * is the one step that needs one.
 *
 * Answers are stored per tenant and reused, so next month's register costs
 * nothing for names already seen, and a correction made by hand sticks.
 */

/** What a single item name was resolved to. */
export interface ItemClassification {
  /** The name as the sheet spelled it. */
  rawName: string;
  /** The same name reduced for lookup (lower case, single spaces). */
  nameKey: string;
  categoryId: string | null;
  /** Full category path for display, e.g. "Mobile › Smartphone". */
  categoryLabel: string | null;
  brand: string;
  /** The model on its own, with the brand and colour taken out. */
  modelNumber: string;
  color: string | null;
  /** Category attributes that could be filled from the name (RAM, storage, size). */
  attributes: Record<string, string>;
  /** A display or demo piece: bought, but not sellable as new. */
  isDemoUnit: boolean;
  /** How sure the classifier was, 0 to 1. */
  confidence: number;
  /** Where the answer came from. A user decision outranks a later AI run. */
  decidedBy: 'ai' | 'user' | 'cache';
  /**
   * A category the classifier wanted but the tenant does not have. Nothing is
   * created until the import is confirmed with the suggestion approved.
   */
  suggestedCategory: { name: string; parentName: string | null } | null;
  /** Why the classifier was unsure, when it was. */
  note: string | null;
}

export interface ClassifyItemsRequest {
  /** Item names from the sheet. Duplicates are collapsed. */
  names: string[];
  /** Ask the model again for names that are already cached. */
  refresh?: boolean;
}

export interface ClassifyItemsResponse {
  classifications: ItemClassification[];
  /** Names answered from the stored table rather than the model. */
  fromCache: number;
  /** Names the model was asked about in this call. */
  fromModel: number;
  /** Categories the classifier asked for that the tenant does not have yet. */
  suggestedCategories: Array<{
    name: string;
    parentName: string | null;
    /** Example item names that wanted it, for the approval list. */
    examples: string[];
    items: number;
  }>;
  /** False when no API key is configured — the import still works, by hand. */
  aiEnabled: boolean;
  /** Set when the model could not be reached; names come back unresolved. */
  error?: string;
}

/** A correction made in the preview, saved so it holds for every later import. */
export interface SaveClassificationsRequest {
  classifications: Array<{
    nameKey: string;
    rawName: string;
    categoryId: string | null;
    brand?: string;
    modelNumber?: string;
    color?: string | null;
    attributes?: Record<string, string>;
    isDemoUnit?: boolean;
  }>;
}

/**
 * Looking one item up on the web, from the identify screen.
 *
 * A purchase register names a product but describes nothing about it, so once
 * the brand and model are settled — by the classifier, or typed in by hand
 * when the sheet was too terse — this fetches the specifications that belong
 * to that exact model.
 */
export interface LookupItemRequest {
  /** The sheet name this is for, so the answer can be stored against it. */
  nameKey: string;
  rawName: string;
  brand: string;
  /** Required: nothing can be looked up without a model. */
  modelNumber: string;
  /** The category whose attributes should be filled. */
  categoryId: string;
}

export interface LookupItemResponse {
  /** Attributes found, keyed as the category defines them. */
  attributes: Record<string, string>;
  /** Their labels, for telling the user what came back. */
  filled: string[];
  aiEnabled: boolean;
  /** Set when nothing could be found, or the lookup is unavailable. */
  message?: string;
}

/**
 * Forgetting stored answers.
 *
 * Caching is what makes a repeat import instant, but it also means a wrong
 * answer keeps being served. Forgetting one drops it from the store so the
 * next run works it out afresh — the way to undo a bad call without
 * re-asking about every other name on the sheet.
 */
export interface ForgetClassificationsRequest {
  /** The stored names to forget. */
  nameKeys: string[];
}

export interface ForgetClassificationsResponse {
  forgotten: number;
}
