/**
 * How a user's permissions turn into what they can actually do.
 *
 *   granted  = role permissions + per-user grants − per-user denies
 *   effective = granted
 *               − permissions of features the tenant has switched off
 *               − permissions whose prerequisites are missing (repeated
 *                 until nothing changes)
 *
 * The same function runs on the API (every request) and in the browser
 * (menus, pages, buttons), so a screen never offers what the API refuses.
 *
 * Prerequisites encode "hiding one without the other makes no sense":
 * a menu item needs its list, actions need the screen they live on, and
 * a few cross-module links (a sale needs customers and products; anything
 * about installments needs the real, non-sanitized sales).
 */
import { FeatureKey } from './features';
import { ALL_PERMISSION_KEYS } from './permissions';

const ALL = new Set<string>(ALL_PERMISSION_KEYS);

// ---------------------------------------------------------------------------
// Feature switches
// ---------------------------------------------------------------------------

/** Whole permission modules that belong to one tenant feature. */
const MODULE_FEATURE: Record<string, string> = {
  dashboard: FeatureKey.DASHBOARD_ANALYTICS,
  products: FeatureKey.PRODUCTS,
  distributors: FeatureKey.DISTRIBUTORS,
  purchases: FeatureKey.PURCHASES,
  customers: FeatureKey.CUSTOMERS,
  sales: FeatureKey.SALES,
  installments: FeatureKey.INSTALLMENTS,
  transfers: FeatureKey.TRANSFERS,
  expenses: FeatureKey.EXPENSES,
  bank: FeatureKey.BANK_RECONCILIATION,
  employees: FeatureKey.MOBILE_APP,
};

/** Individual permissions tied to a feature (checked as well as their module's). */
const KEY_FEATURE: Record<string, string> = {
  'nav.dashboard': FeatureKey.DASHBOARD_ANALYTICS,
  'nav.products': FeatureKey.PRODUCTS,
  'nav.distributors': FeatureKey.DISTRIBUTORS,
  'nav.purchases': FeatureKey.PURCHASES,
  'nav.customers': FeatureKey.CUSTOMERS,
  'nav.sales': FeatureKey.SALES,
  'nav.installments': FeatureKey.INSTALLMENTS,
  'nav.transfers': FeatureKey.TRANSFERS,
  'nav.expenses': FeatureKey.EXPENSES,
  'nav.bank': FeatureKey.BANK_RECONCILIATION,
  'nav.employees': FeatureKey.MOBILE_APP,
  'shop.switch': FeatureKey.MULTI_SHOP,
  'shop.view_all': FeatureKey.ALL_SHOPS_VIEW,
  'shops.view_all': FeatureKey.ALL_SHOPS_VIEW,
  'shops.create': FeatureKey.MULTI_SHOP,
  'dashboard.yoy_comparison': FeatureKey.YOY_REPORTING,
  'sales.approve': FeatureKey.SALE_APPROVAL_WORKFLOW,
  'sales.create_self_finance': FeatureKey.INSTALLMENTS,
  'sales.section.self_finance': FeatureKey.INSTALLMENTS,
  'view.customer.address.zone': FeatureKey.CUSTOMERS,
  'forms.edit_definitions': FeatureKey.DYNAMIC_FORMS,
  'forms.add_field': FeatureKey.DYNAMIC_FORMS,
  'forms.delete_field': FeatureKey.DYNAMIC_FORMS,
  'roles.create': FeatureKey.CUSTOM_ROLES,
  'roles.edit_permissions': FeatureKey.CUSTOM_ROLES,
  'roles.delete': FeatureKey.CUSTOM_ROLES,
  'users.edit_permissions': FeatureKey.CUSTOM_ROLES,
};

/** Feature keys a permission depends on (empty when it is always available). */
export function featuresFor(key: string): string[] {
  const out: string[] = [];
  const mod = MODULE_FEATURE[key.split('.')[0]];
  if (mod) out.push(mod);
  if (KEY_FEATURE[key]) out.push(KEY_FEATURE[key]);
  return out;
}

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

/** The permission a module's other permissions hang off. */
const MODULE_BASE: Record<string, string> = {
  dashboard: 'dashboard.view',
  bank: 'bank.view',
  settings: 'settings.view',
  forms: 'forms.view',
};

const NAV_TARGET: Record<string, string> = {
  'nav.dashboard': 'dashboard.view',
  'nav.bank': 'bank.view',
  'nav.settings': 'settings.view',
  'nav.employees': 'employees.list',
};

/** Detail-screen parts: need the detail page, not just the list. */
const DETAIL_PART = /\.(section\.|audit_trail$|payment_timeline$|view_purchase_history$|view_guarantor_chain$|invoice\.)/;

/** Cross-module links decided with the owner (2026-10-05). */
const EXTRA_REQUIRES: Record<string, string[]> = {
  // Picking what you need for the job.
  'purchases.create': ['distributors.list'],
  'purchases.create_unbilled': ['distributors.list'],
  'purchases.edit': ['distributors.list'],
  'sales.create_full_payment': ['customers.list', 'products.list'],
  'sales.create_partial_with_promise': ['customers.list', 'products.list'],
  'sales.create_company_finance': ['customers.list', 'products.list'],
  'sales.create_self_finance': ['customers.list', 'products.list', 'sales.view_real'],
  'transfers.initiate': ['products.list'],
  'employees.assign_collection_route': ['installments.list'],
  'users.change_role': ['roles.list'],
  'users.edit_permissions': ['roles.list'],
  'shop.view_all': ['shop.switch'],
  'shops.view_all': ['shops.list'],
  // Editing or digging into a sale's real terms needs the real sale.
  'sales.edit': ['sales.view_real'],
  'sales.view_history': ['sales.view_real'],
  'sales.mark_partial_settled': ['sales.view_real'],
  'sales.record_company_finance_payment': ['sales.view_real'],
  'customers.view_guarantor_chain': ['sales.view_real'],
  'dashboard.overdue_table': ['installments.list'],
  'dashboard.view_profit': ['sales.view_real'],
};

/**
 * A user who sees only the sanitized copy of sales (every self-finance sale
 * shown as a cash sale) must never reach installment data by another route.
 * Field collectors (Employee role) have no sales access at all, so this
 * doesn't touch them.
 */
const HIDDEN_FROM_SANITIZED_VIEWERS = (key: string) =>
  key.startsWith('installments.') ||
  key === 'nav.installments' ||
  key === 'sales.create_self_finance' ||
  key === 'customers.view_guarantor_chain' ||
  key === 'dashboard.overdue_table' ||
  key === 'employees.assign_collection_route';

/** True when the user sees sales only as the sanitized copy. */
export function isSanitizedViewer(perms: Set<string>): boolean {
  return perms.has('sales.view_sanitized') && !perms.has('sales.view_real');
}

/** Every permission `key` needs before it can take effect. */
export function prerequisitesFor(key: string): string[] {
  const out = new Set<string>();
  if (NAV_TARGET[key]) out.add(NAV_TARGET[key]);
  else if (key.startsWith('nav.')) out.add(`${key.slice(4)}.list`);

  const [mod] = key.split('.');
  const base = MODULE_BASE[mod] ?? `${mod}.list`;
  const detail = `${mod}.detail`;
  const hasDetail = ALL.has(detail);
  if (key.startsWith('nav.') || key === base) {
    // menu items handled above; the base needs nothing in its module
  } else if (key === detail) {
    // A record can be opened from elsewhere (a customer from an installment)
    // without access to the full list.
  } else if (hasDetail && (DETAIL_PART.test(key) || (/\.view_/.test(key) && !/^sales\.view_(real|sanitized)$/.test(key)))) {
    // Detail-screen parts and field visibility (phone, Aadhaar, cost…) hang
    // off the detail page.
    out.add(detail);
  } else if (ALL.has(base)) {
    out.add(base);
  }
  if (mod === 'sales' && key.startsWith('sales.section.')) out.add('sales.view_real');

  for (const extra of EXTRA_REQUIRES[key] ?? []) out.add(extra);
  out.delete(key);
  return [...out].filter((k) => ALL.has(k));
}

/**
 * What a user can actually do: `granted`, minus anything the tenant has
 * switched off, minus anything whose prerequisites are missing.
 */
export function effectivePermissions(
  granted: Iterable<string>,
  featureFlags: Record<string, boolean> | null,
): Set<string> {
  const set = new Set(granted);
  if (featureFlags) {
    for (const key of [...set]) {
      if (featuresFor(key).some((f) => featureFlags[f] !== true)) set.delete(key);
    }
  }
  if (isSanitizedViewer(set)) {
    for (const key of [...set]) if (HIDDEN_FROM_SANITIZED_VIEWERS(key)) set.delete(key);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...set]) {
      if (prerequisitesFor(key).some((p) => !set.has(p))) {
        set.delete(key);
        changed = true;
      }
    }
  }
  return set;
}

/** Permissions that stop working when `key` is removed (for the role editor). */
export function dependentsOf(key: string): string[] {
  return ALL_PERMISSION_KEYS.filter((k) => prerequisitesFor(k).includes(key));
}
