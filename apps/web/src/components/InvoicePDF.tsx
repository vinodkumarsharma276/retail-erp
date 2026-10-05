import React from 'react';
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface InvoiceData {
  // Shop
  shopName: string;
  shopAddress: string;
  shopGstin: string;
  shopPhone: string;
  shopState: string;
  // Sale
  saleNumber: string;
  ledgerNumber: string;
  saleDate: string;
  // Customer
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  /** True for B2B customers — switches the bill-to label and shows business name + GSTIN. */
  customerIsBusiness?: boolean;
  /** B2B legal business name (shown above customerName for business customers). */
  customerBusinessName?: string | null;
  /** B2B GSTIN to print on the invoice (input credit reporting). */
  customerGstin?: string | null;
  // Product
  productBrand: string;
  productModel: string;
  productSerial?: string;
  productCategory?: string;
  hsnCode?: string;
  /** IMEI number(s) for mobile sales — printed below the model line. */
  productImeis?: string[];
  // Pricing (SP is GST-inclusive)
  sellingPrice: number;
  gstRate: number;
  gstType: string; // "GST", "CGST_SGST", or "IGST"
  // Payment
  paymentMode: string;
  paymentBreakdown?: Array<{mode: string; amount: number}> | null;
}

// ---------------------------------------------------------------------------
// Number to Words (Indian numbering: lakhs, crores)
// ---------------------------------------------------------------------------
const ones = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const tens = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function twoDigitToWords(n: number): string {
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
}

function threeDigitToWords(n: number): string {
  if (n === 0) return '';
  if (n < 100) return twoDigitToWords(n);
  const h = Math.floor(n / 100);
  const rem = n % 100;
  return ones[h] + ' Hundred' + (rem ? ' and ' + twoDigitToWords(rem) : '');
}

export function numberToWords(num: number | string | null | undefined): string {
  const n = Number(num) || 0;
  if (n === 0) return 'Zero Rupees Only';

  const rupees = Math.floor(Math.abs(n));
  const paise = Math.round((Math.abs(n) - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  let result = '';

  // Crore (1,00,00,000)
  const crore = Math.floor(rupees / 10000000);
  if (crore > 0) {
    result += twoDigitToWords(crore) + ' Crore ';
  }

  // Lakh (1,00,000)
  const lakh = Math.floor((rupees % 10000000) / 100000);
  if (lakh > 0) {
    result += twoDigitToWords(lakh) + ' Lakh ';
  }

  // Thousand (1,000)
  const thousand = Math.floor((rupees % 100000) / 1000);
  if (thousand > 0) {
    result += twoDigitToWords(thousand) + ' Thousand ';
  }

  // Hundreds & rest
  const rest = rupees % 1000;
  if (rest > 0) {
    result += threeDigitToWords(rest) + ' ';
  }

  result += 'Rupees';

  if (paise > 0) {
    result += ' and ' + twoDigitToWords(paise) + ' Paise';
  }

  result += ' Only';
  return result.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Simple INR formatter for PDF (no Intl)
// ---------------------------------------------------------------------------
function formatRupees(amount: number | string | null | undefined): string {
  const num = Number(amount) || 0;
  const fixed = num.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  // Indian grouping: last 3 digits, then groups of 2
  const intStr = intPart.replace(/^-/, '');
  const isNeg = num < 0;
  let grouped: string;
  if (intStr.length <= 3) {
    grouped = intStr;
  } else {
    const last3 = intStr.slice(-3);
    let remaining = intStr.slice(0, -3);
    const groups: string[] = [];
    while (remaining.length > 2) {
      groups.unshift(remaining.slice(-2));
      remaining = remaining.slice(0, -2);
    }
    if (remaining.length > 0) {
      groups.unshift(remaining);
    }
    grouped = groups.join(',') + ',' + last3;
  }
  return (isNeg ? '-' : '') + grouped + '.' + decPart;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#1a1a1a',
  },
  // Outer border around entire invoice
  outerBorder: {
    border: '1.5pt solid #333333',
  },
  // Header section
  headerRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #333333',
  },
  headerLeft: {
    flex: 1,
    padding: 12,
  },
  headerRight: {
    width: 200,
    padding: 12,
    borderLeft: '1pt solid #333333',
  },
  title: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    paddingVertical: 6,
    backgroundColor: '#f0f0f0',
    borderBottom: '1pt solid #333333',
    letterSpacing: 2,
  },
  shopName: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 3,
  },
  shopDetail: {
    fontSize: 9,
    marginBottom: 2,
    color: '#333333',
  },
  invoiceLabel: {
    fontSize: 9,
    color: '#666666',
    marginBottom: 1,
  },
  invoiceValue: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
  },
  // Customer section
  customerSection: {
    padding: 12,
    borderBottom: '1pt solid #333333',
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#666666',
    marginBottom: 4,
    textTransform: 'uppercase' as any,
  },
  customerName: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  customerDetail: {
    fontSize: 9,
    color: '#333333',
    marginBottom: 1,
  },
  // Table
  tableHeader: {
    flexDirection: 'row',
    borderBottom: '1pt solid #333333',
    backgroundColor: '#f0f0f0',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #cccccc',
    minHeight: 40,
  },
  colSno: {
    width: 35,
    padding: 6,
    borderRight: '0.5pt solid #cccccc',
    textAlign: 'center',
  },
  colDesc: {
    flex: 1,
    padding: 6,
    borderRight: '0.5pt solid #cccccc',
  },
  colHsn: {
    width: 60,
    padding: 6,
    borderRight: '0.5pt solid #cccccc',
    textAlign: 'center',
  },
  colQty: {
    width: 40,
    padding: 6,
    borderRight: '0.5pt solid #cccccc',
    textAlign: 'center',
  },
  colAmount: {
    width: 100,
    padding: 6,
    textAlign: 'right',
  },
  headerCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#333333',
    textTransform: 'uppercase' as any,
  },
  cellText: {
    fontSize: 9,
  },
  cellTextSmall: {
    fontSize: 8,
    color: '#666666',
    marginTop: 2,
  },
  cellTextBold: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  // Summary section
  summarySection: {
    borderBottom: '1pt solid #333333',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
  summaryLabel: {
    width: 180,
    textAlign: 'right',
    fontSize: 9,
    paddingRight: 12,
    color: '#333333',
  },
  summaryValue: {
    width: 100,
    textAlign: 'right',
    fontSize: 9,
  },
  summaryDivider: {
    borderBottom: '0.5pt solid #999999',
    marginHorizontal: 12,
    marginVertical: 2,
    marginLeft: '50%',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#f0f0f0',
  },
  grandTotalLabel: {
    width: 180,
    textAlign: 'right',
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    paddingRight: 12,
  },
  grandTotalValue: {
    width: 100,
    textAlign: 'right',
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
  },
  // Payment details
  paymentSection: {
    padding: 12,
    borderBottom: '1pt solid #333333',
  },
  paymentRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  paymentLabel: {
    width: 140,
    fontSize: 9,
    color: '#666666',
  },
  paymentValue: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  // Amount in words
  amountInWordsSection: {
    padding: 12,
    borderBottom: '1pt solid #333333',
  },
  amountInWordsLabel: {
    fontSize: 8,
    color: '#666666',
    marginBottom: 2,
  },
  amountInWordsText: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
  },
  // Terms & signatory
  footerSection: {
    flexDirection: 'row',
  },
  termsSection: {
    flex: 1,
    padding: 12,
    borderRight: '1pt solid #333333',
  },
  termsTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#666666',
    marginBottom: 4,
    textTransform: 'uppercase' as any,
  },
  termsText: {
    fontSize: 8,
    color: '#444444',
    marginBottom: 2,
  },
  signatorySection: {
    width: 200,
    padding: 12,
    textAlign: 'right',
    justifyContent: 'space-between',
  },
  signatoryLabel: {
    fontSize: 8,
    color: '#666666',
    marginTop: 40,
  },
  signatoryShop: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    marginTop: 2,
  },
});

// ---------------------------------------------------------------------------
// Helper to format payment mode
// ---------------------------------------------------------------------------
function formatPaymentMode(mode: string): string {
  return mode
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}



// ---------------------------------------------------------------------------
// Invoice PDF Component
// ---------------------------------------------------------------------------
export function InvoicePDF({ data }: { data: InvoiceData }) {
  // Reverse calculation: SP is GST-inclusive
  const gstRate = data.gstRate || 0;
  const baseAmount = gstRate > 0
    ? Math.round((data.sellingPrice * 100) / (100 + gstRate) * 100) / 100
    : data.sellingPrice;
  const gstAmount = gstRate > 0
    ? Math.round((data.sellingPrice - baseAmount) * 100) / 100
    : 0;
  const halfGst = Math.round((gstAmount / 2) * 100) / 100;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.outerBorder}>
          {/* Title */}
          <Text style={styles.title}>TAX INVOICE</Text>

          {/* Header: Shop info + Invoice details */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.shopName}>{data.shopName}</Text>
              <Text style={styles.shopDetail}>{data.shopAddress}</Text>
              <Text style={styles.shopDetail}>GSTIN: {data.shopGstin}</Text>
              <Text style={styles.shopDetail}>Phone: {data.shopPhone}</Text>
              {data.shopState && (
                <Text style={styles.shopDetail}>State: {data.shopState}</Text>
              )}
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.invoiceLabel}>Invoice No.</Text>
              <Text style={styles.invoiceValue}>{data.saleNumber}</Text>
              <Text style={styles.invoiceLabel}>Date</Text>
              <Text style={styles.invoiceValue}>{data.saleDate}</Text>
              <Text style={styles.invoiceLabel}>Ledger No.</Text>
              <Text style={styles.invoiceValue}>{data.ledgerNumber}</Text>
            </View>
          </View>

          {/* Customer section — for B2B, show business name as the
              primary line and the contact person + GSTIN below; for
              individuals, show just the name + phone + address. */}
          <View style={styles.customerSection}>
            <Text style={styles.sectionTitle}>
              {data.customerIsBusiness ? 'Bill To (B2B)' : 'Bill To'}
            </Text>
            {data.customerIsBusiness && data.customerBusinessName ? (
              <>
                <Text style={styles.customerName}>{data.customerBusinessName}</Text>
                <Text style={styles.customerDetail}>Contact: {data.customerName}</Text>
              </>
            ) : (
              <Text style={styles.customerName}>{data.customerName}</Text>
            )}
            <Text style={styles.customerDetail}>Phone: {data.customerPhone}</Text>
            {data.customerAddress && (
              <Text style={styles.customerDetail}>{data.customerAddress}</Text>
            )}
            {data.customerIsBusiness && data.customerGstin && (
              <Text style={styles.customerDetail}>GSTIN: {data.customerGstin}</Text>
            )}
          </View>

          {/* Items table header */}
          <View style={styles.tableHeader}>
            <View style={styles.colSno}>
              <Text style={styles.headerCell}>S.No</Text>
            </View>
            <View style={styles.colDesc}>
              <Text style={styles.headerCell}>Description</Text>
            </View>
            <View style={styles.colHsn}>
              <Text style={styles.headerCell}>HSN</Text>
            </View>
            <View style={styles.colQty}>
              <Text style={styles.headerCell}>Qty</Text>
            </View>
            <View style={styles.colAmount}>
              <Text style={styles.headerCell}>Amount</Text>
            </View>
          </View>

          {/* Items table row */}
          <View style={styles.tableRow}>
            <View style={styles.colSno}>
              <Text style={styles.cellText}>1</Text>
            </View>
            <View style={styles.colDesc}>
              <Text style={styles.cellTextBold}>
                {data.productBrand} {data.productModel}
              </Text>
              {data.productSerial && (
                <Text style={styles.cellTextSmall}>
                  Serial: {data.productSerial}
                </Text>
              )}
              {data.productImeis && data.productImeis.length > 0 && (
                <Text style={styles.cellTextSmall}>
                  IMEI:{' '}
                  {data.productImeis
                    .filter((v) => v && v.trim().length > 0)
                    .join(' / ')}
                </Text>
              )}
              {data.productCategory && (
                <Text style={styles.cellTextSmall}>
                  Category: {data.productCategory}
                </Text>
              )}
            </View>
            <View style={styles.colHsn}>
              <Text style={styles.cellText}>{data.hsnCode || '-'}</Text>
            </View>
            <View style={styles.colQty}>
              <Text style={styles.cellText}>1</Text>
            </View>
            <View style={styles.colAmount}>
              <Text style={styles.cellTextBold}>{formatRupees(baseAmount)}</Text>
            </View>
          </View>

          {/* Tax summary */}
          <View style={styles.summarySection}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Taxable Amount:</Text>
              <Text style={styles.summaryValue}>{formatRupees(baseAmount)}</Text>
            </View>

            {gstRate > 0 && (
              <>
                {data.gstType === 'CGST_SGST' ? (
                  <>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>
                        CGST @ {gstRate / 2}%:
                      </Text>
                      <Text style={styles.summaryValue}>{formatRupees(halfGst)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>
                        SGST @ {gstRate / 2}%:
                      </Text>
                      <Text style={styles.summaryValue}>{formatRupees(halfGst)}</Text>
                    </View>
                  </>
                ) : data.gstType === 'IGST' ? (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>
                      IGST @ {gstRate}%:
                    </Text>
                    <Text style={styles.summaryValue}>{formatRupees(gstAmount)}</Text>
                  </View>
                ) : (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>
                      GST @ {gstRate}%:
                    </Text>
                    <Text style={styles.summaryValue}>{formatRupees(gstAmount)}</Text>
                  </View>
                )}
              </>
            )}

            <View style={styles.summaryDivider} />

            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Grand Total:</Text>
              <Text style={styles.grandTotalValue}>
                Rs. {formatRupees(data.sellingPrice)}
              </Text>
            </View>
          </View>

          {/* Payment details — always shown as full payment on invoice */}
          <View style={styles.paymentSection}>
            <Text style={styles.sectionTitle}>Payment Details</Text>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Payment Mode:</Text>
              <Text style={styles.paymentValue}>
                {data.paymentBreakdown && data.paymentBreakdown.length > 1
                  ? data.paymentBreakdown
                      .map((p) => `${formatPaymentMode(p.mode)} - Rs. ${formatRupees(p.amount)}`)
                      .join(', ')
                  : formatPaymentMode(data.paymentMode)}
              </Text>
            </View>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Amount Received:</Text>
              <Text style={styles.paymentValue}>
                Rs. {formatRupees(data.sellingPrice)}
              </Text>
            </View>
          </View>

          {/* Amount in words */}
          <View style={styles.amountInWordsSection}>
            <Text style={styles.amountInWordsLabel}>Amount in Words</Text>
            <Text style={styles.amountInWordsText}>
              {numberToWords(data.sellingPrice)}
            </Text>
          </View>

          {/* Footer: Terms + Signatory */}
          <View style={styles.footerSection}>
            <View style={styles.termsSection}>
              <Text style={styles.termsTitle}>Terms & Conditions</Text>
              <Text style={styles.termsText}>
                1. Goods once sold will not be taken back or exchanged.
              </Text>
              <Text style={styles.termsText}>
                2. All disputes are subject to local jurisdiction only.
              </Text>
              <Text style={styles.termsText}>
                3. E. & O.E. (Errors and Omissions Excepted).
              </Text>
            </View>
            <View style={styles.signatorySection}>
              <Text style={styles.signatoryLabel}>Authorized Signatory</Text>
              <Text style={styles.signatoryShop}>For {data.shopName}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------
export async function downloadInvoicePDF(data: InvoiceData): Promise<void> {
  const blob = await pdf(React.createElement(InvoicePDF, { data }) as unknown as Parameters<typeof pdf>[0]).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Invoice-${data.saleNumber}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
