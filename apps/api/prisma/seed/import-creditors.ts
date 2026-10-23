/**
 * Bring a Tally "Sundry Creditors" export in as suppliers.
 *
 * The export is a ledger listing, not a supplier master: it has the name,
 * the address, the GSTIN and the balance, and almost nothing else. Phone is
 * on one row in ten, email and bank details are on none, and there is no
 * city column at all. Rather than refuse the rows that are thin — which is
 * most of them — each supplier is created with what the sheet knows and the
 * gaps are left showing, the same way the purchase-register importer does
 * it. `distributorCompleteness` on the web side turns those gaps into the
 * "N details missing" badge on the list.
 *
 * Nothing about money is imported. A creditor's closing balance is what the
 * shop owes on invoices that are not in this file, and inventing purchases
 * to carry it would put stock in the system that never arrived. The figures
 * are parked in `dynamicAttributes` so they are not lost.
 *
 * Idempotent: re-running matches what is already there by GSTIN and then by
 * name, and only fills blanks — it never overwrites a detail someone has
 * since typed in by hand.
 *
 * Usage (from apps/api):
 *   npx tsx prisma/seed/import-creditors.ts <file.xlsx> [--tenant vn] [--apply]
 *
 * Without --apply it reports what it would do and writes nothing.
 */
import * as path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Sheet columns, exactly as Tally names them
// ---------------------------------------------------------------------------
const COL = {
  name: 'Name',
  address: 'Address',
  state: 'State',
  pin: 'PIN',
  gstin: 'GSTIN',
  pan: 'PAN',
  phone: 'Phone (from address)',
  email: 'Email',
  contact: 'Contact',
  bank: 'Bank Details',
  closingCr: 'Closing Cr (Payable)',
  closingDr: 'Closing Dr (Advance/Receivable)',
  netBalance: 'Net Balance (+Cr / -Dr)',
  group: 'Group',
} as const;

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------
const clean = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

/** Supplier name for matching: lower-case, no punctuation or "M/s". */
function nameKey(name: string): string {
  return clean(name)
    .toLowerCase()
    .replace(/^m\/?s\.?\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A GSTIN only counts if it is shaped like one. */
function normalizeGst(value: unknown): string | null {
  const g = clean(value).toUpperCase().replace(/\s+/g, '');
  return /^[0-9]{2}[A-Z0-9]{13}$/.test(g) ? g : null;
}

/** Characters 3–12 of a GSTIN are the holder's PAN. */
function panFromGst(gstin: string | null): string | null {
  if (!gstin) return null;
  const pan = gstin.slice(2, 12);
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? pan : null;
}

function normalizePan(value: unknown): string | null {
  const p = clean(value).toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p) ? p : null;
}

/**
 * Tally stuffs whatever phone numbers it has into the address line, so one
 * cell can hold two. The first becomes the phone, the second the alternate.
 */
function splitPhones(value: unknown): { phone: string; altPhone: string | null } {
  const found = clean(value)
    .split(/[,/;]+/)
    .map((p) => p.replace(/\D/g, ''))
    .filter((p) => p.length >= 10)
    .map((p) => p.slice(-10));
  return { phone: found[0] ?? '', altPhone: found[1] ?? null };
}

/** A PIN is six digits or it is nothing; the sheet holds "09" and "20301". */
function normalizePincode(value: unknown): string {
  const p = clean(value).replace(/\D/g, '');
  return /^\d{6}$/.test(p) ? p : '';
}

/** Money as Tally writes it: "11,502.00". */
function parseAmount(value: unknown): number {
  const n = Number(clean(value).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The sheet has no city column, so it is read out of the address — but only
 * when one known place name is in there, as a whole word. A guessed city is
 * worse than a blank one, which the completeness badge will ask for.
 */
const CITIES = [
  'Greater Noida', 'New Delhi', 'Noida', 'Ghaziabad', 'Delhi', 'Gurugram', 'Gurgaon',
  'Faridabad', 'Meerut', 'Baghpat', 'Modinagar', 'Hapur', 'Bulandshahr', 'Sonipat',
  'Panipat', 'Mumbai', 'Pune', 'Bengaluru', 'Bangalore', 'Chennai', 'Kolkata',
  'Hyderabad', 'Ahmedabad', 'Surat', 'Indore', 'Bhopal', 'Jaipur', 'Lucknow',
  'Kanpur', 'Agra', 'Ludhiana', 'Chandigarh', 'Rajkot',
];

/** Localities people write instead of the city they belong to. */
const LOCALITY_CITY: Record<string, string> = {
  Indirapuram: 'Ghaziabad',
  Sahibabad: 'Ghaziabad',
  Vaishali: 'Ghaziabad',
  Kaushambi: 'Ghaziabad',
};

function cityFromAddress(address: string): string {
  const haystack = ` ${address} `;
  const hit = (place: string) =>
    new RegExp(`(^|[^A-Za-z])${place.replace(/ /g, '\\s+')}([^A-Za-z]|$)`, 'i').test(haystack);

  for (const [locality, city] of Object.entries(LOCALITY_CITY)) {
    if (hit(locality)) return city;
  }
  // Longest first, so "Greater Noida" wins over "Noida".
  const matches = CITIES.filter(hit).sort((a, b) => b.length - a.length);
  return matches[0] ?? '';
}

// ---------------------------------------------------------------------------
// One sheet row, mapped
// ---------------------------------------------------------------------------
interface Creditor {
  rowNumber: number;
  companyName: string;
  contactPerson: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  gstNumber: string | null;
  panNumber: string | null;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
  /** Tally's own figures, kept but not acted on. */
  balances: { closingCr: number; closingDr: number; net: number; group: string };
  /** Values the sheet had but that were too malformed to store. */
  rejected: Array<{ field: string; value: string }>;
}

function mapRow(raw: Record<string, unknown>, rowNumber: number): Creditor | null {
  const companyName = clean(raw[COL.name]);
  if (!companyName) return null;

  const address = clean(raw[COL.address]);
  const gstNumber = normalizeGst(raw[COL.gstin]);
  const { phone, altPhone } = splitPhones(raw[COL.phone]);
  const pincode = normalizePincode(raw[COL.pin]);
  const panNumber = normalizePan(raw[COL.pan]) ?? panFromGst(gstNumber);

  // A value the sheet had but that will not be stored is worth saying out
  // loud: it is a typo in Tally, and only there can it be fixed.
  const rejected: Array<{ field: string; value: string }> = [];
  if (clean(raw[COL.gstin]) && !gstNumber) rejected.push({ field: 'GSTIN', value: clean(raw[COL.gstin]) });
  if (clean(raw[COL.pan]) && !normalizePan(raw[COL.pan])) rejected.push({ field: 'PAN', value: clean(raw[COL.pan]) });
  if (clean(raw[COL.pin]) && !pincode) rejected.push({ field: 'PIN', value: clean(raw[COL.pin]) });

  return {
    rowNumber,
    companyName: companyName.slice(0, 300),
    // The sheet's Contact column is empty throughout; the supplier's own name
    // is a better placeholder than a blank on every screen that shows it.
    contactPerson: (clean(raw[COL.contact]) || companyName).slice(0, 200),
    phone,
    altPhone,
    email: clean(raw[COL.email]).slice(0, 255) || null,
    gstNumber,
    panNumber,
    addressLine1: address.slice(0, 255),
    city: cityFromAddress(address).slice(0, 100),
    state: clean(raw[COL.state]).slice(0, 100),
    pincode,
    balances: {
      closingCr: parseAmount(raw[COL.closingCr]),
      closingDr: parseAmount(raw[COL.closingDr]),
      net: parseAmount(raw[COL.netBalance]),
      group: clean(raw[COL.group]),
    },
    rejected,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
interface Outcome {
  created: Creditor[];
  /** Matched an existing supplier; lists the blanks that were filled. */
  updated: Array<{ row: Creditor; matchedName: string; matchedBy: 'gst' | 'name'; fills: string[] }>;
  unchanged: Array<{ row: Creditor; matchedName: string }>;
  skipped: Array<{ rowNumber: number; reason: string }>;
  /** Two rows sharing one GSTIN: one legal entity, two Tally ledgers. */
  gstCollisions: Array<{ gstin: string; names: string[] }>;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const tenantSlug = (args.find((a) => a.startsWith('--tenant='))?.split('=')[1]
    ?? (args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : undefined)
    ?? 'vn').trim();

  if (!file) {
    console.error('Usage: npx tsx prisma/seed/import-creditors.ts <file.xlsx> [--tenant vn] [--apply]');
    process.exit(1);
  }

  const tenant = await prisma.tenant.findFirst({
    where: { slug: tenantSlug },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) {
    const all = await prisma.tenant.findMany({ select: { slug: true, name: true } });
    console.error(
      `No tenant with slug "${tenantSlug}". Known: ${all.map((t) => `${t.slug} (${t.name})`).join(', ')}`,
    );
    process.exit(1);
  }

  // --- Read ----------------------------------------------------------------
  const wb = XLSX.readFile(path.resolve(file));
  const sheetName = wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    raw: false,
    defval: '',
  }) as Record<string, unknown>[];

  const missingColumns = [COL.name, COL.address, COL.gstin].filter(
    (c) => raw.length > 0 && !(c in raw[0]),
  );
  if (missingColumns.length > 0) {
    console.error(
      `Sheet "${sheetName}" is missing expected column(s): ${missingColumns.join(', ')}.\n` +
        `Found: ${Object.keys(raw[0] ?? {}).join(', ')}`,
    );
    process.exit(1);
  }

  const out: Outcome = { created: [], updated: [], unchanged: [], skipped: [], gstCollisions: [] };
  const rows: Creditor[] = [];
  raw.forEach((r, i) => {
    // +2: one for the header, one because spreadsheets count from 1.
    const mapped = mapRow(r, i + 2);
    if (mapped) rows.push(mapped);
    else out.skipped.push({ rowNumber: i + 2, reason: 'No supplier name' });
  });

  // Two ledgers under one GSTIN are reported, not silently folded together:
  // both come in, and the Merge action on the distributor list can join them
  // once a human has decided which name is the real one.
  const byGstInFile = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.gstNumber) continue;
    byGstInFile.set(r.gstNumber, [...(byGstInFile.get(r.gstNumber) ?? []), r.companyName]);
  }
  for (const [gstin, names] of byGstInFile) {
    if (names.length > 1) out.gstCollisions.push({ gstin, names });
  }

  // --- Match against what is already there ---------------------------------
  const existing = await prisma.distributor.findMany({
    where: { tenantId: tenant.id },
    select: {
      id: true, companyName: true, phone: true, altPhone: true, email: true,
      gstNumber: true, panNumber: true, addressLine1: true, city: true,
      state: true, pincode: true,
    },
  });
  const byGst = new Map(existing.filter((d) => d.gstNumber).map((d) => [d.gstNumber!, d]));
  const byName = new Map(existing.map((d) => [nameKey(d.companyName), d]));

  /** Only ever fills a blank; a value typed in by hand always wins. */
  const FILLABLE = ['phone', 'altPhone', 'email', 'gstNumber', 'panNumber', 'addressLine1', 'city', 'state', 'pincode'] as const;

  for (const row of rows) {
    const match =
      (row.gstNumber ? byGst.get(row.gstNumber) : undefined) ?? byName.get(nameKey(row.companyName));

    if (!match) {
      out.created.push(row);
      continue;
    }

    const data: Record<string, string | null> = {};
    for (const field of FILLABLE) {
      const current = clean(match[field as keyof typeof match]);
      const incoming = row[field];
      if (!current && incoming) data[field] = incoming as string;
    }
    const fills = Object.keys(data);
    if (fills.length === 0) {
      out.unchanged.push({ row, matchedName: match.companyName });
      continue;
    }
    out.updated.push({
      row,
      matchedName: match.companyName,
      matchedBy: row.gstNumber && byGst.has(row.gstNumber) ? 'gst' : 'name',
      fills,
    });
    if (apply) {
      await prisma.distributor.update({ where: { id: match.id }, data });
    }
  }

  // --- Write ---------------------------------------------------------------
  if (apply && out.created.length > 0) {
    await prisma.distributor.createMany({
      data: out.created.map((r) => ({
        tenantId: tenant.id,
        companyName: r.companyName,
        contactPerson: r.contactPerson,
        phone: r.phone,
        altPhone: r.altPhone,
        email: r.email,
        gstNumber: r.gstNumber,
        panNumber: r.panNumber,
        addressLine1: r.addressLine1,
        city: r.city,
        state: r.state,
        pincode: r.pincode,
        creditLimit: new Prisma.Decimal(0),
        dynamicAttributes: {
          importedFrom: 'excel',
          needsReview: true,
          source: 'tally-sundry-creditors',
          importedAt: new Date().toISOString(),
          sheetRow: r.rowNumber,
          // Kept so the figures survive, but nothing in the app reads them:
          // what the shop owes is computed from purchases it actually has.
          tallyClosingCr: r.balances.closingCr,
          tallyClosingDr: r.balances.closingDr,
          tallyNetBalance: r.balances.net,
          tallyGroup: r.balances.group,
        },
      })),
    });
  }

  // --- Report --------------------------------------------------------------
  const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`;
  const filled = (f: (r: Creditor) => unknown) => rows.filter((r) => clean(f(r)) !== '').length;

  console.log(`\nTally creditors → suppliers`);
  console.log(`  file    ${path.resolve(file)}`);
  console.log(`  sheet   ${sheetName}`);
  console.log(`  tenant  ${tenant.name} (${tenant.slug})`);
  console.log(`  mode    ${apply ? 'APPLY — writing to the database' : 'DRY RUN — nothing written'}`);

  console.log(`\nRows read: ${rows.length}`);
  console.log(`  create   ${out.created.length}`);
  console.log(`  fill in  ${out.updated.length}  (matched an existing supplier, blanks filled)`);
  console.log(`  no change ${out.unchanged.length}`);
  console.log(`  skipped  ${out.skipped.length}`);

  console.log(`\nWhat the sheet could supply, across ${rows.length} rows:`);
  for (const [label, get] of [
    ['GSTIN', (r: Creditor) => r.gstNumber],
    ['PAN', (r: Creditor) => r.panNumber],
    ['Address', (r: Creditor) => r.addressLine1],
    ['City (read from address)', (r: Creditor) => r.city],
    ['State', (r: Creditor) => r.state],
    ['PIN code', (r: Creditor) => r.pincode],
    ['Phone', (r: Creditor) => r.phone],
    ['Email', (r: Creditor) => r.email],
  ] as Array<[string, (r: Creditor) => unknown]>) {
    const n = filled(get);
    console.log(`  ${label.padEnd(26)} ${String(n).padStart(3)}  ${pct(n).padStart(4)}`);
  }
  console.log(`  ${'Bank details'.padEnd(26)}   0     0%  (never in a creditors export)`);

  if (out.gstCollisions.length > 0) {
    console.log(`\nSame GSTIN on more than one row — one business, two ledgers.`);
    console.log(`Both are imported; merge them on the Distributors screen if they are the same supplier:`);
    for (const c of out.gstCollisions) console.log(`  ${c.gstin}  ${c.names.join('  |  ')}`);
  }

  if (out.updated.length > 0) {
    console.log(`\nExisting suppliers topped up:`);
    for (const u of out.updated.slice(0, 20)) {
      console.log(`  ${u.row.companyName}  →  ${u.matchedName}  [${u.matchedBy}]  filled: ${u.fills.join(', ')}`);
    }
    if (out.updated.length > 20) console.log(`  ... and ${out.updated.length - 20} more`);
  }

  const withRejects = rows.filter((r) => r.rejected.length > 0);
  if (withRejects.length > 0) {
    console.log(`\nValues the sheet had that could not be stored — typos to fix in Tally:`);
    for (const r of withRejects) {
      for (const bad of r.rejected) {
        console.log(`  row ${String(r.rowNumber).padStart(3)}  ${r.companyName.padEnd(42)} ${bad.field}: "${bad.value}"`);
      }
    }
    console.log(`  (the supplier is still imported; only that one field is left blank)`);
  }

  if (out.skipped.length > 0) {
    console.log(`\nSkipped:`);
    for (const s of out.skipped) console.log(`  row ${s.rowNumber}: ${s.reason}`);
  }

  const noBalance = rows.filter((r) => r.balances.net !== 0).length;
  if (noBalance > 0) {
    console.log(
      `\n${noBalance} supplier(s) carry a balance in Tally. Those figures are kept on the record ` +
        `but no money is imported — what the shop owes is worked out from purchases it actually has.`,
    );
  }

  if (!apply) {
    console.log(`\nFirst few as they would be stored:`);
    for (const r of out.created.slice(0, 5)) {
      console.log(
        `  ${r.companyName}\n` +
          `      gst ${r.gstNumber ?? '—'}  pan ${r.panNumber ?? '—'}  phone ${r.phone || '—'}\n` +
          `      ${[r.addressLine1 || '—', r.city || '—', r.state || '—', r.pincode || '—'].join(' | ')}`,
      );
    }
    console.log(`\nNothing was written. Re-run with --apply to import.`);
  } else {
    const now = await prisma.distributor.count({ where: { tenantId: tenant.id } });
    console.log(`\nDone. ${tenant.name} now has ${now} supplier(s).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
