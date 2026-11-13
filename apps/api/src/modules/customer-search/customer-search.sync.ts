import { prisma } from '../../config/database.js';
import { tenantContext } from '../../config/tenant-context.js';
import { CustomerSearchError } from './customer-search.service.js';

/**
 * Register sync for the mobile app's on-device copy.
 *
 * 1. Bootstrap: with no token, the server notes a start watermark (the oldest
 *    still-running transaction id) and returns entries a page at a time in id
 *    order. Everything committed before the watermark is in those pages;
 *    anything later is replayed by the delta, so nothing is lost while pages
 *    are being fetched.
 * 2. Delta: the change log (`customer_search_changes`, written by a trigger)
 *    is read in (txid, seq) order, only up to the oldest still-running
 *    transaction, so a change that commits late can't be skipped. Each
 *    changed id is returned with its current row, or as deleted.
 *
 * Responses carry an opaque token for the next call. Replaying a token is
 * safe: rows are returned as they are now, never as diffs.
 */

export const BOOTSTRAP_PAGE = 2000;
export const DELTA_BATCH = 5000;

/** What this user may receive. A change means the device must start over. */
export interface SyncProjection {
  phones: boolean;
  rawValues: boolean;
}

type Token =
  | { v: 1; t: string; p: string; phase: 'boot'; c0: string; after: string }
  | { v: 1; t: string; p: string; phase: 'delta'; tx: string; seq: string };

const projectionKey = (p: SyncProjection) => `1:${p.phones ? 1 : 0}${p.rawValues ? 1 : 0}`;

const encode = (token: Token) => Buffer.from(JSON.stringify(token)).toString('base64url');

/** 410: the device's position can't be continued; it must download again. */
export class SyncResetError extends CustomerSearchError {
  constructor(reason: 'invalid' | 'tenant' | 'projection') {
    super(
      reason === 'projection'
        ? 'What you are allowed to see has changed; the register will download again.'
        : 'The register needs to download again.',
      410,
      { reset: true, reason },
    );
  }
}

function decode(raw: string, tenantId: string, projection: SyncProjection): Token {
  let token: Token;
  try {
    token = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new SyncResetError('invalid');
  }
  const digits = (s: unknown) => typeof s === 'string' && /^\d{1,19}$/.test(s);
  const valid =
    token &&
    token.v === 1 &&
    typeof token.t === 'string' &&
    typeof token.p === 'string' &&
    ((token.phase === 'boot' && digits(token.c0) && typeof token.after === 'string' && token.after.length <= 64) ||
      (token.phase === 'delta' && digits(token.tx) && digits(token.seq)));
  if (!valid) throw new SyncResetError('invalid');
  if (token.t !== tenantId) throw new SyncResetError('tenant');
  if (token.p !== projectionKey(projection)) throw new SyncResetError('projection');
  return token;
}

const entrySelect = {
  id: true,
  shopId: true,
  accountNumber: true,
  prefix: true,
  seriesNo: true,
  customerId: true,
  customerName: true,
  mobile: true,
  altMobile: true,
  address: true,
  moreAddresses: true,
  area: true,
  coCustomerId: true,
  coName: true,
  coMobile: true,
  coAltMobile: true,
  coAddress: true,
  coMoreAddresses: true,
  purchaseDate: true,
  categoryId: true,
  product: true,
  brand: true,
  model: true,
  issues: true,
  rawValues: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { customerCode: true } },
  coCustomer: { select: { customerCode: true } },
} as const;

type Row = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows(where: { id: { gt: string } } | { id: { in: string[] } }, take?: number) {
  return prisma.customerSearchEntry.findMany({ where, select: entrySelect, orderBy: { id: 'asc' }, ...(take ? { take } : {}) });
}

function project(rows: Row[], projection: SyncProjection) {
  return rows.map(({ customer, coCustomer, rawValues, purchaseDate, ...e }) => ({
    ...e,
    purchaseDate: purchaseDate ? purchaseDate.toISOString().slice(0, 10) : null,
    customerCode: customer?.customerCode ?? null,
    coCustomerCode: coCustomer?.customerCode ?? null,
    // Phones (and rawValues, which hold sheet mobiles) are also removed by
    // field-access without customers.view_phone; rawValues are detail data.
    ...(projection.rawValues ? { rawValues } : {}),
  }));
}

/** Small lookups the device needs to show and filter entries: every shop and product type. */
async function reference() {
  const [shops, categories] = await Promise.all([
    prisma.shop.findMany({ select: { id: true, name: true, code: true }, orderBy: { code: 'asc' } }),
    prisma.productCategory.findMany({
      select: { id: true, name: true, parentId: true, path: true, level: true, isLeaf: true, isActive: true, displayOrder: true },
      orderBy: [{ level: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);
  return { shops, categories };
}

async function watermark(): Promise<string> {
  const [row] = await prisma.$queryRaw<{ w: string }[]>`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS w`;
  return row.w;
}

export async function syncRegister(rawToken: string | undefined, projection: SyncProjection, limit?: number) {
  const tenantId = tenantContext.currentTenantId();
  if (!tenantId) throw new CustomerSearchError('No business selected', 400);
  const base = { v: 1 as const, t: tenantId, p: projectionKey(projection) };
  const token = rawToken ? decode(rawToken, tenantId, projection) : null;
  const serverTime = new Date().toISOString();
  const meta = { projection, serverTime };

  if (!token || token.phase === 'boot') {
    const c0 = token?.c0 ?? (await watermark());
    const after = token?.after ?? '';
    const pageSize = Math.min(limit ?? BOOTSTRAP_PAGE, BOOTSTRAP_PAGE);
    const rows = await loadRows({ id: { gt: after } }, pageSize);
    const done = rows.length < pageSize;
    const next: Token = done
      ? { ...base, phase: 'delta', tx: c0, seq: '0' }
      : { ...base, phase: 'boot', c0, after: rows[rows.length - 1].id };
    return {
      ...meta,
      phase: 'bootstrap' as const,
      /** First page: the device starts a fresh copy (keeping the old one until `complete`). */
      start: !token,
      entries: project(rows, projection),
      deleted: [] as string[],
      next: encode(next),
      /** Snapshot finished: the device swaps its fresh copy in, then continues with `next`. */
      complete: done,
      more: true,
      ...(done ? { reference: await reference() } : {}),
    };
  }

  const batch = Math.min(limit ?? DELTA_BATCH, DELTA_BATCH);
  const changes = await prisma.$queryRaw<{ seq: string; entry_id: string; txid: string }[]>`
    SELECT seq::text AS seq, entry_id, txid::text AS txid
    FROM customer_search_changes
    WHERE tenant_id = ${tenantId}
      AND (txid > ${token.tx}::bigint OR (txid = ${token.tx}::bigint AND seq > ${token.seq}::bigint))
      AND txid < pg_snapshot_xmin(pg_current_snapshot())::text::bigint
    ORDER BY txid, seq
    LIMIT ${batch}`;
  const ids = [...new Set(changes.map((c) => c.entry_id))];
  const rows = ids.length ? await loadRows({ id: { in: ids } }) : [];
  const present = new Set(rows.map((r) => r.id));
  const last = changes[changes.length - 1];
  const more = changes.length === batch;
  const next: Token = last ? { ...base, phase: 'delta', tx: last.txid, seq: last.seq } : { ...base, phase: 'delta', tx: token.tx, seq: token.seq };
  return {
    ...meta,
    phase: 'delta' as const,
    start: false,
    entries: project(rows, projection),
    deleted: ids.filter((id) => !present.has(id)),
    next: encode(next),
    complete: true,
    more,
    ...(more ? {} : { reference: await reference() }),
  };
}
