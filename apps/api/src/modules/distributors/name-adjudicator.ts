import OpenAI from 'openai';
import { config as appConfig } from '../../config/index.js';
import {
  nameSimilarity,
  SIMILAR_NAME_THRESHOLD,
  normalizeCompanyName,
} from '@retailerp/shared-utils';

/**
 * Deciding whether two supplier names are the same business.
 *
 * Trigram overlap answers most of this for nothing: names that barely
 * overlap are different, and names that overlap heavily are the same thing
 * spelled twice. What it cannot see is meaning — it compares letters, so
 * "Shree Balaji Electronics" and "Balaji Shree Electricals" score lower
 * than they deserve, and an abbreviation scores near zero.
 *
 * So a model is asked about the middle only: pairs close enough to be
 * suspicious but not close enough to be obvious. On a 195-row creditors
 * sheet that is a handful of pairs rather than 195 calls, the obvious cases
 * stay instant and free, and the answer stays deterministic everywhere
 * except the band where nothing was certain anyway.
 *
 * If the model is unavailable or says something unexpected, the trigram
 * score stands. Duplicate detection is a help, not a gate, and it must not
 * stop working because a key expired.
 */

/** Below this, two names have nothing to do with each other. */
const ASK_MODEL_FLOOR = 0.4;
/** At or above this, trigrams are already sure enough. */
const ASK_MODEL_CEILING = SIMILAR_NAME_THRESHOLD;

/** Pairs sent in one request. */
const BATCH_SIZE = 25;
const MODEL_TIMEOUT_MS = 30_000;
/** Beyond this many uncertain pairs, the sheet is odd; trigrams can have it. */
const MAX_PAIRS = 200;

let client: OpenAI | null = null;
function openai(): OpenAI {
  client ??= new OpenAI({
    apiKey: appConfig.statements.openAiApiKey,
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: 1,
  });
  return client;
}

export const adjudicatorEnabled = () => appConfig.statements.openAiApiKey.length > 0;

export interface NamePair {
  candidateName: string;
  existingId: string;
  existingName: string;
  score: number;
}

/** A pair the model was asked about, and what it said. */
export interface Adjudication {
  candidateName: string;
  existingId: string;
  same: boolean;
  /** Why, in a few words, for showing next to the warning. */
  reason?: string;
}

const PROMPT = `You compare supplier names from an Indian electronics retailer's books.

For each pair, say whether they are most likely THE SAME business written two
different ways, or two DIFFERENT businesses.

Treat as the same business:
- spelling or transliteration variants (Lakshmi / Laxmi, Jagdambe / Jagdembe)
- word order swapped (Shree Balaji Electronics / Balaji Shree Electronics)
- an abbreviation or expansion of the same name (M S Distributors / M S Distribution Co)
- presence or absence of Pvt, Ltd, LLP, & Co, Enterprises, Traders, India

Treat as different businesses:
- a shared common word but different distinctive name (Sharma Electronics / Gupta Electronics)
- the same family name with a clearly different trade (Balaji Motors / Balaji Electronics)
- a different city or branch where the trade name also differs

When genuinely unsure, answer false. A wrong "same" hides a real supplier;
a wrong "different" only loses a warning.

Reply with JSON only: {"results":[{"i":<pair index>,"same":<true|false>,"reason":"<6 words max>"}]}`;

/**
 * Ask the model about the uncertain pairs.
 *
 * Returns only what it was confident enough to answer; everything else is
 * simply absent, and the caller keeps the trigram verdict.
 */
export async function adjudicateNames(pairs: NamePair[]): Promise<Adjudication[]> {
  if (!adjudicatorEnabled() || pairs.length === 0) return [];

  const uncertain = pairs
    .filter((p) => p.score >= ASK_MODEL_FLOOR && p.score < ASK_MODEL_CEILING)
    // Two names that normalise to the same string need no model.
    .filter((p) => normalizeCompanyName(p.candidateName) !== normalizeCompanyName(p.existingName))
    .slice(0, MAX_PAIRS);

  if (uncertain.length === 0) return [];

  const batches: NamePair[][] = [];
  for (let i = 0; i < uncertain.length; i += BATCH_SIZE) {
    batches.push(uncertain.slice(i, i + BATCH_SIZE));
  }

  const out: Adjudication[] = [];
  for (const batch of batches) {
    try {
      const listing = batch
        .map((p, i) => `${i}. "${p.candidateName}" vs "${p.existingName}"`)
        .join('\n');

      const response = await openai().chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: listing },
        ],
      });

      const text = response.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(text) as {
        results?: Array<{ i?: number; same?: boolean; reason?: string }>;
      };

      for (const row of parsed.results ?? []) {
        const pair = typeof row.i === 'number' ? batch[row.i] : undefined;
        if (!pair || typeof row.same !== 'boolean') continue;
        out.push({
          candidateName: pair.candidateName,
          existingId: pair.existingId,
          same: row.same,
          reason: typeof row.reason === 'string' ? row.reason.slice(0, 80) : undefined,
        });
      }
    } catch (cause) {
      // A batch that fails costs its warnings, not the import.
      console.warn('[distributor-duplicates] name adjudication failed:', cause);
    }
  }

  return out;
}

/** Every candidate-against-existing pair worth asking about. */
export function uncertainPairs(
  candidates: Array<{ companyName: string }>,
  existing: Array<{ id: string; companyName: string }>,
): NamePair[] {
  const pairs: NamePair[] = [];
  for (const candidate of candidates) {
    for (const row of existing) {
      const score = nameSimilarity(candidate.companyName, row.companyName);
      if (score >= ASK_MODEL_FLOOR && score < ASK_MODEL_CEILING) {
        pairs.push({
          candidateName: candidate.companyName,
          existingId: row.id,
          existingName: row.companyName,
          score,
        });
      }
    }
  }
  // Closest first, so the cap keeps the most likely duplicates.
  return pairs.sort((a, b) => b.score - a.score);
}
