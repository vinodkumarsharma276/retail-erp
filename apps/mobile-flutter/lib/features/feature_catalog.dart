import 'package:flutter/material.dart';
import '../core/session_models.dart';

class FeatureEntry {
  const FeatureEntry(
    this.id,
    this.title,
    this.icon,
    this.permission,
    this.feature, {
    this.prerequisite,
  });
  final String id;
  final String title;
  final IconData icon;
  final String permission;
  final String? feature;
  final String? prerequisite;

  bool visibleTo(Identity identity) =>
      identity.can(permission, feature: feature) &&
      (prerequisite == null || identity.can(prerequisite!));
}

/// Owner decision (2026-11-10): on the phone, everyone except the owner sees
/// only these modules for now. Their permissions still apply on top.
const mobileModulesForEveryone = {'customer-searching', 'installment'};

/// Modules with a working Flutter screen; the rest are listed as "coming soon".
const mobileModulesBuilt = {'customer-searching'};

/// The modules this user's phone lists, in rail order.
List<FeatureEntry> mobileModulesFor(Identity identity) {
  if (identity.flags['mobile_app'] != true) return const [];
  return featureCatalog
      .where(
        (f) =>
            f.visibleTo(identity) &&
            (identity.isOwner || mobileModulesForEveryone.contains(f.id)),
      )
      .toList();
}

const featureCatalog = [
  FeatureEntry(
    'dashboard',
    'Dashboard',
    Icons.dashboard_outlined,
    'nav.dashboard',
    'dashboard.analytics',
  ),
  FeatureEntry(
    'products',
    'Products',
    Icons.inventory_2_outlined,
    'nav.products',
    'products',
  ),
  FeatureEntry(
    'purchases',
    'Purchases',
    Icons.receipt_long_outlined,
    'nav.purchases',
    'purchases',
  ),
  FeatureEntry(
    'distributors',
    'Distributors',
    Icons.local_shipping_outlined,
    'nav.distributors',
    'distributors',
  ),
  FeatureEntry(
    'transfers',
    'Transfers',
    Icons.swap_horiz,
    'nav.transfers',
    'transfers',
  ),
  FeatureEntry(
    'sales',
    'Sales',
    Icons.shopping_cart_outlined,
    'nav.sales',
    'sales',
  ),
  FeatureEntry(
    'installment',
    'Installments',
    Icons.calendar_month_outlined,
    'nav.installments',
    'installments',
  ),
  FeatureEntry(
    'customers',
    'Customers',
    Icons.people_outline,
    'nav.customers',
    'customers',
  ),
  FeatureEntry(
    'customer-searching',
    'Customer Searching',
    Icons.person_search_outlined,
    'nav.customer_search',
    'customer_search',
    prerequisite: 'customer_search.list',
  ),
  FeatureEntry(
    'expenses',
    'Expenses',
    Icons.account_balance_wallet_outlined,
    'nav.expenses',
    'expenses',
  ),
  FeatureEntry(
    'bank-overview',
    'Bank overview',
    Icons.account_balance_outlined,
    'nav.bank',
    'bank.reconciliation',
  ),
  FeatureEntry(
    'bank-upload',
    'Upload statement',
    Icons.upload_file_outlined,
    'bank.upload_statement',
    'bank.reconciliation',
  ),
  FeatureEntry(
    'bank-review',
    'Bank review queue',
    Icons.fact_check_outlined,
    'nav.bank',
    'bank.reconciliation',
  ),
  FeatureEntry(
    'bank-transactions',
    'Bank transactions',
    Icons.list_alt,
    'nav.bank',
    'bank.reconciliation',
  ),
  FeatureEntry(
    'bank-statements',
    'Bank statements',
    Icons.description_outlined,
    'nav.bank',
    'bank.reconciliation',
  ),
  FeatureEntry(
    'bank-rules',
    'Bank rules',
    Icons.rule,
    'nav.bank',
    'bank.reconciliation',
  ),
  FeatureEntry(
    'employees',
    'Employees',
    Icons.badge_outlined,
    'nav.employees',
    null,
  ),
  FeatureEntry(
    'settings',
    'Settings',
    Icons.settings_outlined,
    'nav.settings',
    null,
  ),
];
