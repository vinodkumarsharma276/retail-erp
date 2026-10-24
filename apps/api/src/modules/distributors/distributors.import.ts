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
import {
  creditorNameKey,
  findDuplicateDistributors,
  duplicateFieldLabel,
  type ParsedCreditor,
  type DuplicateReport,
  type CandidateDistributor,
} from '@retailerp/shared-utils';
import { adjudicateNames, uncertainPairs, adjudicatorEnabled } from './name-adjudicator.js';

/** A sheet that would put the same party on the books twice. */
export class DistributorImportBlocked extends Error {}

/**
 * Which of these rows duplicate a supplier already on file, or each other.
 *
 * Used by the preview to show the problem and by the commit to refuse it,
 * so the two cannot disagree about what counts as a duplicate.
 */
export async function checkDistributorDuplicates(
  rows: ParsedCreditor[],
): Promise<DuplicateReport[]> {
  return checkCandidatesForDuplicates(
    rows.map((row) => ({
      rowNumber: row.rowNumber,
      companyName: row.companyName,
      phone: row.phone,
      gstNumber: row.gstNumber,
      panNumber: row.panNumber,
    })),
  );
}

/**
 * The duplicate check as both screens get it: trigrams, then a model on the
 * pairs trigrams were unsure about.
 *
 * Trigram overlap settles most of it for nothing. What it cannot see is
 * meaning — it compares letters, so a swapped word order or an abbreviation
 * scores far lower than it deserves. Only the uncertain middle is put to a
 * model, which on a 195-row sheet is a handful of pairs rather than 195
 * calls, and the obvious cases stay instant, free and repeatable.
 */
export async function checkCandidatesForDuplicates(
  candidates: CandidateDistributor[],
): Promise<DuplicateReport[]> {
  const existing = await prisma.distributor.findMany({
    select: { id: true, companyName: true, phone: true, gstNumber: true, panNumber: true },
  });

  const reports = findDuplicateDistributors(candidates, existing);

  if (!adjudicatorEnabled()) return reports;

  const verdicts = await adjudicateNames(uncertainPairs(candidates, existing));
  if (verdicts.length === 0) return reports;

  // Only "same" verdicts do anything: the model is there to catch what the
  // letters missed, never to overrule a name the letters already matched.
  const sameByName = new Map<string, Map<string, string | undefined>>();
  for (const v of verdicts) {
    if (!v.same) continue;
    const forName = sameByName.get(v.candidateName) ?? new Map();
    forName.set(v.existingId, v.reason);
    sameByName.set(v.candidateName, forName);
  }
  const byId = new Map(existing.map((e) => [e.id, e]));

  return reports.map((report) => {
    const found = sameByName.get(report.companyName);
    if (!found) return report;

    const already = new Set(report.similar.map((s) => s.existingId));
    const added = [...found.entries()]
      .filter(([id]) => !already.has(id) && byId.has(id))
      .filter(([id]) => !report.clashes.some((c) => c.existingId === id))
      .map(([id, reason]) => ({
        existingId: id,
        existingName: byId.get(id)!.companyName,
        // Not a letter-overlap score; the model was asked and said yes.
        score: 1,
        reason,
      }));

    return added.length > 0
      ? { ...report, similar: [...report.similar, ...added].slice(0, 5) }
      : report;
  });
}

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
  /** Only for rows that would make a new supplier. */
  duplicates: DuplicateReport[];
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

  // Only new suppliers can duplicate one: a matched row is an update.
  const creating = new Set(
    planned.filter((r) => r.action === 'create').map((r) => r.rowNumber),
  );
  const duplicates = (
    await checkDistributorDuplicates(rows.filter((r) => creating.has(r.rowNumber)))
  ).filter((report) => report.clashes.length > 0 || report.similar.length > 0);

  return {
    rows: planned,
    counts: {
      create: planned.filter((r) => r.action === 'create').length,
      fill: planned.filter((r) => r.action === 'fill').length,
      unchanged: planned.filter((r) => r.action === 'unchanged').length,
    },
    duplicates,
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

  // Only the rows that would make a *new* supplier can duplicate one. A row
  // matching an existing supplier is an update to it, which is the point of
  // re-importing a sheet, not a clash.
  //
  // The screen will not let a clashing sheet through, but the screen is not
  // the thing that has to be right: a GSTIN on two suppliers is far easier
  // to refuse than to unpick afterwards.
  const creating = new Set(
    plan.rows.filter((r) => r.action === 'create').map((r) => r.rowNumber),
  );
  const blocking = (
    await checkDistributorDuplicates(rows.filter((r) => creating.has(r.rowNumber)))
  ).filter((report) => report.clashes.length > 0);

  if (blocking.length > 0) {
    const first = blocking[0];
    const clash = first.clashes[0];
    throw new DistributorImportBlocked(
      `${first.companyName} has the same ${duplicateFieldLabel(clash.field)} (${clash.value}) as ${clash.existingName}. ` +
        `Sort that out before importing${blocking.length > 1 ? `; ${blocking.length - 1} other row(s) clash too` : ''}.`,
    );
  }
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
