import { createHash } from 'node:crypto';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { aiEnabled, config } from './engine/config.js';
import { getSettings, query, saveSettings, withTx, type Settings } from './engine/db.js';
import { CATEGORIES, GROUPS, groupOf } from './engine/categorize/categories.js';
import { enrichTransactions } from './engine/categorize/engine.js';
import { recomputeFlags } from './engine/categorize/flags.js';
import { descriptionKey } from './engine/categorize/merchant.js';
import { compileUserRules } from './engine/categorize/rules.js';
import { parseStatement, PdfPasswordError, SUPPORTED_EXT, UnsupportedError } from './engine/parsers/index.js';
import type { RawTransaction } from './engine/types.js';
import type { Filters, TxPatch } from './bank-statements.validation.js';
import type { z } from 'zod';
import type { listSchema, ruleSchema, statementPatchSchema } from './bank-statements.validation.js';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** The tenant and the shops this request may read or write (from shopScope). */
export interface Scope {
  tenantId: string;
  shopIds: string[];
}

// ---------------------------------------------------------------- filters

/** Parameterised WHERE over `statement_transactions t`, always tenant + shop scoped. */
function buildWhere(f: Filters, scope: Scope, startIndex = 1) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${startIndex + params.length - 1}`;
  };
  // Requested shops narrow the accessible set; they can never widen it.
  const shops = f.shopIds.length ? f.shopIds.filter((id) => scope.shopIds.includes(id)) : scope.shopIds;
  clauses.push(`t.tenant_id = ${p(scope.tenantId)}`, `t.shop_id = ANY(${p(shops)}::text[])`);
  if (f.statementIds.length) clauses.push(`t.statement_id = ANY(${p(f.statementIds)}::text[])`);
  if (f.banks.length) clauses.push(`t.bank = ANY(${p(f.banks)}::text[])`);
  if (f.categories.length) clauses.push(`t.category = ANY(${p(f.categories)}::text[])`);
  if (f.channels.length) clauses.push(`t.channel = ANY(${p(f.channels)}::text[])`);
  if (f.from) clauses.push(`t.date >= ${p(f.from)}::date`);
  if (f.to) clauses.push(`t.date <= ${p(f.to)}::date`);
  if (f.direction) clauses.push(`t.direction = ${p(f.direction)}`);
  if (f.flagged) clauses.push(`t.flagged = ${p(f.flagged === 'true')}`);
  if (f.review === 'none') clauses.push(`t.review_status IS NULL`);
  else if (f.review) clauses.push(`t.review_status = ${p(f.review)}`);
  if (f.reason) clauses.push(`t.flag_reasons @> jsonb_build_array(jsonb_build_object('code', ${p(f.reason)}::text))`);
  if (f.q) {
    const like = p(`%${f.q.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
    const num = Number(f.q.replace(/,/g, ''));
    const amountClause = Number.isFinite(num) && f.q.trim() !== '' ? ` OR abs(t.amount) = ${p(Math.abs(num))}::numeric` : '';
    clauses.push(
      `(t.description ILIKE ${like} OR t.counterparty ILIKE ${like} OR t.reference ILIKE ${like} OR t.category ILIKE ${like}${amountClause})`,
    );
  }
  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

const TX_COLUMNS = `t.id, t.statement_id, t.shop_id, sh.name AS shop_name, t.bank, t.date, t.description, t.amount, t.direction,
  t.balance, t.reference, t.counterparty, t.channel, t.category, t.category_source, t.confidence, t.ai_note, t.flagged,
  t.flag_reasons, t.review_status, t.reviewer_note, t.reviewed_at, t.reviewed_by, s.file_name`;
const TX_FROM = `FROM statement_transactions t JOIN shops sh ON sh.id = t.shop_id JOIN bank_statements s ON s.id = t.statement_id`;

const SORTS: Record<string, string> = {
  date: 't.date',
  amount: 't.amount',
  abs: 'abs(t.amount)',
  category: 't.category',
  bank: 't.bank',
  shop: 'sh.name',
  counterparty: 't.counterparty',
};

function assertShop(scope: Scope, shopId: string) {
  if (!scope.shopIds.includes(shopId)) throw new HttpError(403, 'You do not have access to this shop.');
}

/** Recompute flags for each distinct shop (sequentially; each pass reads the whole shop). */
async function reflag(tenantId: string, shopIds: Iterable<string>) {
  for (const shopId of new Set(shopIds)) await recomputeFlags(tenantId, shopId);
}

// ---------------------------------------------------------------- meta

export async function getMeta(scope: Scope) {
  const [shops, settings] = await Promise.all([
    query<{ id: string; name: string; code: string }>(
      'SELECT id, name, code FROM shops WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY name',
      [scope.tenantId, scope.shopIds],
    ),
    getSettings(scope.tenantId),
  ]);
  return {
    shops: shops.rows,
    categories: CATEGORIES,
    groups: GROUPS,
    ai: { enabled: aiEnabled(), model: config.openaiModel },
    supportedExtensions: SUPPORTED_EXT,
    maxFileMb: Math.round(config.maxFileBytes / 1024 / 1024),
    settings,
  };
}

// ---------------------------------------------------------------- statements

export interface UploadInput {
  buffer: Buffer;
  fileName: string;
  shopId: string;
  bank?: string;
  password?: string;
  uploadedById: string;
}

export async function uploadStatement(scope: Scope, input: UploadInput) {
  assertShop(scope, input.shopId);
  const { tenantId } = scope;
  const { buffer, fileName, shopId } = input;

  const shop = await query<{ name: string }>('SELECT name FROM shops WHERE id = $1 AND tenant_id = $2', [shopId, tenantId]);
  if (!shop.rowCount) throw new HttpError(400, 'Unknown shop.');

  const hash = createHash('sha256').update(buffer).digest('hex');
  const dup = await query<{ file_name: string }>('SELECT file_name FROM bank_statements WHERE shop_id = $1 AND file_hash = $2', [
    shopId,
    hash,
  ]);
  if (dup.rowCount) {
    throw new HttpError(409, `This file was already uploaded for ${shop.rows[0].name} as "${dup.rows[0].file_name}".`);
  }

  let parsed;
  try {
    parsed = await parseStatement({ buffer, fileName, password: input.password });
  } catch (err) {
    if (err instanceof PdfPasswordError) throw new HttpError(422, err.message, { needsPassword: true });
    if (err instanceof UnsupportedError) throw new HttpError(422, err.message);
    throw err;
  }
  if (!parsed.transactions.length) throw new HttpError(422, 'No transactions were found in this file.');

  const enriched = await enrichTransactions(parsed.transactions, { tenantId, shopId });
  const warnings = [...parsed.warnings];
  if (enriched.aiError) warnings.push(`AI categorization failed (${enriched.aiError}); rule-based categories were used.`);

  const bank = input.bank || parsed.bank || 'Unknown bank';
  const dates = enriched.rows.map((r) => r.date).sort();
  const currency = parsed.currency ?? 'INR';

  const statementId = await withTx(async (db) => {
    const st = await query<{ id: string }>(
      `INSERT INTO bank_statements (id, tenant_id, shop_id, file_name, file_hash, file_type, file_size, bank, account_hint, currency,
                                    parse_method, reconciliation, warnings, period_start, period_end, tx_count, uploaded_by_id)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::date, $14::date, $15, $16)
       RETURNING id`,
      [
        tenantId, shopId, fileName, hash, path.extname(fileName).slice(1).toLowerCase(), buffer.length, bank, parsed.accountHint,
        currency, parsed.method, parsed.reconciliation, JSON.stringify(warnings), dates[0], dates[dates.length - 1],
        enriched.rows.length, input.uploadedById,
      ],
      db,
    );
    const id = st.rows[0].id;
    const rows = enriched.rows.map((x, i) => ({
      date: x.date,
      description: x.description,
      amount: x.amount,
      direction: x.direction,
      balance: x.balance,
      reference: x.reference ? x.reference.slice(0, 100) : null,
      counterparty: x.counterparty ? x.counterparty.slice(0, 120) : null,
      channel: x.channel,
      category: x.category,
      category_source: x.categorySource,
      confidence: x.confidence,
      ai_note: x.aiNote,
      fingerprint: `${x.date}|${x.amount}|${descriptionKey(x.description)}`,
      row_index: i,
    }));
    await query(
      `INSERT INTO statement_transactions (id, tenant_id, statement_id, shop_id, bank, date, description, amount, direction, balance,
                                           reference, counterparty, channel, category, category_source, confidence, ai_note,
                                           fingerprint, row_index)
       SELECT gen_random_uuid()::text, $1, $2, $3, $4, u.date, u.description, u.amount, u.direction, u.balance, u.reference,
              u.counterparty, u.channel, u.category, u.category_source, u.confidence, u.ai_note, u.fingerprint, u.row_index
         FROM jsonb_to_recordset($5::jsonb) AS u(date date, description text, amount numeric, direction text, balance numeric,
              reference text, counterparty text, channel text, category text, category_source text, confidence real,
              ai_note text, fingerprint text, row_index int)`,
      [tenantId, id, shopId, bank, JSON.stringify(rows)],
      db,
    );
    return id;
  });

  await recomputeFlags(tenantId, shopId);
  return { statement: await getStatement(scope, statementId), aiUsed: enriched.aiUsed };
}

const STATEMENT_SELECT = `
  SELECT s.id, s.shop_id, sh.name AS shop_name, s.file_name, s.file_type, s.file_size, s.bank, s.account_hint, s.currency,
         s.parse_method, s.reconciliation, s.warnings, s.period_start, s.period_end, s.tx_count, s.uploaded_at,
         u.full_name AS uploaded_by,
         COALESCE(sum(CASE WHEN t.direction='credit' THEN t.amount END), 0) AS inflow,
         COALESCE(-sum(CASE WHEN t.direction='debit' THEN t.amount END), 0) AS outflow,
         count(t.id) FILTER (WHERE t.review_status = 'pending') AS pending_review,
         count(t.id) FILTER (WHERE t.flagged) AS flagged
    FROM bank_statements s JOIN shops sh ON sh.id = s.shop_id
    LEFT JOIN users u ON u.id = s.uploaded_by_id
    LEFT JOIN statement_transactions t ON t.statement_id = s.id`;
const STATEMENT_GROUP = 'GROUP BY s.id, sh.name, u.full_name';

async function getStatement(scope: Scope, id: string) {
  const { rows } = await query(
    `${STATEMENT_SELECT} WHERE s.id = $1 AND s.tenant_id = $2 AND s.shop_id = ANY($3::text[]) ${STATEMENT_GROUP}`,
    [id, scope.tenantId, scope.shopIds],
  );
  if (!rows.length) throw new HttpError(404, 'Statement not found.');
  return rows[0];
}

export async function listStatements(scope: Scope, shopIds: string[]) {
  const shops = shopIds.length ? shopIds.filter((s) => scope.shopIds.includes(s)) : scope.shopIds;
  const { rows } = await query(
    `${STATEMENT_SELECT} WHERE s.tenant_id = $1 AND s.shop_id = ANY($2::text[]) ${STATEMENT_GROUP} ORDER BY s.uploaded_at DESC`,
    [scope.tenantId, shops],
  );
  return rows;
}

/** Fetch a statement's owning shop, enforcing tenant + shop access. */
async function statementShop(scope: Scope, id: string) {
  const { rows } = await query<{ shop_id: string }>('SELECT shop_id FROM bank_statements WHERE id = $1 AND tenant_id = $2', [
    id,
    scope.tenantId,
  ]);
  if (!rows.length) throw new HttpError(404, 'Statement not found.');
  assertShop(scope, rows[0].shop_id);
  return rows[0].shop_id;
}

export async function updateStatement(scope: Scope, id: string, body: z.infer<typeof statementPatchSchema>) {
  const before = await statementShop(scope, id);
  if (body.shopId) assertShop(scope, body.shopId);
  await withTx(async (db) => {
    if (body.bank) {
      await query('UPDATE bank_statements SET bank = $2 WHERE id = $1', [id, body.bank], db);
      await query('UPDATE statement_transactions SET bank = $2 WHERE statement_id = $1', [id, body.bank], db);
    }
    if (body.shopId) {
      await query('UPDATE bank_statements SET shop_id = $2 WHERE id = $1', [id, body.shopId], db);
      await query('UPDATE statement_transactions SET shop_id = $2 WHERE statement_id = $1', [id, body.shopId], db);
    }
  });
  if (body.shopId && body.shopId !== before) await reflag(scope.tenantId, [before, body.shopId]);
  return getStatement(scope, id);
}

export async function deleteStatement(scope: Scope, id: string) {
  const shopId = await statementShop(scope, id);
  await query('DELETE FROM bank_statements WHERE id = $1', [id]);
  await recomputeFlags(scope.tenantId, shopId);
}

/** Re-run rules + AI for everything in a statement that a person hasn't categorized by hand. */
export async function recategorizeStatement(scope: Scope, id: string) {
  const shopId = await statementShop(scope, id);
  const { rows } = await query<RawTransaction & { id: string }>(
    `SELECT id, date, description, amount, balance, reference FROM statement_transactions
      WHERE statement_id = $1 AND category_source <> 'user' ORDER BY row_index`,
    [id],
  );
  const enriched = await enrichTransactions(rows, { tenantId: scope.tenantId, shopId });
  const updates = rows.map((r, i) => {
    const e = enriched.rows[i];
    return {
      id: r.id,
      category: e.category,
      source: e.categorySource,
      confidence: e.confidence,
      note: e.aiNote,
      counterparty: e.counterparty ? e.counterparty.slice(0, 120) : null,
      channel: e.channel,
    };
  });
  if (updates.length) {
    await query(
      `UPDATE statement_transactions t SET category = u.category, category_source = u.source, confidence = u.confidence,
              ai_note = u.note, counterparty = COALESCE(u.counterparty, t.counterparty), channel = u.channel
         FROM jsonb_to_recordset($1::jsonb) AS u(id text, category text, source text, confidence real, note text,
              counterparty text, channel text)
        WHERE t.id = u.id`,
      [JSON.stringify(updates)],
    );
  }
  await recomputeFlags(scope.tenantId, shopId);
  return { updated: rows.length, aiUsed: enriched.aiUsed, aiError: enriched.aiError ?? null };
}

// ---------------------------------------------------------------- transactions

export async function listTransactions(scope: Scope, f: z.infer<typeof listSchema>) {
  const sortKey = SORTS[f.sort] ?? SORTS.date;
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const where = buildWhere(f, scope);
  const n = where.params.length;

  const [list, totals] = await Promise.all([
    query(
      `SELECT ${TX_COLUMNS} ${TX_FROM} ${where.sql}
        ORDER BY ${sortKey} ${dir} NULLS LAST, t.date ${dir}, t.row_index ${dir}, t.id ${dir}
        LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...where.params, f.pageSize, (f.page - 1) * f.pageSize],
    ),
    query<{ total: number; inflow: number; outflow: number }>(
      `SELECT count(*) AS total,
              COALESCE(sum(t.amount) FILTER (WHERE t.direction='credit'), 0) AS inflow,
              COALESCE(-sum(t.amount) FILTER (WHERE t.direction='debit'), 0) AS outflow
         FROM statement_transactions t ${where.sql}`,
      where.params,
    ),
  ]);
  return {
    rows: list.rows.map((r: any) => ({ ...r, group: groupOf(r.category) })),
    page: f.page,
    pageSize: f.pageSize,
    ...totals.rows[0],
  };
}

export async function getFacets(scope: Scope) {
  const params = [scope.tenantId, scope.shopIds];
  const where = 'WHERE tenant_id = $1 AND shop_id = ANY($2::text[])';
  const [banks, channels] = await Promise.all([
    query<{ bank: string }>(`SELECT DISTINCT bank FROM statement_transactions ${where} ORDER BY bank`, params),
    query<{ channel: string }>(`SELECT DISTINCT channel FROM statement_transactions ${where} ORDER BY channel`, params),
  ]);
  return { banks: banks.rows.map((r) => r.bank), channels: channels.rows.map((r) => r.channel) };
}

export async function getTransaction(scope: Scope, id: string) {
  const { rows } = await query(
    `SELECT ${TX_COLUMNS} ${TX_FROM} WHERE t.id = $1 AND t.tenant_id = $2 AND t.shop_id = ANY($3::text[])`,
    [id, scope.tenantId, scope.shopIds],
  );
  if (!rows.length) throw new HttpError(404, 'Transaction not found.');
  return { ...rows[0], group: groupOf(rows[0].category) };
}

/**
 * Apply a category / review change to transactions within scope. The reviewer
 * is always the signed-in user (LedgerLens asked for a "Reviewing as" name).
 */
export async function patchTransactions(scope: Scope, ids: string[], body: TxPatch, reviewerName: string) {
  if (!ids.length) return [];
  const sets: string[] = [];
  const params: unknown[] = [ids, scope.tenantId, scope.shopIds];
  if (body.category) {
    params.push(body.category);
    sets.push(`category = $${params.length}`, `category_source = 'user'`, `confidence = 1`);
  }
  if (body.review_status !== undefined) {
    params.push(body.review_status);
    const i = params.length;
    sets.push(`review_status = $${i}`, `reviewed_at = CASE WHEN $${i}::text IN ('verified','suspicious') THEN now() ELSE NULL END`);
    params.push(body.review_status === 'verified' || body.review_status === 'suspicious' ? reviewerName : null);
    sets.push(`reviewed_by = $${params.length}`);
  }
  if (body.reviewer_note !== undefined) {
    params.push(body.reviewer_note);
    sets.push(`reviewer_note = $${params.length}`);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update.');
  const { rows } = await query<{ shop_id: string }>(
    `UPDATE statement_transactions SET ${sets.join(', ')}
      WHERE id = ANY($1::text[]) AND tenant_id = $2 AND shop_id = ANY($3::text[]) RETURNING shop_id`,
    params,
  );
  // A category change can resolve (or create) flags.
  if (body.category) await reflag(scope.tenantId, rows.map((r) => r.shop_id));
  return rows;
}

// ---------------------------------------------------------------- analytics

export async function getAnalytics(scope: Scope, f: Filters) {
  const w = buildWhere(f, scope);
  const and = (extra: string) => `${w.sql} AND ${extra}`;
  const q = <T extends Record<string, any>>(sql: string) => query<T>(sql, w.params).then((r) => r.rows);
  const FROM = 'FROM statement_transactions t JOIN shops sh ON sh.id = t.shop_id';

  const [totals, monthly, categories, channels, payees, payers, shops, banks, weekday, daily, largest, reasons, currency] =
    await Promise.all([
      q(`SELECT count(*) AS count,
                COALESCE(sum(t.amount) FILTER (WHERE t.direction='credit'), 0) AS inflow,
                COALESCE(-sum(t.amount) FILTER (WHERE t.direction='debit'), 0) AS outflow,
                count(*) FILTER (WHERE t.direction='credit') AS credit_count,
                count(*) FILTER (WHERE t.direction='debit') AS debit_count,
                count(*) FILTER (WHERE t.flagged) AS flagged,
                count(*) FILTER (WHERE t.review_status='pending') AS pending,
                count(*) FILTER (WHERE t.review_status='verified') AS verified,
                count(*) FILTER (WHERE t.review_status='suspicious') AS suspicious,
                count(*) FILTER (WHERE t.category='Uncategorized') AS uncategorized,
                count(*) FILTER (WHERE t.category_source='ai') AS ai_categorized,
                count(DISTINCT t.statement_id) AS statements,
                min(t.date) AS date_from, max(t.date) AS date_to
           ${FROM} ${w.sql}`),
      q(`SELECT to_char(date_trunc('month', t.date), 'YYYY-MM') AS month,
                COALESCE(sum(t.amount) FILTER (WHERE t.direction='credit'), 0) AS inflow,
                COALESCE(-sum(t.amount) FILTER (WHERE t.direction='debit'), 0) AS outflow,
                count(*) AS count
           ${FROM} ${w.sql} GROUP BY 1 ORDER BY 1`),
      q<{ category: string; direction: string; amount: number; count: number }>(
        `SELECT t.category, t.direction, abs(sum(t.amount)) AS amount, count(*) AS count
           ${FROM} ${w.sql} GROUP BY 1, 2 ORDER BY 3 DESC`,
      ),
      q(`SELECT t.channel, t.direction, abs(sum(t.amount)) AS amount, count(*) AS count
           ${FROM} ${w.sql} GROUP BY 1, 2 ORDER BY 3 DESC`),
      q(`SELECT mode() WITHIN GROUP (ORDER BY COALESCE(t.counterparty, 'Unknown')) AS name, -sum(t.amount) AS amount, count(*) AS count,
                mode() WITHIN GROUP (ORDER BY t.category) AS category
           ${FROM} ${and(`t.direction='debit'`)}
          GROUP BY lower(regexp_replace(COALESCE(t.counterparty, 'Unknown'), '[^a-zA-Z0-9]', '', 'g')) ORDER BY 2 DESC LIMIT 12`),
      q(`SELECT mode() WITHIN GROUP (ORDER BY COALESCE(t.counterparty, 'Unknown')) AS name, sum(t.amount) AS amount, count(*) AS count,
                mode() WITHIN GROUP (ORDER BY t.category) AS category
           ${FROM} ${and(`t.direction='credit'`)}
          GROUP BY lower(regexp_replace(COALESCE(t.counterparty, 'Unknown'), '[^a-zA-Z0-9]', '', 'g')) ORDER BY 2 DESC LIMIT 12`),
      q(`SELECT sh.id, sh.name,
                COALESCE(sum(t.amount) FILTER (WHERE t.direction='credit'), 0) AS inflow,
                COALESCE(-sum(t.amount) FILTER (WHERE t.direction='debit'), 0) AS outflow,
                count(*) AS count, count(*) FILTER (WHERE t.review_status='pending') AS pending
           ${FROM} ${w.sql} GROUP BY 1, 2 ORDER BY 2`),
      q(`SELECT t.bank,
                COALESCE(sum(t.amount) FILTER (WHERE t.direction='credit'), 0) AS inflow,
                COALESCE(-sum(t.amount) FILTER (WHERE t.direction='debit'), 0) AS outflow,
                count(*) AS count
           ${FROM} ${w.sql} GROUP BY 1 ORDER BY 4 DESC`),
      q(`SELECT extract(isodow FROM t.date)::int AS dow,
                COALESCE(sum(t.amount) FILTER (WHERE t.direction='credit'), 0) AS inflow,
                COALESCE(-sum(t.amount) FILTER (WHERE t.direction='debit'), 0) AS outflow,
                count(*) AS count
           ${FROM} ${w.sql} GROUP BY 1 ORDER BY 1`),
      q(`SELECT t.date,
                COALESCE(sum(t.amount) FILTER (WHERE t.direction='credit'), 0) AS inflow,
                COALESCE(-sum(t.amount) FILTER (WHERE t.direction='debit'), 0) AS outflow
           ${FROM} ${w.sql} GROUP BY 1 ORDER BY 1`),
      q<{ category: string }>(
        `SELECT t.id, t.date, t.description, t.counterparty, t.amount, t.category, t.bank, sh.name AS shop_name, t.flagged, t.review_status
           ${FROM} ${w.sql} ORDER BY abs(t.amount) DESC LIMIT 10`,
      ),
      q(`SELECT r->>'code' AS code, r->>'severity' AS severity, count(*) AS count
           ${FROM} CROSS JOIN LATERAL jsonb_array_elements(t.flag_reasons) r
           ${and(`t.review_status = 'pending'`)} GROUP BY 1, 2 ORDER BY 3 DESC`),
      query<{ currency: string }>(
        `SELECT currency FROM bank_statements WHERE tenant_id = $1 AND shop_id = ANY($2::text[])
          GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
        [scope.tenantId, scope.shopIds],
      ).then((r) => r.rows),
    ]);

  // Roll categories up into fixed groups (entity-stable colours on the client).
  const groupTotals = new Map<string, { outflow: number; inflow: number; count: number }>();
  for (const g of GROUPS) groupTotals.set(g.id, { outflow: 0, inflow: 0, count: 0 });
  for (const c of categories) {
    const g = groupTotals.get(groupOf(c.category))!;
    if (c.direction === 'debit') g.outflow += c.amount;
    else g.inflow += c.amount;
    g.count += c.count;
  }

  return {
    currency: currency[0]?.currency ?? 'INR',
    totals: totals[0],
    monthly,
    categories: categories.map((c) => ({ ...c, group: groupOf(c.category) })),
    groups: GROUPS.map((g) => ({ ...g, ...groupTotals.get(g.id)! })),
    channels,
    topPayees: payees,
    topPayers: payers,
    shops,
    banks,
    weekday,
    daily,
    largest: largest.map((l) => ({ ...l, group: groupOf(l.category) })),
    reviewReasons: reasons,
  };
}

// ---------------------------------------------------------------- rules & settings

export async function listRules(scope: Scope) {
  const { rows } = await query(
    `SELECT r.id, r.pattern, r.match_type, r.category, r.shop_id, r.created_at, sh.name AS shop_name
       FROM statement_rules r LEFT JOIN shops sh ON sh.id = r.shop_id
      WHERE r.tenant_id = $1 ORDER BY r.created_at DESC`,
    [scope.tenantId],
  );
  return rows;
}

export async function createRule(scope: Scope, body: z.infer<typeof ruleSchema>) {
  if (body.shop_id) assertShop(scope, body.shop_id);
  if (body.match_type === 'regex') {
    try {
      new RegExp(body.pattern, 'i');
    } catch {
      throw new HttpError(400, 'Invalid regular expression.');
    }
  }
  const { rows } = await query(
    `INSERT INTO statement_rules (id, tenant_id, pattern, match_type, category, shop_id)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5) RETURNING id, pattern, match_type, category, shop_id, created_at`,
    [scope.tenantId, body.pattern, body.match_type, body.category, body.shop_id],
  );
  let applied = 0;
  if (body.applyToExisting) {
    const [rule] = compileUserRules([rows[0]]);
    // Re-categorise only within the shops this user can see.
    const shops = body.shop_id ? [body.shop_id] : scope.shopIds;
    const candidates = await query<{ id: string; description: string; shop_id: string }>(
      `SELECT id, description, shop_id FROM statement_transactions
        WHERE tenant_id = $1 AND shop_id = ANY($2::text[]) AND category_source <> 'user'`,
      [scope.tenantId, shops],
    );
    const hits = candidates.rows.filter((t) => rule.re.test(t.description));
    if (hits.length) {
      await query(
        `UPDATE statement_transactions SET category = $2, category_source = 'user-rule', confidence = 1 WHERE id = ANY($1::text[])`,
        [hits.map((h) => h.id), body.category],
      );
      await reflag(scope.tenantId, hits.map((h) => h.shop_id));
    }
    applied = hits.length;
  }
  return { rule: rows[0], applied };
}

export async function deleteRule(scope: Scope, id: string) {
  await query('DELETE FROM statement_rules WHERE id = $1 AND tenant_id = $2', [id, scope.tenantId]);
}

export async function updateSettings(scope: Scope, patch: Partial<Settings>) {
  const saved = await saveSettings(scope.tenantId, patch);
  const shops = await query<{ shop_id: string }>('SELECT DISTINCT shop_id FROM bank_statements WHERE tenant_id = $1', [scope.tenantId]);
  await reflag(scope.tenantId, shops.rows.map((s) => s.shop_id));
  return saved;
}

export { getSettings };

// ---------------------------------------------------------------- export

export async function exportTransactions(scope: Scope, f: Filters, format: 'xlsx' | 'csv') {
  const w = buildWhere(f, scope);
  const { rows } = await query(`SELECT ${TX_COLUMNS} ${TX_FROM} ${w.sql} ORDER BY t.date, t.row_index`, w.params);
  const data = rows.map((r: any) => ({
    Date: r.date,
    Shop: r.shop_name,
    Bank: r.bank,
    Description: r.description,
    Counterparty: r.counterparty ?? '',
    Channel: r.channel,
    'Money in': r.direction === 'credit' ? r.amount : null,
    'Money out': r.direction === 'debit' ? -r.amount : null,
    Balance: r.balance,
    Category: r.category,
    Group: GROUPS.find((g) => g.id === groupOf(r.category))?.label,
    'Categorized by': r.category_source,
    Flagged: r.flagged ? 'Yes' : '',
    'Flag reasons': (r.flag_reasons as { label: string }[]).map((x) => x.label).join('; '),
    'Review status': r.review_status ?? '',
    'Reviewed by': r.reviewed_by ?? '',
    'Reviewer note': r.reviewer_note ?? '',
    Reference: r.reference ?? '',
    'Source file': r.file_name,
  }));
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    const sheet = XLSX.utils.json_to_sheet(data);
    return {
      body: Buffer.from('﻿' + XLSX.utils.sheet_to_csv(sheet), 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      fileName: `bank-transactions-${stamp}.csv`,
    };
  }

  const wb = XLSX.utils.book_new();
  const txSheet = XLSX.utils.json_to_sheet(data);
  txSheet['!cols'] = [12, 22, 18, 60, 26, 14, 12, 12, 12, 26, 20, 12, 8, 40, 12, 20, 30, 20, 30].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, txSheet, 'Transactions');

  const byCat = new Map<string, { in: number; out: number; n: number }>();
  for (const r of rows as any[]) {
    const c = byCat.get(r.category) ?? { in: 0, out: 0, n: 0 };
    if (r.direction === 'credit') c.in += r.amount;
    else c.out += -r.amount;
    c.n++;
    byCat.set(r.category, c);
  }
  const summary = [...byCat.entries()]
    .sort((a, b) => b[1].out + b[1].in - (a[1].out + a[1].in))
    .map(([category, v]) => ({
      Category: category,
      Transactions: v.n,
      'Money in': Math.round(v.in * 100) / 100,
      'Money out': Math.round(v.out * 100) / 100,
    }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'By category');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.filter((d) => d.Flagged)), 'Flagged');

  return {
    body: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `bank-transactions-${stamp}.xlsx`,
  };
}
