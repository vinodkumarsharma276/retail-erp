/**
 * Generates a customer code like CUST-0001, CUST-0002, etc.
 */
export function generateCustomerCode(lastCode?: string): string {
  if (!lastCode) return 'CUST-0001';
  const num = parseInt(lastCode.split('-')[1], 10);
  return `CUST-${String(num + 1).padStart(4, '0')}`;
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
