/**
 * Bring a Tally "Sundry Creditors" export in as suppliers, from the command
 * line.
 *
 * The same job the Distributors → Import from Excel screen does, for when
 * the sheet is on a server, or the run wants to be scripted, or there are
 * more rows than anyone wants to sit watching a browser tab for. It shares
 * the parsing (`parseCreditorSheet`) and the writing
 * (`planDistributorImport` / `commitDistributorImport`) with that screen, so
 * the two cannot drift apart — only the reporting differs.
 *
 * Usage (from apps/api):
 *   npx tsx prisma/seed/import-creditors.ts <file.xlsx> [--tenant vn] [--apply]
 *
 * Without --apply it reports what it would do and writes nothing.
 */
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import {
  parseCreditorSheet,
  creditorSheetCoverage,
  type ParsedCreditor,
} from '@retailerp/shared-utils';
import {
  planDistributorImport,
  commitDistributorImport,
} from '../../src/modules/distributors/distributors.import.js';
import { tenantContext } from '../../src/config/tenant-context.js';

const prisma = new PrismaClient();

function arg(args: string[], name: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  if (inline) return inline;
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const tenantSlug = (arg(args, 'tenant') ?? 'vn').trim();

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
  const resolved = path.resolve(file);
  const wb = XLSX.readFile(resolved);
  const sheetName =
    wb.SheetNames.find((n) => /creditor|supplier|vendor/i.test(n)) ?? wb.SheetNames[0];
  const records = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    raw: false,
    defval: '',
  }) as Record<string, unknown>[];

  const sheet = parseCreditorSheet(records, 2);

  if (sheet.missingColumns.length > 0) {
    console.error(
      `Sheet "${sheetName}" is missing expected column(s): ${sheet.missingColumns.join(', ')}.\n` +
        `Found: ${Object.keys(records[0] ?? {}).join(', ')}`,
    );
    process.exit(1);
  }
  if (sheet.rows.length === 0) {
    console.error(`Sheet "${sheetName}" has no suppliers in it.`);
    process.exit(1);
  }

  // --- Plan, and maybe write -----------------------------------------------
  // The service reads and writes through the tenant-scoped client, which
  // takes the tenant from this context rather than from an argument.
  const run = <T>(fn: () => Promise<T>) => tenantContext.runAs(tenant.id, fn);

  const plan = await run(() => planDistributorImport(sheet.rows, tenant.id));
  const result = apply
    ? await run(() => commitDistributorImport(sheet.rows, tenant.id, null))
    : null;

  // --- Report --------------------------------------------------------------
  const rows: ParsedCreditor[] = sheet.rows;

  console.log(`\nTally creditors → suppliers`);
  console.log(`  file    ${resolved}`);
  console.log(`  sheet   ${sheetName}`);
  console.log(`  tenant  ${tenant.name} (${tenant.slug})`);
  console.log(`  mode    ${apply ? 'APPLY — writing to the database' : 'DRY RUN — nothing written'}`);

  console.log(`\nRows read: ${rows.length}`);
  console.log(`  create    ${plan.counts.create}`);
  console.log(`  fill in   ${plan.counts.fill}  (matched an existing supplier, blanks filled)`);
  console.log(`  no change ${plan.counts.unchanged}`);
  console.log(`  skipped   ${sheet.skipped.length}`);

  console.log(`\nWhat the sheet could supply, across ${rows.length} rows:`);
  for (const c of creditorSheetCoverage(rows)) {
    const pct = c.total ? `${Math.round((c.filled / c.total) * 100)}%` : '0%';
    console.log(`  ${c.label.padEnd(26)} ${String(c.filled).padStart(3)}  ${pct.padStart(4)}`);
  }
  console.log(`  ${'Bank details'.padEnd(26)}   0     0%  (never in a creditors export)`);

  if (sheet.gstCollisions.length > 0) {
    console.log(`\nSame GSTIN on more than one row — one business, two ledgers.`);
    console.log(`Both are imported; merge them on the Distributors screen if they are the same:`);
    for (const c of sheet.gstCollisions) console.log(`  ${c.gstin}  ${c.names.join('  |  ')}`);
  }

  const filled = plan.rows.filter((r) => r.action === 'fill');
  if (filled.length > 0) {
    console.log(`\nExisting suppliers topped up:`);
    for (const u of filled.slice(0, 20)) {
      console.log(`  ${u.companyName}  →  ${u.matchedName}  [${u.matchedBy}]  filled: ${u.fills?.join(', ')}`);
    }
    if (filled.length > 20) console.log(`  ... and ${filled.length - 20} more`);
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

  if (sheet.skipped.length > 0) {
    console.log(`\nSkipped:`);
    for (const s of sheet.skipped) console.log(`  row ${s.rowNumber}: ${s.reason}`);
  }

  const withBalance = rows.filter((r) => r.balances.net !== 0).length;
  if (withBalance > 0) {
    console.log(
      `\n${withBalance} supplier(s) carry a balance in Tally. Those figures are kept on the record ` +
        `but no money is imported — what the shop owes is worked out from purchases it actually has.`,
    );
  }

  if (!result) {
    console.log(`\nFirst few as they would be stored:`);
    const creating = new Set(
      plan.rows.filter((r) => r.action === 'create').map((r) => r.rowNumber),
    );
    for (const r of rows.filter((x) => creating.has(x.rowNumber)).slice(0, 5)) {
      console.log(
        `  ${r.companyName}\n` +
          `      gst ${r.gstNumber ?? '—'}  pan ${r.panNumber ?? '—'}  phone ${r.phone || '—'}\n` +
          `      ${[r.addressLine1 || '—', r.city || '—', r.state || '—', r.pincode || '—'].join(' | ')}`,
      );
    }
    console.log(`\nNothing was written. Re-run with --apply to import.`);
  } else {
    const now = await prisma.distributor.count({ where: { tenantId: tenant.id } });
    console.log(
      `\nDone. Created ${result.created}, filled in ${result.filled}, left ${result.unchanged} alone.`,
    );
    console.log(`${tenant.name} now has ${now} supplier(s).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
