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