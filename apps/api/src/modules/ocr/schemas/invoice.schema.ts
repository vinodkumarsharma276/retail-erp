import { z } from 'zod';

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const invoiceParseSchema = z.object({
  source: z.object({
    kind: z.enum(['image', 'pdf']),
    pageCount: z.number().int().min(1),
  }),
  invoice: z.object({
    number: nullableString,
    date: nullableString,
    supplierStateCode: nullableString,
    buyerStateCode: nullableString,
    gstSplit: z.enum(['CGST_SGST', 'IGST']).nullable(),
    totals: z.object({
      taxableAmount: nullableNumber,
      gstAmount: nullableNumber,
      netAmount: nullableNumber,
    }),
  }),
  distributor: z.object({
    parsed: z.object({
      companyName: nullableString,
      gstNumber: nullableString,
      panNumber: nullableString,
      address: nullableString,
      city: nullableString,
      state: nullableString,
      pincode: nullableString,
      phone: nullableString,
    }),
    match: z.object({
      id: nullableString,
      companyName: nullableString,
      contactPerson: nullableString.optional(),
      phone: nullableString.optional(),
      gstNumber: nullableString.optional(),
      matchedBy: z.enum(['gst', 'name']).nullable(),
      confidence: z.number().min(0).max(1),
    }),
  }),
  items: z.array(z.object({
    brand: nullableString,
    modelNumber: z.string().nullable(),
    categoryHint: nullableString,
    hsnCode: nullableString,
    serialNumbers: z.array(z.string()),
    quantity: z.number().int().min(1),
    mrp: nullableNumber,
    purchasePrice: nullableNumber,
    sellingPrice: nullableNumber,
    gstPercent: nullableNumber,
    color: nullableString,
    warrantyMonths: nullableNumber,
    barcode: nullableString,
    notes: nullableString,
    confidence: z.number().min(0).max(1),
  })),
  warnings: z.array(z.string()),
  rawText: z.string().nullable(),
});

export type InvoiceParseResult = z.infer<typeof invoiceParseSchema>;

export const invoiceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'invoice', 'distributor', 'items', 'warnings', 'rawText'],
  properties: {
    source: {
      type: 'object', additionalProperties: false, required: ['kind', 'pageCount'],
      properties: { kind: { type: 'string', enum: ['image', 'pdf'] }, pageCount: { type: 'integer' } },
    },
    invoice: {
      type: 'object', additionalProperties: false, required: ['number', 'date', 'supplierStateCode', 'buyerStateCode', 'gstSplit', 'totals'],
      properties: {
        number: { type: ['string', 'null'] }, date: { type: ['string', 'null'] },
        supplierStateCode: { type: ['string', 'null'] }, buyerStateCode: { type: ['string', 'null'] },
        gstSplit: { type: ['string', 'null'], enum: ['CGST_SGST', 'IGST', null] },
        totals: {
          type: 'object', additionalProperties: false, required: ['taxableAmount', 'gstAmount', 'netAmount'],
          properties: { taxableAmount: { type: ['number', 'null'] }, gstAmount: { type: ['number', 'null'] }, netAmount: { type: ['number', 'null'] } },
        },
      },
    },
    distributor: {
      type: 'object', additionalProperties: false, required: ['parsed', 'match'],
      properties: {
        parsed: {
          type: 'object', additionalProperties: false, required: ['companyName', 'gstNumber', 'panNumber', 'address', 'city', 'state', 'pincode', 'phone'],
          properties: {
            companyName: { type: ['string', 'null'] },
            gstNumber: { type: ['string', 'null'] },
            panNumber: { type: ['string', 'null'] },
            address: { type: ['string', 'null'] },
            city: { type: ['string', 'null'] },
            state: { type: ['string', 'null'] },
            pincode: { type: ['string', 'null'] },
            phone: { type: ['string', 'null'] },
          },
        },
        match: {
          type: 'object', additionalProperties: false, required: ['id', 'companyName', 'contactPerson', 'phone', 'gstNumber', 'matchedBy', 'confidence'],
          properties: {
            id: { type: ['string', 'null'] }, companyName: { type: ['string', 'null'] }, contactPerson: { type: ['string', 'null'] },
            phone: { type: ['string', 'null'] }, gstNumber: { type: ['string', 'null'] },
            matchedBy: { type: ['string', 'null'], enum: ['gst', 'name', null] }, confidence: { type: 'number' },
          },
        },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['brand', 'modelNumber', 'categoryHint', 'hsnCode', 'serialNumbers', 'quantity', 'mrp', 'purchasePrice', 'sellingPrice', 'gstPercent', 'color', 'warrantyMonths', 'barcode', 'notes', 'confidence'],
        properties: {
          brand: { type: ['string', 'null'] }, modelNumber: { type: ['string', 'null'] }, categoryHint: { type: ['string', 'null'] }, hsnCode: { type: ['string', 'null'] },
          serialNumbers: { type: 'array', items: { type: 'string' } }, quantity: { type: 'integer' }, mrp: { type: ['number', 'null'] }, purchasePrice: { type: ['number', 'null'] },
          sellingPrice: { type: ['number', 'null'] }, gstPercent: { type: ['number', 'null'] }, color: { type: ['string', 'null'] }, warrantyMonths: { type: ['number', 'null'] },
          barcode: { type: ['string', 'null'] }, notes: { type: ['string', 'null'] }, confidence: { type: 'number' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
    rawText: { type: ['string', 'null'] },
  },
} as const;