import { config } from '../../../config/index.js';
import { researchableSpecs } from '../researchable.js';

type OcrFile = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
};

function toDataUrl(file: OcrFile) {
  return `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
}

function extractOutputText(payload: any): string {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const output = payload.output ?? [];
  for (const item of output) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('OCR provider returned no text output');
}

export async function parseWithOpenAi<T>(args: {
  file: OcrFile;
  model: string;
  schemaName: string;
  schema: unknown;
  systemPrompt: string;
  userPrompt: string;
  /** Enable OpenAI hosted `web_search_preview` tool. Requires a model that supports it (e.g. gpt-4o, gpt-4.1). */
  enableWebSearch?: boolean;
}): Promise<T> {
  if (!config.ocr.openAiApiKey) {
    throw new Error('OCR is not configured. Set OPENAI_API_KEY to enable scanning.');
  }

  const isPdf = args.file.mimeType === 'application/pdf';
  const documentPart = isPdf
    ? { type: 'input_file', filename: args.file.filename || 'document.pdf', file_data: toDataUrl(args.file) }
    : { type: 'input_image', image_url: toDataUrl(args.file) };

  const requestBody: Record<string, unknown> = {
    model: args.model,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: args.systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: args.userPrompt }, documentPart] },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: args.schemaName,
        strict: true,
        schema: args.schema,
      },
    },
  };

  if (args.enableWebSearch) {
    requestBody.tools = [{ type: 'web_search_preview' }];
    requestBody.tool_choice = 'auto';
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ocr.openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errorText = '';
    let errorJson: any = undefined;
    try {
      errorText = await response.text();
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        // ignore non-JSON bodies
      }
    } catch {
      // ignore body read failures
    }

    const providerMessage =
      (typeof errorJson?.error?.message === 'string' && errorJson.error.message) ||
      (typeof errorJson?.message === 'string' && errorJson.message) ||
      '';
    const providerCode =
      (typeof errorJson?.error?.code === 'string' && errorJson.error.code) ||
      (typeof errorJson?.code === 'string' && errorJson.code) ||
      '';

    let message = `OCR provider failed: ${response.status}`;
    if (response.status === 401) {
      message = 'OpenAI authentication failed. Check OPENAI_API_KEY.';
    } else if (response.status === 429 && providerCode === 'insufficient_quota') {
      message =
        'OpenAI quota/billing is not available for this key. Add billing/credits in OpenAI and try again.';
    } else if (response.status === 429) {
      message = 'OpenAI rate limit exceeded. Please retry in a minute.';
    } else if (providerMessage) {
      message = `OCR provider failed: ${response.status} ${providerMessage}`;
    } else if (errorText) {
      message = `OCR provider failed: ${response.status} ${errorText}`;
    }

    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = response.status;
    throw error;
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);
  return JSON.parse(outputText) as T;
}

/**
 * Resolve a product brand from a model number using OpenAI Responses API with
 * the hosted `web_search_preview` tool. Returns the brand name (e.g. "Samsung",
 * "Vivo") or null if the lookup yields nothing definitive.
 *
 * Uses a plain-text (non-JSON-schema) response so the model can freely invoke
 * the web_search tool — strict json_schema responses suppress tool usage in
 * practice. The model is instructed to return ONLY the brand name on one line.
 */
export async function resolveBrandByWebSearch(args: {
  modelNumber: string;
  categoryHint?: string | null;
  model?: string;
}): Promise<string | null> {
  if (!config.ocr.openAiApiKey) return null;

  const searchModel = args.model || 'gpt-4o';
  const category = args.categoryHint ? ` (${args.categoryHint})` : '';

  const systemPrompt = [
    'You are a product-lookup assistant for an Indian electronics/appliance/mobile retailer.',
    'Given a product model number, find the manufacturer (brand) by searching Indian retail sites.',
    'You MUST call the web_search_preview tool — do not answer from memory alone, because model numbers are often reused or ambiguous.',
    'After searching, return ONLY the brand name on a single line. Examples: "Samsung", "LG", "Sony", "Vivo", "Xiaomi", "Whirlpool", "Godrej".',
    'No quotes, no punctuation, no extra words. Just the brand name.',
    'If after searching you cannot determine the brand with confidence, respond with exactly: UNKNOWN',
  ].join('\n');

  const userPrompt = [
    `Find the brand for this product model number${category}: ${args.modelNumber}`,
    '',
    'Search query suggestion:',
    `  "${args.modelNumber}" site:amazon.in OR site:flipkart.com OR site:croma.com OR site:reliancedigital.in`,
    '',
    'Read the top result titles — they almost always start with the brand name. Respond with just the brand.',
  ].join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ocr.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: searchModel,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
        ],
        tools: [{ type: 'web_search_preview' }],
        tool_choice: { type: 'web_search_preview' },
      }),
    });

    if (!response.ok) {
      // Surface the underlying reason so it shows up in server logs
      const body = await response.text().catch(() => '');
      console.warn(`[ocr] Brand web-search failed (${response.status}): ${body.slice(0, 300)}`);
      return null;
    }

    const payload = await response.json();
    const text = extractOutputText(payload).trim();
    // Strip code fences, quotes, leading "Brand:" etc.
    const cleaned = text
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^brand\s*[:=-]\s*/i, '')
      .trim()
      .split(/\r?\n/)[0]
      .trim();
    if (!cleaned || /^unknown$/i.test(cleaned)) return null;
    // Sanity cap — brand names are short
    if (cleaned.length > 60) return null;
    return cleaned;
  } catch (err) {
    console.warn('[ocr] Brand web-search error:', err);
    return null;
  }
}

/**
 * Resolve an HSN/SAC code for a product using OpenAI Responses API + web
 * search. Used when the invoice OCR didn't pick up an HSN code for an item.
 * Returns the HSN code (4/6/8 digit numeric string) or null.
 */
export async function resolveHsnByWebSearch(args: {
  brand?: string | null;
  modelNumber?: string | null;
  categoryHint?: string | null;
  model?: string;
}): Promise<string | null> {
  if (!config.ocr.openAiApiKey) return null;
  if (!args.modelNumber && !args.categoryHint) return null;

  const searchModel = args.model || 'gpt-4o';
  const descriptor = [args.brand, args.modelNumber, args.categoryHint]
    .filter(Boolean)
    .join(' ');

  const systemPrompt = [
    'You are a tax-classification assistant for an Indian retailer.',
    'Given a product description, find its Indian GST HSN (Harmonized System of Nomenclature) code.',
    'You MUST call the web_search_preview tool to confirm — do not answer from memory alone.',
    'After searching, return ONLY the HSN code as 4, 6, or 8 digits on a single line. Examples: "8528", "85287100", "8418".',
    'No quotes, no punctuation, no extra words. Just the numeric code.',
    'If you cannot determine the HSN with reasonable confidence, respond with exactly: UNKNOWN',
  ].join('\n');

  const userPrompt = [
    `Find the Indian GST HSN code for this product: ${descriptor}`,
    '',
    'Search query suggestion:',
    `  "${descriptor}" HSN code India GST`,
    '',
    'Respond with just the HSN code.',
  ].join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ocr.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: searchModel,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
        ],
        tools: [{ type: 'web_search_preview' }],
        tool_choice: { type: 'web_search_preview' },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[ocr] HSN web-search failed (${response.status}): ${body.slice(0, 300)}`);
      return null;
    }

    const payload = await response.json();
    const text = extractOutputText(payload).trim();
    const cleaned = text
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^hsn\s*[:=-]\s*/i, '')
      .trim()
      .split(/\r?\n/)[0]
      .trim();
    if (!cleaned || /^unknown$/i.test(cleaned)) return null;
    // Extract first numeric run; HSN is digits only
    const digits = cleaned.match(/\d{4,8}/)?.[0];
    if (!digits) return null;
    return digits;
  } catch (err) {
    console.warn('[ocr] HSN web-search error:', err);
    return null;
  }
}

/**
 * Describes one category attribute that the spec lookup should try to fill.
 */
export type SpecAttributeDef = {
  attributeName: string;
  attributeLabel: string;
  attributeType: string;
  /** Allowed values for `select` attributes (canonical labels). */
  options?: string[];
};

/**
 * Resolve product specifications (RAM, storage, screen size, tonnage, star
 * rating, etc.) for a given model number using OpenAI Responses API + web
 * search. The caller supplies the target category's attribute schema so the
 * returned keys map 1:1 onto the dynamic form fields.
 *
 * Returns a map of `{ attributeName: value }` containing only the attributes
 * the model could determine with confidence. Values for `select` attributes
 * are constrained to the supplied `options`. Failures are silent (returns {}).
 */
export async function resolveProductSpecsByWebSearch(args: {
  brand?: string | null;
  modelNumber: string;
  categoryName?: string | null;
  attributes: SpecAttributeDef[];
  model?: string;
}): Promise<Record<string, string>> {
  if (!config.ocr.openAiApiKey) return {};
  // Enforced here as well as by callers: a search cannot establish a demo
  // flag or a serial number, and asked anyway it will invent an answer.
  const askable = researchableSpecs(args.attributes);
  if (!askable.length) return {};

  const searchModel = args.model || 'gpt-4o';
  const descriptor = [args.brand, args.modelNumber].filter(Boolean).join(' ');
  const category = args.categoryName ? ` (${args.categoryName})` : '';

  // Build a human-readable spec of the fields we want filled.
  const fieldLines = askable.map((a) => {
    const opts =
      a.attributeType === 'select' && a.options?.length
        ? ` — choose EXACTLY one of: ${a.options.join(', ')}`
        : a.attributeType === 'checkbox'
          ? ' — answer true or false'
          : a.attributeType === 'number'
            ? ' — a number only'
            : '';
    return `  - "${a.attributeName}" (${a.attributeLabel})${opts}`;
  });

  const systemPrompt = [
    'You are a product-specification assistant for an Indian electronics/appliance/mobile retailer.',
    'Given a product brand + model number, find its real specifications by searching Indian retail and manufacturer sites.',
    'You MUST call the web_search_preview tool — do not answer from memory alone, because specs vary by model and region.',
    'Return ONLY a single JSON object (no markdown, no prose) whose keys are the requested attribute names.',
    'Include a key ONLY when you are confident of its value from the search results. Omit keys you cannot determine — never guess.',
    'For attributes with a fixed list of choices, the value MUST be one of those exact choices.',
    'For number attributes return a bare number as a string (e.g. "43"). For checkbox attributes return "true" or "false".',
    'If you cannot determine any attribute, return an empty object: {}',
  ].join('\n');

  const userPrompt = [
    `Find the specifications for this product${category}: ${descriptor}`,
    '',
    'Fill ONLY these attributes (use these exact keys):',
    ...fieldLines,
    '',
    'Search query suggestion:',
    `  "${descriptor}" specifications site:amazon.in OR site:flipkart.com OR site:gsmarena.com OR site:croma.com`,
    '',
    'Respond with just the JSON object.',
  ].join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ocr.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: searchModel,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
        ],
        tools: [{ type: 'web_search_preview' }],
        tool_choice: { type: 'web_search_preview' },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[ocr] Spec web-search failed (${response.status}): ${body.slice(0, 300)}`);
      return {};
    }

    const payload = await response.json();
    const text = extractOutputText(payload).trim();
    // The model may wrap the JSON in prose/code fences — extract the first {...} block.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    // Keep only requested keys, normalise to strings, drop empties, and
    // constrain `select` values to the allowed options (case-insensitive).
    const byName = new Map(askable.map((a) => [a.attributeName, a]));
    const out: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
      const def = byName.get(key);
      if (!def) continue;
      if (rawValue === null || rawValue === undefined) continue;
      let value = String(rawValue).trim();
      if (!value || /^(unknown|n\/?a|none)$/i.test(value)) continue;
      if (def.attributeType === 'select' && def.options?.length) {
        const canonical = def.options.find((o) => o.toLowerCase() === value.toLowerCase());
        if (!canonical) continue; // skip values that don't match an allowed option
        value = canonical;
      }
      out[key] = value;
    }
    return out;
  } catch (err) {
    console.warn('[ocr] Spec web-search error:', err);
    return {};
  }
}
/**
 * Work out what a product actually is, by searching for its model code.
 *
 * The item classifier reads an item name and usually knows the product from
 * the words in it. Some names carry only a code — "LG S40T . CINDLLK",
 * "WHIRL- 200 IMPC PRM 1S SAPPHIRE BLISS" — and there the classifier is
 * guessing, which it has done badly: a sound bar read as a sewing machine, a
 * refrigerator as a car battery. A code is exactly what a search engine is
 * good at, so unplaced items come here before anyone is asked to sort them
 * out by hand.
 *
 * Returns the category path copied from `categoryPaths`, or null when the
 * search settles nothing. Failures are silent and return null: this runs
 * after the classifier has already given up, so there is nothing to break.
 */
export async function identifyProductByWebSearch(args: {
  rawName: string;
  brand?: string | null;
  modelNumber?: string | null;
  /** The allowed category paths, exactly as the answer must be spelled. */
  categoryPaths: string[];
  model?: string;
}): Promise<{ categoryPath: string | null; productType: string | null; note: string | null }> {
  if (!config.ocr.openAiApiKey) return { categoryPath: null, productType: null, note: null };
  if (!args.categoryPaths.length) return { categoryPath: null, productType: null, note: null };

  const searchModel = args.model || 'gpt-4o';
  const descriptor = [args.brand, args.modelNumber].filter(Boolean).join(' ') || args.rawName;

  const systemPrompt = [
    'You identify products for an Indian electronics, appliance, furniture and mobile retailer.',
    'You are given one line copied from a shop purchase book. Somebody already tried to read it and could not tell what the product is, because the line is mostly a model code.',
    'You MUST call the web_search_preview tool. A model code is precisely what a search settles and guessing from memory is what already went wrong.',
    'Work out what the product IS — a sound bar, a refrigerator, a washing machine — from the search results.',
    'Then return ONLY a JSON object, no prose and no markdown:',
    '  {"product_type": "<what it is, in plain words>", "category_path": "<one path copied EXACTLY from the allowed list, or null>", "note": "<one short sentence on what you found, or null>"}',
    'Copy "category_path" character for character from the allowed list, separators included. If the search tells you what the product is but no listed category could hold it, give "product_type" and set "category_path" to null.',
    'The moment the search tells you what the product is, that belongs in "product_type", and the matching entry from the list belongs in "category_path". "note" is a remark for a person to read — it is NOT where the answer goes. Writing "Identified as a Whirlpool 200 L Single Door Refrigerator" in "note" while leaving both fields null is the one wrong way to answer: you found it, so say so in the fields.',
    'If the search settles nothing, return {"product_type": null, "category_path": null, "note": "<why>"}. Saying so is a perfectly good answer; an invented one is not.',
  ].join('\n');

  const userPrompt = [
    `Purchase book line: "${args.rawName}"`,
    args.brand ? `Brand already read from it: ${args.brand}` : '',
    args.modelNumber ? `Model code already read from it: ${args.modelNumber}` : '',
    '',
    'Allowed categories, to copy from exactly:',
    ...args.categoryPaths.map((path) => `  ${path}`),
    '',
    'Search query suggestion:',
    `  "${descriptor}" site:amazon.in OR site:flipkart.com OR site:croma.com OR site:reliancedigital.in`,
    '',
    'Respond with just the JSON object.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.ocr.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: searchModel,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
        ],
        tools: [{ type: 'web_search_preview' }],
        tool_choice: { type: 'web_search_preview' },
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.warn(`[ocr] Product identification failed (${response.status}): ${body.slice(0, 200)}`);
      return { categoryPath: null, productType: null, note: null };
    }

    const text = extractOutputText(await response.json()).trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { categoryPath: null, productType: null, note: null };
    const parsed = JSON.parse(match[0]) as {
      product_type?: string | null;
      category_path?: string | null;
      note?: string | null;
    };

    // Only a path that really is on the list, compared loosely enough to
    // survive spacing around the separator.
    const wanted = String(parsed.category_path ?? '').toLowerCase().replace(/\s*>\s*/g, ' > ').trim();
    const categoryPath =
      args.categoryPaths.find((path) => path.toLowerCase().replace(/\s*>\s*/g, ' > ') === wanted) ?? null;

    return {
      categoryPath,
      productType: parsed.product_type?.trim() || null,
      note: parsed.note?.trim() || null,
    };
  } catch (error) {
    console.warn('[ocr] Product identification error:', error);
    return { categoryPath: null, productType: null, note: null };
  }
}
