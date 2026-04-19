import { apiClient } from './api-client';
import { formatDateIN } from '@retailerp/shared-utils';
import type { InvoiceData } from '../components/InvoicePDF';
import type { ApiResponse, Shop } from '@retailerp/shared-types';
import type { SaleDetailResponse } from '../hooks/useSales';

/**
 * Parse GST type from the notes field.
 * Notes contain "GST Type: CGST_SGST" or "GST Type: IGST" or "GST Type: GST".
 */
function parseGstType(notes?: string | null): string {
  if (!notes) return 'GST';
  const match = notes.match(/GST Type:\s*(CGST_SGST|IGST|GST)/i);
  return match ? match[1].toUpperCase() : 'GST';
}

/**
 * Build a full shop address string from the Shop object fields.
 */
function buildShopAddress(shop: Shop): string {
  const parts: string[] = [];
  if (shop.addressLine1) parts.push(shop.addressLine1);
  if (shop.addressLine2) parts.push(shop.addressLine2);
  if (shop.city) parts.push(shop.city);
  if (shop.state) parts.push(shop.state);
  if (shop.pincode) parts.push(shop.pincode);
  return parts.join(', ');
}

/**
 * Build a multi-line customer address string.
 */
function buildCustomerAddress(customer: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
} | null | undefined): string | undefined {
  if (!customer) return undefined;
  const parts: string[] = [];
  if (customer.addressLine1) parts.push(customer.addressLine1);
  if (customer.addressLine2) parts.push(customer.addressLine2);
  const cityState = [customer.city, customer.state, customer.pincode]
    .filter(Boolean)
    .join(', ');
  if (cityState) parts.push(cityState);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Fetch all data needed for the invoice and trigger the PDF download.
 * Fetches both the sale detail and the shop detail in parallel.
 */
export async function handleInvoiceDownload(saleId: string): Promise<void> {
  // Fetch sale detail and shop detail in parallel
  const saleRes = await apiClient.get<ApiResponse<SaleDetailResponse>>(
    `/sales/${saleId}`,
  );
  const sale = saleRes.data.data!;

  // The sale response includes shop with { id, name, code }
  // We need full shop info — fetch it from /shops/:id
  const shopId = sale.shopId;
  let shop: Shop | null = null;
  try {
    const shopRes = await apiClient.get<ApiResponse<Shop>>(`/shops/${shopId}`);
    shop = shopRes.data.data!;
  } catch {
    // If shop fetch fails (e.g., non-admin), use fallback data
    shop = null;
  }

  const invoiceData: InvoiceData = {
    // Shop info — use full shop data if available, fallback to basic
    shopName: shop?.name || (sale as any).shop?.name || '',
    shopAddress: shop ? buildShopAddress(shop) : '',
    shopGstin: shop?.gstNumber || '',
    shopPhone: shop?.phone || '',
    shopState: shop?.state || '',
    // Sale
    saleNumber: sale.saleNumber,
    ledgerNumber: sale.ledgerNumber,
    saleDate: formatDateIN(sale.saleDate),
    // Customer
    customerName: sale.customer?.name || '',
    customerPhone: sale.customer?.phone || '',
    customerAddress: buildCustomerAddress(sale.customer as any),
    // Product
    productBrand: sale.product?.brand || '',
    productModel: sale.product?.modelNumber || '',
    productSerial: sale.product?.serialNumber || undefined,
    productCategory:
      (sale.product as any)?.category?.name || undefined,
    hsnCode: (sale.product as any)?.category?.hsnCode || undefined,
    // Pricing — coerce Prisma Decimals to numbers
    sellingPrice: Number(sale.sellingPrice) || 0,
    gstRate: Number(sale.gstRate) || 0,
    gstType: parseGstType(sale.notes),
    // Payment
    paymentMode: sale.paymentMode,
    paymentBreakdown: sale.paymentBreakdown ?? null,
  };

  // Dynamic import to keep bundle small for non-invoice pages
  const { downloadInvoicePDF } = await import('../components/InvoicePDF');
  await downloadInvoicePDF(invoiceData);
}
