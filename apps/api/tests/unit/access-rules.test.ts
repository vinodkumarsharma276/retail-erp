import { describe, expect, it } from 'vitest';
import {
  ALL_FEATURE_KEYS,
  FeatureKey,
  SYSTEM_ROLES,
  effectivePermissions,
  isSanitizedViewer,
  prerequisitesFor,
} from '@retailerp/shared-types';

const allOn = Object.fromEntries(ALL_FEATURE_KEYS.map((k) => [k, true]));
const allBut = (...off: string[]) => ({ ...allOn, ...Object.fromEntries(off.map((k) => [k, false])) });

/** P — What a user can actually do, from role + tenant features + dependencies. */
describe('P. Permission rules', () => {
  it('P1 every default role works as granted — nothing in it is dropped', () => {
    for (const role of SYSTEM_ROLES) {
      const eff = effectivePermissions(role.permissions, allOn);
      expect(role.permissions.filter((p) => !eff.has(p)), role.code).toEqual([]);
    }
  });

  it('P2 a menu item needs its list', () => {
    expect([...effectivePermissions(['nav.products'], allOn)]).toEqual([]);
    expect(effectivePermissions(['nav.products', 'products.list'], allOn).has('nav.products')).toBe(true);
  });

  it('P3 actions need the screen they live on (create needs the list)', () => {
    expect(effectivePermissions(['expenses.create'], allOn).has('expenses.create')).toBe(false);
    expect(effectivePermissions(['expenses.list', 'expenses.create'], allOn).has('expenses.create')).toBe(true);
  });

  it('P4 a record can be opened without the full list (a customer from an installment)', () => {
    expect(effectivePermissions(['customers.detail', 'customers.view_phone'], allOn)).toEqual(
      new Set(['customers.detail', 'customers.view_phone']),
    );
  });

  it('P5 removing a prerequisite removes everything hanging off it', () => {
    const eff = effectivePermissions(['sales.list', 'sales.detail', 'sales.view_real', 'sales.section.profit', 'sales.section.audit_trail'], allOn);
    expect(eff.has('sales.section.profit')).toBe(true);
    const without = effectivePermissions(['sales.list', 'sales.view_real', 'sales.section.profit', 'sales.section.audit_trail'], allOn);
    expect(without.has('sales.section.profit')).toBe(false);
  });

  it('P6 a sale can only be made by someone who can pick a customer and a product', () => {
    expect(prerequisitesFor('sales.create_full_payment')).toEqual(expect.arrayContaining(['customers.list', 'products.list']));
    expect(effectivePermissions(['sales.list', 'sales.create_full_payment'], allOn).has('sales.create_full_payment')).toBe(false);
  });

  it('P7 a feature switched off for the tenant switches off its permissions, even for the owner', () => {
    const owner = SYSTEM_ROLES.find((r) => r.code === 'owner')!.permissions;
    const eff = effectivePermissions(owner, allBut(FeatureKey.BANK_RECONCILIATION, FeatureKey.INSTALLMENTS));
    expect([...eff].some((k) => k.startsWith('bank.') || k === 'nav.bank')).toBe(false);
    expect([...eff].some((k) => k.startsWith('installments.') || k === 'nav.installments')).toBe(false);
    expect(eff.has('sales.create_self_finance')).toBe(false);
    expect(eff.has('sales.create_company_finance')).toBe(true);
  });

  it('P8 someone who sees only the sanitized sales can never reach installment data', () => {
    const perms = ['sales.list', 'sales.detail', 'sales.view_sanitized', 'installments.list', 'installments.detail', 'nav.installments', 'customers.list', 'customers.detail', 'customers.view_guarantor_chain'];
    const eff = effectivePermissions(perms, allOn);
    expect(isSanitizedViewer(eff)).toBe(true);
    expect([...eff].filter((k) => k.includes('installment') || k.includes('guarantor'))).toEqual([]);
  });

  it('P9 field collectors keep their installment access (they have no sales access at all)', () => {
    const employee = SYSTEM_ROLES.find((r) => r.code === 'employee')!.permissions;
    const eff = effectivePermissions(employee, allOn);
    expect(eff.has('installments.record_payment')).toBe(true);
    expect(eff.has('customers.view_phone')).toBe(true);
  });

  it('P10 the "Others" role sees sanitized sales and nothing about installments', () => {
    const others = SYSTEM_ROLES.find((r) => r.code === 'others')!.permissions;
    const eff = effectivePermissions(others, allOn);
    expect(isSanitizedViewer(eff)).toBe(true);
    expect([...eff].some((k) => k.startsWith('installments.'))).toBe(false);
  });

  it('P11 sale sections showing real terms need the real sale', () => {
    expect(prerequisitesFor('sales.section.self_finance')).toEqual(expect.arrayContaining(['sales.detail', 'sales.view_real']));
  });
});
