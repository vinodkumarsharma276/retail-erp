import OpenAI from 'openai';
import { config as appConfig } from '../../config/index.js';

/**
 * Deciding whether two names written against the same mobile number are one
 * person spelled twice ("Jitender" / "Jitendra") or two people sharing a
 * phone (relatives, or a number reused).
 *
 * Edit distance settles the obvious cases for nothing; only the borderline
 * pairs come here. Only the two names are sent — never the mobile, address
 * or anything else about the customer.
 *
 * The answer is a suggestion shown next to the choice; the person importing
 * always decides. If the model is unavailable or answers oddly, the pair is
 * simply absent and the caller keeps its own verdict.
 */

const BATCH_SIZE = 25;
const MODEL_TIMEOUT_MS = 30_000;
/** Beyond this many borderline pairs in one preview, edit distance can have them. */
const MAX_PAIRS = 400;

let client: OpenAI | null = null;
function openai(): OpenAI {
  client ??= new OpenAI({
    apiKey: appConfig.statements.openAiApiKey,
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: 1,
  });
  return client;
}

export const customerNameAdjudicatorEnabled = () => appConfig.statements.openAiApiKey.length > 0;

export interface PersonNamePair {
  a: string;
  b: string;
}

export interface PersonNameVerdict {
  a: string;
  b: string;
  same: boolean;
  reason?: string;
}

const PROMPT = `You compare customer names from an Indian electronics shop's account register.
Each pair of names was written against the SAME mobile number. Say whether they are
most likely THE SAME person written two ways, or TWO DIFFERENT people who share a phone
(family members often do).

Treat as the same person:
- spelling or transliteration variants (Jitender / Jitendra / Jintendar, Laxmi / Lakshmi)
- a surname or middle name present in one and missing in the other (Ramesh / Ramesh Kumar)
- an initial for a written-out name (R. Kumar / Ramesh Kumar)
- an honorific added or dropped (Smt Sunita / Sunita)

Treat as different people:
- different first names, even with the same surname (Ramesh Kumar / Suresh Kumar)
- gendered forms of a name (Kumar / Kumari, Rajesh / Rajeshwari)
- a relation written in (Ramesh / Ramesh's wife, Ram Singh / Ram Singh son)

When genuinely unsure, answer false. A wrong "same" merges two real customers;
a wrong "different" only leaves one to merge later.

Reply with JSON only: {"results":[{"i":<pair index>,"same":<true|false>,"reason":"<6 words max>"}]}`;

export async function adjudicatePersonNames(pairs: PersonNamePair[]): Promise<PersonNameVerdict[]> {
  if (!customerNameAdjudicatorEnabled() || pairs.length === 0) return [];
  const todo = pairs.slice(0, MAX_PAIRS);

  const out: PersonNameVerdict[] = [];
  for (let start = 0; start < todo.length; start += BATCH_SIZE) {
    const batch = todo.slice(start, start + BATCH_SIZE);
    try {
      const listing = batch.map((p, i) => `${i}. "${p.a}" vs "${p.b}"`).join('\n');
      const response = await openai().chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: listing },
        ],
      });
      const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as {
        results?: Array<{ i?: number; same?: boolean; reason?: string }>;
      };
      for (const row of parsed.results ?? []) {
        const pair = typeof row.i === 'number' ? batch[row.i] : undefined;
        if (!pair || typeof row.same !== 'boolean') continue;
        out.push({
          a: pair.a,
          b: pair.b,
          same: row.same,
          reason: typeof row.reason === 'string' ? row.reason.slice(0, 80) : undefined,
        });
      }
    } catch (cause) {
      // A failed batch costs its suggestions, not the import.
      console.warn('[customer-search] name adjudication failed:', cause);
    }
  }
  return out;
}
