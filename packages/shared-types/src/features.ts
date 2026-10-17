/**
 * Feature flag keys — gate optional / paid modules per tenant. Mirrors the
 * `permissions.ts` pattern (string constant + TS type for inference). Each
 * tenant has a row in the `tenant_features` table per key it wants to
 * override; absent rows fall back to the tenant's plan default
 * (`plan_features`).
 *
 * Add a new feature: register the key here, update the seed/plan-default
 * matrix, and wrap the relevant API route/UI element in
 * `featureGate('<key>')` / `useFeature('<key>')`.
 */
export const FeatureKey = {
  // ── Core modules — always on for any active tenant ────────────────────
  SALES: 'sales',
  PRODUCTS: 'products',
  CUSTOMERS: 'customers',
  PURCHASES: 'purchases',
  DISTRIBUTORS: 'distributors',

  // ── Optional / paid modules ───────────────────────────────────────────
  INSTALLMENTS: 'installments',
  TRANSFERS: 'transfers',
  EXPENSES: 'expenses',
  BANK_RECONCILIATION: 'bank.reconciliation',
  /** Paid add-on: keep the original uploaded bank statement files in the database. */
  BANK_STATEMENT_FILES: 'bank.statement_files',
  /** Paid add-on: pull statements automatically from banks' APIs. */
  BANK_API_FEEDS: 'bank.api_feeds',
  DASHBOARD_ANALYTICS: 'dashboard.analytics',
  YOY_REPORTING: 'reports.yoy',
  OCR_INVOICE_PARSING: 'ocr.invoice',
  PUSH_NOTIFICATIONS: 'notifications.push',
  MOBILE_APP: 'mobile_app',

  // ── Workflow toggles ──────────────────────────────────────────────────
  SALE_APPROVAL_WORKFLOW: 'sales.approval_workflow',
  MULTI_SHOP: 'multi_shop',
  ALL_SHOPS_VIEW: 'shops.view_all',
  CUSTOM_ROLES: 'rbac.custom_roles',
  DYNAMIC_FORMS: 'forms.dynamic',

  // ── Capacity / limit-style flags (value stored in `valueJson`) ────────
  MAX_SHOPS: 'limits.max_shops',
  MAX_USERS: 'limits.max_users',
  MAX_PRODUCTS: 'limits.max_products',
} as const;

export type FeatureKeyType = (typeof FeatureKey)[keyof typeof FeatureKey];

/** All feature keys as a flat array — useful for plan-editor UIs. */
export const ALL_FEATURE_KEYS: FeatureKeyType[] = Object.values(FeatureKey);

/**
 * Categorisation used by the admin UI to group feature toggles. Matches
 * the section comments above.
 */
export const FEATURE_CATEGORIES = {
  CORE: 'Core',
  MODULES: 'Modules',
  WORKFLOWS: 'Workflows',
  LIMITS: 'Limits',
} as const;

export type FeatureCategory =
  (typeof FEATURE_CATEGORIES)[keyof typeof FEATURE_CATEGORIES];

export const FEATURE_METADATA: Record<
  FeatureKeyType,
  { label: string; category: FeatureCategory; isLimit?: boolean }
> = {
  [FeatureKey.SALES]: { label: 'Sales', category: FEATURE_CATEGORIES.CORE },
  [FeatureKey.PRODUCTS]: { label: 'Products', category: FEATURE_CATEGORIES.CORE },
  [FeatureKey.CUSTOMERS]: { label: 'Customers', category: FEATURE_CATEGORIES.CORE },
  [FeatureKey.PURCHASES]: { label: 'Purchases', category: FEATURE_CATEGORIES.CORE },
  [FeatureKey.DISTRIBUTORS]: { label: 'Distributors', category: FEATURE_CATEGORIES.CORE },

  [FeatureKey.INSTALLMENTS]: { label: 'Installments / EMI', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.TRANSFERS]: { label: 'Inter-shop transfers', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.EXPENSES]: { label: 'Expenses', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.BANK_RECONCILIATION]: { label: 'Bank statements', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.BANK_STATEMENT_FILES]: { label: 'Keep original bank statement files (storage add-on)', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.BANK_API_FEEDS]: { label: 'Automatic bank statement feeds (bank API add-on)', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.DASHBOARD_ANALYTICS]: { label: 'Dashboard analytics', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.YOY_REPORTING]: { label: 'Year-over-year reporting', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.OCR_INVOICE_PARSING]: { label: 'OCR invoice parsing', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.PUSH_NOTIFICATIONS]: { label: 'Push notifications', category: FEATURE_CATEGORIES.MODULES },
  [FeatureKey.MOBILE_APP]: { label: 'Mobile app for employees', category: FEATURE_CATEGORIES.MODULES },

  [FeatureKey.SALE_APPROVAL_WORKFLOW]: { label: 'Sale approval workflow', category: FEATURE_CATEGORIES.WORKFLOWS },
  [FeatureKey.MULTI_SHOP]: { label: 'Multiple shops', category: FEATURE_CATEGORIES.WORKFLOWS },
  [FeatureKey.ALL_SHOPS_VIEW]: { label: '"All Shops" aggregated view', category: FEATURE_CATEGORIES.WORKFLOWS },
  [FeatureKey.CUSTOM_ROLES]: { label: 'Custom RBAC roles', category: FEATURE_CATEGORIES.WORKFLOWS },
  [FeatureKey.DYNAMIC_FORMS]: { label: 'DB-driven dynamic forms', category: FEATURE_CATEGORIES.WORKFLOWS },

  [FeatureKey.MAX_SHOPS]: { label: 'Maximum shops', category: FEATURE_CATEGORIES.LIMITS, isLimit: true },
  [FeatureKey.MAX_USERS]: { label: 'Maximum users', category: FEATURE_CATEGORIES.LIMITS, isLimit: true },
  [FeatureKey.MAX_PRODUCTS]: { label: 'Maximum products', category: FEATURE_CATEGORIES.LIMITS, isLimit: true },
};
