import OpenAI from 'openai';
import { config as appConfig } from '../../config/index.js';
import { glossaryLines, PRODUCT_TEXT_RULES } from './customer-search.product-glossary.js';
import { proposeType, TYPE_PATH_SEPARATOR, type ProductTypeMatch, type TypeTree } from './customer-search.product-types.js';

/**
 * Asking a model what the Product texts nobody recognised mean.
 *
 * Only texts that no saved decision, glossary entry or type name explains
 * are sent: the text, how many rows have it, and a few Brand / Model pairs
 * written beside it, with the tenant's type names. No customer names,
 * mobiles or addresses. Every answer is checked against the tree and is
 * only pre-filled on the import screen; a person confirms it. No key, a
 * failure or a nonsensical answer leaves the text as it was.
 */

const BATCH_SIZE = 60;
const MAX_TEXTS = 300;

let client: OpenAI | null = null;
function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: appConfig.statements.openAiApiKey, timeout: 60_000, maxRetries: 1 });
  return client;
}

export const productAdjudicatorEnabled = () => appConfig.statements.openAiApiKey.length > 0;

export function productPrompt(tree: TypeTree): string {
  const types = tree.all
    .map((c) => tree.label(c.id))
    .filter((l): l is string => !!l)
    .sort()
    .join('\n');
  return `You map the free-text "Product" column of an Indian electronics, home-appliance, furniture and
mobile shop's account register to the shop's product types. Staff type fast in English and
Hinglish: expect abbreviations, misspellings, Hindi words, a brand written instead of the product,
several items in one cell, and a count written instead of the items.

The shop's product types (one path per line, " › " between levels):
${types}

Spellings already known (text → type):
${glossaryLines().join('\n')}

How the shop writes products:
${PRODUCT_TEXT_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}

For each numbered text, answer one of:
- "type": it is one product of an existing type. "path" is that type's full path, copied exactly.
- "new": it is one real product with no fitting type. "path" is an existing parent path plus the
  new type's name as the last element (or just [name] for a new top-level type). Use a short,
  correctly spelt English name in Title Case.
- "several": it names more than one product. "items" lists each one's type path.
- "blank": it names no product (junk, a note, a model number alone with no clue).
- "unsure": you cannot tell.

Judge by sound for misspellings. Use the Brand / Model samples when the text alone is unclear
(e.g. a brand typed as the product). Prefer the most specific existing type. When genuinely unsure,
answer "unsure": a wrong type mislabels every row with that text, while "unsure" only asks a person.

Reply with JSON only:
{"results":[{"i":<text index>,"kind":"type|new|several|blank|unsure","path":["…"],"items":[["…"]],"reason":"<8 words max>"}]}`;
}

interface Answer {
  i?: number;
  kind?: string;
  path?: unknown;
  items?: unknown;
  reason?: unknown;
}

const asPath = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.length <= 6 && v.every((s) => typeof s === 'string' && s.trim() && s.length <= 100)
    ? v.map((s: string) => s.trim())
    : null;

/** The model's answer as a suggestion for one match, or null when it doesn't hold up. */
export function applyAnswer(match: ProductTypeMatch, answer: Answer, tree: TypeTree): ProductTypeMatch | null {
  const reason = typeof answer.reason === 'string' ? `AI: ${answer.reason.slice(0, 80)}` : 'AI suggestion';
  const path = asPath(answer.path);
  switch (answer.kind) {
    case 'type': {
      const found = path ? tree.find(path) : null;
      if (!found) return null;
      return { ...match, kind: 'ai', categoryId: found.id, categoryName: tree.label(found.id), create: undefined, suggestion: { action: 'existing', categoryId: found.id }, reason };
    }
    case 'new': {
      if (!path) return null;
      // A "new" type that already exists is that type.
      const found = tree.find(path);
      if (found) return applyAnswer(match, { ...answer, kind: 'type' }, tree);
      if (path.length > 1 && !tree.find(path.slice(0, -1))) return null;
      const create = proposeType(path, tree);
      return { ...match, kind: 'ai', categoryId: null, categoryName: null, create, suggestion: { action: 'create', name: create.name, parentId: create.parentId }, reason };
    }
    case 'several': {
      const items = Array.isArray(answer.items) ? answer.items.map(asPath).filter((p): p is string[] => !!p) : [];
      if (items.length < 2 || items.length > 10) return null;
      // Splitting changes the rows, so a person does it: the row's Product is edited to "A, B".
      const names = items.map((p) => p.join(TYPE_PATH_SEPARATOR)).join(' + ');
      return { ...match, reason: `AI: several items — ${names}. Separate them with commas in the row to split it.`, suggestion: { action: 'blank' } };
    }
    case 'blank':
      return { ...match, kind: 'ai', categoryId: null, categoryName: null, create: undefined, suggestion: { action: 'blank' }, reason };
    case 'unsure':
      return { ...match, reason: typeof answer.reason === 'string' ? `AI unsure: ${answer.reason.slice(0, 80)}` : 'AI unsure' };
    default:
      return null;
  }
}

/**
 * Ask about the texts still unexplained (`new` and spelling lookalikes).
 * Returns the matches with suggestions filled in; `asked` says whether the
 * model was called, `answered` how many came back usable.
 */
export async function adjudicateProductTexts(
  matches: ProductTypeMatch[],
  tree: TypeTree,
): Promise<{ matches: ProductTypeMatch[]; asked: boolean; answered: number }> {
  const todo = matches.filter((m) => m.kind === 'new' || m.kind === 'similar').slice(0, MAX_TEXTS);
  if (!productAdjudicatorEnabled() || todo.length === 0) return { matches, asked: false, answered: 0 };

  const updated = new Map<string, ProductTypeMatch>();
  const system = productPrompt(tree);
  for (let start = 0; start < todo.length; start += BATCH_SIZE) {
    const batch = todo.slice(start, start + BATCH_SIZE);
    try {
      const listing = batch
        .map((m, i) => `${i}. "${m.text}" ×${m.rows}${m.samples.length ? ` — samples: ${m.samples.join('; ')}` : ''}`)
        .join('\n');
      const response = await openai().chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: listing },
        ],
      });
      const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as { results?: Answer[] };
      for (const answer of parsed.results ?? []) {
        const match = typeof answer.i === 'number' ? batch[answer.i] : undefined;
        if (!match || updated.has(match.textKey)) continue;
        const next = applyAnswer(match, answer, tree);
        if (next) updated.set(match.textKey, next);
      }
    } catch (cause) {
      // A failed batch costs its suggestions, not the import.
      console.warn('[customer-search] product type suggestions failed:', cause);
    }
  }
  return {
    matches: matches.map((m) => updated.get(m.textKey) ?? m),
    asked: true,
    answered: updated.size,
  };
}
