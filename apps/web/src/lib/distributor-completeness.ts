import type { Distributor } from '@retailerp/shared-types';

/**
 * Which supplier details are still missing.
 *
 * A supplier created from a Tally purchase register starts out thin: the
 * register carries a name, a GSTIN and an address, and nothing else. Bank
 * details in particular are never in it, and they are what you need on the
 * day you have to pay the supplier. Rather than block the import on details
 * the sheet cannot supply, the record is created and the gaps are shown —
 * on the list, and on a tab of the supplier's own page.
 */

export type CompletenessGroup = 'Contact' | 'Address' | 'Tax' | 'Bank';

export interface MissingDetail {
  field: keyof Distributor;
  label: string;
  group: CompletenessGroup;
  /** Needed before the supplier can be paid or an invoice can be claimed. */
  important: boolean;
}

const CHECKS: MissingDetail[] = [
  { field: 'phone', label: 'Phone number', group: 'Contact', important: true },
  { field: 'email', label: 'Email', group: 'Contact', important: false },
  { field: 'addressLine1', label: 'Address', group: 'Address', important: false },
  { field: 'city', label: 'City', group: 'Address', important: false },
  { field: 'state', label: 'State', group: 'Address', important: false },
  { field: 'pincode', label: 'PIN code', group: 'Address', important: false },
  { field: 'gstNumber', label: 'GSTIN', group: 'Tax', important: true },
  { field: 'panNumber', label: 'PAN', group: 'Tax', important: false },
  { field: 'bankName', label: 'Bank name', group: 'Bank', important: true },
  { field: 'bankAccountNumber', label: 'Account number', group: 'Bank', important: true },
  { field: 'bankIfsc', label: 'IFSC code', group: 'Bank', important: true },
  { field: 'bankBranch', label: 'Branch', group: 'Bank', important: false },
];

export interface Completeness {
  missing: MissingDetail[];
  /** Missing details that hold up paying the supplier or claiming GST. */
  importantMissing: MissingDetail[];
  /** Missing details grouped the way the form presents them. */
  byGroup: Array<{ group: CompletenessGroup; fields: MissingDetail[] }>;
  /** How much of the record is filled in, 0 to 100. */
  percent: number;
  isComplete: boolean;
  /** True for a supplier the importer created, which is why it may be thin. */
  fromImport: boolean;
}

const isBlank = (value: unknown) => value == null || String(value).trim() === '';

export function distributorCompleteness(distributor: Distributor): Completeness {
  const missing = CHECKS.filter((check) => isBlank(distributor[check.field]));
  const groups: CompletenessGroup[] = ['Contact', 'Address', 'Tax', 'Bank'];

  return {
    missing,
    importantMissing: missing.filter((detail) => detail.important),
    byGroup: groups
      .map((group) => ({ group, fields: missing.filter((detail) => detail.group === group) }))
      .filter((entry) => entry.fields.length > 0),
    percent: Math.round(((CHECKS.length - missing.length) / CHECKS.length) * 100),
    isComplete: missing.length === 0,
    fromImport:
      (distributor.dynamicAttributes as Record<string, unknown> | undefined)?.importedFrom === 'excel',
  };
}
