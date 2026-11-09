import type { Prisma } from '@prisma/client';
import { personNameKey, REGISTER_ISSUE_CODES, type RegisterIssue } from '@retailerp/shared-utils';

/**
 * Review problems on register entries.
 *
 * The sheet is imported as it is — a missing mobile or a reused account
 * number doesn't stop a row — and each entry carries the list of what needs
 * a person's attention. Everything but `duplicate_account` depends only on
 * the entry itself; that one depends on the other entries sharing its number,
 * so it is refreshed for every entry of an account number that changes.
 */

/** As-written values the entry couldn't use, kept for whoever fixes it. */
export interface RawValues {
  mobile?: string;
  coMobile?: string;
  purchaseDate?: string;
}

export interface IssueFields {
  accountNumber: string;
  seriesNo: number | null;
  customerName: string;
  mobile: string;
  coName: string | null;
  coMobile: string | null;
  coCustomerId: string | null;
  purchaseDate: Date | null;
  categoryId: string | null;
  rawValues: unknown;
}

const todayUtc = () => {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
};

/** Problems an entry has on its own (everything except duplicate account numbers). */
export function rowIssues(e: IssueFields): RegisterIssue[] {
  const raw = (e.rawValues ?? {}) as RawValues;
  const out = new Set<RegisterIssue>();
  if (!e.accountNumber) out.add('missing_account');
  else if (e.seriesNo == null) out.add('odd_account');
  if (!personNameKey(e.customerName)) out.add('missing_name');
  if (!e.mobile) out.add(raw.mobile && /\d/.test(raw.mobile) ? 'invalid_mobile' : 'missing_mobile');
  if (!e.purchaseDate) out.add(raw.purchaseDate ? 'invalid_date' : 'missing_date');
  else if (e.purchaseDate.getTime() > todayUtc()) out.add('future_date');
  const coNamed = !!e.coName?.trim();
  const coMobileGiven = !!(e.coMobile?.trim() || raw.coMobile?.trim());
  if ((coNamed && !e.coCustomerId) || (!coNamed && coMobileGiven)) out.add('co_incomplete');
  if (!e.categoryId) out.add('no_product_type');
  return order(out);
}

const order = (codes: Iterable<string>) => {
  const set = new Set(codes);
  return REGISTER_ISSUE_CODES.filter((c) => set.has(c));
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Recompute the problems of the given entries and of every entry sharing
 * an account number with them (or with `accountNumbers`, for numbers an
 * entry just left). Only rows whose list changes are written.
 */
export async function refreshIssues(
  tx: Prisma.TransactionClient,
  target: { ids?: string[]; accountNumbers?: string[] },
): Promise<void> {
  const ids = target.ids ?? [];
  const numbers = new Set((target.accountNumbers ?? []).filter(Boolean));
  if (ids.length) {
    const own = await tx.customerSearchEntry.findMany({ where: { id: { in: ids } }, select: { accountNumber: true } });
    for (const e of own) if (e.accountNumber) numbers.add(e.accountNumber);
  }
  if (!ids.length && !numbers.size) return;

  const select = {
    id: true, accountNumber: true, seriesNo: true, customerName: true, mobile: true, coName: true, coMobile: true,
    coCustomerId: true, purchaseDate: true, categoryId: true, rawValues: true, issues: true,
  } as const;
  const entries = await tx.customerSearchEntry.findMany({
    where: { OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(numbers.size ? [{ accountNumber: { in: [...numbers] } }] : [])] },
    select,
  });
  const counts = new Map<string, number>();
  for (const e of entries) if (e.accountNumber) counts.set(e.accountNumber, (counts.get(e.accountNumber) ?? 0) + 1);

  for (const e of entries) {
    const next = order([...rowIssues(e), ...((counts.get(e.accountNumber) ?? 0) > 1 ? ['duplicate_account'] : [])]);
    if (!sameList(next, e.issues)) {
      await tx.customerSearchEntry.update({ where: { id: e.id }, data: { issues: next } });
    }
  }
}

/**
 * When an entry changes shop, its customer (and co-applicant) go with it —
 * unless they still have something in another shop: another register entry,
 * or a sale. Real sales never move; each shop is its own GST entity.
 * Returns the ids of the customers that moved.
 */
export async function moveCustomersWithEntry(
  tx: Prisma.TransactionClient,
  customerIds: Array<string | null>,
  shopId: string,
): Promise<string[]> {
  const moved: string[] = [];
  for (const id of new Set(customerIds.filter((c): c is string => !!c))) {
    const customer = await tx.customer.findUnique({ where: { id }, select: { shopId: true } });
    if (!customer || customer.shopId === shopId) continue;
    const elsewhere = { shopId: { not: shopId } };
    const [entries, sales, guaranteed, sanitized] = await Promise.all([
      tx.customerSearchEntry.count({ where: { OR: [{ customerId: id }, { coCustomerId: id }], ...elsewhere } }),
      tx.saleRecord.count({ where: { customerId: id, ...elsewhere } }),
      tx.saleRecord.count({ where: { guarantorId: id, ...elsewhere } }),
      tx.saleRecordSanitized.count({ where: { customerId: id, ...elsewhere } }),
    ]);
    if (entries + sales + guaranteed + sanitized > 0) continue;
    await tx.customer.update({ where: { id }, data: { shopId } });
    moved.push(id);
  }
  return moved;
}
