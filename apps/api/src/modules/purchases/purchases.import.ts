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

/**
 * The attribute that holds a handset’s IMEI numbers. Where a category
 * requires it, a line without IMEIs is an error rather than a warning: an
 * untraceable phone is no use for warranty or for finding who bought it.
 */
const IMEI_ATTRIBUTE = 'imeiNumbers';

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

/**
 * Supplier details a sheet can fill in on a supplier already on file.
 *
 * Only blanks are ever filled: a Tally register is a snapshot of what the
 * shop's accountant typed, so it is good enough to complete a record but not
 * to overrule one somebody maintains by hand.
 */
const FILLABLE_FIELDS = [
  { field: 'gstNumber', label: 'GSTIN', from: (row: PurchaseImportRow) => normalizeGst(row.distributorGst) ?? '' },
  { field: 'panNumber', label: 'PAN', from: (row: PurchaseImportRow) => clean(row.distributorPan).toUpperCase().slice(0, 10) },
  { field: 'phone', label: 'Phone', from: (row: PurchaseImportRow) => clean(row.distributorPhone).replace(/\D/g, '').slice(-10) },
  { field: 'addressLine1', label: 'Address', from: (row: PurchaseImportRow) => clean(row.distributorAddress).slice(0, 255) },
  { field: 'city', label: 'City', from: (row: PurchaseImportRow) => clean(row.distributorCity).slice(0, 100) },
  { field: 'state', label: 'State', from: (row: PurchaseImportRow) => clean(row.distributorState).slice(0, 100) },
  { field: 'pincode', label: 'PIN code', from: (row: PurchaseImportRow) => clean(row.distributorPincode).replace(/\D/g, '').slice(0, 6) },
] as const;

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
      select: {
        id: true,
        name: true,
        path: true,
        isLeaf: true,
        // Which categories insist on an IMEI, so a phone without one is
        // caught here rather than saved half-identified.
        attributes: {
          where: { isActive: true, isRequired: true, attributeName: IMEI_ATTRIBUTE },
          select: { attributeName: true },
        },
      },
    }),
    prisma.distributor.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        id: true, companyName: true, gstNumber: true, panNumber: true, phone: true,
        addressLine1: true, city: true, state: true, pincode: true,
      },
    }),
  ]);
  if (!shop) throw new Error('Shop not found');

  // Category by name; a leaf wins over a parent of the same name.
  const categoryByName = new Map<string, (typeof categories)[number]>();
  for (const c of [...categories].sort((a, b) => Number(a.isLeaf) - Number(b.isLeaf))) {
    categoryByName.set(lower(c.name), c);
  }
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  /** A category settled by the item classifier wins over matching by name. */
  const resolveCategory = (row: PurchaseImportRow) => {
    if (row.categoryId && categoryById.has(row.categoryId)) return categoryById.get(row.categoryId)!;
    const key = lower(row.categoryName);
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

    // Details the sheet can add to a supplier already on file.
    const fieldsToFill: PurchaseImportPreviewInvoice['distributor']['fieldsToFill'] = [];
    if (matched && request.updateDistributors) {
      for (const { field, label, from } of FILLABLE_FIELDS) {
        const existing = clean((matched as Record<string, unknown>)[field] as string | null | undefined);
        if (existing) continue;
        const value = lines.map(from).find(Boolean);
        if (value) fieldsToFill.push({ field, label, value });
      }
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

      const category = resolveCategory(line);
      const categoryName = clean(line.categoryName);
      if (!category) {
        const k = lower(categoryName) || lower(modelNumber);
        const entry = unknownCategoryRows.get(k) ?? { name: categoryName || modelNumber, rows: 0 };
        entry.rows += 1;
        unknownCategoryRows.set(k, entry);
        errors.push(
          categoryName
            ? `${at}: product type "${categoryName}" isn't a known category — choose one.`
            : `${at}: "${modelNumber}" has no product type — choose a category for it.`,
        );
      }

      // A phone has to arrive with its IMEI numbers, one set per unit.
      if (category && category.attributes.length > 0) {
        const supplied = line.unitImeis ?? [];
        const numbered = supplied.filter((unit) => unit.length > 0).length;
        if (numbered === 0) {
          errors.push(`${at}: "${modelNumber}" needs an IMEI number and the sheet gives none.`);
        } else if (numbered !== quantity) {
          errors.push(`${at}: ${numbered} of ${quantity} units have an IMEI number; every one needs its own.`);
        }
      }

      // The first word of an item name is the brand often enough to be
      // tempting and wrong often enough to matter — "KING" is not the maker
      // of "KING STORAGE 6X6". Every unit is stored under its make, so it is
      // asked for rather than guessed.
      const brand = clean(line.brand);
      if (!brand) {
        errors.push(`${at}: "${modelNumber}" has no brand — say which make it is.`);
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
        attributes: line.attributes ?? {},
        isDemoUnit: Boolean(line.isDemoUnit),
        unitImeis: line.unitImeis ?? [],
      });
    }

    const totalAmount = round2(items.reduce((s, i) => s + i.rate * i.quantity, 0));
    const discountAmount = round2(items.reduce((s, i) => s + i.discount, 0));
    const gstAmount = round2(items.reduce((s, i) => s + i.gstAmount, 0));
    // Rounding the supplier applied, so the stored total is the printed
    // one to the paisa rather than a few paise off it.
    const roundOff = round2(Number(lines.find((l) => l.roundOff != null)?.roundOff) || 0);
    const computedNet = round2(totalAmount - discountAmount + gstAmount + roundOff);
    const printedTotal = lines.find((l) => l.invoiceTotal != null && Number(l.invoiceTotal) > 0)?.invoiceTotal;

    /**
     * What the shop owes is what the bill says, not what its lines add up to.
     *
     * Tax is rounded on each line, so summing them lands a paisa or two from
     * the invoice's own figure — on the October book, 13 of 26 invoices. Where
     * the sheet states a total, that is used and the lines are only checked
     * against it; a difference worth more than a rupee is a real disagreement
     * and is said out loud rather than quietly adopted.
     */
    const netAmount = printedTotal != null ? round2(Number(printedTotal)) : computedNet;
    if (printedTotal != null && Math.abs(Number(printedTotal) - computedNet) > 1) {
      warnings.push(`Lines add up to ₹${computedNet}, but the invoice total in the sheet is ₹${round2(Number(printedTotal))}; the sheet total is used.`);
    }

    invoices.push({
      key,
      invoiceNumber,
      voucherNumber: clean(lines.find((l) => l.voucherNumber)?.voucherNumber) || null,
      invoiceDate,
      rowNumbers: lines.map((l) => l.rowNumber),
      distributor: {
        name: distributorName,
        gstNumber: gst,
        matchedId: matched?.id ?? null,
        matchedName: matched?.companyName ?? null,
        matchedBy,
        fieldsToFill,
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

  // Supplier updates, collected once per supplier rather than per invoice.
  const updatesById = new Map<string, PurchaseImportPreview['distributorUpdates'][number]>();
  for (const inv of invoices) {
    const id = inv.distributor.matchedId;
    if (!id || inv.distributor.fieldsToFill.length === 0) continue;
    const entry = updatesById.get(id) ?? { distributorId: id, name: inv.distributor.matchedName ?? inv.distributor.name, fields: [] };
    for (const field of inv.distributor.fieldsToFill) {
      if (!entry.fields.some((f) => f.field === field.field)) entry.fields.push(field);
    }
    updatesById.set(id, entry);
  }

  /**
   * Is this sheet even for this shop? A Tally register is exported one
   * entity at a time, so importing September's Vinod Electronics register
   * into Nishant Electronics is the easiest mistake to make here — and the
   * one that takes longest to unpick afterwards.
   */
  const consigneeNames = [...new Set(rows.map((r) => clean(r.consigneeName)).filter(Boolean))];
  const sheetOwnerName = clean(request.sheetOwnerName) || null;
  const shopNameKey = nameKey(shop.name);
  const namesToCheck = consigneeNames.length > 0 ? consigneeNames : sheetOwnerName ? [sheetOwnerName] : [];
  const shopCheck = namesToCheck.length > 0
    ? { sheetOwnerName, consigneeNames, matches: namesToCheck.every((n) => nameKey(n) === shopNameKey) }
    : null;

  const preview: PurchaseImportPreview = {
    shop,
    shopCheck,
    invoices,
    unknownCategories: [...unknownCategoryRows.values()].sort((a, b) => b.rows - a.rows),
    distributorUpdates: [...updatesById.values()],
    summary: {
      invoices: invoices.length,
      ready: invoices.filter((i) => i.errors.length === 0 && !i.duplicateOf).length,
      units: invoices.reduce((s, i) => s + i.unitCount, 0),
      newDistributors: newSuppliers.size,
      updatedDistributors: updatesById.size,
      duplicates: invoices.filter((i) => i.duplicateOf).length,
      withErrors: invoices.filter((i) => i.errors.length > 0).length,
      demoUnits: invoices.reduce(
        (s, i) => s + i.items.filter((item) => item.isDemoUnit).reduce((n, item) => n + item.quantity, 0),
        0,
      ),
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

    // One record per import run, so every invoice it brought in can be traced
    // back to the file it came from — and shown as imported on the list.
    const batch = await prisma.purchaseImportBatch.create({
      data: {
        tenantId: ctx.tenantId,
        shopId: ctx.shopId,
        fileName: clean(request.fileName).slice(0, 255) || 'spreadsheet',
        sourceFormat: request.sourceFormat === 'tally_purchase_register' ? 'tally_purchase_register' : 'mapped_columns',
        period: clean(request.period).slice(0, 100) || null,
        sheetOwnerName: clean(request.sheetOwnerName).slice(0, 300) || null,
        createdBy: ctx.userId,
      },
      select: { id: true },
    });

    const updatedDistributors = new Set<string>();

    /**
     * Fill in blank supplier details before touching the invoices.
     *
     * This used to sit inside the transaction that records a purchase, so
     * it never ran for an invoice already on file. Re-importing a book to
     * pick up supplier details it had gained — which is exactly when this
     * matters — skipped nearly all of them, and the preview promised
     * updates the import then did not make.
     *
     * Supplier details have nothing to do with whether a particular bill is
     * new, so they are applied once per supplier, for the whole sheet.
     */
    for (const update of preview.distributorUpdates) {
      try {
        // Read it again here: what gets filled is what is still blank now,
        // not what was blank when the preview was built.
        const current = await prisma.distributor.findFirst({
          where: { id: update.distributorId, tenantId: ctx.tenantId },
          select: {
            gstNumber: true, panNumber: true, phone: true,
            addressLine1: true, city: true, state: true, pincode: true,
          },
        });
        if (!current) continue;
        const data: Record<string, string> = {};
        for (const { field, value } of update.fields) {
          const existing = clean((current as Record<string, unknown>)[field] as string | null | undefined);
          if (!existing) data[field] = value;
        }
        if (Object.keys(data).length === 0) continue;
        await prisma.distributor.update({
          where: { id: update.distributorId },
          data: data as Prisma.DistributorUpdateInput,
        });
        updatedDistributors.add(update.distributorId);
      } catch (cause) {
        // A supplier that cannot be topped up must not stop the import.
        console.warn('[purchase-import] could not fill in supplier details:', cause);
      }
    }

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
        const outcome = await prisma.$transaction(async (tx) => {
          // Supplier: matched, created earlier in this run, or new.
          let distributorId = inv.distributor.matchedId ?? createdSuppliers.get(nameKey(inv.distributor.name)) ?? null;
          if (!distributorId) {
            const firstRow = rowByNumber.get(inv.rowNumbers[0]);
            const d = await tx.distributor.create({
              data: {
                tenantId: ctx.tenantId,
                companyName: inv.distributor.name,
                contactPerson: inv.distributor.name,
                phone: clean(firstRow?.distributorPhone).replace(/\D/g, '').slice(-10),
                gstNumber: inv.distributor.gstNumber,
                panNumber: clean(firstRow?.distributorPan).toUpperCase().slice(0, 10) || null,
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
              notes: request.billed === false ? 'Imported from spreadsheet (no bill)' : 'Imported from spreadsheet',
              billed: request.billed !== false,
              source: 'excel_import',
              importBatchId: batch.id,
              createdBy: ctx.userId,
            },
          });

          // One product record per unit, the same as entering it by hand.
          const units: Prisma.ProductCreateManyInput[] = [];
          for (const item of inv.items) {
            const row = rowByNumber.get(item.rowNumber);
            const costPerUnit = round2(item.rate - item.discount / item.quantity);
            const givenSellingPrice = row?.sellingPrice != null && Number(row.sellingPrice) > 0 ? round2(Number(row.sellingPrice)) : null;
            const givenMrp = row?.mrp != null && Number(row.mrp) > 0 ? round2(Number(row.mrp)) : null;
            const attributes: Record<string, unknown> = { importedFrom: 'excel', ...item.attributes };
            if (row?.hsnCode) attributes.hsnCode = clean(row.hsnCode);
            if (row?.gstRate != null) attributes.gstRate = Number(row.gstRate);
            if (item.isDemoUnit) attributes.isDemoUnit = true;
            // A purchase register carries cost and nothing else. Rather than
            // invent a retail price, the unit is stored at cost and marked so
            // it can be found and priced before it is sold.
            if (!givenMrp && !givenSellingPrice) attributes.priceNotSet = true;
            // No real model was established, so the item name is standing in.
            // Marked rather than refused: the unit was genuinely bought.
            if (row?.modelKnown === false) attributes.modelNotSet = true;

            for (let n = 0; n < item.quantity; n += 1) {
              // Each unit keeps its own IMEI numbers, so a handset can be
              // traced from this invoice to the customer who buys it.
              const imeis = item.unitImeis?.[n] ?? [];
              const unitAttributes = imeis.length > 0
                ? { ...attributes, [IMEI_ATTRIBUTE]: imeis }
                : attributes;
              units.push({
                tenantId: ctx.tenantId,
                shopId: ctx.shopId,
                categoryId: item.categoryId!,
                brand: item.brand.slice(0, 200),
                modelNumber: item.modelNumber.slice(0, 200),
                serialNumber: item.serialNumber,
                mrp: givenMrp ?? item.mrp,
                sellingPrice: givenSellingPrice ?? givenMrp ?? item.mrp,
                purchasePrice: costPerUnit > 0 ? costPerUnit : item.rate,
                color: clean(row?.color).slice(0, 50) || null,
                distributorId,
                purchaseId: purchase.id,
                status: 'in_stock',
                dynamicAttributes: unitAttributes as Prisma.InputJsonValue,
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

        if ('skipped' in outcome) {
          results.push({ ...base, status: 'skipped', purchaseId: outcome.skipped, message: 'Already recorded' });
        } else {
          results.push({ ...base, status: 'created', purchaseId: outcome.created });
        }
      } catch (error) {
        results.push({ ...base, status: 'failed', message: error instanceof Error ? error.message : 'Could not save' });
      }
    }

    const created = results.filter((r) => r.status === 'created');
    const createdKeys = new Set(created.map((r) => r.key));
    const importedInvoices = preview.invoices.filter((i) => createdKeys.has(i.key));

    await prisma.purchaseImportBatch.update({
      where: { id: batch.id },
      data: {
        invoiceCount: created.length,
        unitCount: importedInvoices.reduce((s, i) => s + i.unitCount, 0),
        netAmount: round2(importedInvoices.reduce((s, i) => s + i.netAmount, 0)),
        skippedCount: results.filter((r) => r.status === 'skipped').length,
        failedCount: results.filter((r) => r.status === 'failed').length,
        distributorsCreated: createdSuppliers.size,
        distributorsUpdated: updatedDistributors.size,
      },
    });

    return {
      results,
      created: created.length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      distributorsCreated: createdSuppliers.size,
      distributorsUpdated: updatedDistributors.size,
      batchId: batch.id,
    };
  },

  /** Past import runs, newest first, for the imports history. */
  async listBatches(ctx: { tenantId: string; shopId?: string | null }, limit = 20) {
    const batches = await prisma.purchaseImportBatch.findMany({
      where: { tenantId: ctx.tenantId, ...(ctx.shopId ? { shopId: ctx.shopId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        shop: { select: { id: true, name: true, code: true } },
        creator: { select: { fullName: true } },
      },
    });
    return batches.map((batch) => ({
      id: batch.id,
      fileName: batch.fileName,
      sourceFormat: batch.sourceFormat,
      period: batch.period,
      sheetOwnerName: batch.sheetOwnerName,
      shop: batch.shop,
      invoiceCount: batch.invoiceCount,
      unitCount: batch.unitCount,
      netAmount: Number(batch.netAmount),
      skippedCount: batch.skippedCount,
      failedCount: batch.failedCount,
      distributorsCreated: batch.distributorsCreated,
      distributorsUpdated: batch.distributorsUpdated,
      createdByName: batch.creator?.fullName ?? null,
      createdAt: batch.createdAt.toISOString(),
    }));
  },
};
