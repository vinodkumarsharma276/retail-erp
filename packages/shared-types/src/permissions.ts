/**
 * RBAC permission catalog. Single source of truth for both backend (middleware
 * checks) and frontend (UI gating + role editor). Add new permissions here.
 *
 * Permission keys follow the convention: `<module>.<action>` or
 * `<module>.section.<section>` for sub-page sensitive blocks.
 */

export interface PermissionDef {
  key: string;
  module: string;
  description: string;
}

export interface PermissionGroup {
  module: string;
  label: string;
  permissions: PermissionDef[];
}

const g = (module: string, label: string, defs: Array<[string, string]>): PermissionGroup => ({
  module,
  label,
  permissions: defs.map(([key, description]) => ({ key, module, description })),
});

export const PERMISSION_GROUPS: PermissionGroup[] = [
  g('nav', 'Navigation', [
    ['nav.dashboard', 'Show Dashboard menu item'],
    ['nav.products', 'Show Products menu item'],
    ['nav.distributors', 'Show Distributors menu item'],
    ['nav.purchases', 'Show Purchases menu item'],
    ['nav.customers', 'Show Customers menu item'],
    ['nav.sales', 'Show Sales menu item'],
    ['nav.installments', 'Show Installments menu item'],
    ['nav.transfers', 'Show Transfers menu item'],
    ['nav.expenses', 'Show Expenses menu item'],
    ['nav.bank', 'Show Bank menu item'],
    ['nav.employees', 'Show Employees menu item'],
    ['nav.settings', 'Show Settings menu item'],
    ['shop.switch', 'Use shop switcher in header'],
    ['shop.view_all', 'See data across all shops without switching'],
  ]),

  g('dashboard', 'Dashboard', [
    ['dashboard.view', 'Open dashboard page'],
    ['dashboard.summary_cards', 'See summary cards'],
    ['dashboard.sales_chart', 'See sales trend chart'],
    ['dashboard.yoy_comparison', 'See year-over-year comparison'],
    ['dashboard.top_products', 'See top products chart'],
    ['dashboard.overdue_table', 'See overdue installments table'],
    ['dashboard.export', 'Export dashboard data'],
    ['dashboard.view_profit', 'See net profit figures'],
  ]),

  g('products', 'Products', [
    ['products.list', 'Open product list'],
    ['products.detail', 'Open product detail'],
    ['products.audit_trail', 'See product audit timeline'],
    ['products.create', 'Create new product'],
    ['products.edit', 'Edit product'],
    ['products.delete', 'Delete product'],
    ['products.bulk_import', 'Bulk import products'],
    ['products.export', 'Export products'],
    ['products.view_dp', 'See Dealer Price / Purchase Price'],
    ['products.view_margin', 'See MRP vs SP margin'],
    ['products.view_distributor', 'See distributor on product'],
  ]),

  g('distributors', 'Distributors', [
    ['distributors.list', 'Open distributor list'],
    ['distributors.detail', 'Open distributor detail'],
    ['distributors.create', 'Create distributor'],
    ['distributors.edit', 'Edit distributor'],
    ['distributors.delete', 'Delete distributor'],
    ['distributors.deactivate', 'Deactivate distributor'],
    ['distributors.view_bank_details', 'See distributor bank details'],
    ['distributors.view_gst', 'See distributor GST'],
    ['distributors.view_credit_limit', 'See distributor credit limit'],
  ]),

  g('purchases', 'Purchases', [
    ['purchases.list', 'Open purchase list'],
    ['purchases.detail', 'Open purchase detail'],
    ['purchases.create', 'Record new purchase'],
    ['purchases.create_unbilled', 'Record a purchase made without a bill'],
    ['purchases.edit', 'Edit purchase'],
    ['purchases.delete', 'Delete purchase'],
    ['purchases.record_payment', 'Record payment against purchase'],
    ['purchases.view_pending_amount', 'See accounts payable column'],
    ['purchases.export', 'Export purchases'],
  ]),

  g('customers', 'Customers', [
    ['customers.list', 'Open customer list'],
    ['customers.detail', 'Open customer detail'],
    ['customers.create', 'Create customer'],
    ['customers.edit', 'Edit customer'],
    ['customers.delete', 'Delete customer'],
    ['customers.view_aadhaar', 'See unmasked Aadhaar'],
    ['customers.view_phone', 'See customer phone'],
    ['customers.view_guarantor_chain', 'See guarantor chain'],
    ['customers.view_purchase_history', 'See customer purchase history'],
    // Address Zone — exposed both for view (filter) and edit on the customer form.
    // Naming intentionally kept as the user requested (`view.customer.address.zone`).
    ['view.customer.address.zone', 'See & edit Customer Address Zone'],
  ]),

  g('sales', 'Sales', [
    ['sales.list', 'Open sale list'],
    ['sales.detail', 'Open sale detail'],
    ['sales.view_real', 'See real installment data'],
    ['sales.view_sanitized', 'See sanitized full-cash view'],
    ['sales.invoice.view', 'Open printable invoice'],
    ['sales.invoice.download_pdf', 'Download invoice PDF'],
    ['sales.create_full_payment', 'Create full payment sale'],
    ['sales.create_partial_with_promise', 'Create partial-with-promise sale'],
    ['sales.create_self_finance', 'Create self-finance sale'],
    ['sales.create_company_finance', 'Create company-finance sale'],
    ['sales.edit', 'Edit existing sale'],
    ['sales.delete', 'Delete or cancel sale'],
    ['sales.view_history', 'View sale modification history'],
    ['sales.change_ledger_number', 'Override auto ledger number'],
    ['sales.section.financials', 'See financials section (net amount, GST)'],
    ['sales.section.profit', 'See Total Earnings / profit section'],
    ['sales.section.purchase_price', 'See DP + input GST on sale'],
    ['sales.section.self_finance', 'See self-finance section'],
    ['sales.section.company_finance', 'See company-finance section'],
    ['sales.section.payment_breakdown', 'See payment mode breakdown'],
    ['sales.section.guarantor', 'See guarantor block'],
    ['sales.section.audit_trail', 'See sale audit trail'],
    ['sales.record_company_finance_payment', 'Mark NBFC payment received'],
    ['sales.mark_partial_settled', 'Settle partial-with-promise balance'],
    ['sales.export', 'Export sales'],
    // Approval workflow — sales created by users without this permission
    // start with approvalStatus = 'pending'; users WITH this permission can
    // approve them and have their own sales auto-approved on creation.
    ['sales.approve', 'Approve pending sales'],
  ]),

  g('installments', 'Installments', [
    ['installments.list', 'Open installment list'],
    ['installments.tab.todays_scheduled', "See Today's Scheduled tab"],
    ['installments.tab.all_overdue', 'See All Overdue tab'],
    ['installments.tab.search', 'See Search tab'],
    ['installments.detail', 'Open installment schedule detail'],
    ['installments.record_payment', 'Record installment payment'],
    ['installments.reschedule_full', 'Reschedule full schedule'],
    ['installments.reschedule_partial', 'Partial pay + reschedule'],
    ['installments.waive_amount', 'Waive part of dues'],
    ['installments.assign_to_employee', 'Assign collection to employee'],
    ['installments.cancel_schedule', 'Cancel installment schedule'],
    ['installments.view_interest_rate', 'See interest rate'],
    ['installments.view_guarantor_contact', 'See guarantor contact info'],
    ['installments.payment_timeline', 'See payment timeline component'],
    ['installments.final_settlement', 'Close loan with final settlement quote'],
    ['installments.interest.apply', 'Apply overdue interest to installment'],
    ['installments.revert_payment', 'Undo or correct a recorded payment, cancel a promise entered by mistake'],
    ['installments.interest.rollback', 'Roll back applied overdue interest'],
  ]),

  g('transfers', 'Inter-Shop Transfers', [
    ['transfers.list', 'Open transfer list'],
    ['transfers.detail', 'Open transfer detail'],
    ['transfers.initiate', 'Initiate transfer'],
    ['transfers.receive', 'Receive transfer'],
    ['transfers.cancel', 'Cancel transfer (before receive)'],
    ['transfers.edit_invoice_number', 'Edit transfer invoice number'],
    ['transfers.view_transfer_price', 'See cross-shop transfer price'],
    ['transfers.view_audit_trail', 'See transfer audit trail'],
  ]),

  g('expenses', 'Expenses', [
    ['expenses.list', 'Open expense list'],
    ['expenses.detail', 'Open expense detail'],
    ['expenses.create', 'Create expense'],
    ['expenses.edit', 'Edit expense'],
    ['expenses.delete', 'Delete expense'],
    ['expenses.upload_invoice', 'Upload expense invoice'],
    ['expenses.mark_gst_claimable', 'Toggle GST claimability'],
    ['expenses.export', 'Export expenses'],
  ]),

  g('bank', 'Bank', [
    ['bank.view', 'Open bank statements page'],
    ['bank.upload_statement', 'Upload bank statement'],
    ['bank.reconcile', 'Reconcile bank transaction'],
    ['bank.unmatch', 'Undo reconciliation'],
    ['bank.delete_statement', 'Delete bank statement'],
    ['bank.view_account_balance', 'See account balance'],
  ]),

  g('employees', 'Employees', [
    ['employees.list', 'Open employee list'],
    ['employees.create', 'Create employee'],
    ['employees.edit', 'Edit employee'],
    ['employees.deactivate', 'Deactivate employee'],
    ['employees.view_collection_history', 'See employee collection history'],
    ['employees.assign_collection_route', 'Assign collection route'],
    ['employees.view_location', 'See employee location'],
  ]),

  g('users', 'Users & Roles', [
    ['users.list', 'See user list'],
    ['users.create', 'Create user'],
    ['users.edit', 'Edit user'],
    ['users.deactivate', 'Deactivate user'],
    ['users.reset_password', 'Reset user password'],
    ['users.change_role', 'Change user role'],
    ['users.assign_to_shops', 'Assign user to shops'],
    // Per-user permission overrides (grant/deny on top of role).
    // Owner-only by default; lets one user be granted or denied an
    // individual permission without cloning their role.
    ['users.edit_permissions', 'Override permissions for a specific user'],
    ['roles.list', 'See role list'],
    ['roles.create', 'Create custom role'],
    ['roles.edit_permissions', 'Edit role permissions'],
    ['roles.delete', 'Delete custom role'],
  ]),

  g('shops', 'Shops', [
    ['shops.list', 'See shop list'],
    ['shops.create', 'Create shop / GST entity'],
    ['shops.edit', 'Edit shop details'],
    ['shops.deactivate', 'Deactivate shop'],
    ['shops.view_bank_details', 'See shop bank details'],
    ['shops.view_all', 'View aggregated data across all shops at once'],
  ]),

  g('settings', 'Settings & Builders', [
    ['settings.view', 'Open settings page'],
    ['settings.app_settings', 'Edit app settings'],
    ['forms.view', 'Open form builder'],
    ['forms.edit_definitions', 'Edit form definitions'],
    ['forms.add_field', 'Add form field'],
    ['forms.delete_field', 'Delete form field'],
    ['categories.list', 'See category list'],
    ['categories.create', 'Create category'],
    ['categories.edit', 'Edit category'],
    ['categories.delete', 'Delete category'],
    ['categories.edit_attributes', 'Edit category attributes'],
    ['categories.edit_hsn_code', 'Edit category HSN code'],
  ]),

  g('reports', 'Reports', [
    ['reports.gst_summary', 'See GST summary report'],
    ['reports.profit_loss', 'See P&L report'],
    ['reports.aging_ar', 'See AR aging report'],
    ['reports.inventory_valuation', 'See inventory valuation'],
    ['reports.stock_movement', 'See stock movement report'],
    ['reports.export_all', 'Export reports'],
  ]),

  g('notifications', 'Notifications', [
    ['notifications.view_own', 'See own notifications'],
    ['notifications.view_all', 'See all system notifications'],
    ['notifications.send_manual', 'Send manual notification'],
  ]),

  g('auditlog', 'Audit Logs', [
    ['auditlog.view', 'View audit logs'],
    ['auditlog.export', 'Export audit logs'],
  ]),

  g('system', 'System', [
    ['system.backup_export', 'Export backup'],
    ['system.clear_test_data', 'Clear test data'],
    ['system.impersonate_user', 'Impersonate another user'],
  ]),
];

/** Flat list of all permissions. */
export const ALL_PERMISSIONS: PermissionDef[] = PERMISSION_GROUPS.flatMap((g) => g.permissions);

/** Just the permission keys, useful for assigning all to Owner. */
export const ALL_PERMISSION_KEYS: string[] = ALL_PERMISSIONS.map((p) => p.key);

// ---------------------------------------------------------------------------
// Role templates — initial permission sets seeded for the 5 system roles.
// Owner has everything; the others are sensible defaults that the Owner can
// change at runtime via the Settings UI.
// ---------------------------------------------------------------------------

export const ROLE_OWNER_PERMISSIONS = ALL_PERMISSION_KEYS;

export const ROLE_ADMIN_PERMISSIONS: string[] = ALL_PERMISSION_KEYS.filter((k) => {
  // Admin gets everything except role/permission management and impersonation.
  // They can see the roles list, so they can assign a role to a user.
  if (k.startsWith('roles.') && k !== 'roles.list') return false;
  if (k === 'system.impersonate_user') return false;
  if (k === 'sales.view_sanitized') return false;
  // Sale modification is locked to Owner by default. Owner can grant these
  // to Admin (or any other role) at runtime via Settings → Roles & Users.
  if (k === 'sales.edit') return false;
  if (k === 'sales.delete') return false;
  if (k === 'sales.view_history') return false;
  // Sale approval is Owner-only by default — Owner explicitly grants this
  // to whichever account should monitor/approve other users' sales.
  if (k === 'sales.approve') return false;
  // Per-user permission overrides are Owner-only. Otherwise an Admin could
  // bootstrap themselves around any policy by editing their own overrides.
  if (k === 'users.edit_permissions') return false;
  return true;
});

export const ROLE_ACCOUNTANT_PERMISSIONS: string[] = [
  // Navigation
  'nav.products', 'nav.distributors', 'nav.purchases', 'nav.customers',
  'nav.sales', 'nav.installments', 'nav.expenses', 'nav.bank', 'nav.settings',
  'shop.switch', 'settings.view',
  // Products
  'products.list', 'products.detail', 'products.audit_trail',
  'products.view_dp', 'products.view_margin', 'products.view_distributor',
  'products.export',
  // Distributors
  'distributors.list', 'distributors.detail',
  'distributors.create', 'distributors.edit',
  'distributors.view_bank_details', 'distributors.view_gst', 'distributors.view_credit_limit',
  // Purchases
  'purchases.list', 'purchases.detail', 'purchases.create', 'purchases.create_unbilled',
  'purchases.edit', 'purchases.delete',
  'purchases.record_payment', 'purchases.view_pending_amount', 'purchases.export',
  // Customers
  'customers.list', 'customers.detail', 'customers.create', 'customers.edit',
  'customers.view_phone', 'customers.view_guarantor_chain', 'customers.view_purchase_history',
  // Sales
  'sales.list', 'sales.detail', 'sales.view_real',
  'sales.invoice.view', 'sales.invoice.download_pdf',
  'sales.create_full_payment', 'sales.create_partial_with_promise',
  'sales.create_self_finance', 'sales.create_company_finance',
  'sales.section.financials', 'sales.section.profit', 'sales.section.purchase_price',
  'sales.section.self_finance', 'sales.section.company_finance',
  'sales.section.payment_breakdown', 'sales.section.guarantor', 'sales.section.audit_trail',
  'sales.record_company_finance_payment', 'sales.mark_partial_settled', 'sales.export',
  // Installments
  'installments.list', 'installments.tab.todays_scheduled', 'installments.tab.all_overdue',
  'installments.tab.search', 'installments.detail', 'installments.record_payment',
  'installments.view_interest_rate', 'installments.view_guarantor_contact',
  'installments.payment_timeline', 'installments.interest.apply', 'installments.revert_payment',
  // Expenses
  'expenses.list', 'expenses.detail', 'expenses.create', 'expenses.edit',
  'expenses.upload_invoice', 'expenses.mark_gst_claimable', 'expenses.export',
  // Bank
  'bank.view', 'bank.upload_statement', 'bank.reconcile', 'bank.view_account_balance',
  // Reports
  'reports.gst_summary', 'reports.profit_loss', 'reports.aging_ar',
  'reports.inventory_valuation', 'reports.stock_movement', 'reports.export_all',
  // Notifications
  'notifications.view_own',
];

export const ROLE_OTHERS_PERMISSIONS: string[] = [
  // Navigation
  'nav.products', 'nav.customers', 'nav.sales',
  // Products (no DP, no margin)
  'products.list', 'products.detail',
  // Customers (basic)
  'customers.list', 'customers.detail', 'customers.create',
  'customers.view_phone',
  // Sales — sanitized only
  'sales.list', 'sales.detail', 'sales.view_sanitized',
  'sales.invoice.view',
  'sales.create_full_payment',
  // Notifications
  'notifications.view_own',
];

export const ROLE_EMPLOYEE_PERMISSIONS: string[] = [
  // Mobile-only — minimal web access. Mainly installments collection.
  'nav.installments',
  'installments.list', 'installments.tab.todays_scheduled', 'installments.tab.all_overdue',
  'installments.detail', 'installments.record_payment',
  'installments.payment_timeline', 'installments.interest.apply',
  'customers.detail', 'customers.view_phone',
  'notifications.view_own',
];

export const SYSTEM_ROLES = [
  { code: 'owner', name: 'Owner', description: 'Business owner. Full access including roles & users.', permissions: ROLE_OWNER_PERMISSIONS },
  { code: 'admin', name: 'Admin', description: 'Shop administrator. Full operational access.', permissions: ROLE_ADMIN_PERMISSIONS },
  { code: 'accountant', name: 'Accountant', description: 'Finance team. No dashboard, no role management.', permissions: ROLE_ACCOUNTANT_PERMISSIONS },
  { code: 'others', name: 'Others (Sanitized)', description: 'Sees sanitized sales (no installment details).', permissions: ROLE_OTHERS_PERMISSIONS },
  { code: 'employee', name: 'Employee', description: 'Mobile-only. Installment collection in field.', permissions: ROLE_EMPLOYEE_PERMISSIONS },
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLES)[number]['code'];
