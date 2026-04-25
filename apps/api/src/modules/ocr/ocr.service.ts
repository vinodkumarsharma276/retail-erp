import { config } from '../../config/index.js';
import { invoiceJsonSchema, invoiceParseSchema, type InvoiceParseResult } from './schemas/invoice.schema.js';
import { registerJsonSchema, registerParseSchema, type RegisterParseResult } from './schemas/register.schema.js';
import { parseWithOpenAi } from './providers/openai-vision.provider.js';
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

export const ocrService = {
  async parseInvoice(file: OcrFile): Promise<InvoiceParseResult> {
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
        '  - brand: manufacturer name (Samsung, LG, Bajaj, etc.)',
        '  - modelNumber: exact alphanumeric model number as printed — do NOT paraphrase',
        '  - hsnCode: HSN/SAC code for this item',
        '  - serialNumbers: array of ALL serial / IMEI numbers for this model line — read each character very carefully, transcribe exactly',
        '  - quantity: number of units',
        '  - mrp: maximum retail price per unit',
        '  - purchasePrice: price per unit being billed on this invoice',
        '  - gstPercent: GST rate as a number (5, 12, 18, or 28)',
        '  - color: colour/variant if printed',
        '  - warrantyMonths: warranty in months if stated',
        '  - categoryHint: product category (TV, AC, Refrigerator, Washing Machine, Mobile, Laptop, etc.)',
        '',
        'Set rawText to ALL text from the invoice (full verbatim transcription).',
        'Add entries in warnings for anything that was hard to read, ambiguous, or partially obscured.',
      ].join('\n'),
    });

    const validated = invoiceParseSchema.parse(parsed);
    const processed = postProcessInvoice(validated);
    const match = await matchDistributor(processed.distributor.parsed);
    return { ...processed, distributor: { ...processed.distributor, match } };
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