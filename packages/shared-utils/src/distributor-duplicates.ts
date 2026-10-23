/**
 * Spotting a supplier the books already have.
 *
 * Two different questions, with two different answers:
 *
 *   - A GSTIN, PAN or phone that already belongs to somebody is not a
 *     near-miss, it is the same party twice. That is an error, and the fix
 *     is to go and look at the record that already exists.
 *
 *   - A name that merely *looks* like one already there might be the same
 *     supplier spelled twice, or might be two real businesses on the same
 *     street. Nobody can tell from the string, so it is a warning and the
 *     person decides.
 *
 * Name matching is done on trigrams rather than by asking a model. It is
 * deterministic, needs no key and no network, runs over a few thousand
 * suppliers in milliseconds, and catches what actually goes wrong in these
 * books — "JAGDAMBE ELECTRONICS" against "JAGDEMBE ELECTRICALS", a missing
 * PVT, a stray full stop.
 */

/** Lower-case, no punctuation, no company-form noise, single spaces. */
export function normalizeCompanyName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(
      /\b(m\/?s|private|pvt|limited|ltd|llp|co|company|and|the|india|enterprises?|traders?|trading)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Phone as it is compared: the last ten digits, or '' when there are none. */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export function normalizeTaxId(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/**
 * How alike two names are, 0 to 1, by Dice coefficient over trigrams.
 *
 * Falls back to an exact check for names too short to have trigrams worth
 * comparing, where the measure is meaningless.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeCompanyName(a);
  const right = normalizeCompanyName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 3 || right.length < 3) return left === right ? 1 : 0;

  const l = trigrams(left);
  const r = trigrams(right);
  let shared = 0;
  for (const gram of l) if (r.has(gram)) shared += 1;
  return (2 * shared) / (l.size + r.size);
}

/**
 * Alike enough to be worth a second look.
 *
 * Set where a missing word or a swapped letter still matches but two
 * genuinely different businesses mostly do not. Tuned against the shop's
 * own creditor list.
 */
export const SIMILAR_NAME_THRESHOLD = 0.62;

/** A supplier already on file, as the checker needs to see it. */
export interface ExistingDistributor {
  id: string;
  companyName: string;
  phone?: string | null;
  gstNumber?: string | null;
  panNumber?: string | null;
}

/** A supplier about to be added, as the checker needs to see it. */
export interface CandidateDistributor {
  /** Spreadsheet row, where the candidate came from one. */
  rowNumber?: number;
  companyName: string;
  phone?: string | null;
  gstNumber?: string | null;
  panNumber?: string | null;
  /** The record being edited, which is never its own duplicate. */
  excludeId?: string;
}

export type DuplicateField = 'gstNumber' | 'panNumber' | 'phone';

export interface DuplicateClash {
  field: DuplicateField;
  value: string;
  existingId: string;
  existingName: string;
}

export interface SimilarName {
  existingId: string;
  existingName: string;
  /** 0 to 1. */
  score: number;
}

export interface DuplicateReport {
  rowNumber?: number;
  companyName: string;
  /** Same party twice. Has to be sorted out before the record can be added. */
  clashes: DuplicateClash[];
  /** Might be the same supplier spelled twice. Worth a look, not a block. */
  similar: SimilarName[];
}

const FIELD_LABEL: Record<DuplicateField, string> = {
  gstNumber: 'GSTIN',
  panNumber: 'PAN',
  phone: 'phone number',
};

export const duplicateFieldLabel = (field: DuplicateField) => FIELD_LABEL[field];

/**
 * Check candidates against what is on file, and against each other.
 *
 * Candidates are compared to earlier candidates too: a sheet that lists the
 * same GSTIN on rows 12 and 90 is just as much a problem as one that
 * clashes with the database, and only saying so after the first row is
 * imported would be too late.
 */
export function findDuplicateDistributors(
  candidates: CandidateDistributor[],
  existing: ExistingDistributor[],
): DuplicateReport[] {
  const byGst = new Map<string, ExistingDistributor>();
  const byPan = new Map<string, ExistingDistributor>();
  const byPhone = new Map<string, ExistingDistributor>();

  for (const row of existing) {
    const gst = normalizeTaxId(row.gstNumber);
    const pan = normalizeTaxId(row.panNumber);
    const phone = normalizePhone(row.phone);
    if (gst && !byGst.has(gst)) byGst.set(gst, row);
    if (pan && !byPan.has(pan)) byPan.set(pan, row);
    if (phone && !byPhone.has(phone)) byPhone.set(phone, row);
  }

  // Earlier rows of this same batch count as "already there" for later ones.
  const seenInBatch: ExistingDistributor[] = [];

  return candidates.map((candidate) => {
    const clashes: DuplicateClash[] = [];

    const check = (field: DuplicateField, value: string, index: Map<string, ExistingDistributor>) => {
      if (!value) return;
      const hit = index.get(value);
      if (hit && hit.id !== candidate.excludeId) {
        clashes.push({
          field,
          value,
          existingId: hit.id,
          existingName: hit.companyName,
        });
      }
    };

    const gst = normalizeTaxId(candidate.gstNumber);
    const pan = normalizeTaxId(candidate.panNumber);
    const phone = normalizePhone(candidate.phone);

    check('gstNumber', gst, byGst);
    check('panNumber', pan, byPan);
    check('phone', phone, byPhone);

    // Names close enough to be the same supplier written twice.
    const similar: SimilarName[] = [];
    for (const row of [...existing, ...seenInBatch]) {
      if (row.id === candidate.excludeId) continue;
      // A hard clash already says more than a similar name would.
      if (clashes.some((c) => c.existingId === row.id)) continue;
      const score = nameSimilarity(candidate.companyName, row.companyName);
      if (score >= SIMILAR_NAME_THRESHOLD) {
        similar.push({ existingId: row.id, existingName: row.companyName, score });
      }
    }
    similar.sort((a, b) => b.score - a.score);

    // This candidate is now something later rows can clash with.
    const asExisting: ExistingDistributor = {
      id: `candidate:${candidate.rowNumber ?? seenInBatch.length}`,
      companyName: candidate.companyName,
      phone: candidate.phone,
      gstNumber: candidate.gstNumber,
      panNumber: candidate.panNumber,
    };
    if (gst && !byGst.has(gst)) byGst.set(gst, asExisting);
    if (pan && !byPan.has(pan)) byPan.set(pan, asExisting);
    if (phone && !byPhone.has(phone)) byPhone.set(phone, asExisting);
    seenInBatch.push(asExisting);

    return {
      rowNumber: candidate.rowNumber,
      companyName: candidate.companyName,
      clashes,
      // Three is enough to recognise the one you meant.
      similar: similar.slice(0, 3),
    };
  });
}
