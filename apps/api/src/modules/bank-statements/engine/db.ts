import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/database.js';

/**
 * Thin raw-SQL layer over Prisma. The statement analytics are aggregate-heavy
 * SQL (ported from LedgerLens), so queries stay as SQL and rows are normalised
 * to plain JSON-friendly values:
 *   - NUMERIC (Decimal) and BIGINT counts -> number
 *   - DATE -> 'yyyy-mm-dd' (no timezone shifting); TIMESTAMPTZ -> ISO string
 */
export type Db = Pick<typeof prisma, '$queryRawUnsafe'>;

function normValue(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Prisma.Decimal) return v.toNumber();
  if (v instanceof Date) {
    // Prisma returns DATE columns as UTC midnight. Timestamps practically never
    // land on exactly 00:00:00.000 UTC, so this distinguishes the two.
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  return v;
}

function normRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = normValue(v);
  return out as T;
}

export async function query<T = any>(text: string, params: unknown[] = [], db: Db = prisma) {
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(text, ...params);
  return { rows: rows.map((r) => normRow<T>(r)), rowCount: rows.length };
}

export function withTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction((tx) => fn(tx), { timeout: 60_000, maxWait: 10_000 });
}

export const DEFAULT_SETTINGS = {
  largeAmount: 100000, // flag any single transaction at or above this
  cashAlertAmount: 20000, // flag cash withdrawals at or above this
  unknownPayeeAmount: 5000, // flag first-time personal transfers at or above this
  minAiConfidence: 0.65,
  baseCurrency: 'INR',
  /** Keep the original uploaded file (needs the paid "bank.statement_files" feature). */
  keepOriginalFiles: false,
};
export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(tenantId: string): Promise<Settings> {
  const { rows } = await query<{ values: Record<string, unknown> }>(
    'SELECT "values" FROM statement_settings WHERE tenant_id = $1',
    [tenantId],
  );
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(rows[0]?.values ?? {})) if (k in DEFAULT_SETTINGS) merged[k] = v;
  return merged as Settings;
}

export async function saveSettings(tenantId: string, patch: Partial<Settings>) {
  const next: Record<string, unknown> = { ...(await getSettings(tenantId)) };
  for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS && v !== undefined) next[k] = v;
  await query(
    `INSERT INTO statement_settings (tenant_id, "values", updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (tenant_id) DO UPDATE SET "values" = EXCLUDED."values", updated_at = now()`,
    [tenantId, JSON.stringify(next)],
  );
  return next as Settings;
}
