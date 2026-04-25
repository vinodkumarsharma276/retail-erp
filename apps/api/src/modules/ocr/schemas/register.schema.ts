import { z } from 'zod';

export const registerParseSchema = z.object({
  rows: z.array(z.object({
    rowIndex: z.number().int().min(1),
    date: z.string().nullable(),
    ledgerNumber: z.string().nullable(),
    customerName: z.string().nullable(),
    phone: z.string().nullable(),
    modelNumber: z.string().nullable(),
    amount: z.number().nullable(),
    paymentMode: z.enum(['cash', 'upi', 'card', 'installment']).nullable(),
    remarks: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })),
  warnings: z.array(z.string()),
  rawText: z.string().nullable(),
});

export type RegisterParseResult = z.infer<typeof registerParseSchema>;

export const registerJsonSchema = {
  type: 'object', additionalProperties: false, required: ['rows', 'warnings', 'rawText'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['rowIndex', 'date', 'ledgerNumber', 'customerName', 'phone', 'modelNumber', 'amount', 'paymentMode', 'remarks', 'confidence'],
        properties: {
          rowIndex: { type: 'integer' }, date: { type: ['string', 'null'] }, ledgerNumber: { type: ['string', 'null'] },
          customerName: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] }, modelNumber: { type: ['string', 'null'] },
          amount: { type: ['number', 'null'] }, paymentMode: { type: ['string', 'null'], enum: ['cash', 'upi', 'card', 'installment', null] },
          remarks: { type: ['string', 'null'] }, confidence: { type: 'number' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
    rawText: { type: ['string', 'null'] },
  },
} as const;