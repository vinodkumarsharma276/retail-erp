import { apiClient } from '../lib/api-client';

export interface ParsedInvoiceItem {
  brand: string | null;
  modelNumber: string | null;
  categoryHint: string | null;
  hsnCode: string | null;
  serialNumbers: string[];
  quantity: number;
  mrp: number | null;
  purchasePrice: number | null;
  sellingPrice: number | null;
  gstPercent: number | null;
  color: string | null;
  warrantyMonths: number | null;
  barcode: string | null;
  notes: string | null;
  confidence: number;
}

export interface InvoiceParseResult {
  source: { kind: 'image' | 'pdf'; pageCount: number };
  invoice: {
    number: string | null;
    date: string | null;
    supplierStateCode: string | null;
    buyerStateCode: string | null;
    gstSplit: 'CGST_SGST' | 'IGST' | null;
    totals: { taxableAmount: number | null; gstAmount: number | null; netAmount: number | null };
  };
  distributor: {
    parsed: {
      companyName: string | null;
      gstNumber: string | null;
      panNumber: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      pincode: string | null;
      phone: string | null;
    };
    match: {
      id: string | null;
      companyName: string | null;
      contactPerson?: string | null;
      phone?: string | null;
      gstNumber?: string | null;
      matchedBy: 'gst' | 'name' | null;
      confidence: number;
    };
  };
  items: ParsedInvoiceItem[];
  warnings: string[];
  rawText: string | null;
}

export interface RegisterParseRow {
  rowIndex: number;
  date: string | null;
  ledgerNumber: string | null;
  customerName: string | null;
  phone: string | null;
  modelNumber: string | null;
  amount: number | null;
  paymentMode: 'cash' | 'upi' | 'card' | 'installment' | null;
  remarks: string | null;
  confidence: number;
}

export interface RegisterParseResult {
  rows: RegisterParseRow[];
  warnings: string[];
  rawText: string | null;
}

export interface OcrStatus {
  enabled: boolean;
  provider: string;
  invoiceModel: string;
  registerModel: string;
}

async function postFile<T>(url: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await apiClient.post<{ data: T }>(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.data;
}

export const ocrApi = {
  status: async () => {
    const { data } = await apiClient.get<{ data: OcrStatus }>('/ocr/status');
    return data.data;
  },
  parseInvoice: (file: File) => postFile<InvoiceParseResult>('/ocr/invoice', file),
  parseRegisterEntry: (file: File) => postFile<RegisterParseResult>('/ocr/register-entry', file),
};