import { config } from '../../config/index.js';
import { prisma } from '../../config/database.js';
import { invoiceJsonSchema, invoiceParseSchema, type InvoiceParseResult } from './schemas/invoice.schema.js';
import { registerJsonSchema, registerParseSchema, type RegisterParseResult } from './schemas/register.schema.js';
import { parseWithOpenAi, resolveBrandByWebSearch, resolveHsnByWebSearch, resolveProductSpecsByWebSearch, type SpecAttributeDef } from './providers/openai-vision.provider.js';
import { matchDistributor } from './utils/distributor-match.js';

type OcrFile = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
};

const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

function ensureEnabled() {
  if (config.ocr.provider === 'disabled') {
    const error = new Error('OCR scanning is disabled. Configure OPENAI_API_KEY or set OCR_PROVIDER=openai.');
    (error as Error & { statusCode?: number }).statusCode = 503;
    throw error;
  }
  if (config.ocr.provider !== 'openai') {
    throw new Error(`Unsupported OCR provider: ${config.ocr.provider}`);
  }
}

function validateFile(file: OcrFile) {
  if (!supportedMimeTypes.has(file.mimeType)) {
    throw new Error('Unsupported file type. Upload an image or PDF.');
  }
  if (file.buffer.length > config.ocr.maxFileMb * 1024 * 1024) {
    throw new Error(`File is too large. Maximum allowed size is ${config.ocr.maxFileMb} MB.`);
  }
}

function splitSerials(serialNumbers: string[]) {
  const values = serialNumbers.flatMap((serial) => serial.split(/[\n,;\s]+/g));
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function snapGst(value: number | null) {
  if (value === null || Number.isNaN(value)) return null;
  const slabs = [0, 5, 12, 18, 28];
  return slabs.reduce((best, slab) => Math.abs(slab - value) < Math.abs(best - value) ? slab : best, slabs[0]);
}

function postProcessInvoice(result: InvoiceParseResult): InvoiceParseResult {
  return {
    ...result,
    items: result.items.map((item) => {
      const serialNumbers = splitSerials(item.serialNumbers);
      return {
        ...item,
        serialNumbers,
        quantity: Math.max(1, serialNumbers.length || item.quantity || 1),
        gstPercent: snapGst(item.gstPercent),
      };
    }),
  };
}

/**
 * Second-pass enrichment: for each line item with a readable model number,
 * resolve / validate the brand via OpenAI web search.
 *   - No brand parsed   -> use the web-search result.
 *   - Brand parsed      -> validate against the model number; if the web
 *                          search returns a clearly different brand, prefer
 *                          the web answer (OCR mis-reads happen) and warn.
 * Runs all lookups in parallel. Failures are silent.
 */
async function resolveMissingBrands(result: InvoiceParseResult): Promise<InvoiceParseResult> {
  const needsLookup = result.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.modelNumber?.trim());

  if (needsLookup.length === 0) return result;

  const lookups = await Promise.all(
    needsLookup.map(({ item }) =>
      resolveBrandByWebSearch({
        modelNumber: item.modelNumber!.trim(),
        categoryHint: item.categoryHint,
      }),
    ),
  );

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const brandsMatch = (a: string, b: string) => {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  };

  const items = [...result.items];
  const warnings = [...result.warnings];
  needsLookup.forEach(({ index, item }, lookupIdx) => {
    const webBrand = lookups[lookupIdx];
    if (!webBrand) return;
    const parsedBrand = item.brand?.trim();
    if (!parsedBrand) {
      items[index] = { ...items[index], brand: webBrand };
      warnings.push(
        `Brand "${webBrand}" inferred from model number "${item.modelNumber}" via web lookup — please verify.`,
      );
    } else if (!brandsMatch(parsedBrand, webBrand)) {
      items[index] = { ...items[index], brand: webBrand };
      warnings.push(
        `Brand for model "${item.modelNumber}" updated from "${parsedBrand}" to "${webBrand}" based on web lookup — please verify.`,
      );
    }
  });

  return { ...result, items, warnings };
}

/**
 * Third-pass enrichment: for each line item with a model number, look for an
 * existing Product in the same tenant with that model number. If found, copy
 * over fields that the invoice didn't supply (brand, color, warranty, selling
 * price, HSN, category) and attach `matchedProductId` + `categoryId` so the
 * frontend can preselect the category and skip redundant data entry.
 */
async function enrichFromExistingProducts(result: InvoiceParseResult, tenantId: string): Promise<InvoiceParseResult> {
  const lookups = result.items.map((item) => {
    const model = item.modelNumber?.trim();
    if (!model) return Promise.resolve(null);
    return prisma.product.findFirst({
      where: { tenantId, modelNumber: { equals: model, mode: 'insensitive' } },
      select: {
        id: true,
        categoryId: true,
        brand: true,
        color: true,
        warrantyMonths: true,
        sellingPrice: true,
        category: { select: { hsnCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  const matches = await Promise.all(lookups);
  const warnings = [...result.warnings];
  const items = result.items.map((item, idx) => {
    const match = matches[idx];
    if (!match) return item;
    warnings.push(
      `Model "${item.modelNumber}" already exists in catalogue — prefilled brand / category / pricing from the existing product.`,
    );
    return {
      ...item,
      matchedProductId: match.id,
      categoryId: match.categoryId,
      brand: item.brand || match.brand || null,
      color: item.color || match.color || null,
      warrantyMonths: item.warrantyMonths ?? match.warrantyMonths ?? null,
      sellingPrice: item.sellingPrice ?? (Number(match.sellingPrice) || null),
      hsnCode: item.hsnCode || match.category?.hsnCode || null,
    };
  });

  return { ...result, items, warnings };
}

/**
 * Second-pass enrichment: resolve missing HSN codes via web search using the
 * brand + model + category. Runs in parallel. Failures are silent.
 */
async function resolveMissingHsn(result: InvoiceParseResult): Promise<InvoiceParseResult> {
  const needsLookup = result.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.hsnCode?.trim() && (item.modelNumber?.trim() || item.categoryHint?.trim()));

  if (needsLookup.length === 0) return result;

  const lookups = await Promise.all(
    needsLookup.map(({ item }) =>
      resolveHsnByWebSearch({
        brand: item.brand,
        modelNumber: item.modelNumber,
        categoryHint: item.categoryHint,
      }),
    ),
  );

  const items = [...result.items];
  const warnings = [...result.warnings];
  needsLookup.forEach(({ index, item }, lookupIdx) => {
    const hsn = lookups[lookupIdx];
    if (hsn) {
      items[index] = { ...items[index], hsnCode: hsn };
      warnings.push(
        `HSN code "${hsn}" inferred for "${item.brand || ''} ${item.modelNumber || item.categoryHint || ''}".trim() via web lookup — please verify.`,
      );
    }
  });

  return { ...result, items, warnings };
}

/**
 * Resolve a leaf category id for an item. Prefers an already-resolved
 * `categoryId` (from the existing-product match), otherwise fuzzy-matches the
 * parsed `categoryHint` against active leaf categories by name/slug.
 */
async function resolveLeafCategoryId(item: { categoryId?: string | null; categoryHint?: string | null }): Promise<string | null> {
  if (item.categoryId) return item.categoryId;
  const hint = item.categoryHint?.trim();
  if (!hint) return null;

  const leaves = await prisma.productCategory.findMany({
    where: { isLeaf: true, isActive: true },
    select: { id: true, name: true, slug: true, parent: { select: { name: true } } },
  });

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(hint);
  if (!target) return null;

  // Exact name/slug match first, then parent-name match, then substring match.
  const exact = leaves.find((c) => norm(c.name) === target || norm(c.slug) === target);
  if (exact) return exact.id;
  const byParent = leaves.find((c) => c.parent && norm(c.parent.name) === target);
  if (byParent) return byParent.id;
  const partial = leaves.find((c) => {
    const n = norm(c.name);
    return n.includes(target) || target.includes(n) || (c.parent ? norm(c.parent.name).includes(target) || target.includes(norm(c.parent.name)) : false);
  });
  return partial?.id ?? null;
}

/**
 * Validate a numeric string with the Luhn (mod-10) checksum. IMEIs are
 * 15-digit numbers whose final digit is a Luhn check digit, so this cleanly
 * separates real IMEIs from arbitrary alphanumeric serial numbers.
 */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** True when the value is a valid 15-digit IMEI (15 digits + Luhn checksum). */
function isImei(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return /^\d{15}$/.test(digits) && luhnValid(digits);
}

/**
 * Lenient IMEI heuristic for known mobile categories. OCR frequently misreads a
 * single digit (which breaks the strict Luhn check) or bills print 14/16-digit
 * variants. On a phone bill the printed "serial" IS the IMEI — phones have no
 * separate serial — so within a mobile category any 14–16 digit numeric value
 * is treated as an IMEI.
 */
function looksLikeImei(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return /^\d{14,16}$/.test(digits);
}

/**
 * Fourth-pass enrichment. For every line item we:
 *  1. Resolve a leaf category (catalogue match or fuzzy categoryHint match) so
 *     the form preselects it and renders the dynamic attribute fields.
 *  2. Classify scanned identifiers: any 15-digit Luhn-valid number is an IMEI,
 *     not a serial. When the resolved category has an IMEI attribute (mobiles),
 *     those numbers are moved out of `serialNumbers` into
 *     `dynamicAttributes.<imeiAttr>` so they land in the correct field.
 *  3. For items with a model number, look up category-specific specs (RAM,
 *     storage, screen size, tonnage, etc.) via web search.
 * Lookups run in parallel; failures are silent.
 */
async function enrichProductSpecs(result: InvoiceParseResult): Promise<InvoiceParseResult> {
  const targets = result.items.map((item, index) => ({ item, index }));
  if (targets.length === 0) return result;

  // Resolve a leaf category for each item.
  const categoryIds = await Promise.all(targets.map(({ item }) => resolveLeafCategoryId(item)));

  // Fetch the full attribute schema for each distinct resolved category and
  // derive (a) the spec-lookup attributes and (b) the IMEI attribute name.
  const distinctCategoryIds = Array.from(new Set(categoryIds.filter((id): id is string => !!id)));
  const specAttrsByCategory = new Map<string, SpecAttributeDef[]>();
  const imeiAttrByCategory = new Map<string, string>();
  await Promise.all(
    distinctCategoryIds.map(async (categoryId) => {
      const attrs = await prisma.categoryAttribute.findMany({
        where: { categoryId, isActive: true },
        orderBy: { displayOrder: 'asc' },
        select: { attributeName: true, attributeLabel: true, attributeType: true, options: true },
      });
      const imeiAttr = attrs.find((a) => /imei/i.test(a.attributeName));
      if (imeiAttr) imeiAttrByCategory.set(categoryId, imeiAttr.attributeName);
      // Skip per-unit identifier fields (serials / IMEI) — those come from the
      // invoice, not from a spec lookup.
      const specAttrs: SpecAttributeDef[] = attrs
        .filter((a) => a.attributeType !== 'multi_text' && !/imei|serial/i.test(a.attributeName))
        .map((a) => ({
          attributeName: a.attributeName,
          attributeLabel: a.attributeLabel,
          attributeType: String(a.attributeType),
          options: Array.isArray(a.options)
            ? (a.options as unknown[]).map((o) =>
                typeof o === 'object' && o !== null ? String((o as Record<string, unknown>).value ?? o) : String(o),
              )
            : undefined,
        }));
      specAttrsByCategory.set(categoryId, specAttrs);
    }),
  );

  // Run spec lookups in parallel for items that have a model number AND a
  // resolved category with spec attributes.
  const lookups = await Promise.all(
    targets.map(({ item }, i) => {
      const categoryId = categoryIds[i];
      const attrs = categoryId ? specAttrsByCategory.get(categoryId) : undefined;
      if (!categoryId || !item.modelNumber?.trim() || !attrs || attrs.length === 0) {
        return Promise.resolve<Record<string, string>>({});
      }
      return resolveProductSpecsByWebSearch({
        brand: item.brand,
        modelNumber: item.modelNumber.trim(),
        categoryName: item.categoryHint,
        attributes: attrs,
      });
    }),
  );

  const items = [...result.items];
  const warnings = [...result.warnings];
  targets.forEach(({ index, item }, i) => {
    const categoryId = categoryIds[i];
    const specs = lookups[i];
    const next = { ...items[index] };

    // Attach the resolved category so the form preselects it and renders the
    // dynamic attribute fields.
    if (categoryId && !next.categoryId) next.categoryId = categoryId;

    const merged: Record<string, unknown> = { ...(next.dynamicAttributes ?? {}) };

    // (1) Reclassify IMEI numbers out of serialNumbers when the category has an
    // IMEI attribute (mobiles). IMEI uniquely identifies a phone (incl. its SIM
    // slots) and must never be stored as a generic serial.
    const imeiAttr = categoryId ? imeiAttrByCategory.get(categoryId) : undefined;
    if (imeiAttr && Array.isArray(next.serialNumbers) && next.serialNumbers.length > 0) {
      const imeis: string[] = [];
      const remaining: string[] = [];
      for (const sn of next.serialNumbers) {
        // Confident IMEI (15 digits + Luhn) OR a 14–16 digit numeric value in a
        // known mobile category — phones have no separate serial number.
        if (isImei(sn) || looksLikeImei(sn)) imeis.push(sn.replace(/\D/g, ''));
        else remaining.push(sn);
      }
      if (imeis.length > 0) {
        next.serialNumbers = remaining;
        const existing = Array.isArray(merged[imeiAttr]) ? (merged[imeiAttr] as string[]) : [];
        merged[imeiAttr] = Array.from(new Set([...existing, ...imeis]));
        warnings.push(
          `Detected ${imeis.length} IMEI number${imeis.length > 1 ? 's' : ''} for "${`${item.brand || ''} ${item.modelNumber || ''}`.trim()}" and moved them into the IMEI field — please verify.`,
        );
      }
    } else if (!imeiAttr && Array.isArray(next.serialNumbers) && next.serialNumbers.some(looksLikeImei)) {
      // Diagnostic: item has IMEI-looking numbers but no mobile category was
      // resolved, so they stay in serialNumbers. Surfaces category-resolution gaps.
      console.warn(
        `[ocr] IMEI-like serials found but category not resolved as mobile — categoryHint="${item.categoryHint ?? ''}", categoryId="${categoryId ?? ''}", brand="${item.brand ?? ''}", model="${item.modelNumber ?? ''}"`,
      );
    }

    // (2) Merge web-searched specs (only fill empty keys).
    if (specs && Object.keys(specs).length > 0) {
      const filled: string[] = [];
      for (const [key, value] of Object.entries(specs)) {
        if (merged[key] === undefined || merged[key] === '') {
          merged[key] = value;
          filled.push(`${key}=${value}`);
        }
      }
      if (filled.length > 0) {
        warnings.push(
          `Specifications for "${item.brand || ''} ${item.modelNumber}".trim() prefilled from web lookup (${filled.join(', ')}) — please verify.`,
        );
      }
    }

    next.dynamicAttributes = merged;
    items[index] = next;
  });

  return { ...result, items, warnings };
}

export const ocrService = {
  async parseInvoice(file: OcrFile, tenantId: string): Promise<InvoiceParseResult> {
    ensureEnabled();
    validateFile(file);

    const parsed = await parseWithOpenAi<InvoiceParseResult>({
      file,
      model: config.ocr.invoiceModel,
      schemaName: 'retailerp_invoice_parse',
      schema: invoiceJsonSchema,
      systemPrompt: [
        'You are a precise OCR system specialising in Indian GST purchase invoices for retail electronics, furniture, and mobile shops.',
        'Rules:',
        '- Return strict JSON matching the schema. Use null for any field that is not clearly visible — never guess or invent values.',
        '- For the line-item `brand` field: scan EVERY part of each row for a brand name — the dedicated Brand/Make column, the product description / particulars / description-of-goods column, AND the model number itself (model numbers often embed a brand prefix or code, e.g. "SAM-UA43T5500" => Samsung, "LG-32LM560" => LG, "WHR-IFPRO" => Whirlpool). Common Indian retail brands: Samsung, LG, Sony, Panasonic, Vivo, Oppo, Xiaomi/Redmi/MI, Realme, OnePlus, Apple, Bajaj, Havells, Whirlpool, Godrej, Voltas, Daikin, Hitachi, Blue Star, Carrier, IFB, Bosch, Haier, Crompton, Usha, V-Guard, Philips, Boat, JBL, Asus, HP, Dell, Lenovo, Acer, Sleepwell, Duroflex, Nilkamal, Cello, Prestige, Pigeon, Butterfly. If the brand is clearly written in the description (e.g. "Samsung 1.5T Split AC", "Whirlpool 265L Fridge"), extract it. ONLY return null when no brand word and no recognizable brand prefix is visible — a post-processing step will then resolve it via web search.',
        '- For the line-item `hsnCode` field: HSN/SAC codes are 4, 6, or 8 digit numeric codes. They are almost always printed on Indian GST invoices in a dedicated "HSN" / "HSN/SAC" / "HSN Code" column near the product description, OR repeated for each row, OR sometimes printed once for the whole invoice if all items share the same HSN. Look very carefully — do not return null unless absolutely nothing resembling an HSN code is visible. If only an item-level HSN is shown for some rows, apply that same HSN to other rows of the SAME product category. If the HSN is genuinely absent on the invoice, set it to null — a post-processing step will resolve it from the category.',
        '- Serial numbers / IMEI numbers are CRITICAL: copy every digit exactly as printed. A single wrong digit is a serious error. If you cannot read a digit clearly, include what you can see and add a warning.',
        '- Indian GSTIN is 15 characters: 2-digit state code + 10-char PAN + 1-char entity number + always "Z" + 1 checksum digit  (example: 07AABCU9603R1ZP).',
        '- PAN is 10 characters: 5 uppercase letters + 4 digits + 1 uppercase letter  (example: AABCU9603R). It is embedded in the GSTIN at positions 3–12, so if the GSTIN is readable the PAN is derivable.',
        '- Indian phone numbers are 10 digits, sometimes prefixed with +91 or 0.',
        '- Pincode is exactly 6 digits.',
        '- Prices may appear as ₹, Rs., or plain numbers. Never round or alter them.',
        '- For multiple serial numbers under one model, list each in the serialNumbers array.',
        '- rawText must contain ALL visible text from the invoice exactly as printed, preserving line breaks. This is used to verify your extraction.',
      ].join('\n'),
      userPrompt: [
        'Read this Indian GST purchase invoice carefully and extract the following fields:',
        '',
        'SUPPLIER / DISTRIBUTOR (the company that issued the invoice — usually top of page):',
        '  - companyName: exact legal name as printed',
        '  - gstNumber: full 15-character GSTIN (e.g. 07AABCU9603R1ZP)',
        '  - panNumber: 10-character PAN (e.g. AABCU9603R) — derive from GSTIN positions 3–12 if needed',
        '  - address: full street/locality address line(s)',
        '  - city: city name only',
        '  - state: state name only',
        '  - pincode: 6-digit pincode — look carefully in the address block; it often appears at the end of the address line or after the city/state. If not printed, return null.',
        '  - phone: ALL phone/mobile numbers visible for the supplier, separated by commas (e.g. "9811012345, 011-47001234"). Look in the header, footer, and letterhead.',
        '  - bankName: bank name from the "Bank Details" / "Payment Details" section, if printed (e.g. "HDFC Bank", "State Bank of India")',
        '  - bankAccountNumber: account number from the bank details block — transcribe digits exactly, no spaces',
        '  - bankIfsc: 11-character IFSC code (4 letters + 0 + 6 alphanumeric, e.g. "HDFC0001234") from the bank details block',
        '  - bankBranch: branch name printed alongside the bank details',
        '  Bank details are usually printed in the invoice footer in a section labelled "Bank Details", "Payment Details", "Account Details", or near the supplier\'s signature. If absent, return null for these fields — do not guess.',
        '',
        'INVOICE HEADER:',
        '  - number: invoice number exactly as printed',
        '  - date: invoice date exactly as printed',
        '  - supplierStateCode: first 2 digits of supplier GSTIN',
        '  - buyerStateCode: first 2 digits of buyer GSTIN',
        '  - gstSplit: "CGST_SGST" if CGST+SGST columns are present, "IGST" if IGST column is present',
        '  - totals.taxableAmount: total taxable value before GST',
        '  - totals.gstAmount: total GST amount',
        '  - totals.netAmount: grand total / invoice total',
        '',
        'LINE ITEMS (one entry per product model):',
        '  - brand: manufacturer name — look in the Brand/Make column AND inside the product description/particulars text AND as a prefix on the model number. Recognize brand words even when mixed into the description (e.g. "Samsung 1.5T Split AC", "LG 7kg Front Load WM", "Whirlpool 265L Refrigerator", "Vivo Y21"). Only return null if no recognizable brand text is anywhere on the row.',
        '  - modelNumber: exact alphanumeric model number as printed — do NOT paraphrase',
        '  - hsnCode: HSN/SAC code for this item — look in the dedicated HSN column on EVERY row, not just the first. If the column shows a single HSN for the whole invoice apply it to every row. Common HSN codes: 8528 (TV), 8418 (Refrigerator), 8415 (AC), 8450 (Washing Machine), 8517 (Mobile phone), 8471 (Laptop), 9403 (Furniture), 8507 (Battery — inverter / automotive / UPS).',
        '  - serialNumbers: array of ALL serial / IMEI numbers for this model line — read each character very carefully, transcribe exactly',
        '  - quantity: number of units',
        '  - mrp: maximum retail price per unit',
        '  - purchasePrice: price per unit being billed on this invoice',
        '  - gstPercent: GST rate as a number (5, 12, 18, or 28)',
        '  - color: colour/variant if printed',
        '  - warrantyMonths: warranty in months if stated',
        '  - categoryHint: product category, as specific as possible (e.g. "Smartphone", "Split AC", "LED TV", "Front Load Washing Machine", "Double Door Refrigerator", "Inverter Battery"). Use the most precise sub-type visible — this drives automatic lookup of category-specific specifications (RAM/storage for mobiles, tonnage/star-rating for ACs, screen-size/resolution for TVs, etc.) in a later step.',
        '',
        'Do NOT attempt to fill product specifications such as RAM, storage, screen size, tonnage, or star rating — these are enriched automatically after parsing via a web lookup keyed on the brand + model number. Just capture brand, modelNumber and a precise categoryHint accurately.',
        '',
        'Set rawText to ALL text from the invoice (full verbatim transcription).',
        'Add entries in warnings for anything that was hard to read, ambiguous, or partially obscured.',
      ].join('\n'),
    });

    const validated = invoiceParseSchema.parse(parsed);
    const processed = postProcessInvoice(validated);
    const enrichedFromCatalog = await enrichFromExistingProducts(processed, tenantId);
    const enrichedBrands = await resolveMissingBrands(enrichedFromCatalog);
    const enriched = await resolveMissingHsn(enrichedBrands);
    const enrichedSpecs = await enrichProductSpecs(enriched);
    const match = await matchDistributor(enrichedSpecs.distributor.parsed, tenantId);
    return { ...enrichedSpecs, distributor: { ...enrichedSpecs.distributor, match } };
  },

  async parseRegisterEntry(file: OcrFile): Promise<RegisterParseResult> {
    ensureEnabled();
    validateFile(file);

    const parsed = await parseWithOpenAi<RegisterParseResult>({
      file,
      model: config.ocr.registerModel,
      schemaName: 'retailerp_register_parse',
      schema: registerJsonSchema,
      systemPrompt: 'You extract handwritten sale-register rows for a retail ERP. Return strict JSON only. Use null when unsure. Do not invent missing values.',
      userPrompt: 'Read this register page and extract sale rows. Capture date, ledger number, customer name, phone, model number, amount, payment mode, and remarks when visible.',
    });

    return registerParseSchema.parse(parsed);
  },
};