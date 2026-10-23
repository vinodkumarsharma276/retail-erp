/**
 * Importing a Tally creditors list as suppliers.
 *
 * Two steps, like the purchase importer: a preview that writes nothing and
 * says exactly what would happen, then a commit. The sheet is read in the
 * browser — `parseCreditorSheet` in shared-utils does that for both ends —
 * so what arrives here is already mapped rows, and this file only decides
 * what is new, what is already known, and what to fill in.
 *
 * Re-running is safe by design: a supplier is matched on GSTIN first and
 * then on name, and a match only ever has its *blanks* filled. A detail
 * someone typed in by hand is never overwritten by a sheet.
 */
import { prisma } from '../../config/database.js';
import { Prisma } from '@prisma/client';
import { creditorNameKey, type ParsedCreditor } from '@retailerp/shared-utils';

/** Fields a sheet may fill on a supplier that already exists. */
const FILLABLE = [
  'phone', 'altPhone', 'email', 'gstNumber', 'panNumber',
  'addressLine1', 'city', 'state', 'pincode',
] as const;

type FillableField = (typeof FILLABLE)[number];

export interface DistributorImportPlanRow {
  rowNumber: number;
  companyName: string;
  action: 'create' | 'fill' | 'unchanged';
  /** Set for 'fill' and 'unchanged'. */
  matchedId?: string;
  matchedName?: string;
  matchedBy?: 'gst' | 'name';
  /** Which blanks would be filled, for 'fill'. */
  fills?: FillableField[];
  gstNumber: string | null;
  city: string;
  phone: string;
}

export interface DistributorImportPreview {
  rows: DistributorImportPlanRow[];
  counts: { create: number; fill: number; unchanged: number };
}

const clean = (value: unknown) => String(value ?? '').trim();

/**
 * What the sheet would do, without doing it.
 *
 * Matching is done against the suppliers that existed when the run started,
 * so two rows in one sheet sharing a GSTIN both come through as new rather
 * than the second silently folding into the first.
 */
export async function planDistributorImport(
  rows: ParsedCreditor[],
  tenantId: string,
): Promise<DistributorImportPreview> {
  const existing = await prisma.distributor.findMany({
    where: { tenantId },
    select: {
      id: true, companyName: true, phone: true, altPhone: true, email: true,
      gstNumber: true, panNumber: true, addressLine1: true, city: true,
      state: true, pincode: true,
    },
  });

  const byGst = new Map(existing.filter((d) => d.gstNumber).map((d) => [d.gstNumber!, d]));
  const byName = new Map(existing.map((d) => [creditorNameKey(d.companyName), d]));

  const planned: DistributorImportPlanRow[] = rows.map((row) => {
    const gstMatch = row.gstNumber ? byGst.get(row.gstNumber) : undefined;
    const match = gstMatch ?? byName.get(creditorNameKey(row.companyName));

    const base = {
      rowNumber: row.rowNumber,
      companyName: row.companyName,
      gstNumber: row.gstNumber,
      city: row.city,
      phone: row.phone,
    };

    if (!match) return { ...base, action: 'create' as const };

    const fills = FILLABLE.filter((field) => {
      const current = clean(match[field as keyof typeof match]);
      return !current && clean(row[field]) !== '';
    });

    return {
      ...base,
      action: fills.length > 0 ? ('fill' as const) : ('unchanged' as const),
      matchedId: match.id,
      matchedName: match.companyName,
      matchedBy: gstMatch ? ('gst' as const) : ('name' as const),
      fills,
    };
  });

  return {
    rows: planned,
    counts: {
      create: planned.filter((r) => r.action === 'create').length,
      fill: planned.filter((r) => r.action === 'fill').length,
      unchanged: planned.filter((r) => r.action === 'unchanged').length,
    },
  };
}

export interface DistributorImportResult {
  created: number;
  filled: number;
  unchanged: number;
}

/**
 * Write the plan.
 *
 * The plan is recomputed here rather than trusted from the browser: between
 * previewing and pressing the button someone else may have added the very
 * supplier this row would create.
 */
export async function commitDistributorImport(
  rows: ParsedCreditor[],
  tenantId: string,
  userId: string | null,
): Promise<DistributorImportResult> {
  const plan = await planDistributorImport(rows, tenantId);
  const byRowNumber = new Map(rows.map((r) => [r.rowNumber, r]));

  const toCreate = plan.rows.filter((r) => r.action === 'create');
  const toFill = plan.rows.filter((r) => r.action === 'fill');

  const importedAt = new Date().toISOString();

  await prisma.$transaction(async (tx) => {
    if (toCreate.length > 0) {
      await tx.distributor.createMany({
        data: toCreate.map((planned) => {
          const row = byRowNumber.get(planned.rowNumber)!;
          return {
            tenantId,
            companyName: row.companyName,
            contactPerson: row.contactPerson,
            phone: row.phone,
            altPhone: row.altPhone,
            email: row.email,
            gstNumber: row.gstNumber,
            panNumber: row.panNumber,
            addressLine1: row.addressLine1,
            city: row.city,
            state: row.state,
            pincode: row.pincode,
            creditLimit: new Prisma.Decimal(0),
            createdBy: userId,
            dynamicAttributes: {
              importedFrom: 'excel',
              needsReview: true,
              source: 'tally-sundry-creditors',
              importedAt,
              sheetRow: row.rowNumber,
              // Kept so the figures survive the move, but nothing reads
              // them: what the shop owes is worked out from its purchases.
              tallyClosingCr: row.balances.closingCr,
              tallyClosingDr: row.balances.closingDr,
              tallyNetBalance: row.balances.net,
              tallyGroup: row.balances.group,
            },
          };
        }),
      });
    }

    for (const planned of toFill) {
      const row = byRowNumber.get(planned.rowNumber)!;
      const data: Record<string, string | null> = {};
      for (const field of planned.fills ?? []) data[field] = row[field] as string | null;
      if (Object.keys(data).length === 0) continue;
      await tx.distributor.update({ where: { id: planned.matchedId! }, data });
    }
  });

  return {
    created: toCreate.length,
    filled: toFill.length,
    unchanged: plan.counts.unchanged,
  };
}
