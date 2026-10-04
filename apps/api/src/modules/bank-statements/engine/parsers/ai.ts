import OpenAI from 'openai';
import { aiEnabled, config } from '../config.js';
import { CATEGORY_NAMES } from '../categorize/categories.js';
import type { RawTransaction } from '../types.js';
import { parseDate, round2 } from './normalize.js';

let client: OpenAI | null = null;
function openai() {
  if (!aiEnabled()) throw new Error('AI is not configured. Set OPENAI_API_KEY in .env.');
  client ??= new OpenAI({ apiKey: config.openaiKey, timeout: 180_000, maxRetries: 2 });
  return client;
}

/** Run async tasks with a concurrency cap, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------- extraction

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bank_name', 'account_last4', 'currency', 'transactions'],
  properties: {
    bank_name: { type: ['string', 'null'], description: 'Issuing bank, e.g. "HDFC Bank". null if not visible.' },
    account_last4: { type: ['string', 'null'] },
    currency: { type: ['string', 'null'], description: 'ISO 4217 code, e.g. INR, USD' },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'description', 'debit', 'credit', 'balance', 'reference'],
        properties: {
          date: { type: 'string', description: 'Transaction date as YYYY-MM-DD' },
          description: { type: 'string', description: 'Full narration, wrapped lines joined with spaces' },
          debit: { type: ['number', 'null'], description: 'Money out as a positive number, else null' },
          credit: { type: ['number', 'null'], description: 'Money in as a positive number, else null' },
          balance: { type: ['number', 'null'], description: 'Running balance after this row if printed; negative if overdrawn (Dr)' },
          reference: { type: ['string', 'null'], description: 'Cheque / reference / UTR number if a separate column' },
        },
      },
    },
  },
} as const;

const EXTRACTION_PROMPT = `You extract transactions from bank account statements with perfect accuracy.
Rules:
- Output one entry per transaction row, in the order they appear. Never invent, merge, or skip rows.
- Ignore opening/closing balance lines, page totals, summaries, headers, footers and advertisements.
- Dates: output YYYY-MM-DD. Indian statements use DD/MM/YYYY. Use the statement period to resolve ambiguity.
- Put the amount in "debit" (withdrawal / Dr / money out) or "credit" (deposit / Cr / money in), as a positive number without commas or currency symbols.
- If the statement has one amount column, use Dr/Cr markers or the change in running balance to decide debit vs credit.
- Join multi-line narrations into one description, preserving UPI/NEFT/IMPS identifiers and names verbatim.`;

interface Extraction {
  bank_name: string | null;
  account_last4: string | null;
  currency: string | null;
  transactions: { date: string; description: string; debit: number | null; credit: number | null; balance: number | null; reference: string | null }[];
}

type UserContent = OpenAI.Chat.Completions.ChatCompletionContentPart[];

async function runExtraction(content: UserContent): Promise<Extraction> {
  const res = await openai().chat.completions.create({
    model: config.openaiModel,
    temperature: 0,
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'statement', strict: true, schema: EXTRACTION_SCHEMA as any } },
  });
  const msg = res.choices[0]?.message;
  if (msg?.refusal) throw new Error(`AI refused: ${msg.refusal}`);
  return JSON.parse(msg?.content ?? '{}') as Extraction;
}

function toRaw(ex: Extraction): RawTransaction[] {
  const out: RawTransaction[] = [];
  for (const t of ex.transactions ?? []) {
    const date = parseDate(t.date);
    const debit = t.debit && t.debit > 0 ? t.debit : 0;
    const credit = t.credit && t.credit > 0 ? t.credit : 0;
    if (!date || (!debit && !credit)) continue;
    out.push({
      date,
      description: (t.description || '(no description)').replace(/\s+/g, ' ').trim(),
      amount: round2(credit ? credit : -debit),
      balance: t.balance ?? null,
      reference: t.reference || null,
    });
  }
  return out;
}

export interface AiExtractResult {
  transactions: RawTransaction[];
  bank: string | null;
  accountHint: string | null;
  currency: string | null;
}

function merge(parts: Extraction[]): AiExtractResult {
  const first = parts.find((p) => p.bank_name) ?? parts[0];
  return {
    transactions: parts.flatMap(toRaw),
    bank: first?.bank_name ?? null,
    accountHint: parts.find((p) => p.account_last4)?.account_last4 ? `••${parts.find((p) => p.account_last4)!.account_last4!.slice(-4)}` : null,
    currency: parts.find((p) => p.currency)?.currency ?? null,
  };
}

/** Split long statement text into chunks on line boundaries. */
function chunkText(text: string, max = 12_000): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let cur = '';
  for (const l of lines) {
    if (cur.length + l.length + 1 > max && cur) {
      chunks.push(cur);
      cur = '';
    }
    cur += l + '\n';
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

export async function aiExtractFromText(text: string, fileName: string): Promise<AiExtractResult> {
  const chunks = chunkText(text);
  const parts = await mapLimit(chunks, 4, (chunk, i) =>
    runExtraction([
      {
        type: 'text',
        text: `Statement file "${fileName}", part ${i + 1} of ${chunks.length}. Columns are separated by 3+ spaces.\n\n${chunk}`,
      },
    ]),
  );
  return merge(parts);
}

export async function aiExtractFromImage(buf: Buffer, mime: string, fileName: string): Promise<AiExtractResult> {
  const part = await runExtraction([
    { type: 'text', text: `Extract every transaction from this bank statement image ("${fileName}").` },
    { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}`, detail: 'high' } },
  ]);
  return merge([part]);
}

export async function aiExtractFromPdfFile(buf: Buffer, fileName: string): Promise<AiExtractResult> {
  const part = await runExtraction([
    { type: 'text', text: `Extract every transaction from this scanned bank statement ("${fileName}").` },
    { type: 'file', file: { filename: fileName, file_data: `data:application/pdf;base64,${buf.toString('base64')}` } },
  ]);
  return merge([part]);
}

// ---------------------------------------------------------------- categorization

export interface AiCategoryInput {
  key: string;
  description: string;
  amount: number;
  channel: string;
}
export interface AiCategoryOutput {
  key: string;
  category: string;
  counterparty: string | null;
  confidence: number;
  suspicious: boolean;
  note: string | null;
}

const CATEGORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'category', 'counterparty', 'confidence', 'suspicious', 'note'],
        properties: {
          key: { type: 'string' },
          category: { type: 'string', enum: CATEGORY_NAMES },
          counterparty: { type: ['string', 'null'], description: 'Clean merchant / person / company name, Title Case' },
          confidence: { type: 'number', description: '0..1 confidence in the category' },
          suspicious: { type: 'boolean', description: 'True only if an accountant should double-check this entry' },
          note: { type: ['string', 'null'], description: 'Short reason (max 12 words) when confidence < 0.7 or suspicious' },
        },
      },
    },
  },
} as const;

const CATEGORY_PROMPT = `You are an expert Indian bookkeeper categorizing bank transactions for a group of consumer-electronics and home-appliance retail shops.
Context:
- Negative amount = money out (debit); positive = money in (credit).
- Customer payments received by the shop (UPI collections, card settlements from POS providers like Pine Labs / Paytm / Razorpay / PhonePe, cash deposits of sales) are "Business Income".
- Payments to electronics distributors / brands (Samsung, LG, Sony, Whirlpool, Voltas, Havells, etc.) or wholesalers are "Vendor & Supplier Payments".
- Salaries paid to staff are "Payroll & Salaries Paid". GST, TDS and challans are "Taxes & Government".
- UPI transfers to what looks like an individual's name with no business context are "Personal Transfers".
- Use "Uncategorized" only when there is genuinely no signal.
Return one result per input key. Be calibrated: confidence below 0.6 when guessing.`;

export async function aiCategorize(items: AiCategoryInput[]): Promise<Map<string, AiCategoryOutput>> {
  const result = new Map<string, AiCategoryOutput>();
  const batches: AiCategoryInput[][] = [];
  for (let i = 0; i < items.length; i += 60) batches.push(items.slice(i, i + 60));

  await mapLimit(batches, 4, async (batch) => {
    const res = await openai().chat.completions.create({
      model: config.openaiModel,
      temperature: 0,
      messages: [
        { role: 'system', content: CATEGORY_PROMPT },
        {
          role: 'user',
          content: JSON.stringify(batch.map((b) => ({ key: b.key, description: b.description, amount: b.amount, channel: b.channel }))),
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'categories', strict: true, schema: CATEGORY_SCHEMA as any } },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{"results":[]}') as { results: AiCategoryOutput[] };
    for (const r of parsed.results) result.set(r.key, r);
  });
  return result;
}
