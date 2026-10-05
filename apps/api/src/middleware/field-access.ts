import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loadUsablePermissions } from './permissions.js';

/**
 * Field-level access: sensitive fields are removed from API responses
 * unless the user holds the permission that guards them. Hiding a column
 * in the browser isn't enough — the number would still be in the response.
 *
 * Rules apply per API area (URL prefix), because the same field name can be
 * fine in one place and sensitive in another (a purchase obviously shows
 * what was paid; the product list shows cost only with "see DP").
 * Fields are removed at any depth of the response.
 */
interface FieldRule {
  prefix: string;
  permission: string;
  fields: string[];
}

const RULES: FieldRule[] = [
  { prefix: '/api/v1/products', permission: 'products.view_dp', fields: ['purchasePrice', 'purchasePriceMin', 'purchasePriceMax'] },
  { prefix: '/api/v1/products', permission: 'products.view_margin', fields: ['margin', 'marginPct', 'profit'] },
  { prefix: '/api/v1/products', permission: 'products.view_distributor', fields: ['distributor', 'distributorId'] },
  { prefix: '/api/v1/customers', permission: 'customers.view_aadhaar', fields: ['aadhaarNumber'] },
  { prefix: '/api/v1/customers', permission: 'customers.view_phone', fields: ['phone', 'altPhone'] },
  { prefix: '/api/v1/customers', permission: 'customers.view_guarantor_chain', fields: ['guarantor', 'guarantorId', 'guaranteedCustomers', 'isGuarantor'] },
  { prefix: '/api/v1/distributors', permission: 'distributors.view_bank_details', fields: ['bankName', 'bankAccountNumber', 'bankIfsc', 'bankBranch'] },
  { prefix: '/api/v1/distributors', permission: 'distributors.view_gst', fields: ['gstNumber', 'panNumber'] },
  { prefix: '/api/v1/distributors', permission: 'distributors.view_credit_limit', fields: ['creditLimit'] },
  { prefix: '/api/v1/sales', permission: 'sales.section.purchase_price', fields: ['purchasePrice'] },
  { prefix: '/api/v1/sales', permission: 'sales.section.profit', fields: ['profit', 'profitAmount', 'profitPct', 'margin'] },
  { prefix: '/api/v1/installments', permission: 'installments.view_interest_rate', fields: ['interestRate', 'effectiveRate'] },
  { prefix: '/api/v1/transfers', permission: 'transfers.view_transfer_price', fields: ['transferPrice'] },
  { prefix: '/api/v1/shops', permission: 'shops.view_bank_details', fields: ['bankName', 'bankAccountNumber', 'bankIfsc', 'bankBranch'] },
];

function strip(value: unknown, fields: Set<string>, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) strip(item, fields, depth + 1);
    return value;
  }
  if (value instanceof Date) return value;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (fields.has(key)) delete obj[key];
    else strip(obj[key], fields, depth + 1);
  }
  return value;
}

async function hiddenFieldsFor(request: FastifyRequest): Promise<Set<string> | null> {
  const url = request.url ?? '';
  const rules = RULES.filter((r) => url.startsWith(r.prefix));
  if (rules.length === 0 || !request.currentUser) return null;
  const perms =
    request.currentUser.permissions ??
    (await loadUsablePermissions(request.currentUser.userId, request.tenant?.id ?? request.currentUser.tenantId));
  const hidden = new Set<string>();
  for (const rule of rules) if (!perms.has(rule.permission)) rule.fields.forEach((f) => hidden.add(f));
  return hidden.size > 0 ? hidden : null;
}

export function registerFieldAccess(app: FastifyInstance) {
  app.addHook('preSerialization', async (request, _reply, payload) => {
    const hidden = await hiddenFieldsFor(request);
    if (!hidden) return payload;
    // Responses are built fresh per request; stripping in place is safe.
    return strip(payload, hidden);
  });
}
