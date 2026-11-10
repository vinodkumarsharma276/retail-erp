import { Prisma } from '@prisma/client';
import { tenantContext } from '../config/tenant-context.js';

/**
 * The current tenant's highest `CUST-<digits>` code, compared as a number.
 * Sorting the text instead puts CUST-9999 after CUST-10000, so past 9,999
 * customers the next code would clash with one that already exists.
 */
export async function lastCustomerCode(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<string | undefined> {
  // Raw SQL skips the Prisma tenant extension, so scope it here.
  const tenantId = tenantContext.currentTenantId();
  const rows = await db.$queryRaw<{ customer_code: string }[]>`
    SELECT customer_code FROM customers
    WHERE customer_code ~ '^CUST-[0-9]+$'
      ${tenantId ? Prisma.sql`AND tenant_id = ${tenantId}` : Prisma.empty}
    ORDER BY substring(customer_code from 6)::numeric DESC
    LIMIT 1`;
  return rows[0]?.customer_code;
}

/**
 * Generates a customer code like CUST-0001, CUST-0002, etc.
 */
export function generateCustomerCode(lastCode?: string): string {
  // Only consume the numeric suffix when the code matches the canonical
  // `CUST-<digits>` pattern. Inter-shop transfer customers use `SHOP-XX-YY`
  // codes and would otherwise produce `CUST-0NaN`.
  if (lastCode) {
    const m = /^CUST-(\d+)$/.exec(lastCode);
    if (m) {
      const num = parseInt(m[1], 10);
      const width = Math.max(4, m[1].length);
      return `CUST-${String(num + 1).padStart(width, '0')}`;
    }
  }
  return 'CUST-0001';
}

/**
 * Generates a sale number like SALE-VE-20260416-001
 */
export function generateSaleNumber(shopCode: string, date: Date, lastNumber?: string): string {
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const prefix = `SALE-${shopCode}-${dateStr}`;

  if (!lastNumber || !lastNumber.startsWith(prefix)) {
    return `${prefix}-001`;
  }

  const seq = parseInt(lastNumber.split('-').pop()!, 10);
  return `${prefix}-${String(seq + 1).padStart(3, '0')}`;
}
