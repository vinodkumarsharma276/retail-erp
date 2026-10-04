import { Prisma } from '@prisma/client';
import type {
  PurchaseImportPreview,
  PurchaseImportPreviewInvoice,
  PurchaseImportRequest,
  PurchaseImportResult,
  PurchaseImportRow,
} from '@retailerp/shared-types';
import { prisma } from '../../config/database.js';

/**
 * Bulk import of purchases from a spreadsheet (a Tally purchase register,
 * or any sheet mapped to the same fields in the browser).
 *
 * `preview` and `commit` share one planning step, so what the person
 * reviewed is exactly what gets saved. Each invoice is saved in its own
 * transaction: one bad invoice never blocks the rest, and re-running an
 * import skips invoices already recorded for that supplier.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const lower = (s: string | undefined | null) => clean(s).toLowerCase();

/** Supplier name for matching: lower-case, no punctuation or "M/s". */
function nameKey(name: string): string {
  return lower(name)
    .replace(/^m\/?s\.?\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeGst(gst: string | undefined): string | null {
  const g = clean(gst).toUpperCase().replace(/\s+/g, '');
  return /^[0-9]{2}[A-Z0-9]{13}$/.test(g) ? g : null;
}

interface PlanContext {
  tenantId: string;
  shopId: string;
}

async function plan(request: PurchaseImportRequest, ctx: PlanContext) {
  const rows = request.rows;
  const categoryMap = new Map(
    Object.entries(request.categoryMap ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );

  // --- Lookups ---------------------------------------------------------------
  const [shop, categories, distributors] = await Promise.all([
    prisma.shop.findFirst({ where: { id: ctx.shopId, tenantId: ctx.tenantId }, select: { id: true, name: true, code: true } }),
    prisma.productCategory.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      select: { id: true, name: true, path: true, isLeaf: true },
    }),
    prisma.distributor.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, companyName: true, gstNumber: true },
    }),
  ]);
  if (!shop) throw new Error('Shop not found');

  // Category by name; a leaf wins over a parent of the same name.
  const categoryByName = new Map<string, (typeof categories)[number]>();
  for (const c of [...categories].sort((a, b) => Number(a.isLeaf) - Number(b.isLeaf))) {
    categoryByName.set(lower(c.name), c);
  }
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const resolveCategory = (name: string) => {
    const key = lower(name);
    const mappedId = categoryMap.get(key);
    if (mappedId && categoryById.has(mappedId)) return categoryById.get(mappedId)!;
    return key ? categoryByName.get(key) ?? null : null;
  };

  const distributorByGst = new Map(
    distributors.filter((d) => d.gstNumber).map((d) => [d.gstNumber!.toUpperCase(), d]),
  );
  const distributorByName = new Map(distributors.map((d) => [nameKey(d.companyName), d]));

  // --- Group lines into invoices ----------------------------------------------
  const groups = new Map<string, PurchaseImportRow[]>();
  for (const row of rows) {
    const key = [nameKey(row.distributorName), lower(row.invoiceNumber), clean(row.invoiceDate)].join('|');
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const unknownCategoryRows = new Map<string, { name: string; rows: number }>();
  const invoices: PurchaseImportPreviewInvoice[] = [];

  for (const [key, lines] of groups) {
    const first = lines[0];
    const errors: string[] = [];
    const warnings: string[] = [];
    const invoiceNumber = clean(first.invoiceNumber);
    const invoiceDate = clean(first.invoiceDate);
    const distributorName = clean(first.distributorName);

    if (!invoiceNumber) errors.push('Invoice number is missing.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || Number.isNaN(Date.parse(invoiceDate))) {
      errors.push(`Invoice date "${first.invoiceDate || '(blank)'}" is not a valid date.`);
    }
    if (!distributorName) errors.push('Supplier name is missing.');

    // Supplier: GST number first, then name.
    const gst = normalizeGst(lines.find((l) => l.distributorGst)?.distributorGst);
    let matched: (typeof distributors)[number] | undefined;
    let matchedBy: 'gst' | 'name' | null = null;
    if (gst && distributorByGst.has(gst)) {
      matched = distributorByGst.get(gst);
      matchedBy = 'gst';
    } else if (distributorName && distributorByName.has(nameKey(distributorName))) {
      matched = distributorByName.get(nameKey(distributorName));
      matchedBy = 'name';
    }
    if (!matched && distributorName) warnings.push(`New supplier "${distributorName}" will be created.`);
    if (lines.some((l) => clean(l.distributorGst)) && !gst) {
      warnings.push(`GST number "${clean(lines.find((l) => l.distributorGst)?.distributorGst)}" doesn't look valid; it will be left blank.`);
    }

    // Lines → items
    const items: PurchaseImportPreviewInvoice['items'] = [];
    for (const line of lines) {
      const at = `Row ${line.rowNumber}`;
      const modelNumber = clean(line.modelNumber);
      const quantity = Number(line.quantity);
      const amount = line.amount != null ? Number(line.amount) : undefined;
      let rate = line.rate != null ? Number(line.rate) : undefined;
      if ((rate == null || Number.isNaN(rate)) && amount != null && quantity > 0) rate = round2(amount / quantity);

      if (!modelNumber) errors.push(`${at}: item name is missing.`);
      if (!Number.isInteger(quantity) || quantity < 1) {
        errors.push(`${at}: quantity "${line.quantity}" must be a whole number of 1 or more.`);
      } else if (quantity > 500) {
        errors.push(`${at}: quantity ${quantity} is too large for one line.`);
      }
      if (rate == null || Number.isNaN(rate) || rate <= 0) errors.push(`${at}: rate or amount is missing.`);
      if (rate != null && amount != null && quantity > 0 && Math.abs(rate * quantity - amount) > 1) {
        warnings.push(`${at}: quantity × rate (₹${round2(rate * quantity)}) differs from the amount (₹${round2(amount)}).`);
      }
      if (line.serialNumber && quantity > 1) {
        errors.push(`${at}: a serial number can only be given for a single unit (quantity is ${quantity}).`);
      }

      const categoryName = clean(line.categoryName);
      const category = resolveCategory(categoryName);
      if (!category) {
        const k = lower(categoryName);
        const entry = unknownCategoryRows.get(k) ?? { name: categoryName, rows: 0 };
        entry.rows += 1;
        unknownCategoryRows.set(k, entry);
        errors.push(
          categoryName
            ? `${at}: product type "${categoryName}" isn't a known category — choose one.`
            : `${at}: no product type — choose a category for these rows.`,
        );
      }

      let brand = clean(line.brand);
      if (!brand && modelNumber) {
        brand = modelNumber.split(' ')[0];
        warnings.push(`${at}: no brand given; using "${brand}" from the item name.`);
      }
      const r = rate != null && !Number.isNaN(rate) ? round2(rate) : 0;
      const mrp = line.mrp != null && Number(line.mrp) > 0 ? round2(Number(line.mrp)) : r;

      items.push({
        rowNumber: line.rowNumber,
        categoryName,
        categoryId: category?.id ?? null,
        categoryLabel: category?.name ?? null,
        brand,
        modelNumber,
        serialNumber: clean(line.serialNumber) || null,
        quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 0,
        rate: r,
        discount: round2(Number(line.discount) || 0),
        gstAmount: round2(Number(line.gstAmount) || 0),
        mrp,
      });
    }

    const totalAmount = round2(items.reduce((s, i) => s + i.rate * i.quantity, 0));
    const discountAmount = round2(items.reduce((s, i) => s + i.discount, 0));
    const gstAmount = round2(items.reduce((s, i) => s + i.gstAmount, 0));
    const netAmount = round2(totalAmount - discountAmount + gstAmount);
    const printedTotal = lines.find((l) => l.invoiceTotal != null && Number(l.invoiceTotal) > 0)?.invoiceTotal;
    if (printedTotal != null && Math.abs(Number(printedTotal) - netAmount) > 1) {
      warnings.push(`Lines add up to ₹${netAmount}, but the invoice total in the sheet is ₹${round2(Number(printedTotal))}.`);
    }

    invoices.push({
      key,
      invoiceNumber,
      invoiceDate,
      rowNumbers: lines.map((l) => l.rowNumber),
      distributor: {
        name: distributorName,
        gstNumber: gst,
        matchedId: matched?.id ?? null,
        matchedName: matched?.companyName ?? null,
        matchedBy,
      },
      items,
      unitCount: items.reduce((s, i) => s + i.quantity, 0),
      totalAmount,
      discountAmount,
      gstAmount,
      netAmount,
      duplicateOf: null,
      errors,
      warnings,
    });
  }

  // --- Already recorded? ---------------------------------------------------
  const matchedIds = [...new Set(invoices.map((i) => i.distributor.matchedId).filter(Boolean))] as string[];
  if (matchedIds.length > 0) {
    const existing = await prisma.purchase.findMany({
      where: { tenantId: ctx.tenantId, distributorId: { in: matchedIds } },
      select: { id: true, distributorId: true, invoiceNumber: true },
    });
    const seen = new Map(existing.map((p) => [`${p.distributorId}|${lower(p.invoiceNumber)}`, p.id]));
    for (const inv of invoices) {
      const id = inv.distributor.matchedId && seen.get(`${inv.distributor.matchedId}|${lower(inv.invoiceNumber)}`);
      if (id) inv.duplicateOf = { purchaseId: id };
    }
  }

  // The same invoice number twice for one supplier in this file, on
  // different dates — almost always a typo; import neither until fixed.
  const byInvoice = new Map<string, PurchaseImportPreviewInvoice[]>();
  for (const inv of invoices) {
    const k = `${nameKey(inv.distributor.name)}|${lower(inv.invoiceNumber)}`;
    byInvoice.set(k, [...(byInvoice.get(k) ?? []), inv]);
  }
  for (const list of byInvoice.values()) {
    if (list.length > 1 && list[0].invoiceNumber) {
      for (const inv of list) {
        inv.errors.push(`Invoice ${inv.invoiceNumber} appears ${list.length} times for this supplier with different dates.`);
      }
    }
  }

  invoices.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));

  const newSuppliers = new Set(
    invoices.filter((i) => !i.distributor.matchedId && i.distributor.name).map((i) => nameKey(i.distributor.name)),
  );
  const preview: PurchaseImportPreview = {
    shop,
    invoices,
    unknownCategories: [...unknownCategoryRows.values()].sort((a, b) => b.rows - a.rows),
    summary: {
      invoices: invoices.length,
      ready: invoices.filter((i) => i.errors.length === 0 && !i.duplicateOf).length,
      units: invoices.reduce((s, i) => s + i.unitCount, 0),
      newDistributors: newSuppliers.size,
      duplicates: invoices.filter((i) => i.duplicateOf).length,
      withErrors: invoices.filter((i) => i.errors.length > 0).length,
    },
  };
  return { preview, rows };
}

export const purchaseImportService = {
  async preview(request: PurchaseImportRequest, ctx: PlanContext): Promise<PurchaseImportPreview> {
    return (await plan(request, ctx)).preview;
  },

  async commit(request: PurchaseImportRequest, ctx: PlanContext & { userId: string }): Promise<PurchaseImportResult> {
    const { preview, rows } = await plan(request, ctx);
    const rowByNumber = new Map(rows.map((r) => [r.rowNumber, r]));
    const createdSuppliers = new Map<string, string>(); // nameKey → id, for invoices later in this run
    const results: PurchaseImportResult['results'] = [];

    for (const inv of preview.invoices) {
      const base = { key: inv.key, invoiceNumber: inv.invoiceNumber, distributorName: inv.distributor.name };
      if (inv.duplicateOf) {
        results.push({ ...base, status: 'skipped', purchaseId: inv.duplicateOf.purchaseId, message: 'Already recorded' });
        continue;
      }
      if (inv.errors.length > 0) {
        results.push({ ...base, status: 'failed', message: inv.errors[0] });
        continue;
      }

      try {
        const purchaseId = await prisma.$transaction(async (tx) => {
          // Supplier: matched, created earlier in this run, or new.
          let distributorId = inv.distributor.matchedId ?? createdSuppliers.get(nameKey(inv.distributor.name)) ?? null;
          if (!distributorId) {
            const firstRow = rowByNumber.get(inv.rowNumbers[0]);
            const d = await tx.distributor.create({
              data: {
                tenantId: ctx.tenantId,
                companyName: inv.distributor.name,
                contactPerson: inv.distributor.name,
                phone: clean(firstRow?.distributorPhone).slice(0, 15),
                gstNumber: inv.distributor.gstNumber,
                addressLine1: clean(firstRow?.distributorAddress).slice(0, 255),
                city: clean(firstRow?.distributorCity).slice(0, 100),
                state: clean(firstRow?.distributorState).slice(0, 100),
                pincode: clean(firstRow?.distributorPincode).replace(/\D/g, '').slice(0, 6),
                dynamicAttributes: { importedFrom: 'excel', needsReview: true },
                createdBy: ctx.userId,
              },
            });
            distributorId = d.id;
            createdSuppliers.set(nameKey(inv.distributor.name), d.id);
          } else {
            // Re-check inside the transaction: an earlier invoice in this run
            // may have recorded the same supplier invoice.
            const dup = await tx.purchase.findFirst({
              where: { tenantId: ctx.tenantId, distributorId, invoiceNumber: { equals: inv.invoiceNumber, mode: 'insensitive' } },
              select: { id: true },
            });
            if (dup) return { skipped: dup.id };
          }

          const purchase = await tx.purchase.create({
            data: {
              tenantId: ctx.tenantId,
              shopId: ctx.shopId,
              distributorId,
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: new Date(`${inv.invoiceDate}T00:00:00.000Z`),
              totalAmount: inv.totalAmount,
              gstAmount: inv.gstAmount,
              discountAmount: inv.discountAmount,
              netAmount: inv.netAmount,
              amountPaid: request.markPaid ? inv.netAmount : 0,
              paymentStatus: request.markPaid ? 'paid' : 'pending',
              notes: 'Imported from spreadsheet',
              createdBy: ctx.userId,
            },
          });

          // One product record per unit, the same as entering it by hand.
          const units: Prisma.ProductCreateManyInput[] = [];
          for (const item of inv.items) {
            const row = rowByNumber.get(item.rowNumber);
            const costPerUnit = round2(item.rate - item.discount / item.quantity);
            const sellingPrice = row?.sellingPrice != null && Number(row.sellingPrice) > 0 ? round2(Number(row.sellingPrice)) : item.mrp;
            const attributes: Record<string, unknown> = { importedFrom: 'excel' };
            if (row?.hsnCode) attributes.hsnCode = clean(row.hsnCode);
            if (row?.gstRate != null) attributes.gstRate = Number(row.gstRate);
            for (let n = 0; n < item.quantity; n += 1) {
              units.push({
                tenantId: ctx.tenantId,
                shopId: ctx.shopId,
                categoryId: item.categoryId!,
                brand: item.brand.slice(0, 200),
                modelNumber: item.modelNumber.slice(0, 200),
                serialNumber: item.serialNumber,
                mrp: item.mrp,
                sellingPrice,
                purchasePrice: costPerUnit > 0 ? costPerUnit : item.rate,
                color: clean(row?.color).slice(0, 50) || null,
                distributorId,
                purchaseId: purchase.id,
                status: 'in_stock',
                dynamicAttributes: attributes as Prisma.InputJsonValue,
                warrantyMonths: row?.warrantyMonths != null ? Math.round(Number(row.warrantyMonths)) : null,
                createdBy: ctx.userId,
              });
            }
          }
          const products = await tx.product.createManyAndReturn({ data: units, select: { id: true } });
          await tx.productAuditTrail.createMany({
            data: products.map((p) => ({
              tenantId: ctx.tenantId,
              productId: p.id,
              eventType: 'purchased',
              toShopId: ctx.shopId,
              referenceId: purchase.id,
              referenceType: 'purchase',
              performedBy: ctx.userId,
              notes: `Imported purchase from ${inv.distributor.name}, Invoice: ${inv.invoiceNumber}`,
            })),
          });

          await tx.distributorCategory.createMany({
            data: [...new Set(inv.items.map((i) => i.categoryId!))].map((categoryId) => ({
              tenantId: ctx.tenantId,
              distributorId: distributorId!,
              categoryId,
            })),
            skipDuplicates: true,
          });

          if (request.markPaid) {
            await tx.purchasePayment.create({
              data: {
                tenantId: ctx.tenantId,
                purchaseId: purchase.id,
                amount: inv.netAmount,
                paymentMode: request.markPaid.paymentMode,
                paymentDate: new Date(`${inv.invoiceDate}T00:00:00.000Z`),
                notes: 'Imported as paid',
                createdBy: ctx.userId,
              },
            });
          }
          return { created: purchase.id };
        });

        if ('skipped' in purchaseId) {
          results.push({ ...base, status: 'skipped', purchaseId: purchaseId.skipped, message: 'Already recorded' });
        } else {
          results.push({ ...base, status: 'created', purchaseId: purchaseId.created });
        }
      } catch (error) {
        results.push({ ...base, status: 'failed', message: error instanceof Error ? error.message : 'Could not save' });
      }
    }

    return {
      results,
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      distributorsCreated: createdSuppliers.size,
    };
  },
};
