import { createHash } from 'node:crypto';
import { FeatureKey } from '@retailerp/shared-types';
import { getTenantFeatureSnapshot } from '../../../middleware/feature-gate.js';
import { query } from '../engine/db.js';
import { reconciliationRate } from '../engine/parsers/normalize.js';
import { findOverlap, HttpError, storeStatement, type AccountRow, type Scope } from '../bank-statements.service.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { FeedNotReadyError, PROVIDERS, providerList } from './providers/index.js';

/** Days re-read before the last synced date, to catch transactions the bank posts late. */
const OVERLAP_DAYS = 3;
/** Longest window fetched in one sync. */
const MAX_DAYS = 366;

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function feedsEntitled(tenantId: string) {
  const snap = await getTenantFeatureSnapshot(tenantId);
  return snap.flags[FeatureKey.BANK_API_FEEDS] === true;
}

interface ConnectionRow {
  id: string;
  tenant_id: string;
  bank_account_id: string;
  provider: string;
  status: string;
  credentials: string | null;
  auto_sync: boolean;
  synced_through: string | null;
  last_sync_at: string | null;
  shop_id: string;
  shop_name: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string | null;
}

const CONNECTION_SELECT = `
  SELECT c.id, c.tenant_id, c.bank_account_id, c.provider, c.status, c.credentials, c.auto_sync, c.synced_through,
         c.last_sync_at, a.shop_id, sh.name AS shop_name, a.bank_name, a.account_number, a.ifsc_code
    FROM bank_feed_connections c
    JOIN bank_accounts a ON a.id = c.bank_account_id
    JOIN shops sh ON sh.id = a.shop_id`;

async function getConnection(scope: Scope, id: string) {
  const { rows } = await query<ConnectionRow>(`${CONNECTION_SELECT} WHERE c.id = $1 AND c.tenant_id = $2`, [id, scope.tenantId]);
  if (!rows.length || !scope.shopIds.includes(rows[0].shop_id)) throw new HttpError(404, 'Bank feed not found.');
  return rows[0];
}

export async function listFeeds(scope: Scope) {
  const { rows } = await query(
    `SELECT c.id, c.bank_account_id, c.provider, c.status, c.auto_sync, c.synced_through, c.last_sync_at, c.last_error, c.created_at,
            a.shop_id, sh.name AS shop_name, a.bank_name, a.account_number,
            r.status AS last_run_status, r.imported AS last_run_imported, r.skipped AS last_run_skipped, r.started_at AS last_run_at
       FROM bank_feed_connections c
       JOIN bank_accounts a ON a.id = c.bank_account_id
       JOIN shops sh ON sh.id = a.shop_id
       LEFT JOIN LATERAL (SELECT status, imported, skipped, started_at FROM bank_feed_runs
                           WHERE connection_id = c.id ORDER BY started_at DESC LIMIT 1) r ON true
      WHERE c.tenant_id = $1 AND a.shop_id = ANY($2::text[])
      ORDER BY sh.name, a.bank_name`,
    [scope.tenantId, scope.shopIds],
  );
  return { entitled: await feedsEntitled(scope.tenantId), providers: providerList(), feeds: rows };
}

export interface ConnectInput {
  bankAccountId: string;
  provider: string;
  credentials: Record<string, string>;
  /** First date to import from. */
  startDate: string;
  autoSync: boolean;
}

export async function connectFeed(scope: Scope, userId: string, input: ConnectInput) {
  const provider = PROVIDERS[input.provider];
  if (!provider) throw new HttpError(400, 'Unknown bank feed provider.');
  if (!provider.ready) throw new HttpError(422, provider.note);

  const { rows: acc } = await query<{ shop_id: string; bank_name: string }>(
    'SELECT shop_id, bank_name FROM bank_accounts WHERE id = $1 AND tenant_id = $2 AND is_active',
    [input.bankAccountId, scope.tenantId],
  );
  if (!acc.length || !scope.shopIds.includes(acc[0].shop_id)) throw new HttpError(404, 'Bank account not found.');
  if (provider.banks !== 'any' && !provider.banks.some((b) => b.toLowerCase() === acc[0].bank_name.toLowerCase())) {
    throw new HttpError(422, `${provider.label} only works with ${provider.banks.join(', ')} accounts.`);
  }
  const missing = provider.credentialFields.filter((f) => !input.credentials[f.key]?.trim()).map((f) => f.label);
  if (missing.length) throw new HttpError(400, `Missing: ${missing.join(', ')}.`);

  const creds = Object.fromEntries(provider.credentialFields.map((f) => [f.key, input.credentials[f.key].trim()]));
  const existing = await query('SELECT 1 FROM bank_feed_connections WHERE bank_account_id = $1', [input.bankAccountId]);
  if (existing.rowCount) throw new HttpError(409, 'This account is already connected. Disconnect it first to change the setup.');

  const { rows } = await query<{ id: string }>(
    `INSERT INTO bank_feed_connections (id, tenant_id, bank_account_id, provider, credentials, auto_sync, synced_through, created_by_id)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::date, $7) RETURNING id`,
    [
      scope.tenantId, input.bankAccountId, provider.id,
      provider.credentialFields.length ? encryptSecret(creds) : null,
      input.autoSync, addDays(input.startDate, -1), userId,
    ],
  );
  return { id: rows[0].id };
}

export async function updateFeed(scope: Scope, id: string, patch: { autoSync?: boolean; paused?: boolean }) {
  const c = await getConnection(scope, id);
  await query(
    `UPDATE bank_feed_connections SET auto_sync = COALESCE($2, auto_sync),
            status = CASE WHEN $3::boolean IS TRUE THEN 'paused' WHEN $3::boolean IS FALSE AND status = 'paused' THEN 'active' ELSE status END
      WHERE id = $1`,
    [c.id, patch.autoSync ?? null, patch.paused ?? null],
  );
}

/** Statements already imported from the feed are kept. */
export async function disconnectFeed(scope: Scope, id: string) {
  const c = await getConnection(scope, id);
  await query('DELETE FROM bank_feed_connections WHERE id = $1', [c.id]);
}

export async function listRuns(scope: Scope, id: string) {
  const c = await getConnection(scope, id);
  const { rows } = await query(
    `SELECT r.id, r.trigger, r.from_date, r.to_date, r.status, r.fetched, r.imported, r.skipped, r.statement_id, r.error,
            r.started_at, r.finished_at
       FROM bank_feed_runs r WHERE r.connection_id = $1 ORDER BY r.started_at DESC LIMIT 30`,
    [c.id],
  );
  return rows;
}

export async function syncFeedById(scope: Scope, id: string) {
  const c = await getConnection(scope, id);
  if (!(await feedsEntitled(scope.tenantId))) throw new HttpError(403, 'Automatic bank feeds are a paid add-on.');
  return syncConnection(c, 'manual');
}

/**
 * Pull new transactions for one connection and import them through the shared
 * pipeline. Transactions already imported (from an earlier sync or an uploaded
 * PDF/Excel of the same account) are skipped automatically: there is nobody to ask.
 */
async function syncConnection(c: ConnectionRow, trigger: 'manual' | 'scheduled') {
  const provider = PROVIDERS[c.provider];
  const running = await query(
    `SELECT 1 FROM bank_feed_runs WHERE connection_id = $1 AND status = 'running' AND started_at > now() - interval '15 minutes'`,
    [c.id],
  );
  if (running.rowCount) throw new HttpError(409, 'A sync for this account is already running.');

  const today = todayIST();
  // First sync starts exactly at the chosen start date; later ones re-read a few days for late postings.
  let from = !c.synced_through
    ? addDays(today, -30)
    : c.last_sync_at
      ? addDays(c.synced_through, 1 - OVERLAP_DAYS)
      : addDays(c.synced_through, 1);
  if (from < addDays(today, -MAX_DAYS)) from = addDays(today, -MAX_DAYS);
  const to = today;

  const { rows: run } = await query<{ id: string }>(
    `INSERT INTO bank_feed_runs (id, tenant_id, connection_id, trigger, from_date, to_date, status)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4::date, $5::date, 'running') RETURNING id`,
    [c.tenant_id, c.id, trigger, from, to],
  );
  const runId = run[0].id;

  try {
    if (!provider) throw new FeedNotReadyError(`Unknown provider "${c.provider}".`);
    const fetched = await provider.fetchTransactions(
      { id: c.bank_account_id, bankName: c.bank_name, accountNumber: c.account_number, ifscCode: c.ifsc_code },
      decryptSecret(c.credentials),
      from,
      to,
    );
    const account: AccountRow = { id: c.bank_account_id, shop_id: c.shop_id, shop_name: c.shop_name, bank_name: c.bank_name, account_number: c.account_number };
    const overlap = await findOverlap(c.tenant_id, account, fetched);
    const fresh = fetched.filter((_, i) => !overlap.dupIndexes.has(i));

    let statementId: string | null = null;
    if (fresh.length) {
      const dates = fresh.map((r) => r.date).sort();
      const payload = JSON.stringify(fresh);
      const stored = await storeStatement(c.tenant_id, {
        shopId: c.shop_id,
        account,
        rows: fresh,
        warnings: overlap.dupIndexes.size ? [`${overlap.dupIndexes.size} transactions were already imported and were skipped.`] : [],
        bank: c.bank_name,
        source: 'api',
        fileName: `${provider.label} · ${dates[0]} to ${dates[dates.length - 1]}`,
        fileHash: createHash('sha256').update(`${c.id}|${payload}`).digest('hex'),
        fileType: 'api',
        fileSize: Buffer.byteLength(payload),
        parseMethod: 'bank-api',
        reconciliation: reconciliationRate(fetched),
        currency: 'INR',
        uploadedById: null,
      });
      statementId = stored.statementId;
    }

    // Today is still open at the bank, so it is re-read next time.
    const through = addDays(to, -1);
    await query(
      `UPDATE bank_feed_runs SET status = 'success', fetched = $2, imported = $3, skipped = $4, statement_id = $5, finished_at = now()
        WHERE id = $1`,
      [runId, fetched.length, fresh.length, overlap.dupIndexes.size, statementId],
    );
    await query(
      `UPDATE bank_feed_connections SET last_sync_at = now(), last_error = NULL,
              status = CASE WHEN status = 'paused' THEN status ELSE 'active' END,
              synced_through = GREATEST(COALESCE(synced_through, $2::date), $2::date)
        WHERE id = $1`,
      [c.id, through],
    );
    return { runId, fetched: fetched.length, imported: fresh.length, skipped: overlap.dupIndexes.size, statementId, from, to };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query(`UPDATE bank_feed_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [runId, message]);
    // last_sync_at only records successful syncs (it also tells the next run whether to look back).
    await query(`UPDATE bank_feed_connections SET status = 'error', last_error = $2 WHERE id = $1`, [c.id, message]);
    throw err instanceof HttpError ? err : new HttpError(502, `Sync failed: ${message}`);
  }
}

/** Nightly job: every active, auto-syncing connection whose tenant still has the add-on. */
export async function syncAllDue(log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  const { rows } = await query<ConnectionRow>(`${CONNECTION_SELECT} WHERE c.auto_sync AND c.status <> 'paused' AND a.is_active`);
  const entitled = new Map<string, boolean>();
  for (const c of rows) {
    if (!entitled.has(c.tenant_id)) entitled.set(c.tenant_id, await feedsEntitled(c.tenant_id));
    if (!entitled.get(c.tenant_id)) continue;
    try {
      const r = await syncConnection(c, 'scheduled');
      log.info({ connection: c.id, imported: r.imported, skipped: r.skipped }, '[bank-feeds] synced');
    } catch (err) {
      log.error({ connection: c.id, err }, '[bank-feeds] sync failed');
    }
  }
}
